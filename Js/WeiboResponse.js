// WeiboResponse.js - Surge 响应体净化脚本
const $ = new Env("微博去广告");

// 核心配置项 (可根据个人喜好修改 true/false)
const mainConfig = {
    removeHomeVip: true, removeHomeCreatorTask: true, removeRelate: true,
    removeGood: true, removeFollow: true, modifyMenus: true,
    removeRelateItem: true, removeRecommendItem: true, removeRewardItem: false,
    removeLiveMedia: true, removeNextVideo: false, removePinnedTrending: true,
    removeInterestFriendInTopic: false, removeInterestTopic: false, removeInterestUser: false,
    removeLvZhou: false
};

let body = $response.body;
let url = $request.url;

try {
    let data = JSON.parse(body);
    cleanWeibo(data, url, 0);
    body = JSON.stringify(data);
} catch (e) {
    console.log("微博净化解析失败: " + e.message);
}

$.done({ body });

// --- 核心清洗逻辑 ---
function isObj(v) { return v && typeof v === "object"; }

function isAd(o) {
    if (!isObj(o)) return false;
    let d = isObj(o.data) ? o.data : (isObj(o.mblog) ? o.mblog : o);
    if (o.type === "trend" || o.commentAdType || o.adType === "广告" || o.ad_type === "广告" || o.ad_type === 1 || o.is_ad === 1 || o.isAd === true) return true;
    if (o.category === "group" && (o.trend_name === "super_topic_recommend_card" || o.trend_name === "recommend_video_card")) return true;
    if (!isObj(d)) return false;
    if (d.is_ad === 1 || d.ad_state === 1 || d.adType === "广告" || d.mblogtypename === "广告" || d.mblogtypename === "热推") return true;
    if (d.promotion || d.promotions || d.ad || d.ads || d.ad_info || d.adInfo || d.ad_tag || d.ad_mark || d.advertise) return true;
    if (typeof d.itemid === "string" && (/c_type:51|is_ad_pos|region_data|infeed_may_interest_in|infeed_friends_recommend/.test(d.itemid))) return true;
    if (d.content_auth_info && String(d.content_auth_info.content_auth_title || "").indexOf("广告") >= 0) return true;
    if (d.card_type === 118 || d.card_type === 215 || d.card_type === 22) return true;
    return false;
}

function scrub(o) {
    if (!isObj(o)) return;
    delete o.semantic_brand_params; delete o.ad_tag_nature; delete o.reward_info;
    delete o.title_source; delete o.common_struct; delete o.head_cards;
    delete o.top_cards; delete o.trend; delete o.follow_data; delete o.page_alerts;
    if (o.extend_info) { delete o.extend_info.shopwindow_cards; delete o.extend_info.ad_semantic_brand; }
    if (o.detailInfo && o.detailInfo.extend) delete o.detailInfo.extend.follow_data;
}

function cleanArray(items, url, depth) {
    if (!Array.isArray(items)) return items;
    let out = [];
    for (let i = 0; i < items.length; i++) {
        let item = items[i];
        if (!isObj(item)) { out.push(item); continue; }
        if (isAd(item)) continue;
        cleanWeibo(item, url, depth + 1);
        out.push(item);
    }
    return out;
}

function cleanWeibo(o, url, depth) {
    if (!isObj(o) || depth > 8) return;
    scrub(o);
    ["items","statuses","cards","card_group","datas","reposts","hot_reposts","messages","pageDatas","comments","comment_list","reply_comments","list","data_list","card_list"].forEach(function (k) {
        if (Array.isArray(o[k])) o[k] = cleanArray(o[k], url, depth + 1);
    });
    ["data","mblog","status","payload","header","pageHeader","detailInfo","comment","rootComment","comment_info"].forEach(function (k) {
        if (isObj(o[k])) cleanWeibo(o[k], url, depth + 1);
    });
}

// --- Surge Env 适配类 ---
function Env(name) {
    this.name = name;
    this.log = (...args) => console.log(`[${name}]`, ...args);
    this.done = (val) => $done(val);
}
