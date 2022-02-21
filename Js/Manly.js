/*
Manly修图工具

[MITM]
hostname = buy.itunes.apple.com

[Script]
http-response ^https?:\/\/buy\.itunes\.apple\.com\/verifyReceipt requires-body=1,max-size=0,script-path=https://raw.githubusercontent.com/Xu1o/Surge/master/Script/Manly.js,script-update-interval=0
*/

var obj = JSON.parse($response.body);
var bundle_id = obj.receipt["bundle_id"];
if (bundle_id == "com.alphatech.manly") {
  obj = {
  "status": 0,
  "environment": "Production",
  "receipt": {
    "receipt_type": "Production",
    "app_item_id": 1263326810,
    "receipt_creation_date": "2019-11-10 04:22:17 Etc/GMT",
    "bundle_id": "com.alphatech.manly",
    "original_purchase_date": "2019-11-10 04:10:41 Etc/GMT",
    "in_app": [
      {
        "quantity": "1",
        "purchase_date_ms": "1573359644000",
        "expires_date": "2099-11-13 04:20:44 Etc/GMT",
        "expires_date_pst": "2099-11-12 20:20:44 America/Los_Angeles",
        "is_in_intro_offer_period": "false",
        "transaction_id": "120000682309256",
        "is_trial_period": "false",
        "original_transaction_id": "120000682309256",
        "purchase_date": "2019-11-10 04:20:44 Etc/GMT",
        "product_id": "Manly_1Y",
        "original_purchase_date_pst": "2019-11-09 20:20:44 America/Los_Angeles",
        "original_purchase_date_ms": "1573359644000",
        "web_order_line_item_id": "120000229892814",
        "expires_date_ms": "4098226844000",
        "purchase_date_pst": "2019-11-09 20:20:44 America/Los_Angeles",
        "original_purchase_date": "2019-11-10 04:20:44 Etc/GMT"
      }
    ],
    "adam_id": 1263326810,
    "receipt_creation_date_pst": "2019-11-09 20:22:17 America/Los_Angeles",
    "request_date": "2019-11-10 04:22:19 Etc/GMT",
    "request_date_pst": "2019-11-09 20:22:19 America/Los_Angeles",
    "version_external_identifier": 833272783,
    "request_date_ms": "1573359739093",
    "original_purchase_date_pst": "2019-11-09 20:10:41 America/Los_Angeles",
    "application_version": "19102201",
    "original_purchase_date_ms": "1573359041000",
    "receipt_creation_date_ms": "1573359737000",
    "original_application_version": "19102201",
    "download_id": 32065574391288
  },
  "pending_renewal_info": [
    {
      "product_id": "Manly_1Y",
      "original_transaction_id": "120000682309256",
      "auto_renew_product_id": "Manly_1Y",
      "auto_renew_status": "1"
    }
  ],
  "latest_receipt_info": [
    {
      "quantity": "1",
      "purchase_date_ms": "1573359644000",
      "expires_date": "2099-11-13 04:20:44 Etc/GMT",
      "expires_date_pst": "2099-11-12 20:20:44 America/Los_Angeles",
      "is_in_intro_offer_period": "false",
      "transaction_id": "120000682309256",
      "is_trial_period": "false",
      "original_transaction_id": "120000682309256",
      "purchase_date": "2019-11-10 04:20:44 Etc/GMT",
      "product_id": "Manly_1Y",
      "original_purchase_date_pst": "2019-11-09 20:20:44 America/Los_Angeles",
      "subscription_group_identifier": "20404155",
      "original_purchase_date_ms": "1573359644000",
      "web_order_line_item_id": "120000229892814",
      "expires_date_ms": "4098226844000",
      "purchase_date_pst": "2019-11-09 20:20:44 America/Los_Angeles",
      "original_purchase_date": "2019-11-10 04:20:44 Etc/GMT"
    }
  ],
  "latest_receipt": "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"
  };
}
$done({body:JSON.stringify(obj)});
