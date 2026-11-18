# RINLU iOS v0.3.0 — Native SwiftUI development milestone

This is a **native SwiftUI + SceneKit + AVAudioEngine** client for the existing
RINLU site and backend. The app entrypoint is `RINLUNativeRootView`; it no longer
uses a WKWebView as its main UI. The legacy WKWebView host remains in the source
for migration reference, not as the app root.

## Implemented and CI-compiled

- Native Discover / Search / Your Library / Now Playing / Creator Studio /
  Administrator list / Music & Play entry screens
- Real RINLU account **email/password** login through the existing secure
  `/music/api/accounts/login` cookie session
- Real catalog, favorites, history, playlists, studio/admin read endpoints
- Native HTTP-authorized media transfer before every track play; previous
  five-minute authorization tokens are not cached as queue URLs
- AVAudioEngine + AVAudioPlayerNode + native EQ/reverb signal graph
- Native audio session, iOS background mode, MPRemoteCommandCenter and lock
  screen metadata; interruption handling, headset disconnect pause
- RINLUDSP **managed listener preset** fetched from `/api/sound/policy`;
  listener has only a persisted ON/OFF switch
- Pulse Highway prototype built with SceneKit using the real approved
  `/api/games/highway/:trackId` level timeline, not demo songs
- Existing RINLU app icon preserved in the delivered ZIP
- Verified GitHub Actions macOS iOS Simulator and generic iPhone SDK builds

## Critical incompleteness — do not claim full native parity

1. **RINLUDSP 3.0 NOT ported faithfully yet.** Current AVAudioUnitEQ and
   AVAudioUnitReverb are an initial native effects path. The original 3.0
   excitation, plate diffusion, 4x FIR oversampling, compressor, pre-lookahead,
   dual-channel limiter, convolution and exact latency are **not** implemented.
   No numeric waveform parity claim is made. See canonical source
   `docs/RINLUDSP_V3_ARCHITECTURE.md` and AGPL notices.
2. **Playback waits for an authorized full media download.** Progressive
   buffered native streaming, signed URL refresh on partial downloads,
   background network suspension resilience, long-session tests and low-latency
   song switching need work.
3. **Playback progress and history:** existing server endpoints are available
   but current native engine does not yet write optimistic playback state,
   listened seconds or completed events; actual user history may not update.
4. Email/password sign-in is available; **Google OAuth/PKCE ASWebAuthenticationSession**
   with safe native callback is not implemented.
5. Studio lists are native; upload, release/metadata editors and workflow
   actions are not yet implemented.
6. Admin lists are native; moderation, admin accounts and RINLUDSP preset
   editing/publishing write operations are deliberately not enabled yet.
7. Game visualization uses approved real levels but is not feature-identical
   to the full site Pulse Highway engine. Game scoring, calibrated audio clock,
   timing/difficulty/accessibility need full device QA.
8. Server-side mobile bootstrap/search patches are in a separate overlay
   under `services/mobile-api` and have **not** been published to canonical
   ChatGPT Sites or OVH. The native client currently uses existing live APIs.
9. No physical-device functional, DSP waveform, audio interruption,
   Bluetooth/AirPods or release-signature verification has been completed.

## Install on iPhone

Open `ios/RINLU.xcodeproj` in Xcode, choose your Apple Team in
Signing & Capabilities, connect your iPhone, and press Run. Use an iOS 16+
device. CI builds are unsigned; no team or signing credentials are in source.

## Production safety

Feature branch only: `feature/rinlu-ios-native-v0.3` and draft PR #5.
The published website and existing Google login are unchanged.
Do not merge this branch until all checkboxes in NATIVE_PARITY.md pass.
