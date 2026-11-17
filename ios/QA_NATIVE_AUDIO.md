# RINLU iOS media acceptance checklist

- [ ] Xcode macOS CI simulator build passes
- [ ] Signed real iPhone debug build installs and launches
- [ ] Canonical website player calls native bridge on user playback
- [ ] One audible source only: no web/native doubled music
- [ ] iPhone locked: current song continues, no artificial silent track
- [ ] Lock screen shows artwork/title/artist/duration/position
- [ ] Control Center play, pause, position slider matches visible site
- [ ] AirPods play/pause, next/previous commands control same native queue
- [ ] Bluetooth output selection / AirPlay routes actual audio
- [ ] Bluetooth disconnect pauses, does not unexpectedly use speaker
- [ ] Call/Siri interruption and resume follow system rules
- [ ] Next track plays after end even when webpage is suspended
- [ ] Previous before 3s changes track, after 3s restarts current song
- [ ] Returning foreground refreshes website state, elapsed, lyrics
- [ ] Signed URL lifetime, HTTP Range, formats (MP3/M4A/HLS) verified
- [ ] Favorites/history/play counts synchronized through backend
- [ ] Unavailable stream shows safe error, no broken system state
- [ ] Web player fallback when native bridge unavailable
- [ ] Pulse Highway game audio timing separately verified
- [ ] iPad rotation, file upload/download and login flows still work

The checkbox list documents acceptance criteria, not completion claims.
