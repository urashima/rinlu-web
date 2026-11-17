# RINLU Android v0.1.0 (review build)

A secure Android WebView host for the canonical https://rinlu.com/music/ music/game platform.
Shares current live website backend, accounts, catalog, creator content and games.

**Included:** WebView, cookies, uploads and downloads, safe external navigation,
fullscreen/rotation, microphone/camera runtime permissions, offline retry, back
navigation, WebView state restoration, APK CI.

**Not complete yet:** media notifications, persistent background playback,
headset/lock-screen controls, offline listening, OAuth/deep-link callbacks,
and verification of every website route and game on Android devices.
These require a native Media3 service, a supported playback API and real QA.
Do not claim full feature parity until tested.

Open android/ in Android Studio with JDK 17 / SDK 37, or use Android CI.
AGP 9.5.0 requires Gradle 9.6.0. Debug builds are for device tests only.
No production signing credentials or backend tokens are stored in this repo.

The website's canonical source lives in ChatGPT Sites; this repository is
the OVH publishing mirror. This Android client is separate and must not
trigger production website deployment. Never merge before QA.
