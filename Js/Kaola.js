/*
[Script]
http-request ^https://sp\.kaola\.com/api/openad$ script-path=https://raw.githubusercontent.com/Xu1o/Surge/master/Script/Kaola.js

[MITM]
hostname = sp.kaola.com
*/

var data = {
  body: "{}",
  headers: {
    "Content-Type": "application/json"
  }
};
$done({response: data});
