// XHS_Response_JQ.js - 仅保留 JQ 无法处理的复杂逻辑
let url = $request.url;
let body = $response.body;
if (!body) { $done({}); } else {
    let obj;
    try { obj = JSON.parse(body); } catch (_) { $done({}); }

    // === 持久化存储辅助 ===
    const FEED_KEY = "fmz200.xiaohongshu.feed.rsp";
    const COMMENTS_KEY = "fmz200.xiaohongshu.comments.rsp";
    function getStore(key, fb) { try { return JSON.parse($persistentStore.read(key)) || fb; } catch(_) { return fb; } }
    function setStore(key, val) { $persistentStore.write(JSON.stringify(val), key); }

    // === 解锁保存/下载权限 ===
    function enableSave(item) {
        if (item?.media_save_config) {
            item.media_save_config.disable_save = false;
            item.media_save_config.disable_watermark = true;
            item.media_save_config.disable_weibo_cover = true;
        }
        if (!Array.isArray(item?.function_switch)) item.function_switch = [];
        ["image_download","video_download","note_download","download"].forEach(type => {
            let e = item.function_switch.find(s => s?.type === type);
            if (!e) item.function_switch.push({ type, enable: true });
            else { e.enable = true; delete e.reason; }
        });
        if (Array.isArray(item?.share_info?.function_entries)) {
            ["video_download","image_download","download"].forEach(type => {
                if (!item.share_info.function_entries.some(e => e?.type === type))
                    item.share_info.function_entries.unshift({ type });
            });
        }
    }

    // === Live Photo / 视频直链提取 ===
    function liveStreamFrom(media) {
        const s = media?.stream || {};
        return s.h265?.[0]?.master_url || s.h264?.[0]?.master_url || "";
    }
    function imageEnhance(images) {
        if (!Array.isArray(images)) return images || [];
        return images.map(img => {
            if (img?.live_photo || img?.live_photo_file_id) return img;
            if (typeof img?.url !== "string") return img;
            img.url = img.url.replace(/imageView2\/2\/w\/\d+\/format/g, "imageView2/2/w/2160/format")
                             .replace(/imageView2\/2\/h\/\d+\/format/g, "imageView2/2/h/2160/format");
            return img;
        });
    }

    // --- Feed 流: 收集 Live Photo + 解锁保存 ---
    if (url.includes("/note/imagefeed") || url.includes("/note/feed")) {
        const livePhotos = [];
        for (const item of obj.data?.[0]?.note_list || []) {
            enableSave(item);
            if (Array.isArray(item.images_list)) {
                item.images_list = imageEnhance(item.images_list);
                for (const img of item.images_list) {
                    const media = img?.live_photo?.media;
                    const liveUrl = liveStreamFrom(media);
                    if (img?.live_photo_file_id && liveUrl)
                        livePhotos.push({ file_id: img.live_photo_file_id, video_id: media?.video_id, url: liveUrl });
                }
            }
        }
        if (livePhotos.length > 0) setStore(FEED_KEY, livePhotos);
    }

    // --- Live Photo 保存: 替换无水印直链 ---
    if (url.includes("/note/live_photo/save")) {
        const cache = getStore(FEED_KEY, []);
        for (const item of obj.data?.datas || []) {
            const m = Array.isArray(cache) ? cache.find(c => c.file_id === item.file_id) : null;
            if (m?.url) { item.url = m.url; item.author = "@fmz200"; }
            else if (item.video_id) { item.url = "https://sns-video-al.xhscdn.com/stream/110/" + item.video_id + ".mp4"; item.author = "@fmz200"; }
        }
    }

    // --- 视频 Feed: 提取最高清直链并缓存 ---
    if (url.includes("/v3/note/videofeed?") || url.includes("/v4/note/videofeed")) {
        const videoData = [];
        for (const item of obj.data || []) {
            enableSave(item);
            const streams = (item?.video_info_v2?.media?.stream?.h265 || []).concat(item?.video_info_v2?.media?.stream?.h264 || []);
            const sel = streams.filter(v => v?.master_url).sort((a,b) => ((b.width||0)*(b.height||0)-(a.width||0)*(a.height||0)) || ((b.avg_bitrate||0)-(a.avg_bitrate||0)))[0];
            if (item?.id && sel?.master_url) videoData.push({ id: item.id, url: sel.master_url });
        }
        if (videoData.length > 0) setStore("redBookVideoFeed", videoData);
    }

    // --- 视频保存: 使用缓存直链 ---
    if (url.includes("/v10/note/video/save")) {
        const vf = getStore("redBookVideoFeed", []);
        const m = vf.find(i => i.id === obj.data?.note_id);
        if (m?.url) obj.data.download_url = m.url;
        if (obj.data?.disable) { delete obj.data.disable; delete obj.data.msg; obj.data.status = 2; }
    }

    // --- 评论区: 收集评论 Live Photo ---
    if (url.includes("/api/sns/v5/note/comment/list?") || url.includes("/api/sns/v3/note/comment/sub_comments?")) {
        const comments = obj.data?.comments || [];
        const noteId = comments[0]?.note_id || "";
        const livePhotos = [];
        function visit(c) {
            if (!c) return;
            if (c.comment_type === 3) c.comment_type = 2;
            if (c.media_source_type === 1) c.media_source_type = 0;
            for (const p of c.pictures || []) {
                if (!p.video_id || !p.video_info) continue;
                try { const o = JSON.parse(p.video_info); const u = liveStreamFrom(o); if (u) livePhotos.push({ videId: p.video_id, videoUrl: u }); } catch(_){}
            }
            for (const s of c.sub_comments || []) visit(s);
        }
        comments.forEach(visit);
        if (livePhotos.length > 0) {
            const cached = getStore(COMMENTS_KEY, null);
            const seen = new Set();
            const deduped = (cached?.noteId === noteId ? (cached.livePhotos||[]).concat(livePhotos) : livePhotos).filter(i => {
                const id = i.videId || i.video_id || i.file_id;
                if (!id || seen.has(id)) return false; seen.add(id); return true;
            });
            setStore(COMMENTS_KEY, { noteId, livePhotos: deduped });
        }
    }

    // --- 评论视频下载: 替换直链 ---
    if (url.includes("/api/sns/v1/interaction/comment/video/download?")) {
        const cached = getStore(COMMENTS_KEY, null);
        const m = cached?.livePhotos?.find(i => i.videId === obj.data?.video?.video_id);
        if (m?.videoUrl) obj.data.video.video_url = m.videoUrl;
    }

    // --- 搜索结果: 只保留笔记类型 ---
    if (url.includes("/search/notes?") && Array.isArray(obj.data?.items)) {
        obj.data.items = obj.data.items.filter(i => i?.model_type === "note");
    }

    // --- 关注流: 只保留好友动态 ---
    if (url.includes("/followfeed") && Array.isArray(obj.data?.items)) {
        obj.data.items = obj.data.items.filter(i => i?.recommend_reason === "friend_post" || i?.recommend_reason === undefined);
    }

    // --- 首页推荐流: 移除直播/广告/商品卡 ---
    if (url.includes("/homefeed") && Array.isArray(obj.data)) {
        obj.data = obj.data.filter(i => !(i?.model_type === "live_v2" || i?.ads_info || i?.card_icon || i?.note_attributes?.includes?.("goods")));
    }

    $done({ body: JSON.stringify(obj) });
}
