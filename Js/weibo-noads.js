/**
 * weibo-noads.js  v1.5
 * Surge http-response 脚本：清理微博 App 接口响应中的广告 / 推广条目
 */

var DEBUG = (typeof $argument !== 'undefined' && $argument !== null) &&
    String($argument).indexOf('debug=1') !== -1;

/* 大整数保护用的占位前缀，尽量不可能出现在真实业务字符串里 */
var BIG_PREFIX = '__WB_BIGINT_7f3c9a__';
var BIG_INT_RE = new RegExp('"' + BIG_PREFIX + '(-?\\d+)"', 'g');
/* 只匹配「完整的 JSON 数字字面量」，且必须是纯整数。
   旧写法 /-?\d{16,}/ 会在 0.1234567890123456 里命中小数部分，
   把 0."__WB__123..." 这种非法结构塞进 JSON，
   JSON.parse 抛 "Invalid digits after decimal point"（JSC 的报错文案）。
   现在要求：数字前面是 : [ , 或空白，后面是 , ] } 或结尾，
   因此带小数点 / 指数的数字整体不匹配，交给 JSON.parse 按 double 处理。 */
var BIG_GUARD_RE = /("(?:[^"\\]|\\.)*")|(^|[:\[,\s])(-?\d{16,})(?=\s*[,\]\}]|\s*$)/g;

/* $done 只能调用一次；重复调用在部分 Surge 版本会抛宿主异常 */
var DONE = false;

/* 单次执行的节点预算：正常信息流约 2~3 万节点，这里留 4 倍余量。
   目的是让超大响应提前退出，而不是在 WKWebView 里跑到超时被判为异常。 */
var NODE_BUDGET = 120000;
var nodeCount = 0;

/* 单次执行的时间预算。
   Surge 的 [Script] 有个 timeout 参数，默认 5 秒，超时后会强制终止会话并报
   「必须调用 $done() 结束脚本」。iPhone 的 JS 引擎比桌面慢 3~5 倍，
   留给可控逻辑 3 秒，剩下 2 秒给 JSON.parse / JSON.stringify 与进程间通信。 */
var TIME_BUDGET = 3000;
var DEADLINE = 0;
var ABORTED = false;

/* 本次是否真的改动了数据。removed 只统计「删掉的条数」，
   像 recommend_max_id 归零、unread_count.video 清空这类改动不计入条数，
   若只看 removed 就会把它们当成「无变化」而丢失。 */
var CHANGED = false;

/* 超过这个字节数直接原样放行。
   4 MB JSON 在 iPhone 上 parse + 遍历 + 序列化很容易越过 Surge 默认的
   5 秒 timeout，结果不是「慢一点」而是整条会话被终止（日志报
   「必须调用 $done() 结束脚本」）。与其处理一半被中断，不如整条跳过。
   模块里的 max-size 与这个值保持一致，让 Surge 在更外层就先挡住。 */
var MAX_PROCESS_SIZE = 2621440; // 2.5 MB

/* ------------------------------------------------------------------ */
/* 入口                                                               */
/* ------------------------------------------------------------------ */

function main() {
    /* 每次执行都重置状态：Surge 通常为每个请求新建 JS 上下文，
       但若复用上下文，残留的 DONE=true 会让 $done 永远不触发，表现为挂起 */
    DONE = false;
    nodeCount = 0;
    ABORTED = false;
    CHANGED = false;

    /* 先判 truthy 再取字段：typeof null === 'object'，
       只判 undefined 挡不住 $request / $response 为 null 的情况 */
    var req = (typeof $request !== 'undefined' && $request) ? $request : null;
    var res = (typeof $response !== 'undefined' && $response) ? $response : null;

    /* 没有响应上下文：http-request 阶段、URL Rewrite 已 reject、304 Not Modified、
       或 Surge 未拿到响应体。这类情况必须原样放行，不能碰 .body */
    if (!res) {
        done();
        return;
    }

    var url = (req && typeof req.url === 'string') ? req.url : '';
    var raw = res.body;

    if (typeof raw !== 'string' || raw.length === 0) {
        done();
        return;
    }

    /* 超大响应直接跳过。
       Ugly but necessary：4 MB 的 JSON 在 iPhone 上 parse + 遍历 + 序列化
       很容易越过 Surge 的 5 秒 timeout，结果不是「慢一点」而是整条会话被终止。
       跳过只损失这一条的去广告，不处理会连请求一起拖垮。 */
    if (raw.length > MAX_PROCESS_SIZE) {
        warn('响应 ' + raw.length + ' 字节超过处理上限 ' + MAX_PROCESS_SIZE + '，原样放行');
        done();
        return;
    }

    // /photo/info 是图片推荐位专用接口，出现 ad_params 即为广告位，整体清空
    if (url.indexOf('/photo/info') !== -1 && raw.indexOf('ad_params') !== -1) {
        done('{}');
        return;
    }

    /* 非 JSON（HTML 页面、JS 文件、图片、protobuf）直接放行。
       这类响应在 weibo.com / m.weibo.cn 上占比很高，
       以前每次都进 JSON.parse 抛 "Unrecognized token '<'"，日志全是噪音。 */
    if (!looksLikeJson(raw)) {
        if (DEBUG) log('非 JSON 响应，跳过：' + url);
        done();
        return;
    }

    var obj, handler, removed = 0, start = Date.now();
    DEADLINE = start + TIME_BUDGET;

    /* 解析、路由、处理、序列化全部收进 try：
       原先把 routeOf / pickHandler / stringifyJson 放在 try 外，
       任何一处意外都会变成宿主级 WKErrorDomain:4 */
    try {
        obj = parseJson(raw);

        if (!obj || typeof obj !== 'object') {
            done();
            return;
        }

        handler = pickHandler(routeOf(url));
        if (handler) {
            removed = handler(obj) || 0;
        } else {
            removed = purge(obj, 0);
        }

        /* 超预算：处理可能不完整，宁可原样放行也不返回半成品。
           必须在 stringify 之前退出 —— 序列化本身也可能吃掉一两秒。 */
        if (ABORTED || Date.now() > DEADLINE) {
            warn('处理超预算（nodes=' + nodeCount + ', ' + (Date.now() - start) +
                'ms），原样放行');
            done();
            return;
        }

        /* 完全没有改动：透传原始字节。
           重新 stringify 会把 1.0 写成 1、把带小数的长数字改精度，
           既多花一次序列化的时间，也可能改变业务语义。 */
        if (removed === 0 && !CHANGED) {
            if (DEBUG) {
                log('URL=' + url + ' | handler=' + (handler ? (handler.name || 'anonymous') : 'generic') +
                    ' | removed=0 | nodes=' + nodeCount + ' | 未命中广告字段，原样透传' +
                    ' | 顶层键：' + topKeys(obj));
            }
            done();
            return;
        }

        var out = stringifyJson(obj);

        if (DEBUG) {
            log('URL=' + url + ' | handler=' + (handler ? (handler.name || 'anonymous') : 'generic') +
                ' | removed=' + removed + ' | nodes=' + nodeCount +
                ' | in=' + raw.length + 'B out=' + out.length +
                'B | ' + (Date.now() - start) + 'ms');
        }

        if (out === raw) {
            done();
        } else {
            done(out);
        }
    } catch (e) {
        var msg = describeError(e);
        /* 解析类异常补一段原文，能一眼看出是截断、编码还是格式问题 */
        if (/JSON|parse|token|number/i.test(msg)) msg += ' | 头部=' + head(raw, 60);
        warn('处理异常，原样放行：' + msg);
        done();
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
    if (typeof obj.num === 'number' && typeof obj.original_num === 'number' &&
        obj.num !== obj.original_num) {
        obj.num = obj.original_num;
        CHANGED = true;
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

    /* recommend_max_id 必须归零，否则 App 会继续拉推荐评论。
       只有真的改了才置位 CHANGED，避免把「无变化」也当成需要重写 body。 */
    if (obj.recommend_max_id) {
        obj.recommend_max_id = 0;
        CHANGED = true;
    }

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
        if (hasKey(COMMENT_AD_TYPES, t) || hasKey(COMMENT_AD_TAGS, tag)) {
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
    CHANGED = true;
    return 0;
}

/** 清空指定容器；只有原本非空才算一次修改，避免「无变化也重写 body」 */
function clearContainer(obj, key, empty) {
    var v = obj[key];
    var n = isArray(v) ? v.length : (isFilled(v) ? 1 : 0);
    if (n > 0) {
        obj[key] = empty;
        CHANGED = true;
    }
    return n;
}

function handleEmptyDatas(obj) { return clearContainer(obj, 'datas', []); }
function handleEmptyData(obj) { return clearContainer(obj, 'data', {}); }
function handleEmptyDataArray(obj) { return clearContainer(obj, 'data', []); }
function handleEmptyStories(obj) { return clearContainer(obj, 'story_list', []); }

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
    if (o.category === 'group' && o.trend_name && hasKey(AD_TREND_NAMES, o.trend_name)) return true;

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
    if (d && typeof d === 'object') {
        if (isAd(d) || isCardAd(d)) return true;
        if (d.mblog && isAd(d.mblog)) return true;
    }
    if (o.mblog && isAd(o.mblog)) return true;

    if ((o.category === 'group' || o.category === 'feed') &&
        o.trend_name && hasKey(AD_TREND_NAMES, o.trend_name)) return true;

    return false;
}

/**
 * 深度遍历：数组里遇到广告项就删，对象继续向下找。
 * depth 上限防止异常深层结构导致栈溢出 / 性能问题。
 */
function purge(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return 0;
    if (ABORTED) return 0;

    nodeCount++;
    if (nodeCount > NODE_BUDGET) { ABORTED = true; return 0; }
    /* 每 256 个节点看一次表：Date.now() 本身也有开销，不能每个节点都调 */
    if ((nodeCount & 255) === 0 && Date.now() > DEADLINE) { ABORTED = true; return 0; }

    var removed = 0;
    var i, k, v;

    if (isArray(node)) {
        for (i = node.length - 1; i >= 0; i--) {
            if (isAdNode(node[i])) {
                node.splice(i, 1);
                removed++;
            } else {
                removed += purge(node[i], depth + 1);
            }
        }
        return removed;
    }

    // 对象：先摘广告挂件、清空广告容器，再继续向下
    removed += stripAdWidgets(node);
    removed += emptyAdContainers(node);

    for (k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        v = node[k];
        if (v && typeof v === 'object') removed += purge(v, depth + 1);
    }
    return removed;
}

function dropAdItems(arr) {
    var removed = 0;
    for (var i = arr.length - 1; i >= 0; i--) {
        if (isAdNode(arr[i])) { arr.splice(i, 1); removed++; }
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
        if (dropCard(item) || isAdNode(item) || hasPromotion(item)) {
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
    if (isCardAd(c)) return true;                                    // 118 广告卡 / 89 下载卡
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
        if (isAdNode(it)) { items.splice(i, 1); removed++; continue; }

        // 广告卡 / 下载卡
        if (it.category === 'card' && d && isCardAd(d)) {
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
    BIG_GUARD_RE.lastIndex = 0;
    var guarded = text.replace(BIG_GUARD_RE, function (m, str, lead, num) {
        if (str) return str;
        return lead + '"' + BIG_PREFIX + num + '"';
    });
    return JSON.parse(guarded);
}

/**
 * 响应体是不是 JSON。
 * weibo.com / m.weibo.cn 上大量请求返回的是 HTML、JS、图片，
 * 直接 JSON.parse 会抛 "Unrecognized token '<'"，既污染日志也白费一次解析。
 */
function looksLikeJson(text) {
    for (var i = 0; i < text.length && i < 64; i++) {
        var c = text.charAt(i);
        if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\uFEFF') continue;
        return c === '{' || c === '[';
    }
    return false;
}

function stringifyJson(obj) {
    return JSON.stringify(obj).replace(BIG_INT_RE, '$1');
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function isArray(v) {
    /* Array.isArray 是原生实现，比 Object.prototype.toString.call 快一个数量级。
       emptyAdContainers 会对每个节点调用 14 次，这里是最大的性能热点。 */
    if (typeof Array.isArray === 'function') return Array.isArray(v);
    return Object.prototype.toString.call(v) === '[object Array]';
}

/**
 * 字典查表必须用 hasOwnProperty：
 * 直接写 dict[key] 时，key="constructor" / "toString" 会命中原型链上的函数，
 * 得到一个 truthy 值，把正常内容当广告删掉。
 */
function hasKey(dict, key) {
    if (typeof key !== 'string' && typeof key !== 'number') return false;
    return Object.prototype.hasOwnProperty.call(dict, key);
}

/** 调试用：列出顶层键，避免把整个响应体写进日志 */
function topKeys(o) {
    if (!o || typeof o !== 'object') return typeof o;
    var keys = [];
    for (var k in o) {
        if (Object.prototype.hasOwnProperty.call(o, k)) keys.push(k);
    }
    return keys.slice(0, 24).join(',');
}

function log(msg) {
    if (DEBUG && typeof console !== 'undefined' && console && console.log) {
        try { console.log('[weibo-noads] ' + msg); } catch (e) { /* 日志失败不影响放行 */ }
    }
}

/**
 * 异常日志：不受 DEBUG 限制。
 * 异常是罕见事件，如果只在 DEBUG 下才打印，用户看到 Surge 的
 * 「发生了JavaScript异常」却拿不到任何上下文，等于没法排查。
 */
function warn(msg) {
    if (typeof console !== 'undefined' && console && console.log) {
        try { console.log('[weibo-noads][error] ' + msg); } catch (e) {}
    }
}

/** 把异常整理成一行可读文本，DEBUG 时便于定位；非 DEBUG 不输出 */
function describeError(e) {
    if (!e) return 'unknown';
    var s = (e.name || 'Error') + ': ' + (e.message || String(e));
    if (DEBUG && e.stack) s += '\n' + String(e.stack).split('\n').slice(0, 6).join('\n');
    return s;
}

/** 取响应体开头一小段并转义：日志里只占一行，够判断类型 */
function head(text, n) {
    if (typeof text !== 'string') return '';
    var s = text.slice(0, n || 60).replace(/[\r\n\t]/g, ' ');
    return s.length < text.length ? s + '…' : s;
}

/**
 * 统一出口：不传 body 表示原样放行。
 * $done 只允许调用一次 —— 重复回调在部分 Surge 版本会抛宿主异常，
 * 而异常又会被记成 WKErrorDomain:4，等于自己制造故障。
 */
function done(body) {
    if (DONE) return;
    DONE = true;
    try {
        if (typeof body === 'string') {
            $done({ body: body });
        } else {
            $done({});
        }
    } catch (e) {
        /* 宿主会话已销毁时 $done 可能抛错，这里必须吞掉：
           再次抛出就会变成 Surge 日志里的「发生了JavaScript异常」 */
        if (DEBUG && typeof console !== 'undefined' && console && console.log) {
            try { console.log('[weibo-noads] $done 失败：' + describeError(e)); } catch (e2) {}
        }
    }
}

/* 入口放在文件末尾：确保上面的常量表已完成赋值（var 不会提升赋值）。
   最外层再包一层绝对兜底 —— main() 里已经分块 try，但常量初始化、
   函数求值阶段仍可能有意料之外的问题，绝不能让异常冒到宿主。 */
try {
    main();
} catch (e) {
    warn('未捕获异常，原样放行：' + describeError(e));
    done();
}
