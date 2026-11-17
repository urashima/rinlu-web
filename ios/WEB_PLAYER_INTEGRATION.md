# RINLU iOS native audio contract — v2

**Important:** The canonical music player source is still in ChatGPT Sites, not in
this OVH deployment mirror. This iOS change adds the native side. The site's
player must explicitly call the bridge for full parity. An unmodified website
continues its existing HTML/WebAudio path; background continuity cannot be
claimed for that path.

## Native handoff (first-party https://rinlu.com only)

The iOS app injects `window.RINLUNativeAudio` before the page's scripts run.
It is not present in a normal browser or Android. The existing website's
"Play" action must select the native path instead of starting another audio
element when the bridge exists.

```js
// In the canonical website's track playback handler:
const player = window.RINLUNativeAudio;
if (player?.isAvailable) {
  player.setQueue(
    playlist.map(song => ({
      id: song.id,
      url: song.signedPlayableHttpsURL, // HTTPS MP3/M4A/HLS; not blob:, not an HTML page
      title: song.title,
      artist: song.artist,
      album: song.album ?? '',
      artwork: song.coverHttpsURL,
      duration: song.durationSeconds
    })),
    currentTrackIndex,
    true // autoplay the user-selected track
  );
} else {
  // Existing browser/Android playback path
  playUsingWebPlayer();
}
```

For a single track, `player.playTrack(track)` is also supported. Avoid using
both HTMLMediaElement/WebAudio and native AVPlayer for the same song.

## Site -> native commands

- `setQueue(tracks, index, autoplay)` — replace queue and select a track;
  max 300 entries. For controls to work in the background, the next and
  previous song URLs must already be in the native queue.
- `playTrack(track)`, `play()`, `pause()`, `toggle()`,
  `seek(seconds)`, `next()`, `previous()`, `stop()`, `getState()`.

`track.url` must be a direct, valid HTTPS audio/HLS URL that AVPlayer can
access without relying on an HTML blob, JS fetch headers, or the WKWebView's
private cookie jar. The backend should supply properly scoped signed URLs
or a native-compatible stream endpoint. Never embed permanent access
credentials, cookies, session tokens or private storage keys in the app.
WebSocket, DASH and WebAudio-only resources require a different approach.

## Native -> site state/event

```js
window.addEventListener('rinlu:native-audio-state', function (event) {
  const state = event.detail;
  if (state.type === 'error') {
    showPlaybackError(state.message); // optionally offer web fallback
    return;
  }
  // Fields:
  // ready, playing, buffering, elapsed, duration,
  // index, queueLength, canNext, canPrevious
  // track: { id, title, artist, album, artwork }
  updateVisiblePlayer(state);
  syncLyricsPosition(state.elapsed);
  updateSeekbar(state.elapsed, state.duration);
});
```

The native engine is authoritative for elapsed time, playing state and queue
position. A lock-screen/AirPods/Control Center command operates on AVPlayer
first, then emits the new state to the page. When WebKit is suspended in the
background, AVPlayer continues and the page refreshes on foreground.

Native "next" and "previous" require preloaded queue metadata and URLs.
When listening for a long time, signed URLs must not expire before their turn.
Use a secure renewable stream endpoint or a carefully designed renewal API
for production. The current v2 bridge does not renew expiring URLs.

## Native lock screen and Bluetooth

- iOS App target Info.plist includes `UIBackgroundModes = audio`.
- `AVAudioSession.Category.playback` activates on actual native playback.
- `MPNowPlayingInfoCenter` shows title, artist, artwork, progress and duration.
- `MPRemoteCommandCenter` handles play, pause, headset toggle, next,
  previous and seek. Hardware/system audio routing handles AirPods, Bluetooth
  devices and AirPlay.
- Disconnecting an output route pauses to avoid sudden speaker playback.
  Phone interruptions honor the OS "shouldResume" option.

## Validation still required

1. Update the canonical Sites player to call `RINLUNativeAudio`, without
   changing its design/copy. Deploy only after separate approval.
2. Confirm the real stream endpoint works with AVPlayer (MP3/M4A/HLS,
   auth, byte ranges, expiry).
3. Real iPhone: lock + 30min background, Control Center seek, AirPods remote,
   Bluetooth disconnect, calls/Siri, next/previous and artwork.
4. Confirm playlist/likes/history persistence with backend. Their playback
   events are currently NOT automatically persisted by this native engine;
   the website/backend must hook playback telemetry and history updates.
5. Measure games separately; WebAudio game beat timing is not guaranteed
   to synchronize with AVPlayer without a clock bridge.
6. Apple Watch, CarPlay, offline download, cross-device Handoff, dynamic
   island/Live Activities and system lock-screen lyrics are **not** included.

This is native playback infrastructure with a clean integration contract,
not a verified Apple Music feature-equivalent release.
