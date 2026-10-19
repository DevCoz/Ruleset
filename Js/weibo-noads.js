/**
 * weibo-noads.js  v1.2
 * Surge http-response 脚本：清理微博 App 接口响应中的广告 / 推广条目
 *
 * 设计原则
 *   1. 只删「确定是广告」的节点，不整段清空业务数据；
 *   2. 同时兼容两代接口结构：老的 statuses / cards，新的 items / feed；
 *   3. 对 16 位以上整数（微博 id）做精度保护，避免 JSON.parse 改写 id；
 *   4. 任何异常都原样放行 —— 脚本出错绝不能导致 App 断网或白屏。
 *
 * v1.1 新增（对照 DevCoz/Ruleset 模块后补的判定，均已用差分用例验证）
 *   + itemid 中的广告位编码（c_type:51 / is_ad_pos / region_data ...）
 *   + mblogtypename / adType 取值「广告」「热推」
 *   + content_auth_info.content_auth_title 含「广告」
 *   + category=group + trend_name 的超话 / 视频推荐卡
 *   + 幸存条目上的品牌橱窗挂件（semantic_brand_params / shopwindow_cards）
 *   同时刻意**不采用**对方「对每个节点都 delete trend」的写法：
 *   实测会把话题页 / 超话页的业务数据一起删掉（见 test/compare-thirdparty.js）。
 *
 * v1.2 新增（对应真机反馈的两处漏广告）
 *   + 正文页评论流：adType=广告/荐读、type=15/41、readtimetype=adMblog
 *   + 应用下载广告：ads_material_info.is_ads=true
 *   + 热搜页 flowpage/flowlist：推广卡与推广热词（promotion 对象）
 *   + 搜索推广：actionlog.ext 含 ads_word、page_info.actionlog.source=ad
 *
 * 调试：在模块的脚本行里把 argument=debug=0 改成 argument=debug=1，
 *       Surge 的「脚本日志」会输出命中的 URL、删除数量与耗时。
 */

var DEBUG = (typeof $argument !== 'undefined') && String($argument).indexOf('debug=1') !== -1;

/* 大整数保护用的占位前缀，尽量不可能出现在真实业务字符串里 */
var BIG_PREFIX = '__WB_BIGINT_7f3c9a__';

/* ------------------------------------------------------------------ */
/* 入口                                                               */
/* ------------------------------------------------------------------ */

function main() {
    var url = (typeof $request !== 'undefined' && $request.url) ? $request.url : '';
    var raw = (typeof $response !== 'undefined') ? $response.body : null;

    if (typeof raw !== 'string' || raw.length === 0) {
        done();
        return;
    }

    // /photo/info 是图片推荐位专用接口，出现 ad_params 即为广告位，整体清空
    if (url.indexOf('/photo/info') !== -1 && raw.indexOf('ad_params') !== -1) {
        done('{}');
        return;
    }

    var obj;
    try {
        obj = parseJson(raw);
    } catch (e) {
        log('JSON 解析失败，原样放行：' + e);
        done();
        return;
    }

    var start = Date.now();
    var handler = pickHandler(routeOf(url));
    var removed = 0;

    try {
        if (handler) {
            removed = handler(obj) || 0;
        } else {
            removed = purge(obj, 0);
        }
    } catch (e) {
        log('处理异常，原样放行：' + e);
        done();
        return;
    }

    var out = stringifyJson(obj);

    if (DEBUG) {
        log('URL=' + url + ' | handler=' + (handler ? handler.name : 'generic') +
            ' | removed=' + removed + ' | in=' + raw.length + 'B out=' + out.length +
            'B | ' + (Date.now() - start) + 'ms');
        // removed=0 时把顶层键打出来：能区分「接口选错了」和「字段没覆盖」
        if (removed === 0) log('未命中广告字段，顶层键：' + topKeys(obj));
    }

    if (out === raw) {
        done();
    } else {
        done(out);
    }
}

/* ------------------------------------------------------------------ */
/* 路由：把 URL 归一化成 /2/ 之后的路径，避免用 indexOf 误匹配          */
/* ------------------------------------------------------------------ */

function routeOf(url) {
    var m = url.match(/^https?:\/\/[^\/]+(\/[^?#]*)?/i);
    var path = (m && m[1]) ? m[1] : url;
    var i = path.indexOf('/2/');
    if (i >= 0) return path.substring(i + 3);
    return path.replace(/^\//, '');
}

var TIMELINE = [
    'statuses/friends_timeline',
    'statuses/friends/timeline',
    'statuses/unread_friends_timeline',
    'statuses/unread',
    'statuses/video_timeline',
    'statuses/video_mixtimeline',
    'statuses/unread_hot_timeline',
    'groups/timeline',
    'fangle/timeline',
    'profile/statuses',
    'video/tiny_stream_video_list'
];

var CARDS = [
    'cardlist',
    'searchall',
    'page',
    'profile/me'
];

function pickHandler(route) {
    // 1) 精确/前缀匹配的独立接口
    if (route === 'comments/build_comments') return handleComments;
    if (route === 'flowpage') return handleFlowPage;
    if (route === 'flowlist') return handleFlowList;
    if (route === 'statuses/extend') return handleExtend;
    if (route === 'statuses/positives/get') return handleEmptyDatas;
    if (route === 'photo/recommend_list' || route === '!/photos/pic_recommend_status') return handleEmptyData;
    if (route === 'stories/video_stream') return handleVideoStream;
    if (route === 'stories/home_list') return handleEmptyStories;
    if (route === 'service/picfeed' || route === 'live/media_homelist') return handleEmptyDataArray;
    if (route === 'search/finder') return handleFinder;
    if (route === 'remind/unread_count') return handleUnreadCount;

    // 2) 新版 items / feed 结构（必须在 cardlist 之前判断）
    if (route.indexOf('statuses/container_timeline') === 0 ||
        route.indexOf('search/container_timeline') === 0 ||
        route.indexOf('search/container_discover') === 0 ||
        route.indexOf('profile/container_timeline') === 0 ||
        route.indexOf('messageflow/notice') === 0) {
        return handleItems;
    }

    // 3) 卡片流（热搜、搜索聚合、个人页）
    if (inList(CARDS, route)) return handleCards;

    // 4) 经典信息流
    if (inList(TIMELINE, route)) return handleTimeline;

    return null;
}

function inList(list, route) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === route) return true;
    }
    return false;
}

/* ------------------------------------------------------------------ */
/* 各接口处理函数                                                      */
/* ------------------------------------------------------------------ */

/** 经典信息流：statuses[] + ad / advertises / trends 容器 */
function handleTimeline(obj) {
    var removed = purge(obj, 0);

    if (isArray(obj.statuses)) {
        removed += dropAdItems(obj.statuses);
        // 幸存条目上挂的品牌橱窗 / 语义推广位，单独摘掉
        for (var i = 0; i < obj.statuses.length; i++) removed += stripAdWidgets(obj.statuses[i]);
    }
    if (isArray(obj.ad)) { removed += obj.ad.length; obj.ad = []; }
    if (isArray(obj.advertises)) { removed += obj.advertises.length; obj.advertises = []; }
    if (isArray(obj.trends)) removed += dropAdItems(obj.trends);

    // 微博用 original_num 记录「不含广告」的条数，num 含广告位
    if (typeof obj.num === 'number' && typeof obj.original_num === 'number') {
        obj.num = obj.original_num;
    }
    return removed;
}

/** 卡片流：cards[]，含 card_group 嵌套与热搜推广位 */
function handleCards(obj) {
    var removed = purge(obj, 0);
    if (isArray(obj.cards)) removed += filterCards(obj.cards);
    if (isArray(obj.items)) removed += filterItems(obj.items);
    return removed;
}

/** 新版 items[]：category=feed 的 mblogtype=1、category=card 的 118/89 */
function handleItems(obj) {
    var removed = purge(obj, 0);
    if (isArray(obj.items)) removed += filterItems(obj.items);
    if (isArray(obj.messages)) {
        for (var i = obj.messages.length - 1; i >= 0; i--) {
            var m = obj.messages[i];
            if (m && (m.isrecommend === true || m.isrecommend === 1)) {
                obj.messages.splice(i, 1);
                removed++;
            }
        }
    }
    return removed;
}

/* 评论流里的广告包装类型：1/5/6 是老版本，15/41 是新版本（过滤提示、氛围调查） */
var COMMENT_AD_TYPES = { 1: 1, 5: 1, 6: 1, 15: 1, 41: 1 };

/* 评论条目 adType 的取值表，只认这些明确表示推广/推荐的标签 */
var COMMENT_AD_TAGS = {
    '\u5e7f\u544a': 1,                 // 广告
    '\u8350\u8bfb': 1,                 // 荐读
    '\u8bc4\u8bba\u603b\u7ed3': 1,     // 评论总结
    '\u63a8\u8350': 1,                 // 推荐
    '\u76f8\u5173\u5185\u5bb9': 1,     // 相关内容
    '\u76f8\u5173\u8bc4\u8bba': 1      // 相关评论
};

/** 评论区：datas[] / root_comments[] 中带广告类型或 adType 标签的条目 */
function handleComments(obj) {
    var removed = purge(obj, 0);

    if (isArray(obj.datas)) removed += dropAdCommentItems(obj.datas);
    if (isArray(obj.root_comments)) removed += dropAdCommentItems(obj.root_comments);

    obj.recommend_max_id = 0;

    // 热评结构里夹带的广告回调，保留 max_id 后整块删除
    if (obj.top_hot_structs && obj.top_hot_structs.call_back_struct) {
        var cb = obj.top_hot_structs.call_back_struct;
        if (typeof cb.max_id !== 'undefined') obj.max_id = cb.max_id;
        delete obj.top_hot_structs;
        removed++;
    }
    return removed;
}

function dropAdCommentItems(list) {
    var removed = 0;
    for (var i = list.length - 1; i >= 0; i--) {
        var it = list[i];
        if (!it || typeof it !== 'object') continue;
        var t = Number(it.type);
        var tag = it.adType || it.ad_type;
        if (COMMENT_AD_TYPES[t] || COMMENT_AD_TAGS[tag]) {
            list.splice(i, 1);
            removed++;
        }
    }
    return removed;
}

/**
 * 热搜页（/2/flowpage）：items[] 里既有榜单分组，也有推广横幅。
 * 推广位的特征：
 *   - 条目本身带 promotion（热点页顶部品牌横幅）
 *   - 分组 items[] 里的单个热搜词带 promotion
 *   - 手动置顶热搜用 pic 里的 _img_search_stick 标记
 *   - 顶部「开启推送通知」提示条 itemid=hot-search-push-notice
 */
function handleFlowPage(obj) {
    var removed = purge(obj, 0);
    if (!isArray(obj.items)) return removed;

    for (var i = obj.items.length - 1; i >= 0; i--) {
        var it = obj.items[i];
        if (!it || typeof it !== 'object') continue;

        var d = it.data;
        if (d && d.itemid === 'hot-search-push-notice') {
            obj.items.splice(i, 1);
            removed++;
            continue;
        }
        if (isAdNode(it) || hasPromotion(it) || hasPromotion(d)) {
            obj.items.splice(i, 1);
            removed++;
            continue;
        }

        if (isArray(it.items)) {
            for (var j = it.items.length - 1; j >= 0; j--) {
                var x = it.items[j];
                if (!x || typeof x !== 'object') continue;
                var xd = x.data;
                var pinned = xd && /_img_search_stick/.test(String(xd.pic || ''));
                if (isAdNode(x) || pinned || hasPromotion(x) || hasPromotion(xd)) {
                    it.items.splice(j, 1);
                    removed++;
                }
            }
        }
    }
    return removed;
}

/** 关注页 / 热搜列表（/2/flowlist）：清掉分组里的推广条目 */
function handleFlowList(obj) {
    var removed = purge(obj, 0);

    if (isArray(obj.items)) {
        for (var k = 0; k < obj.items.length; k++) {
            var group = obj.items[k];
            if (!group || !isArray(group.items)) continue;
            for (var j = group.items.length - 1; j >= 0; j--) {
                var x = group.items[j];
                if (!x || typeof x !== 'object') continue;
                if (isAdNode(x) || hasPromotion(x) || hasPromotion(x.data)) {
                    group.items.splice(j, 1);
                    removed++;
                }
            }
        }
    }
    return removed;
}

/** 微博正文页的相关推荐 */
function handleExtend(obj) {
    var removed = purge(obj, 0);
    if (obj.trend) { delete obj.trend; removed++; }
    return removed;
}

/** 视频流 segments[]：is_ad=true 的插播广告 */
function handleVideoStream(obj) {
    var removed = purge(obj, 0);
    if (isArray(obj.segments)) {
        for (var i = obj.segments.length - 1; i >= 0; i--) {
            var s = obj.segments[i];
            if (s && (s.is_ad === true || s.is_ad === 1)) {
                obj.segments.splice(i, 1);
                removed++;
            }
        }
    }
    return removed;
}

/** 搜索发现页：channelInfo.channels[en_name=Discover].payload.items[] */
function handleFinder(obj) {
    var removed = purge(obj, 0);
    var channels = obj.channelInfo && obj.channelInfo.channels;
    if (!isArray(channels)) return removed;
    for (var i = 0; i < channels.length; i++) {
        var ch = channels[i];
        if (ch && ch.en_name === 'Discover' && ch.payload && isArray(ch.payload.items)) {
            removed += filterItems(ch.payload.items);
        }
    }
    return removed;
}

function handleUnreadCount(obj) {
    obj.video = {};
    return 0;
}

function handleEmptyDatas(obj) { obj.datas = []; return 0; }
function handleEmptyData(obj) { obj.data = {}; return 0; }
function handleEmptyDataArray(obj) { obj.data = []; return 0; }
function handleEmptyStories(obj) { obj.story_list = []; return 0; }

/* ------------------------------------------------------------------ */
/* 通用广告判定与遍历                                                  */
/* ------------------------------------------------------------------ */

/**
 * itemid 是微博给每个信息流条目分配的编码串，广告位会在里面留下固定标记。
 * 这里只匹配已知的广告片段，不做「含 ad 就算广告」这种模糊判断，
 * 否则 ad_mark / download 这类正常词都会被误伤。
 */
var AD_ITEMID = /c_type:51|t:51|is_ad_pos|region_data|infeed_may_interest_in|infeed_friends_recommend|infeed_weibo_mall|feed_-_invite|ads_word/;

/* 超话 / 视频的推荐卡：字段是 category=group + trend_name，不是 mblogtype */
var AD_TREND_NAMES = {
    super_topic_recommend_card: 1,
    recommend_video_card: 1
};

/**
 * 判定一个节点是否广告。字段依据接口实测、模型层符号，以及第三方模块
 * （DevCoz/Ruleset）中经过验证的部分；每条都要求「精确取值」而非「字段存在」。
 */
function isAd(o) {
    if (!o || typeof o !== 'object') return false;

    /* ① 微博自己的广告标记 */
    if (o.is_ad === true || o.is_ad === 1 || o.is_ad === '1') return true;
    if (o.isAd === true) return true;
    if (o.ad_state === true || o.ad_state === 1) return true;
    if (o.mblogtype === 1 || o.mblogtype === '1') return true;

    /* ② 正文页 / 评论流 / 下载类广告的专用标记（v1.2） */
    // 评论流里插播的推广博文，客户端按 adMblog 走广告样式
    if (o.readtimetype === 'adMblog') return true;
    // 「APP 下载」这类广告素材会带 is_ads=true
    var material = o.ads_material_info || o.adsMaterialInfo;
    if (material && material.is_ads === true) return true;

    /* ③ 文案标记：只认「广告 / 热推」这两个词，「热门」不能删 */
    var mt = o.mblogtypename || o.mblogtypename_v2 || '';
    if (typeof mt === 'string' && (mt.indexOf('\u5e7f\u544a') !== -1 || mt.indexOf('\u70ed\u63a8') !== -1)) return true;
    if (typeof o.adType === 'string' && o.adType.indexOf('\u5e7f\u544a') !== -1) return true;
    if (typeof o.ad_type === 'string' && o.ad_type.indexOf('\u5e7f\u544a') !== -1) return true;

    /* ④ 推广对象 / 广告主信息 */
    if (o.promotion && typeof o.promotion === 'object') {
        var ptype = String(o.promotion.type || '');
        if (ptype.indexOf('ad') !== -1) return true;
        if (o.promotion.recommend === '\u5e7f\u544a' || o.promotion.recommend === '\u70ed\u63a8') return true;
    }
    if (o.ad_id && (o.ad_type || o.adType)) return true;
    if (o.commentAdType) return true;
    if (isFilled(o.ad_info) || isFilled(o.adInfo) || isFilled(o.ad_tag) || isFilled(o.ad_mark)) return true;

    /* 广告容器本身：只有「填充过」才算，避免 ad:{} / ads:[] 误判 */
    if (isFilled(o.ad) || isFilled(o.ads) || isFilled(o.advertise) || isFilled(o.promotions)) return true;

    /* ⑤ 内容审核信息里带「广告」标签 */
    if (o.content_auth_info) {
        var title = String(o.content_auth_info.content_auth_title || '');
        if (title.indexOf('\u5e7f\u544a') !== -1) return true;
    }

    /* ⑥ 信息流条目编码与搜索推广标记 */
    if (typeof o.itemid === 'string' && AD_ITEMID.test(o.itemid)) return true;
    if (typeof o.itemId === 'string' && AD_ITEMID.test(o.itemId)) return true;
    if (o.actionlog && typeof o.actionlog.ext === 'string' &&
        o.actionlog.ext.indexOf('ads_word') !== -1) return true;
    if (o.page_info && o.page_info.actionlog && o.page_info.actionlog.source === 'ad') return true;

    /* ⑦ 超话 / 视频推荐卡 */
    if (o.category === 'group' && o.trend_name && AD_TREND_NAMES[o.trend_name]) return true;

    return false;
}

/** 值为非空对象 / 非空字符串时才算「填充」，避免 ad_info:null 被当成广告 */
function isFilled(v) {
    if (!v) return false;
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'object') {
        for (var k in v) {
            if (Object.prototype.hasOwnProperty.call(v, k)) return true;
        }
    }
    return false;
}

/** 推广位判定：热搜 / 发现页的条目常常只给 promotion 对象，不带 type */
function hasPromotion(o) {
    return !!(o && typeof o === 'object' && isFilled(o.promotion));
}

/**
 * 广告挂件：条目本身是正常微博，但正文下面挂了品牌橱窗 / 语义推广位。
 * 只删这些挂件字段，保留微博主体。
 */
function stripAdWidgets(o) {
    if (!o || typeof o !== 'object') return 0;
    var n = 0;
    if (o.semantic_brand_params) { delete o.semantic_brand_params; n++; }
    if (o.ad_tag_nature) { delete o.ad_tag_nature; n++; }
    if (o.page_alerts) { delete o.page_alerts; n++; }
    var ext = o.extend_info || o.extendInfo;
    if (ext && typeof ext === 'object') {
        if (ext.shopwindow_cards) { delete ext.shopwindow_cards; n++; }
        if (ext.ad_semantic_brand) { delete ext.ad_semantic_brand; n++; }
    }
    return n;
}

/* 顶层广告容器：命中就清空，里面的元素不用逐个判 */
var AD_CONTAINERS = [
    'ad', 'ads', 'advertises', 'advertise', 'ad_cards', 'promotion_ads',
    'comment_ad', 'comment_ads', 'top_ad', 'top_ads', 'hot_ad', 'hot_ads',
    'ad_banner', 'banner_ad'
];

function emptyAdContainers(o) {
    var n = 0;
    for (var i = 0; i < AD_CONTAINERS.length; i++) {
        var k = AD_CONTAINERS[i];
        var v = o[k];
        if (isArray(v) && v.length) { n += v.length; o[k] = []; }
        else if (v && typeof v === 'object' && !isArray(v) && isFilled(v)) { delete o[k]; n++; }
    }
    return n;
}

/** 卡片类型判广告：118 广告卡、89 下载卡，以及挂着 promotion 的推广卡 */
function isCardAd(o) {
    if (!o || typeof o !== 'object') return false;
    if (o.card_type === 118 || o.card_type === 89) return true;
    if (typeof o.card_type !== 'undefined' && hasPromotion(o)) return true;
    return false;
}

/**
 * 节点级判定：一个数组元素是否该整条删除。
 * 除了节点自身，还要看它的 data / mblog 子节点 —— H5、容器时间线、
 * 私信消息流的包装层都不一样，只判一层必然漏。
 */
function isAdNode(o) {
    if (!o || typeof o !== 'object') return false;
    if (isAd(o)) return true;
    if (isCardAd(o)) return true;

    var d = o.data;
    if (d && typeof 
