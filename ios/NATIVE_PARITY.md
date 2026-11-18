# RINLU Native iOS parity — acceptance ledger

This is an **acceptance checklist**, not a completion claim.

## App / identities
- [x] Real typed RINLU APIs for catalog, sound policy, account, favorites, studio and games
- [x] SwiftUI root UI; no WebView as primary interface
- [x] Xcode compilation for Simulator and generic iPhone target
- [ ] Native Google login, secure device callback, session refresh/logout
- [ ] All account security, consent, export, deletion, language-switch flows

## Audio / music
- [x] AVAudioEngine and first-party authorized media download playback
- [x] System remote control framework and background audio entitlement
- [ ] Real iPhone locked audio + AirPods/Control Center functional verification
- [ ] Progressive streaming/byte range and protected-media failure recovery
- [ ] Optimistic server playback state + history telemetry + conflict resolution
- [ ] Artwork in Now Playing, lyrics sync, playlist repeat/shuffle
- [ ] AirPlay and Bluetooth route handoff verified

## RINLUDSP 3.0
- [x] Download active managed preset/settings and persist listener ON/OFF
- [x] Native audio graph supports initial EQ/reverb signal processing
- [ ] Precise aligned mode port with original attributed AGPL modules
- [ ] Refined 4x oversampled excitation, reference plate, stereo-linked limiter
- [ ] EQ/FIR 10/15/25/31, normalization, leveling, crossfeed, gain/phase behavior
- [ ] Match 68 corpus waveforms at 44.1/48 kHz (latency compensated)
- [ ] Admin revisioned preset editor and publish on actual server
- [ ] Preset change without enabling listener's disabled preference

## Native features
- [x] Discover, search, library, now-playing native screens
- [x] Creator Studio and admin native read views
- [ ] Native album/artist detail, full playlist CRUD, liked/history fully synced
- [ ] Native upload, rights/AI attestations, job status and release editor
- [ ] Native moderation/admin write screens and audit evidence
- [ ] Lyrics edit/translations/creator notes, releases and user profiles
- [ ] Pulse Highway parity, performance, touch/calibration, fullscreen game clock
- [ ] All locale database-backed UI strings and accessibility
- [ ] UI alignment with `rinlu.com/music` across iPhone/iPad sizes

## Backend/production
- [x] Canonical public source archive verified on CI
- [x] Mobile bootstrap/search API source overlay built and checked in isolation
- [ ] Apply patch to actual Sites canonical source and regenerate audited archive
- [ ] Publish to OVH and verify hashes/route parity
- [ ] Test real D1/R2 and role/rights denial on all mobile endpoints
- [ ] Device remote/playback compatibility API and signed stream renewal
- [ ] Document deployment/rollback and run mobile contract regression suite
