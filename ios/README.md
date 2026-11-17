# RINLU iOS v0.2.0 — Native audio + Xcode test client

This iPhone/iPad Xcode project wraps the existing https://rinlu.com/music/
platform while adding an **AVPlayer-based native playback engine**.

## Already implemented in iOS source

- AVAudioSession playback category, audio background mode and AVPlayer
- Now Playing metadata, elapsed position, duration and remote commands
- Lock screen/Control Center/AirPods/Bluetooth play, pause, next, previous, seek
- Native music queue and automatic advancement in the background
- Route-unavailable pause, phone interruption/resume handling
- Secure first-party WebKit message bridge and native->page state events
- Existing uploads/downloads, camera/microphone consent, navigation and offline UI

## Build on an iPhone

1. Open `ios/RINLU.xcodeproj` with a current Xcode.
2. Choose target RINLU > Signing & Capabilities > Automatically manage
   signing; choose your Apple Team and change bundle identifier if necessary.
3. Connect an iPhone (enable Developer Mode if requested), select it,
   then press Run. Simulator CI does not sign a real-device build.

## Important integration boundary

The authoritative website player is managed by ChatGPT Sites and is not
contained in this mirror repository. Read `WEB_PLAYER_INTEGRATION.md`
before claiming the actual website streams use the native player.
Without the website-side handoff, its HTML/WebAudio music is still on the
existing web pathway and is not guaranteed to play in the background.
Real-device testing and approval are still required.

No production environment is changed by this feature branch.
There are no backend credentials or signing private keys in this repository.
