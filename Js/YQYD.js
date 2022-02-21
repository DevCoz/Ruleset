/*
Surge:
[Script]
http-response api.yqacg.com requires-body=1,max-size=0,script-path=https://raw.githubusercontent.com/Xu1o/Surge/master/Script/YQYD.js
[MITM]
hostname = api.yqacg.com
*/

const path1 = "/api/v4/user/myInfo/getInfo";
const path2 = "/api/v4/monthTicket/info";
const path3 = "/api/v4/limitfreecoupon/getUserCouponList";
const path4 = "/api/v4/limitfreecoupon/getCurrentCouponStock";
const path5 = "/ajax/genki/getGenkiInfo";
const path6 = "/api/v1/genkidama/getgenkidamainfo";
const path7 = "/api/v1/genkidama/sendinactivegenkidama";
const path8 = "/api/v4/limitfreecoupon/exchangeCoupon";
const path9 = "/api/v4/medal/detail";
const path10 = "/api/v4/user/account";
const path11 = "/api/v1/comicsubscription/buycomic";
const path12 = "/api/v1/comicsubscription/subscripinfo";
const path13 = "/api/v1/comic/chapter/vipcontent";
const path14 = "/api/v1/comicsubscription/vipchapter";

var body = $response.body;
var url = $request.url;
var obj = JSON.parse(body);

if (url.indexOf(path1) != -1){
body = JSON.parse(body);
body.data.userVipLevel = 9;
body.data.genkiDamaCount = 9999;
body.data.ticketCount = 9999;
body.data.coinCount = 9999;
body.data.limitFreeCount = 9999;
body = JSON.stringify(body);
}

if (url.indexOf(path2) != -1){
body = JSON.parse(body);
body.data.vipLevel = 9;
body.data.surplus = 9999;
body = JSON.stringify(body);
}

if (url.indexOf(path3) != -1){
body = JSON.parse(body);
body.data.total = 9999;
body = JSON.stringify(body);
}

if (url.indexOf(path4) != -1){
body = JSON.parse(body);
body.data.genkiDamaCount = 9999;
body = JSON.stringify(body);
}

if (url.indexOf(path5) != -1){
body = JSON.parse(body);
body.data.giftGenkiNum = 9999;
body.data.selfGenkiNum = 9999;
body = JSON.stringify(body);
}

if (url.indexOf(path6) != -1){
body = JSON.parse(body);
body.data.inactiveCount = 9999;
body = JSON.stringify(body);
}

if (url.indexOf(path7) != -1){
body = JSON.parse(body);
body.data.code = 0;
body.data.message = 成功;
body = JSON.stringify(body);
}

if (url.indexOf(path8) != -1){
body = JSON.parse(body);
body.data.code = 0;
body.data.message = 成功;
body = JSON.stringify(body);
}

if (url.indexOf(path9) != -1){
body = JSON.parse(body);
body.data.obtainStatus = 1;
body.data.obtainTime = 1554430210440;
body.data.level = 3;
body.data.userMedalTotalCount = 11;
body = JSON.stringify(body);
}

if (url.indexOf(path10) != -1){
body = JSON.parse(body);
body.data.iosCoinCount = 9999;
body.data.iosFreeCoinCount = 9999;
body.data.coinCount = 9999;
body.data.latestExpiredCoinCount = 9999;
body.data.latestExpiredCoinSeconds = 2554552;
body = JSON.stringify(body);
}

if (url.indexOf(path11) != -1){
body = JSON.parse(body);
body.data.code = 0;
body.data.message = 成功;
body = JSON.stringify(body);
}

if (url.indexOf(path12) != -1){
body = JSON.parse(body);
body.data.iapBalance = 9999;
body = JSON.stringify(body);
}

if (url.indexOf(path13) != -1){
body = JSON.parse(body);
body.data.code = 0;
body.data.message = 成功;
body = JSON.stringify(body);
}

if (url.indexOf(path14) != -1){
body = JSON.parse(body);
body.data.iapBalance = 9999;
body = JSON.stringify(body);
}

$done({body});

// by Xu1o
