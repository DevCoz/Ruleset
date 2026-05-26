// WeiboRequest.js - Surge 请求重写脚本
let url = $request.url;

if (url.indexOf("/2/remind/unread_count") > -1) {
    // 缓存当前用户的 UID
    let uidMatch = url.match(/uid=(\d+)/);
    if (uidMatch && uidMatch[1]) {
        $persistentStore.write(uidMatch[1], "vweibo_uid");
    }
    $done({});
} else if (url.indexOf("/2/statuses/user_timeline") > -1) {
    // 重写时间线请求，替换为纯净的 Profile Tab 接口
    let savedUid = $persistentStore.read("vweibo_uid") || "";
    let currentUidMatch = url.match(/uid=(\d+)/);
    let uid = currentUidMatch ? currentUidMatch[1] : savedUid;
    
    let newUrl = url.replace("/2/statuses/user_timeline", "/2/profile/statuses/tab").replace("max_id", "since_id");
    
    if (uid && newUrl.indexOf("containerid=") < 0) {
        newUrl += (newUrl.indexOf("?") >= 0 ? "&" : "?") + "containerid=230413" + uid + "_-_WEIBO_SECOND_PROFILE_WEIBO";
    }
    $done({ url: newUrl });
} else {
    $done({});
}
