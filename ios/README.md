# RINLU iOS 0.4
在 Xcode 打开 RINLU.xcodeproj，选择 RINLU scheme。模拟器直接运行。连接 iPhone 时在 Signing & Capabilities 选择自己的 Team。最低 iOS 16。
首屏加载正式站曲库，可直接点封面播放。底栏上方的小播放器打开播放页，支持输出设备、队列、歌词及 RINLUDSP 开关。资料库可进入网页歌单、账户、创作者工作室、审核与游戏。
音频使用 AVURLAsset / AVPlayer 按需读取授权媒体。在 AVAudioMix 上挂接 MTAudioProcessingTap，以原生 C++ 处理 PCM。网站管理的预设 revision、strength 和用户开关进入同一套 DSP。支持 44.1/48 kHz 单声道或立体声浮点输入；遇到其他可解码采样率或流式轨道未提供 PCM 回调时，客户端可重新授权并在设备上转换为 48 kHz 临时音频，接续原生 DSP。此时需等待下载与转换。服务器需支持可渐进解码的媒体，启动时间取决于文件格式和网络。
算法对照基线为站点提交 e70a57361f876b037c9f2fefb8c64e36f873d134。Tests/reference 中的 JavaScript 仅用于桌面对照测试，不进入 App。使用 C++17 和 Node 运行：
```bash
c++ -O2 -std=c++17 -ffp-contract=off Tests/render.cpp -o /tmp/rinlu-compare
node Tests/compare.mjs /tmp/rinlu-compare
```
账户支持站内会话。网页版 Google 登录跳到系统浏览器后，尚需服务端一次性授权码回传才能接续 App 会话。工作室审核原件、本地上传试听、游戏保留网页媒体时钟；开始试听时暂停主播放器。公开歌曲通过原生授权地址播放，网页转交曲目 ID。
详见 DEVELOPMENT_PLAN.md 中的真机验收项。未附签名证书或 IPA。核心处理及其修改记录见 Licenses。

追加长信号回归可运行 `node Tests/compare.mjs /tmp/rinlu-compare --long`。逐声道覆盖静音、超过 10 秒的轻声段、大信号瞬态和回落。模拟器交互测试使用正式站公开曲库，因此依赖曲库和媒体服务可用。
