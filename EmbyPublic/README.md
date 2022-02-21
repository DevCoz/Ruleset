# 视频下载与外部播放 Surge 模块

© 本教程内所有脚本皆为 [Emby 终点站](https://t.me/EmbyPublic) 原创，转载或魔改 (包括改为其他同类软件的模块或脚本) 请注明出处！

⚠️ **注意：**

1. 模块中包含播放权限解锁的脚本，如果之前使用了 [单独的破解模块](https://embywiki.911997.xyz/use-on-various-devices/use-on-ios/use-official-client/crack-with-surge.html)，可以把那个模块禁用或删除。
2. 模块的下载和播放功能只能在浏览器中使用，不能在 Emby 客户端中使用！

⛔️ **封号警告：**

1. 请勿将下载链接复制到**多线程下载**工具中下载！
2. 请勿**多任务大批量**的同时下载！
3. 终点站有后台监控，超过某个阈值会自动封号，[封号记录查询频道](https://t.me/joinchat/U7M2tqH3NKErZmP_)

## 🙏 多合一模块

此模块包含了浏览器中下载视频、Shu 下载、nPlayer 播放、VLC 播放和下载、Infuse 播放、IINA 播放、Movist Pro 播放的多种功能。

### 外部软件下载地址

1. [VLC for Mobile](https://itunes.apple.com/app/id650377962)
2. [nPlayer Plus](https://itunes.apple.com/app/id539397400)
3. [Infuse 7](https://itunes.apple.com/app/id1136220934)
4. [Magic File Viewer - Shu](https://itunes.apple.com/app/id1282297037)
5. [IINA](https://iina.io)
6. [Movist Pro](https://movistprime.com)

### 模块安装及使用

1. 在 iOS 或 macOS 版的 Surge 中以 URL 方式安装模块: `https://raw.githubusercontent.com/rartv/EmbyPublic/test/surge/emby.sgmodule` ；
2. 在 **Safari 浏览器** 中打开终点站 **网站**，在影片详情页中点击 **更多** ( 如果是剧集类型，需在要播放的那一集的详情页点更多按钮 )；
3. 配置好 MitM 证书并系统信任，打开 **MitM** 开关；
4. 此时会看到各个不同的操作，根据需要选择。

⚠️ **注意：** Emby 网站的静态资源会长期保存在浏览器的缓存里，第一次使用此脚本需要 **手动清除浏览器缓存** 或使用 **无痕模式**！

### 限制

下载与外部播放功能只能在浏览器中使用，不能在 Emby 客户端中使用！

#### 🌐 浏览器中下载视频限制

1. 如果视频有外挂字幕且选中，则下载外挂字幕文件，否则下载视频文件。

#### ⏬ 使用 VLC 作为下载工具下载限制

1. 只能在 iOS 浏览器中使用，不支持 macOS 浏览器；
2. 如果影片有外挂字幕且选中，则下载外挂字幕文件，否则下载视频文件；
3. 下载的字幕文件在 VLC 中不可见，需在系统自带的 **文件** app 中查找，路径为 `我的iPhone` -> `VLC`；
4. 如果下载的字幕文件名与视频文件名不相同，播放时则不能自动加载，需手动在 **文件** app 中修改字幕文件名。

#### 🎬 使用 VLC 作为外置播放器在线播放限制

1. 只能在 iOS 浏览器中使用，不支持 macOS 浏览器；
2. 如果一个视频对应多个外挂字幕，只会加载网页上选中的那一个字幕。

#### 🎬 使用 nPlayer 作为外置播放器在线播放限制

1. 只能在 iOS 浏览器中使用，不支持 macOS 浏览器；
2. 不支持外挂字幕。

#### 🎬 使用 Infuse 作为外置播放器在线播放限制

1. 不支持外挂字幕。

#### 🎬 使用 IINA 作为外置播放器在线播放限制

1. 不支持外挂字幕。

#### 🎬 使用 Movist Pro 作为外置播放器在线播放限制

1. 不支持外挂字幕。

#### 📖 使用 Shu 下载视频和字幕

1. 只能在 iOS 浏览器中使用，不支持 macOS 浏览器。

### 效果

![多合一模块](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/10/9/5111409B-CFF4-4B04-B607-258417337813_202049.jpeg)

![浏览器中下载视频](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/8/19/D41B9DC0-E715-4C98-B6BB-BBADC456BDA7_162833.jpeg)

![使用 VLC 播放器在线播放](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/8/19/A1B7ACE3-72AD-4C27-96FB-B1D4A847FA73_162248.jpeg)

![nPlayer 播放](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/8/28/4CC03724-FC3D-4C27-9BC4-F33DCC9AFE53_075200.jpeg)

![Infuse for iOS 播放](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/8/28/5CC95C99-62BB-4C67-BCD9-6413121AD4B2_075140.jpeg)

![使用 Shu 下载视频](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/8/19/49688D2F-2147-4D4D-A89D-2D299BCF92DB_162230.jpeg)

![Infuse for macOS 播放](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/9/27/CC8939D0-441F-4C12-9DC6-F074F6A5326A_023203.jpeg)

![IINA 播放](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/9/27/FA5F29A7-C87E-48BA-AD2A-2A6FFCB03CB6_022626.jpeg)

![Movist Pro 播放](https://raw.githubusercontent.com/tingv/image/Shortcuts/2021/10/9/8D17192C-A196-41A4-A790-D70C74F7CC0D_201215.jpeg)
