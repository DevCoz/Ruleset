/**
 * weibo-launch.js
 * Surge http-response 脚本：屏蔽微博开屏（启动）广告
 *
 * 命中接口：
 *   https://sdkapp.uve.weibo.com/interface/sdk/sdkad.php
 *   https://wbapp.uve.weibo.com/interface/sdk/sdkad.php
 *   https://sdkapp.uve.weibo.com/wbapplua/wbpullad.lua
 *   https://wbapp.uve.weibo.com/wbapplua/wbpullad.lua
 *
 * 处理策略：返回空对象。App 拿到空广告配置后会直接进入首页，
 * 不产生下载、展示与曝光上报，也不会触发重试（比 REJECT 更温和）。
 */

(function main() {
    var raw = (typeof $response !== 'undefined') ? $response.body : null;

    // 极少数版本会返回 Lua 表或带前后缀的脏数据，无法保证是 JSON。
    // 这里直接返回 {}，让客户端按「无广告」处理。
    if (typeof raw !== 'string' || raw.length === 0) {
        $done({ body: '{}' });
        return;
    }

    $done({ body: '{}' });
})();
