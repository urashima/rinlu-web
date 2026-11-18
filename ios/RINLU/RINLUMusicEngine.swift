import Foundation
import Combine
import AVFoundation
import MediaPlayer
import UIKit

/// Device-local, single-source music engine: downloaded authorized audio
/// -> AVAudioFile -> AVAudioPlayerNode -> native DSP nodes -> hardware.
/// Streaming (play-before-download-completes) is a separate milestone.
@MainActor
final class RINLUMusicEngine: ObservableObject {
    @Published private(set) var track: RINLUSong?
    @Published private(set) var playing = false
    @Published private(set) var position = 0.0
    @Published private(set) var duration = 0.0
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var dspEnabled = UserDefaults.standard.object(forKey: "rinlu-dsp-enabled") as? Bool ?? false
    @Published private(set) var dspName = "RINLUDSP"

    private let engine = AVAudioEngine()
    private let source = AVAudioPlayerNode()
    private let eq = AVAudioUnitEQ(numberOfBands: 31)
    private let dynamics = AVAudioUnitDynamicsProcessor()
    private let ambience = AVAudioUnitReverb()
    private var file: AVAudioFile?
    private var temporaryFile: URL?
    private var queue: [RINLUSong] = []
    private var index = 0
    private var token = UUID()
    private var startFrame: AVAudioFramePosition = 0
    private var timer: Timer?
    private var sessionObservers: [NSObjectProtocol] = []
    private var commandTokens: [(MPRemoteCommand, Any)] = []

    init() {
        engine.attach(source)
        engine.attach(eq)
        engine.attach(dynamics)
        engine.attach(ambience)
        engine.connect(source, to: eq, format: nil)
        engine.connect(eq, to: dynamics, format: nil)
        engine.connect(dynamics, to: ambience, format: nil)
        engine.connect(ambience, to: engine.mainMixerNode, format: nil)
        ambience.loadFactoryPreset(.mediumHall)
        eq.bypass = true
        dynamics.bypass = true
        ambience.bypass = true
        setupRemote()
        sessionObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleInterruption(notification) }
        })
        sessionObservers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleRoute(notification) }
        })
        timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshPosition()
            }
        }
    }

    func apply(_ policy: RINLUDSPPolicy?) {
        guard let policy = policy else { return }
        dspName = policy.active.name
        if UserDefaults.standard.object(forKey: "rinlu-dsp-enabled") == nil {
            dspEnabled = policy.default_on
        }
        if !policy.enabled { setNodesEnabled(false); return }
        let settings = policy.active.settings
        let count = min(31, settings.bands, settings.gains.count)
        let centers = [62.5,115.7,214.3,396.9,734.9,1360.8,2519.8,4666.1,8640.5,16000.0]
        for i in 0..<31 {
            let band = eq.bands[i]
            band.filterType = .parametric
            let frequency: Double = count == 10
                ? centers[min(i, 9)]
                : 20.0 * pow(1000.0, Double(i) / Double(max(1, count - 1)))
            band.frequency = Float(min(frequency, 16000))
            band.bandwidth = max(0.2, min(4.0, 1.0 / max(0.5, settings.bass + 1)))
            band.gain = i < count ? settings.gains[i] * policy.active.strength : 0
            band.bypass = i >= count
        }
        eq.globalGain = settings.preamp * policy.active.strength
        dynamics.threshold = -12 - settings.compression * 12
        dynamics.headRoom = 5
        dynamics.expansionRatio = 1
        dynamics.masterGain = 0
        ambience.wetDryMix = max(0, min(35, settings.room * 100 * policy.active.strength))
        setNodesEnabled(policy.enabled && dspEnabled)
    }

    private func setNodesEnabled(_ value: Bool) {
        eq.bypass = !value
        dynamics.bypass = !value
        ambience.bypass = !value
    }

    func toggleDSP(policy: RINLUDSPPolicy?) {
        dspEnabled.toggle()
        UserDefaults.standard.set(dspEnabled, forKey: "rinlu-dsp-enabled")
        apply(policy)
    }

    func play(_ song: RINLUSong, queue songs: [RINLUSong]? = nil) async {
        if let songs = songs, !songs.isEmpty {
            queue = songs
            index = songs.firstIndex(where: { $0.id == song.id }) ?? 0
        } else {
            queue = [song]
            index = 0
        }
        token = UUID()
        let generation = token
        stopLocal()
        track = song
        position = 0
        duration = song.duration ?? 0
        loading = true
        error = nil
        updateNowPlaying()
        do {
            // Authorization is generated per track, directly before transfer;
            // do not pre-cache a five-minute token for the entire playlist.
            let stream = try await RINLUAPI.shared.authorize(trackID: song.id)
            let downloaded = try await RINLUAPI.shared.mediaDownload(stream)
            guard generation == token else {
                try? FileManager.default.removeItem(at: downloaded)
                return
            }
            temporaryFile = downloaded
            try prepareFile(downloaded)
            loading = false
            resume()
        } catch {
            if generation == token {
                loading = false
                self.error = error.localizedDescription
                playing = false
                updateNowPlaying()
            }
        }
    }

    private func prepareFile(_ url: URL) throws {
        let music = try AVAudioFile(forReading: url)
        file = music
        duration = Double(music.length) / music.processingFormat.sampleRate
        engine.stop()
        engine.disconnectNodeOutput(source)
        engine.connect(source, to: eq, format: music.processingFormat)
        if !engine.isRunning { try engine.start() }
        schedule(from: 0)
        updateNowPlaying()
    }

    private func schedule(from frame: AVAudioFramePosition) {
        guard let file = file else { return }
        source.stop()
        startFrame = max(0, min(frame, file.length))
        let generation = token
        let left = file.length - startFrame
        guard left > 0 else { return }
        source.scheduleSegment(file, startingFrame: startFrame,
                               frameCount: AVAudioFrameCount(min(left, Int64(UInt32.max))),
                               at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, generation == self.token,
                      self.file != nil, self.playing else { return }
                await self.next()
            }
        }
    }

    func resume() {
        guard file != nil else { return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .default)
            try audio.setActive(true)
            if !engine.isRunning { try engine.start() }
            source.play()
            playing = true
            updateNowPlaying()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func pause() {
        source.pause()
        playing = false
        refreshPosition()
        updateNowPlaying()
    }

    func toggle() { playing ? pause() : resume() }

    func seek(to seconds: Double) {
        guard let file = file, seconds.isFinite else { return }
        let shouldResume = playing
        let time = max(0, min(seconds, duration))
        let frame = AVAudioFramePosition(time * file.processingFormat.sampleRate)
        // Invalidate callbacks from the previous scheduled segment.
        token = UUID()
        schedule(from: frame)
        position = time
        if shouldResume { source.play() }
        updateNowPlaying()
    }

    func next() async {
        guard index + 1 < queue.count else {
            pause()
            return
        }
        index += 1
        await play(queue[index], queue: queue)
    }

    func previous() async {
        if position >= 3 || index <= 0 {
            seek(to: 0)
        } else {
            index -= 1
            await play(queue[index], queue: queue)
        }
    }

    func stop() {
        token = UUID()
        stopLocal()
        track = nil
        queue = []
        position = 0
        duration = 0
        playing = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func stopLocal() {
        source.stop()
        playing = false
        file = nil
        if let temporary = temporaryFile { try? FileManager.default.removeItem(at: temporary) }
        temporaryFile = nil
    }

    private func refreshPosition() {
        guard let file = file else { return }
        if let node = source.lastRenderTime, let time = source.playerTime(forNodeTime: node) {
            position = min(duration, Double(startFrame) / file.processingFormat.sampleRate
                           + Double(time.sampleTime) / time.sampleRate)
        }
        if playing { updateNowPlaying() }
    }

    private func updateNowPlaying() {
        guard let track = track else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0
        ]
    }

    private func setupRemote() {
        let center = MPRemoteCommandCenter.shared()
        func register(_ command: MPRemoteCommand, handler: @escaping () -> Void) {
            let handle = command.addTarget { _ in
                Task { @MainActor in handler() }
                return .success
            }
            commandTokens.append((command, handle))
        }
        register(center.playCommand) { [weak self] in self?.resume() }
        register(center.pauseCommand) { [weak self] in self?.pause() }
        register(center.togglePlayPauseCommand) { [weak self] in self?.toggle() }
        register(center.nextTrackCommand) { [weak self] in Task { await self?.next() } }
        register(center.previousTrackCommand) { [weak self] in Task { await self?.previous() } }
        let seekTarget = center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: event.positionTime) }
            return .success
        }
        commandTokens.append((center.changePlaybackPositionCommand, seekTarget))
    }

    private func handleInterruption(_ notification: Notification) {
        guard let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue,
              let event = AVAudioSession.InterruptionType(rawValue: type) else { return }
        if event == .began { pause() }
        else if event == .ended {
            let raw = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
            if AVAudioSession.InterruptionOptions(rawValue: raw).contains(.shouldResume) { resume() }
        }
    }

    private func handleRoute(_ notification: Notification) {
        guard let raw = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue,
              let event = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        if event == .oldDeviceUnavailable { pause() }
    }
}
