import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// One audio engine for lock screen, Control Center, AirPods, Bluetooth and the site.
/// The website sends a user-authorized, direct HTTPS stream URL and owns the visual UI.
/// All player state and queue transitions are generated here, never independently in JS.
final class NativeAudioPlayer {
    struct Track {
        let id: String
        let url: URL
        let title: String
        let artist: String
        let album: String
        let artworkURL: URL?
        let declaredDuration: Double?

        static func parse(_ body: [String: Any]) -> Track? {
            guard let address = body["url"] as? String,
                  address.count <= 4096, let url = URL(string: address),
                  url.scheme?.lowercased() == "https", let host = url.host,
                  !host.isEmpty, url.user == nil, url.password == nil,
                  !["localhost", "127.0.0.1", "::1"].contains(host.lowercased()) else { return nil }
            func label(_ key: String, default fallback: String) -> String {
                let value = (body[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return String((value.isEmpty ? fallback : value).prefix(256))
            }
            var art: URL?
            if let value = body["artwork"] as? String, value.count <= 4096,
               let imageURL = URL(string: value), imageURL.scheme?.lowercased() == "https",
               imageURL.host != nil, imageURL.user == nil, imageURL.password == nil {
                art = imageURL
            }
            let duration = (body["duration"] as? NSNumber)?.doubleValue
            return Track(id: label("id", default: url.absoluteString),
                         url: url,
                         title: label("title", default: "RINLU"),
                         artist: label("artist", default: "RINLU"),
                         album: label("album", default: ""),
                         artworkURL: art,
                         declaredDuration: duration?.isFinite == true && duration! > 0 ? duration : nil)
        }
    }

    private let player = AVPlayer()
    private var tracks: [Track] = []
    private var index: Int?
    private var artwork: MPMediaItemArtwork?
    private var artworkTask: URLSessionDataTask?
    private var periodicObserver: Any?
    private var itemObservation: NSKeyValueObservation?
    private var playbackObservation: NSKeyValueObservation?
    private var systemObservers: [NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var resumeAfterInterruption = false
    private let onUpdate: ([String: Any]) -> Void

    init(onUpdate: @escaping ([String: Any]) -> Void) {
        self.onUpdate = onUpdate
        player.automaticallyWaitsToMinimizeStalling = true
        registerRemoteCommands()
        periodicObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main
        ) { [weak self] _ in
            guard let self = self, self.index != nil else { return }
            self.updateNowPlaying()
            if UIApplication.shared.applicationState == .active { self.publish() }
        }
        playbackObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.updateNowPlaying()
                self?.publish()
            }
        }
        systemObservers.append(NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
        ) { [weak self] note in
            guard let self = self,
                  let ended = note.object as? AVPlayerItem,
                  self.player.currentItem === ended else { return }
            if self.hasNext { self.advance(by: 1) }
            else { self.player.pause(); self.updateNowPlaying(); self.publish() }
        })
        systemObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in self?.handleInterruption(notification) })
        systemObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] notification in self?.handleRouteChange(notification) })
        systemObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.publish() })
        refreshRemoteAvailability()
    }

    deinit {
        artworkTask?.cancel()
        itemObservation?.invalidate()
        playbackObservation?.invalidate()
        if let token = periodicObserver { player.removeTimeObserver(token) }
        systemObservers.forEach { NotificationCenter.default.removeObserver($0) }
        remoteTargets.forEach { $0.0.removeTarget($0.1) }
    }

    private var current: Track? {
        guard let index = index, tracks.indices.contains(index) else { return nil }
        return tracks[index]
    }
    private var hasNext: Bool {
        guard let index = index else { return false }
        return index + 1 < tracks.count
    }
    private var hasPrevious: Bool {
        guard let index = index else { return false }
        return index > 0
    }
    private var elapsed: Double {
        let seconds = player.currentTime().seconds
        return seconds.isFinite && seconds >= 0 ? seconds : 0
    }
    private var duration: Double {
        if let seconds = player.currentItem?.duration.seconds, seconds.isFinite && seconds > 0 { return seconds }
        return current?.declaredDuration ?? 0
    }
    private var isPlaying: Bool { player.rate > 0 }

    func handle(_ message: [String: Any]) {
        guard let action = message["action"] as? String else { return }
        switch action {
        case "setQueue":
            guard let bodies = message["tracks"] as? [[String: Any]], !bodies.isEmpty,
                  bodies.count <= 300 else { reportError("播放队列无效"); return }
            let parsed = bodies.compactMap(Track.parse)
            guard parsed.count == bodies.count else { reportError("播放队列包含无效的音频地址"); return }
            let selected = (message["index"] as? NSNumber)?.intValue ?? 0
            guard parsed.indices.contains(selected) else { reportError("播放队列索引无效"); return }
            tracks = parsed
            load(index: selected, shouldPlay: message["autoplay"] as? Bool == true)
        case "playTrack":
            guard let body = message["track"] as? [String: Any],
                  let track = Track.parse(body) else { reportError("播放地址必须是可用的 HTTPS 直链"); return }
            if let found = tracks.firstIndex(where: { $0.id == track.id && $0.url == track.url }) {
                load(index: found, shouldPlay: true)
            } else {
                tracks = [track]
                load(index: 0, shouldPlay: true)
            }
        case "play":
            play()
        case "pause":
            pause()
        case "toggle":
            if isPlaying { pause() } else { play() }
        case "seek":
            if let number = message["seconds"] as? NSNumber { seek(number.doubleValue) }
        case "next":
            if hasNext { advance(by: 1) }
        case "previous":
            previous()
        case "stop":
            stop()
        case "getState":
            publish()
        default:
            break
        }
    }

    func snapshot() -> [String: Any] {
        var state: [String: Any] = [
            "type": "state",
            "ready": current != nil,
            "playing": isPlaying,
            "buffering": player.timeControlStatus == .waitingToPlayAtSpecifiedRate,
            "elapsed": elapsed,
            "duration": duration,
            "index": index ?? -1,
            "queueLength": tracks.count,
            "canNext": hasNext,
            "canPrevious": hasPrevious
        ]
        if let item = current {
            state["track"] = [
                "id": item.id,
                "title": item.title,
                "artist": item.artist,
                "album": item.album,
                "artwork": item.artworkURL?.absoluteString ?? ""
            ]
        }
        return state
    }

    private func publish() { onUpdate(snapshot()) }

    private func reportError(_ message: String) {
        onUpdate(["type": "error", "message": message])
    }

    private func load(index newIndex: Int, shouldPlay: Bool) {
        guard tracks.indices.contains(newIndex) else { return }
        itemObservation?.invalidate()
        artworkTask?.cancel()
        artwork = nil
        index = newIndex
        let item = AVPlayerItem(url: tracks[newIndex].url)
        player.replaceCurrentItem(with: item)
        itemObservation = item.observe(\.status, options: [.new]) { [weak self, weak item] _, _ in
            DispatchQueue.main.async {
                guard let self = self, let item = item,
                      self.player.currentItem === item else { return }
                if item.status == .failed {
                    self.player.pause()
                    self.reportError("音频流加载失败。请检查签名 URL、格式及访问权限")
                    self.updateNowPlaying()
                    self.publish()
                } else if item.status == .readyToPlay {
                    self.updateNowPlaying()
                    self.publish()
                }
            }
        }
        refreshRemoteAvailability()
        loadArtwork()
        if shouldPlay { play() }
        else {
            player.pause()
            updateNowPlaying()
            publish()
        }
    }

    private func activateAudio() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            return true
        } catch {
            reportError("无法启用系统播放音频会话：\(error.localizedDescription)")
            return false
        }
    }

    private func play() {
        guard current != nil else { return }
        guard activateAudio() else { return }
        player.play()
        updateNowPlaying()
        publish()
    }

    private func pause() {
        player.pause()
        updateNowPlaying()
        publish()
    }

    private func seek(_ time: Double) {
        guard current != nil, time.isFinite else { return }
        let target = min(max(0, time), duration > 0 ? duration : time)
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600),
                    toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                self?.updateNowPlaying()
                self?.publish()
            }
        }
    }

    private func advance(by delta: Int) {
        guard let index = index, tracks.indices.contains(index + delta) else { return }
        load(index: index + delta, shouldPlay: true)
    }

    private func previous() {
        if elapsed > 3 {
            seek(0)
        } else if hasPrevious {
            advance(by: -1)
        } else {
            seek(0)
        }
    }

    private func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        tracks = []
        index = nil
        artworkTask?.cancel()
        artwork = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        refreshRemoteAvailability()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        publish()
    }

    private func updateNowPlaying() {
        guard let track = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: player.rate,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue
        ]
        if !track.album.isEmpty { info[MPMediaItemPropertyAlbumTitle] = track.album }
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artwork = artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork() {
        guard let track = current, let url = track.artworkURL else { return }
        let identifier = track.id
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        artworkTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let data = data, data.count <= 5_000_000,
                  let response = response as? HTTPURLResponse,
                  (200..<300).contains(response.statusCode),
                  response.mimeType?.hasPrefix("image/") == true,
                  let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self = self, self.current?.id == identifier,
                      self.current?.artworkURL == url else { return }
                self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.updateNowPlaying()
            }
        }
        artworkTask?.resume()
    }

    private func registerRemoteCommands() {
        let controls = MPRemoteCommandCenter.shared()
        func attach(_ command: MPRemoteCommand, _ handler: @escaping () -> Void) {
            let token = command.addTarget { _ in
                DispatchQueue.main.async(execute: handler)
                return .success
            }
            remoteTargets.append((command, token))
        }
        attach(controls.playCommand) { [weak self] in self?.play() }
        attach(controls.pauseCommand) { [weak self] in self?.pause() }
        attach(controls.togglePlayPauseCommand) { [weak self] in
            guard let self = self else { return }
            self.isPlaying ? self.pause() : self.play()
        }
        attach(controls.nextTrackCommand) { [weak self] in self?.advance(by: 1) }
        attach(controls.previousTrackCommand) { [weak self] in self?.previous() }
        let positionToken = controls.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            DispatchQueue.main.async { self?.seek(event.positionTime) }
            return .success
        }
        remoteTargets.append((controls.changePlaybackPositionCommand, positionToken))
        controls.skipForwardCommand.isEnabled = false
        controls.skipBackwardCommand.isEnabled = false
        controls.likeCommand.isEnabled = false
        controls.dislikeCommand.isEnabled = false
        controls.bookmarkCommand.isEnabled = false
    }

    private func refreshRemoteAvailability() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.isEnabled = current != nil
        commands.pauseCommand.isEnabled = current != nil
        commands.togglePlayPauseCommand.isEnabled = current != nil
        commands.changePlaybackPositionCommand.isEnabled = current != nil
        commands.nextTrackCommand.isEnabled = hasNext
        commands.previousTrackCommand.isEnabled = current != nil
    }

    private func handleInterruption(_ note: Notification) {
        guard let raw = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue,
              let kind = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch kind {
        case .began:
            resumeAfterInterruption = isPlaying
            pause()
        case .ended:
            let optionsValue = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
            if resumeAfterInterruption && options.contains(.shouldResume) { play() }
            resumeAfterInterruption = false
        @unknown default:
            pause()
        }
    }

    private func handleRouteChange(_ note: Notification) {
        guard let raw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        // Don't suddenly blast a song from the phone when headphones disconnect.
        if reason == .oldDeviceUnavailable { pause() }
    }
}
