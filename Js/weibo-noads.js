/**
 * weibo-noads.js  v1.1
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

/** 评论区：datas[] 中 type 1/5/6 为广告与推荐楼中楼 */
function handleComments(obj) {
    var removed = purge(obj, 0);

    if (isArray(obj.datas)) {
        for (var i = obj.datas.length - 1; i >= 0; i--) {
            var t = obj.datas[i] && obj.datas[i].type;
            if (t === 1 || t === 5 || t === 6) {
                obj.datas.splice(i, 1);
                removed++;
            }
        }
    }
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
var AD_ITEMID = /c_type:51|is_ad_pos|region_data|infeed_may_interest_in|infeed_friends_recommend/;

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

    /* ② 文案标记：只认「广告 / 热推」这两个确切值，「热门」不能删 */
    var mt = o.mblogtypename;
    if (mt === '\u5e7f\u544a' || mt === '\u70ed\u63a8') return true;
    if (o.adType === '\u5e7f\u544a' || o.ad_type === '\u5e7f\u544a') return true;

    /* ③ 推广对象 / 广告主信息 */
    if (o.promotion && o.promotion.type === 'ad') return true;
    if (o.ad_id && (o.ad_type || o.adType)) return true;
    if (o.commentAdType) return true;
    if (isFilled(o.ad_info) || isFilled(o.adInfo) || isFilled(o.ad_tag) || isFilled(o.ad_mark)) return true;

    /* ④ 内容审核信息里带「广告」标签 */
    if (o.content_auth_info) {
        var title = String(o.content_auth_info.content_auth_title || '');
        if (title.indexOf('\u5e7f\u544a') !== -1) return true;
    }

    /* ⑤ 信息流条目编码 */
    if (typeof o.itemid === 'string' && AD_ITEMID.test(o.itemid)) return true;

    /* ⑥ 超话 / 视频推荐卡 */
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

/**
 * 广告挂件：条目本身是正常微博，但正文下面挂了品牌橱窗 / 语义推广位。
 * 只删这些挂件字段，保留微博主体。
 */
function stripAdWidgets(o) {
    if (!o || typeof o !== 'object') return 0;
    var n = 0;
    if (o.semantic_brand_params) { delete o.semantic_brand_params; n++; }
    if (o.ad_tag_nature) { delete o.ad_tag_nature; n++; }
    var ext = o.extend_info || o.extendInfo;
    if (ext && typeof ext === 'object') {
        if (ext.shopwindow_cards) { delete ext.shopwindow_cards; n++; }
        if (ext.ad_semantic_brand) { delete ext.ad_semantic_brand; n++; }
    }
    return n;
}

/**
 * 深度遍历：数组里遇到广告项就删，对象继续向下找。
 * depth 上限防止异常深层结构导致栈溢出 / 性能问题。
 */
function purge(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return 0;
    var removed = 0;
    if (isArray(node)) {
        for (var i = node.length - 1; i >= 0; i--) {
            if (isAd(node[i])) {
                node.splice(i, 1);
                removed++;
            } else {
                removed += purge(node[i], depth + 1);
            }
        }
        return removed;
    }
    for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        var v = node[k];
        if (v && typeof v === 'object') removed += purge(v, depth + 1);
    }
    return removed;
}

function dropAdItems(arr) {
    var removed = 0;
    for (var i = arr.length - 1; i >= 0; i--) {
        if (isAd(arr[i])) { arr.splice(i, 1); removed++; }
    }
    return removed;
}

/** cards[] 顶层卡片过滤 */
function filterCards(cards) {
    var removed = 0;
    for (var i = cards.length - 1; i >= 0; i--) {
        var c = cards[i];
        if (!c || typeof c !== 'object') continue;
        if (dropCard(c)) { cards.splice(i, 1); removed++; continue; }
        if (isArray(c.card_group)) removed += filterCardGroup(c.card_group);
        if (c.mblog) removed += stripAdWidgets(c.mblog);
    }
    return removed;
}

function filterCardGroup(group) {
    var removed = 0;
    for (var i = group.length - 1; i >= 0; i--) {
        var item = group[i];
        if (!item || typeof item !== 'object') continue;
        if (dropCard(item) || item.promotion) {
            group.splice(i, 1);
            removed++;
            continue;
        }
        if (isArray(item.card_group)) removed += filterCardGroup(item.card_group);
        if (isArray(item.group)) removed += filterCardGroup(item.group);
    }
    return removed;
}

function dropCard(c) {
    var t = c.card_type;
    if (t === 118 || t === 89) return true;                          // 纯广告 / 下载卡
    if (t === 42 && c.desc === '\u53ef\u80fd\u611f\u5174\u8da3\u7684\u4eba') return true; // 可能感兴趣的人
    if (t === 9 && isAd(c.mblog)) return true;                       // 信息流广告卡
    return false;
}

/** 新版 items[] 过滤（搜索、容器时间线、消息流共用） */
function filterItems(items) {
    var removed = 0;
    for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        if (!it || typeof it !== 'object') continue;
        var d = it.data;

        // 条目本身或 data 内任意一层命中广告标记
        if (isAd(it) || isAd(d)) { items.splice(i, 1); removed++; continue; }

        // 超话 / 视频推荐卡：外层 category=group，内层 trend_name 标类型
        if (it.category === 'group' && it.trend_name && AD_TREND_NAMES[it.trend_name]) {
            items.splice(i, 1);
            removed++;
            continue;
        }

        // 广告卡 / 下载卡
        if (it.category === 'card' && d && (d.card_type === 118 || d.card_type === 89)) {
            items.splice(i, 1);
            removed++;
            continue;
        }

        // 幸存的信息流条目：摘掉品牌橱窗等挂件
        if (d && it.category === 'feed') removed += stripAdWidgets(d);
    }
    return removed;
}

/* ------------------------------------------------------------------ */
/* JSON 读写（含大整数精度保护）                                        */
/* ------------------------------------------------------------------ */

/**
 * JSON.parse 会把 > 2^53 的整数转成 double，微博 id 普遍 16 位，
 * 直接 parse/stringify 会把 id 末几位改成 0，导致点击、翻页异常。
 * 做法：先把长整数临时包成字符串，序列化后再把引号去掉。
 */
function parseJson(text) {
    var guarded = text.replace(/("(?:[^"\\]|\\.)*")|(-?\d{16,})/g, function (m, str, num) {
        if (str) return str;
        return '"' + BIG_PREFIX + num + '"';
    });
    return JSON.parse(guarded);
}

function stringifyJson(obj) {
    var s = JSON.stringify(obj);
    var re = new RegExp('"' + BIG_PREFIX + '(-?\\d+)"', 'g');
    return s.replace(re, '$1');
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
}

function log(msg) {
    if (DEBUG && typeof console !== 'undefined' && console.log) console.log('[weibo-noads] ' + msg);
}

/** 统一出口：不传 body 表示原样放行 */
function done(body) {
    if (typeof body === 'string') {
        $done({ body: body });
    } else {
        $done({});
    }
}

/* 入口放在文件末尾：确保上面的常量表已完成赋值（var 不会提升赋值） */
main();
