let url = $request.url;
let body = $response.body;

if (!body) {
    $done({});
} else {
    // 🚀 快速预判：如果不包含特定关键词，直接放行，节省 JSON 解析性能
    if (body.indexOf("SceneListenCard") === -1 && 
        body.indexOf("直播") === -1 && 
        body.indexOf("123条音频") === -1 && 
        body.indexOf("SVIP") === -1 && 
        body.indexOf("会员") === -1 && 
        body.indexOf("喜马拉雅") === -1) {
        $done({});
        return;
    }

    let obj;
    try { 
        obj = JSON.parse(body); 
    } catch (_) { 
        $done({}); 
        return; 
    }
    
    let changed = false;

    // 辅助函数：判断标题是否包含需要屏蔽的关键词
    function titleBlocked(item) {
        return /直播|123条音频|SVIP|会员/.test(String(item && item.title || ""));
    }

    // 1. 发现页 Feed 流 (过滤 SceneListenCard 听书卡片广告)
    if (/\/discovery-feed\/v\d\/mix\//.test(url) && Array.isArray(obj.heData)) {
        let before = obj.heData.length;
        obj.heData = obj.heData.filter(function (card) {
            let list = card && card.item && Array.isArray(card.item.list) ? card.item.list : [];
            return !list.some(function (item) { return item && item.bizType === "SceneListenCard"; });
        });
        changed = changed || obj.heData.length !== before;
    }

    // 2. 分类定制页 (过滤特定标题的 Item，如直播、SVIP 推广)
    if (/\/discovery-category\/customCategories\//.test(url)) {
        if (Array.isArray(obj.categoryList)) {
            obj.categoryList.forEach(function (category) {
                if (Array.isArray(category.itemList)) {
                    let before = category.itemList.length;
                    category.itemList = category.itemList.filter(function (item) { return !titleBlocked(item); });
                    changed = changed || category.itemList.length !== before;
                }
            });
        }
        if (Array.isArray(obj.customCategoryList)) {
            let beforeCustom = obj.customCategoryList.length;
            obj.customCategoryList = obj.customCategoryList.filter(function (item) { return !titleBlocked(item); });
            changed = changed || obj.customCategoryList.length !== beforeCustom;
        }
    }

    // 3. Tab 定制页 (过滤 "会员" Tab)
    if (/\/nexus-web\/v\d\/tabs\/customTabs/.test(url) && obj.data && Array.isArray(obj.data.feedTabs)) {
        let beforeTabs = obj.data.feedTabs.length;
        obj.data.feedTabs = obj.data.feedTabs.filter(function (tab) { return tab && tab.name !== "会员"; });
        changed = changed || obj.data.feedTabs.length !== beforeTabs;
    }

    // 4. 用户主页 (仅保留 "喜马拉雅" 官方入口，过滤其他杂项推广)
    if (/\/mobile-user\/v\d\/homePage\//.test(url)) {
        let entrances = obj.data && obj.data.serviceModule && obj.data.serviceModule.entrances;
        if (Array.isArray(entrances)) {
            let beforeEntrances = entrances.length;
            obj.data.serviceModule.entrances = entrances.filter(function (entry) { return entry && entry.name === "喜马拉雅"; });
            changed = changed || obj.data.serviceModule.entrances.length !== beforeEntrances;
        }
    }

    // 仅在数据发生改变时重新序列化，否则直接放行
    if (changed) {
        $done({ body: JSON.stringify(obj) });
    } else {
        $done({});
    }
}
