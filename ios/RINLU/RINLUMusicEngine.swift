import AVFoundation
import MediaPlayer
import SwiftUI

@MainActor
final class RINLUMusicEngine: ObservableObject {
    @Published private(set) var track: RINLUSong?
    @Published private(set) var queue = [RINLUSong]()
    @Published private(set) var playing = false
    @Published private(set) var loading = false
    @Published private(set) var duration = 0.0
    @Published private(set) var position = 0.0
    @Published private(set) var error: String?
    @Published private(set) var dspEnabled = false
    @Published private(set) var dspName = "RINLUDSP"
    private let player = AVPlayer()
    private var tap: RINLUTap?
    private var workingFile: URL?
    private var converting = false
    private var wetCheckStart: Date?
    private func discardWorkingFile() {
        if let workingFile { try? FileManager.default.removeItem(at:workingFile) }
        workingFile=nil
    }
    private var assetTrack: AVAssetTrack?
    private var generation = UUID()
    private var wantsPlay = false
    private var interrupted = false
    private var itemStatus: NSKeyValueObservation?
    private var observers = [NSObjectProtocol]()
    private var timer: Any?
    private var revision: Int?
    private var policy: RINLUDSPPolicy?
    private var artwork: MPMediaItemArtwork?
    private var eventID = UUID()
    private var listened = 0.0
    private var previousTime: Double?
    private var retryCount = 0
    private var eventSent = false

    private var accountScope: String?
    private var lastCheckpoint = -1
    private var restored = false
    private struct Checkpoint: Codable {
        let queue: [String]
        let selected: String
        let seconds: Double
    }
    private var checkpointKey: String { "rinlu.queue." + (accountScope ?? "guest") }

    func syncLibrary(_ songs: [RINLUSong], account: String?) {
        let scope = account ?? "guest"
        if let prior = accountScope, prior != scope {
            checkpoint()
            wantsPlay = false; generation = UUID()
            itemStatus = nil; player.replaceCurrentItem(with: nil)
            discardWorkingFile(); converting=false; track = nil; queue = []; assetTrack = nil; tap = nil; artwork = nil
            playing = false; loading = false; error = nil; restored = false
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        }
        accountScope = scope
        guard !restored, track == nil, !songs.isEmpty else { return }
        restored = true
        guard let data = UserDefaults.standard.data(forKey: checkpointKey),
              let saved = try? JSONDecoder().decode(Checkpoint.self, from: data),
              let selected = songs.first(where: { $0.id == saved.selected }) else { return }
        let catalog = Dictionary(songs.map { ($0.id,$0) }, uniquingKeysWith: { first,_ in first })
        queue = saved.queue.compactMap { catalog[$0] }
        if queue.isEmpty { queue = [selected] }
        track = selected; duration = selected.duration ?? 0
        position = min(max(saved.seconds,0),duration); publish()
    }
    private func checkpoint() {
        guard accountScope != nil, let track, position.isFinite else { return }
        let saved = Checkpoint(queue: queue.prefix(300).map(\.id), selected: track.id, seconds: position)
        if let data = try? JSONEncoder().encode(saved) { UserDefaults.standard.set(data,forKey:checkpointKey) }
    }

    init() {
        timer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.4, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        func observe(_ name: Notification.Name, _ action: @escaping @MainActor (Notification) -> Void) {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { n in
                Task { @MainActor in action(n) }
            })
        }
        observe(.AVPlayerItemDidPlayToEndTime) { [weak self] n in
            guard let self, let item = n.object as? AVPlayerItem, item === self.player.currentItem else { return }
            self.saveEvent(completed: true)
            if self.hasNext { Task { await self.next() } } else { self.pause(); self.seek(to: 0) }
        }
        observe(AVAudioSession.interruptionNotification) { [weak self] n in
            guard let self, let t = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            if t == AVAudioSession.InterruptionType.began.rawValue { self.interrupted = self.wantsPlay; self.pause() }
            else if self.interrupted {
                self.interrupted = false
                if AVAudioSession.InterruptionOptions(rawValue: n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0).contains(.shouldResume) { self.resume() }
            }
        }
        observe(AVAudioSession.routeChangeNotification) { [weak self] n in
            if n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self?.interrupted = false; self?.pause() }
        }
        let center = MPRemoteCommandCenter.shared()
        func bind(_ command: MPRemoteCommand, _ action: @escaping @MainActor () -> Void) {
            command.addTarget { _ in Task { @MainActor in action() }; return .success }
        }
        bind(center.playCommand) { [weak self] in self?.resume() }
        bind(center.pauseCommand) { [weak self] in self?.pause() }
        bind(center.togglePlayPauseCommand) { [weak self] in self?.toggle() }
        bind(center.nextTrackCommand) { [weak self] in Task { await self?.next() } }
        bind(center.previousTrackCommand) { [weak self] in Task { await self?.previous() } }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: e.positionTime) }; return .success
        }
    }

    func apply(_ policy: RINLUDSPPolicy?) {
        self.policy = policy
        dspEnabled = policy?.enabled == true && (UserDefaults.standard.object(forKey: "rinlu-dsp-enabled") as? Bool ?? policy?.default_on ?? false)
        dspName = policy?.active.name ?? "RINLUDSP"
        if policy?.revision != revision {
            revision = policy?.revision
            if let item = player.currentItem, let assetTrack { configureDSP(item, assetTrack) }
        }
        tap?.enabled = dspEnabled
    }
    func toggleDSP(policy: RINLUDSPPolicy?) {
        UserDefaults.standard.set(!dspEnabled, forKey: "rinlu-dsp-enabled")
        apply(policy)
    }
    private func configureDSP(_ item: AVPlayerItem, _ track: AVAssetTrack) {
        guard let p = policy, let data = try? JSONEncoder().encode(p.active.settings),
              let settings = (try? JSONSerialization.jsonObject(with: data)) as? [AnyHashable: Any] else {
            tap = nil; item.audioMix = nil; return
        }
        let processor = RINLUTap(settings: settings, strength: Double(p.active.strength))
        processor.enabled = dspEnabled
        item.audioMix = processor.mix(for: track)
        tap = processor
        if item.audioMix == nil && dspEnabled { error = "Sound processing is unavailable for this recording." }
    }
    func play(_ song: RINLUSong, queue songs: [RINLUSong]? = nil) async {
        saveEvent(completed: false)
        eventID = UUID(); listened = 0; eventSent = false; previousTime = nil; retryCount = 0
        artwork = nil; queue = songs ?? [song]; track = song; duration = song.duration ?? 0
        wantsPlay = true; lastCheckpoint = -1
        await load(song, from: 0)
    }
    private func load(_ song: RINLUSong, from seconds: Double, standardized: Bool = false) async {
        generation = UUID(); let id = generation
        itemStatus = nil; player.replaceCurrentItem(with: nil); assetTrack = nil; tap = nil
        discardWorkingFile(); converting = standardized; wetCheckStart = nil
        loading = true; playing = false; error = nil; position = seconds; publish()
        do {
            let url = try await RINLUAPI.shared.authorize(trackID: song.id)
            let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
            let asset: AVURLAsset
            if standardized {
                let file=try await WorkingAudio.convert(url)
                guard id==generation else {try? FileManager.default.removeItem(at:file);return}
                workingFile=file;asset=AVURLAsset(url:file)
            } else { asset=AVURLAsset(url:url,options:[AVURLAssetHTTPCookiesKey:cookies]) }
            guard let channel = try await asset.loadTracks(withMediaType: .audio).first else { throw RINLUServiceError.invalidResponse }
            guard id == generation else { return }
            let item = AVPlayerItem(asset: asset)
            assetTrack = channel; configureDSP(item, channel)
            player.replaceCurrentItem(with: item)
            if seconds > 0 { await player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) }
            guard id == generation else { return }
            itemStatus = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
                Task { @MainActor in
                    guard let self, self.generation == id else { return }
                    if item.status == .failed {
                        if self.retryCount == 0 && self.wantsPlay {
                            self.retryCount += 1; await self.load(song, from: self.position)
                        } else { self.pause(); self.error = item.error?.localizedDescription ?? "Playback failed." }
                    }
                }
            }
            if wantsPlay { resume() } else { loading = false }
            if let url = song.artURL {
                Task { [weak self] in
                    guard let (bytes, _) = try? await URLSession.shared.data(from: url), let image = UIImage(data: bytes), self?.generation == id else { return }
                    self?.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }; self?.publish()
                }
            }
        } catch {
            guard id == generation else { return }
            self.error = error.localizedDescription; pause()
        }
    }
    func resume() {
        guard track != nil else { return }; wantsPlay = true
        if let song = track, (!loading && player.currentItem == nil) || player.currentItem?.status == .failed {
            Task { await load(song, from: position) }; return
        }
        do { let s = AVAudioSession.sharedInstance(); try s.setCategory(.playback); try s.setActive(true); player.play(); tick() }
        catch { self.error = error.localizedDescription; pause() }
    }
    func pause() { wantsPlay = false; player.pause(); loading = false; playing = false; previousTime = nil; checkpoint(); publish() }
    func toggle() { wantsPlay ? pause() : resume() }
    func seek(to t: Double) {
        guard t.isFinite else { return }
        previousTime = nil; position = min(max(t,0),duration); player.seek(to: CMTime(seconds: position, preferredTimescale: 600)); publish()
    }
    private var index: Int { queue.firstIndex { $0.id == track?.id } ?? 0 }
    var hasNext: Bool { index + 1 < queue.count }
    func next() async { if hasNext { await play(queue[index+1], queue: queue) } }
    func previous() async { if position > 3 || index == 0 { seek(to: 0) } else { await play(queue[index-1], queue: queue) } }
    private func tick() {
        guard let item = player.currentItem else { return }
        let t = player.currentTime().seconds
        if item.duration.seconds.isFinite { duration = item.duration.seconds }
        playing = player.timeControlStatus == .playing
        loading = wantsPlay && player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        if t.isFinite {
            if playing, let last = previousTime, (0...1.5).contains(t-last) { listened += t-last }
            position = t; previousTime = playing ? t : nil
        }
        if playing, Int(position)/5 != lastCheckpoint { lastCheckpoint = Int(position)/5; checkpoint() }
        if dspEnabled, playing, let tap, let song=track, !converting {
            if wetCheckStart == nil {wetCheckStart=Date()}
            if tap.formatUnsupported || (!tap.hasProcessedAudio && Date().timeIntervalSince(wetCheckStart ?? Date())>2) {
                converting=true
                Task { await load(song,from:position,standardized:true) }
            }
        } else { wetCheckStart=nil }
        publish()
    }
    private func saveEvent(completed: Bool) {
        guard !eventSent, listened >= 1, let track else { return }; eventSent = true
        let body: [String: Any] = ["id":eventID.uuidString,"track_id":track.id,"seconds":min(7200,listened),"completed":completed]
        Task { let _: [String:Bool]? = try? await RINLUAPI.shared.post("playback/event", payload: body) }
    }
    private func publish() {
        guard let track else { return }
        var info: [String:Any] = [MPMediaItemPropertyTitle:track.title,MPMediaItemPropertyArtist:track.artist,
            MPMediaItemPropertyPlaybackDuration:duration,MPNowPlayingInfoPropertyElapsedPlaybackTime:position,
            MPNowPlayingInfoPropertyPlaybackRate:playing ? 1.0 : 0.0]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

/// Decode unusual source rates into the same 48 kHz working format as the reference processor.
private enum WorkingAudio {
    static func convert(_ url: URL) async throws -> URL {
        let (download, response) = try await URLSession.shared.download(from: url)
        defer { try? FileManager.default.removeItem(at: download) }
        guard let http=response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw RINLUServiceError.invalidResponse }
        return try await Task.detached(priority:.userInitiated) {
            let source = try AVAudioFile(forReading:download)
            guard let format=AVAudioFormat(standardFormatWithSampleRate:48000,channels:2),
                  let converter=AVAudioConverter(from:source.processingFormat,to:format),
                  let output=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:8192) else {throw RINLUServiceError.invalidResponse}
            let location=FileManager.default.temporaryDirectory.appendingPathComponent("rinlu-"+UUID().uuidString+".caf")
            var finished=false
            defer { if !finished { try? FileManager.default.removeItem(at:location) } }
            let writer=try AVAudioFile(forWriting:location,settings:format.settings)
            var readError:Error?
            while true {
                var conversionError:NSError?
                let status=converter.convert(to:output,error:&conversionError){count,state in
                    guard let input=AVAudioPCMBuffer(pcmFormat:source.processingFormat,frameCapacity:count) else {state.pointee = .endOfStream;readError=RINLUServiceError.invalidResponse;return nil}
                    do {try source.read(into:input,frameCount:count)}
                    catch {readError=error;state.pointee = .endOfStream;return nil}
                    guard input.frameLength>0 else {state.pointee = .endOfStream;return nil}
                    state.pointee = .haveData;return input
                }
                if let readError {throw readError}
                if let conversionError {throw conversionError}
                if status == .error {throw RINLUServiceError.invalidResponse}
                if output.frameLength>0 {try writer.write(from:output)}
                if status == .endOfStream {break}
            }
            finished=true;return location
        }.value
    }
}
