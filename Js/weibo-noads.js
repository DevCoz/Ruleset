var BIG_PREFIX = '__WB_BIGINT_7f3c9a__';
var BIG_INT_RE = new RegExp('"' + BIG_PREFIX + '(-?\\d+)"', 'g');

var BIG_GUARD_RE = /("(?:[^"\\]|\\.)*")|(^|[:\[,\s])(-?\d{16,})(?=\s*[,\]\}]|\s*$)/g;

var DONE = false;

var NODE_BUDGET = 120000;
var nodeCount = 0;

var TIME_BUDGET = 3000;
var DEADLINE = 0;
var ABORTED = false;

var CHANGED = false;

var MAX_PROCESS_SIZE = 2621440;

function main() {
    DONE = false;
    nodeCount = 0;
    ABORTED = false;
    CHANGED = false;

    var req = (typeof $request !== 'undefined' && $request) ? $request : null;
    var res = (typeof $response !== 'undefined' && $response) ? $response : null;

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

    if (raw.length > MAX_PROCESS_SIZE) {
        done();
        return;
    }

    if (!looksLikeJson(raw)) {
        done();
        return;
    }

    var obj, handler, removed = 0;
    DEADLINE = Date.now() + TIME_BUDGET;

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

        if (ABORTED || Date.now() > DEADLINE) {
            done();
            return;
        }

        if (removed === 0 && !CHANGED) {
            done();
            return;
        }

        var out = stringifyJson(obj);

        if (out === raw) {
            done();
        } else {
            done(out);
        }
    } catch (e) {
        done();
    }
}

function routeOf(url) {
    var m = url.match(/^https?:\/\/[^\/]+(\/[^?#]*)?/i);
    var path = (m && m[1]) ? m[1] : url;
    var i = path.indexOf('/2/');
    if (i >= 0) path = path.substring(i + 3);
    else path = path.replace(/^\//, '');
    return path.replace(/\.json$/i, '').replace(/\/+$/, '');
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
    if (route === 'comments/build_comments') return handleComments;
    if (route === 'flowpage') return handleFlowPage;
    if (route === 'flowlist') return handleFlowList;
    if (route === 'statuses/extend') return handleExtend;
    if (route === 'statuses/positives/get') return handleEmptyDatas;
    if (route === 'photo/info') return handlePhotoInfo;
    if (route === 'photo/recommend_list' || route === '!/photos/pic_recommend_status') return handleEmptyData;
    if (route === 'stories/video_stream') return handleVideoStream;
    if (route === 'stories/home_list') return handleEmptyStories;
    if (route === 'service/picfeed' || route === 'live/media_homelist') return handleEmptyDataArray;
    if (route === 'search/finder') return handleFinder;
    if (route === 'remind/unread_count') return handleUnreadCount;

    if (route.indexOf('statuses/container_timeline') === 0 ||
        route.indexOf('search/container_timeline') === 0 ||
        route.indexOf('search/container_discover') === 0 ||
        route.indexOf('profile/container_timeline') === 0 ||
        route.indexOf('messageflow/notice') === 0) {
        return handleItems;
    }

    if (inList(CARDS, route)) return handleCards;

    if (inList(TIMELINE, route)) return handleTimeline;

    return null;
}

function inList(list, route) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === route) return true;
    }
    return false;
}

function handleTimeline(obj) {
    var removed = purge(obj, 0);

    if (isArray(obj.statuses)) {
        removed += dropAdItems(obj.statuses);

        for (var i = 0; i < obj.statuses.length; i++) removed += stripAdWidgets(obj.statuses[i]);
    }
    if (isArray(obj.ad)) { removed += obj.ad.length; obj.ad = []; }
    if (isArray(obj.advertises)) { removed += obj.advertises.length; obj.advertises = []; }
    if (isArray(obj.trends)) removed += dropAdItems(obj.trends);

    if (typeof obj.num === 'number' && typeof obj.original_num === 'number' &&
        obj.num !== obj.original_num) {
        obj.num = obj.original_num;
        CHANGED = true;
    }
    return removed;
}

function handleCards(obj) {
    var removed = purge(obj, 0);
    if (isArray(obj.cards)) removed += filterCards(obj.cards);
    if (isArray(obj.items)) removed += filterItems(obj.items);
    return removed;
}

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

var COMMENT_AD_TYPES = { 1: 1, 5: 1, 6: 1, 15: 1, 41: 1 };

var COMMENT_AD_TAGS = {
    '\u5e7f\u544a': 1,
    '\u8350\u8bfb': 1,
    '\u8bc4\u8bba\u603b\u7ed3': 1,
    '\u63a8\u8350': 1,
    '\u76f8\u5173\u5185\u5bb9': 1,
    '\u76f8\u5173\u8bc4\u8bba': 1
};

function handleComments(obj) {
    var removed = purge(obj, 0);

    if (isArray(obj.datas)) removed += dropAdCommentItems(obj.datas);
    if (isArray(obj.root_comments)) removed += dropAdCommentItems(obj.root_comments);

    if (obj.recommend_max_id) {
        obj.recommend_max_id = 0;
        CHANGED = true;
    }

    if (obj.top_hot_structs && obj.top_hot_structs.call_back_struct) {
        var cb = obj.top_hot_structs.call_back_struct;
        var next = Number(cb.max_id);
        if (!obj.max_id && isFinite(next) && next > 0) obj.max_id = next;
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

function handleExtend(obj) {
    var removed = purge(obj, 0);
    if (obj.trend) { delete obj.trend; removed++; }
    return removed;
}

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

function clearContainer(obj, key, empty) {
    var v = obj[key];
    var n = isArray(v) ? v.length : (isFilled(v) ? 1 : 0);
    if (n > 0) {
        obj[key] = isArray(v) ? [] : empty;
        CHANGED = true;
    }
    return n;
}

function handleEmptyDatas(obj) { return clearContainer(obj, 'datas', []); }
function handleEmptyData(obj) { return clearContainer(obj, 'data', {}); }
function handleEmptyDataArray(obj) { return clearContainer(obj, 'data', []); }
function handleEmptyStories(obj) { return clearContainer(obj, 'story_list', []); }

function handlePhotoInfo(obj) {
    var removed = purge(obj, 0);
    if (Object.prototype.hasOwnProperty.call(obj, 'ad_params')) {
        delete obj.ad_params;
        removed++;
    }
    return removed;
}

var AD_ITEMID = /(?:^|[,;\s|])(?:c_type|t):51(?:[,\s;|]|$)|is_ad_pos|region_data|infeed_may_interest_in|infeed_friends_recommend|infeed_weibo_mall|feed_-_invite|ads_word/;

var AD_TREND_NAMES = {
    super_topic_recommend_card: 1,
    recommend_video_card: 1
};

function isAd(o) {
    if (!o || typeof o !== 'object') return false;

    if (o.is_ad === true || o.is_ad === 1 || o.is_ad === '1') return true;
    if (o.isAd === true) return true;
    if (o.ad_state === true || o.ad_state === 1) return true;
    if (o.mblogtype === 1 || o.mblogtype === '1') return true;

    if (o.readtimetype === 'adMblog') return true;

    var material = o.ads_material_info || o.adsMaterialInfo;
    if (material && material.is_ads === true) return true;

    var mt = o.mblogtypename || o.mblogtypename_v2 || '';
    if (typeof mt === 'string' && (mt.indexOf('\u5e7f\u544a') !== -1 || mt.indexOf('\u70ed\u63a8') !== -1)) return true;
    if (typeof o.adType === 'string' && o.adType.indexOf('\u5e7f\u544a') !== -1) return true;
    if (typeof o.ad_type === 'string' && o.ad_type.indexOf('\u5e7f\u544a') !== -1) return true;

    if (o.promotion && typeof o.promotion === 'object') {
        var ptype = String(o.promotion.type || '');
        if (ptype.indexOf('ad') !== -1) return true;
        if (o.promotion.recommend === '\u5e7f\u544a' || o.promotion.recommend === '\u70ed\u63a8') return true;
    }
    if (o.ad_id && (o.ad_type || o.adType)) return true;
    if (o.commentAdType) return true;
    if (isFilled(o.ad_info) || isFilled(o.adInfo) || isFilled(o.ad_tag) || isFilled(o.ad_mark)) return true;

    if (isAdContainer(o.ad) || isAdContainer(o.ads) || isAdContainer(o.advertise) || isAdContainer(o.promotions)) return true;

    if (o.content_auth_info) {
        var title = String(o.content_auth_info.content_auth_title || '');
        if (title.indexOf('\u5e7f\u544a') !== -1) return true;
    }

    if (typeof o.itemid === 'string' && AD_ITEMID.test(o.itemid)) return true;
    if (typeof o.itemId === 'string' && AD_ITEMID.test(o.itemId)) return true;
    if (o.actionlog && typeof o.actionlog.ext === 'string' &&
        o.actionlog.ext.indexOf('ads_word') !== -1) return true;
    if (o.page_info && o.page_info.actionlog && o.page_info.actionlog.source === 'ad') return true;

    if (o.category === 'group' && o.trend_name && hasKey(AD_TREND_NAMES, o.trend_name)) return true;

    return false;
}

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

function isAdContainer(v) {
    if (!v || typeof v !== 'object' || isArray(v)) return false;
    if (v.ad_id || v.is_ad === true || v.is_ad === 1) return true;
    if (v.type === 'ad' || v.type === 1) return true;
    if (v.promotion) return true;
    return false;
}

function hasPromotion(o) {
    return !!(o && typeof o === 'object' && isFilled(o.promotion));
}

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

function isCardAd(o) {
    if (!o || typeof o !== 'object') return false;
    if (o.card_type === 118 || o.card_type === 89) return true;
    if (typeof o.card_type !== 'undefined' && hasPromotion(o)) return true;
    return false;
}

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

function purge(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return 0;
    if (ABORTED) return 0;

    nodeCount++;
    if (nodeCount > NODE_BUDGET) { ABORTED = true; return 0; }

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
    if (isCardAd(c)) return true;
    if (t === 42 && c.desc === '\u53ef\u80fd\u611f\u5174\u8da3\u7684\u4eba') return true;
    if (t === 9 && isAd(c.mblog)) return true;
    return false;
}

function filterItems(items) {
    var removed = 0;
    for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        if (!it || typeof it !== 'object') continue;
        var d = it.data;

        if (isAdNode(it)) { items.splice(i, 1); removed++; continue; }

        if (it.category === 'card' && d && isCardAd(d)) {
            items.splice(i, 1);
            removed++;
            continue;
        }

        if (d && it.category === 'feed') removed += stripAdWidgets(d);
    }
    return removed;
}

function parseJson(text) {
    BIG_GUARD_RE.lastIndex = 0;
    var guarded = text.replace(BIG_GUARD_RE, function (m, str, lead, num) {
        if (str) return str;
        return lead + '"' + BIG_PREFIX + num + '"';
    });
    return JSON.parse(guarded);
}

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

function isArray(v) {
    if (typeof Array.isArray === 'function') return Array.isArray(v);
    return Object.prototype.toString.call(v) === '[object Array]';
}

function hasKey(dict, key) {
    if (typeof key !== 'string' && typeof key !== 'number') return false;
    return Object.prototype.hasOwnProperty.call(dict, key);
}

function done(body) {
    if (DONE) return;
    DONE = true;
    try {
        if (typeof body === 'string') {
            $done({ body: body });
        } else {
            $done({});
        }
    } catch (e) {}
}

try {
    main();
} catch (e) {
    done();
}
