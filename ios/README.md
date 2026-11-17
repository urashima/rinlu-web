# RINLU iOS v0.1.0 — Xcode device test project

iPhone/iPad equivalent of Android v0.1.0, loading https://rinlu.com/music/ to share accounts, catalog, creator features and web games.

## Build on your iPhone
1. Open ios/RINLU.xcodeproj in Xcode 15.4 or newer.
2. In RINLU target > Signing & Capabilities, enable automatic signing and select your Apple Team. Change the bundle ID if necessary.
3. Connect your iPhone, enable Developer Mode if prompted, choose it as the run destination, then Run.
4. The source ZIP delivered alongside this branch contains the full-resolution RINLU app icon, derived from the existing Android logo. This repo bootstrap may initially use the generic iOS icon until binary artwork is checked in.

This uses WKWebView, persistent cookies, trusted-origin routing, native file input, WKDownload export, device rotation, offline retry, and camera/microphone prompts.
It contains no backend keys and makes no production website changes.

## Not yet feature complete
Cross-domain auth redirect, background audio and lock screen control, game fullscreen / audio timing, creator upload and admin-role QA need native/device tests. CI tests an unsigned Simulator build; real device signing requires your Apple Team.
