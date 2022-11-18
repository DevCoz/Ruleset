
/*
Reddit官方客户端去除时间线Promoted广告

[MITM]
hostname = oauth.reddit.com

[Script]
http-response ^https?:\/\/oauth\.reddit\.com\/api\/v1\/me\.json requires-body=1,max-size=0,script-path=https://raw.githubusercontent.com/DevCoz/Ruleset/Pv/Js/Reddit.js,script-update-interval=0
*/

var obj = JSON.parse($response.body);
obj['has_gold_subscription'] = true;
obj['pref_autoplay'] = false;
obj['has_subscribed_to_premium'] = true;
obj['has_visited_new_profile'] = true;
obj['pref_video_autoplay'] = false;
obj['features']['promoted_trend_blanks'] = false;
obj['is_mod'] = true;
obj['is_gold'] = true;
obj['has_ios_subscription'] = true;
obj['seen_premium_adblock_modal'] = true;
obj['can_edit_name'] = true;
obj['has_external_account'] = true;
$done({ body: JSON.stringify(obj) });
