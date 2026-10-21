/**
 * weibo-launch.js  v1.1
 * Surge http-response 脚本：屏蔽微博开屏（启动）广告
 *
 * 命中接口：
 *   https://sdkapp.uve.weibo.com/interface/sdk/sdkad.php
 *   https://wbapp.uve.weibo.com/interface/sdk/sdkad.php
 *   https://sdkapp.uve.weibo.com/wbapplua/wbpullad.lua
 *   https://wbapp.uve.weibo.com/wbapplua/wbpullad.lua
 *
 * 处理策略：无论服务端返回什么，一律改写成 {}。
 * App 拿到空广告配置后直接进首页，不产生下载、展示与曝光上报，
 * 也不会触发重试（比 REJECT 更温和）。
 *
 * v1.1 修复 WKErrorDomain:4
 *   旧版写的是 `typeof $response !== 'undefined' ? $response.body : null`，
 *   而 typeof null === 'object'，$response 为 null 时会直接读 .body 抛
 *   TypeError，异常冒到宿主就是「发生了JavaScript异常」。
 *   本脚本的输出恒定，因此不需要读 body，直接返回并吞掉所有异常。
 */

(function () {
    'use strict';

    var finished = false;

    function finish(value) {
        if (finished) return;
        finished = true;
        try {
            $done(value);
        } catch (e) {
            /* 宿主会话已销毁：吞掉异常，避免二次抛出被记成 JS 异常 */
        }
    }

    try {
        var res = (typeof $response !== 'undefined' && $response) ? $response : null;

        // 没有响应上下文（http-request 阶段 / 被 reject / 304）：
        // 只是放行，不要伪造 body
        finish(res ? { body: '{}' } : {});
    } catch (e) {
        finish({});
    }
})();
