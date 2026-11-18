import SwiftUI
import SceneKit

struct RINLUNativeRootView: View {
    @StateObject private var store = RINLUStore()
    @StateObject private var audio = RINLUMusicEngine()
    @State private var selectedTab = 0
    @State private var showingSignIn = false

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                RINLUSongList(title: "Discover", songs: store.catalog,
                              store: store, audio: audio)
            }
            .tabItem { Label("Discover", systemImage: "sparkles") }.tag(0)

            NavigationStack {
                RINLUPulseLobby(store: store, audio: audio)
            }
            .tabItem { Label("Music & play", systemImage: "gamecontroller") }.tag(1)

            NavigationStack {
                RINLUNowPlaying(store: store, audio: audio)
            }
            .tabItem { Label("Now playing", systemImage: "play.circle") }.tag(2)

            NavigationStack {
                RINLUSearch(store: store, audio: audio)
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }.tag(3)

            NavigationStack {
                RINLULibraryView(store: store, audio: audio,
                                 showSignIn: { showingSignIn = true })
            }
            .tabItem { Label("Your library", systemImage: "books.vertical") }.tag(4)

            NavigationStack {
                RINLUWorkspaceView(store: store, showSignIn: { showingSignIn = true })
            }
            .tabItem { Label("Studio", systemImage: "music.mic") }.tag(5)
        }
        .tint(.white)
        .preferredColorScheme(.dark)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if audio.track != nil {
                RINLUMiniPlayer(audio: audio) { selectedTab = 2 }
            }
        }
        .sheet(isPresented: $showingSignIn) { RINLUSignIn(store: store) }
        .overlay(alignment: .top) {
            if let error = store.error {
                HStack {
                    Text(error).lineLimit(3)
                    Button("关闭") { store.error = nil }
                }
                .font(.caption)
                .padding(12)
                .background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 12))
                .padding(12)
            }
        }
        .task {
            await store.refresh()
            audio.apply(store.dspPolicy)
        }
        .onChange(of: store.dspPolicy?.revision) { _ in
            audio.apply(store.dspPolicy)
        }
    }
}

private struct RINLUSongRow: View {
    let song: RINLUSong
    @ObservedObject var store: RINLUStore
    @ObservedObject var audio: RINLUMusicEngine
    let queue: [RINLUSong]

    var body: some View {
        HStack(spacing: 12) {
            Button {
                Task { await audio.play(song, queue: queue) }
            } label: {
                RINLUCover(cover: song.cover, size: 54)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 4) {
                Text(song.title).font(.body.weight(.medium)).lineLimit(1)
                Text(song.artist).font(.caption).foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 3)
            if store.account != nil {
                Button {
                    Task { await store.toggleFavorite(song) }
                } label: {
                    Image(systemName: store.favorites.contains(song.id) ? "heart.fill" : "heart")
                }
                .buttonStyle(.plain)
            }
            Button {
                Task { await audio.play(song, queue: queue) }
            } label: { Image(systemName: "play.fill") }
                .buttonStyle(.plain)
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}

private struct RINLUCover: View {
    let cover: String?
    var size: CGFloat = 54
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7).fill(.white.opacity(0.08))
            if let cover = cover {
                let url: URL? = {
                    if ["dune","solar","tide","plum","orbit","sage"].contains(cover) {
                        return URL(string: "https://rinlu.com/music/art/\(cover).jpg")
                    }
                    return URL(string: "https://rinlu.com/music/api/artwork/\(cover)")
                }()
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Image(systemName: "music.note").foregroundStyle(.secondary)
                    }
                }
            } else {
                Image(systemName: "music.note").foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct RINLUSongList: View {
    let title: String
    let songs: [RINLUSong]
    @ObservedObject var store: RINLUStore
    @ObservedObject var audio: RINLUMusicEngine

    var body: some View {
        List {
            Section {
                ForEach(songs) { song in
                    RINLUSongRow(song: song, store: store, audio: audio, queue: songs)
                }
            } header: {
                Text("YOUR WORLD OF SOUND")
            }
        }
        .navigationTitle(title)
        .overlay {
            if songs.isEmpty { VStack(spacing: 10) { Image(systemName: "music.note").font(.title); Text("暂无歌曲") }.foregroundStyle(.secondary) }
        }
        .refreshable { await store.refresh() }
    }
}

private struct RINLUSearch: View {
    @ObservedObject var store: RINLUStore
    @ObservedObject var audio: RINLUMusicEngine
    @State private var query = ""
    private var results: [RINLUSong] {
        guard !query.isEmpty else { return store.catalog }
        return store.catalog.filter {
            $0.title.localizedCaseInsensitiveContains(query) ||
            $0.artist.localizedCaseInsensitiveContains(query) ||
            ($0.genre ?? "").localizedCaseInsensitiveContains(query)
        }
    }
    var body: some View {
        RINLUSongList(title: "Search", songs: results, store: store, audio: audio)
            .searchable(text: $query, prompt: "Search songs and artists")
    }
}

private struct RINLUMiniPlayer: View {
    @ObservedObject var audio: RINLUMusicEngine
    let open: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: open) {
                RINLUCover(cover: audio.track?.cover, size: 38)
                VStack(alignment: .leading, spacing: 3) {
                    Text(audio.track?.title ?? "RINLU").font(.subheadline.weight(.medium)).lineLimit(1)
                    Text(audio.track?.artist ?? "").font(.caption).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            Spacer()
            if audio.loading { ProgressView().tint(.white) }
            Button { audio.toggle() } label: {
                Image(systemName: audio.playing ? "pause.fill" : "play.fill")
                    .frame(width: 36, height: 36)
            }
            Button { Task { await audio.next() } } label: {
                Image(systemName: "forward.end.fill").frame(width: 30, height: 36)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 6)
        .background(.regularMaterial)
    }
}

private struct RINLUNowPlaying: View {
    @ObservedObject var store: RINLUStore
    @ObservedObject var audio: RINLUMusicEngine
    @State private var seeking: Double = 0
    @State private var moving = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Spacer(minLength: 20)
                RINLUCover(cover: audio.track?.cover, size: 255)
                    .shadow(color: .black.opacity(0.5), radius: 25)
                Text(audio.track?.title ?? "Now playing")
                    .font(.title2.weight(.semibold))
                Text(audio.track?.artist ?? "Choose a song from Discover")
                    .foregroundStyle(.secondary)
                Slider(value: Binding(get: { moving ? seeking : audio.position },
                                      set: { seeking = $0; moving = true }),
                       in: 0...max(1, audio.duration)) { editing in
                    if !editing {
                        audio.seek(to: seeking)
                        moving = false
                    }
                }
                HStack {
                    Text(format(audio.position))
                    Spacer()
                    Text(format(audio.duration))
                }
                .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                HStack(spacing: 40) {
                    Button { Task { await audio.previous() } } label: {
                        Image(systemName: "backward.end.fill").font(.title2)
                    }
                    Button { audio.toggle() } label: {
                        Image(systemName: audio.playing ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 58))
                    }
                    Button { Task { await audio.next() } } label: {
                        Image(systemName: "forward.end.fill").font(.title2)
                    }
                }
                .buttonStyle(.plain)
                if audio.loading { ProgressView("正在准备音乐…") }
                if let error = audio.error { Text(error).foregroundStyle(.red).font(.caption) }
                Divider()
                Toggle(isOn: Binding(get: { audio.dspEnabled },
                                     set: { _ in audio.toggleDSP(policy: store.dspPolicy) })) {
                    VStack(alignment: .leading) {
                        Text("RINLUDSP")
                        Text(audio.dspName).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .disabled(store.dspPolicy?.enabled != true)
                Text("当前原生 DSP 试听链路尚未通过 RINLUDSP 3.0 波形一致性测试")
                    .font(.caption2).foregroundStyle(.secondary)
                Spacer(minLength: 25)
            }
            .padding(.horizontal, 30)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Now playing")
    }
    private func format(_ seconds: Double) -> String {
        let value = max(0, Int(seconds.isFinite ? seconds : 0))
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}

private struct RINLULibraryView: View {
    @ObservedObject var store: RINLUStore
    @ObservedObject var audio: RINLUMusicEngine
    let showSignIn: () -> Void

    var body: some View {
        List {
            if store.account == nil {
                Button("Sign in to RINLU", action: showSignIn)
            } else {
                Section("喜欢的歌曲") {
                    ForEach(store.catalog.filter { store.favorites.contains($0.id) }) { song in
                        RINLUSongRow(song: song, store: store, audio: audio, queue: store.catalog)
                    }
                }
                Section("最近播放") {
                    ForEach(store.history) { song in
                        RINLUSongRow(song: song, store: store, audio: audio, queue: store.history)
                    }
                }
                Section("播放列表") {
                    ForEach(store.playlists) { playlist in
                        HStack {
                            Image(systemName: "music.note.list")
                            Text(playlist.name)
                        }
                    }
                }
                Section("账户") {
                    Text(store.account?.name ?? "")
                    Button("退出登录") {
                        Task {
                            do {
                                try await RINLUAPI.shared.logout()
                                await store.refresh()
                            } catch { store.error = error.localizedDescription }
                        }
                    }
                }
            }
        }
        .navigationTitle("Your library")
        .refreshable { await store.refreshPrivate() }
    }
}

private struct RINLUWorkspaceView: View {
    @ObservedObject var store: RINLUStore
    let showSignIn: () -> Void

    var body: some View {
        List {
            if store.account == nil {
                Button("Sign in to RINLU", action: showSignIn)
            } else {
                Section("创作者中心") {
                    ForEach(store.studioTracks) { song in
                        HStack {
                            Text(song.title)
                            Spacer()
                            Text(song.status ?? "").foregroundStyle(.secondary).font(.caption)
                        }
                    }
                    if store.studioTracks.isEmpty {
                        Text("开始创建你的原创音乐").foregroundStyle(.secondary)
                    }
                }
                if ["admin","reviewer"].contains(store.account?.role ?? "") {
                    Section("管理后台") {
                        NavigationLink("审核与管理") {
                            RINLUAdminView(store: store)
                        }
                    }
                }
                Section("RINLUDSP 管理") {
                    Text("全站预设：\(store.dspPolicy?.active.name ?? "—")")
                    if store.account?.role == "admin" {
                        Text("原生管理员参数编辑、审计和发布正在对接现有 /api/admin/sound 接口。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Creator Studio")
    }
}

private struct RINLUAdminView: View {
    @ObservedObject var store: RINLUStore
    var body: some View {
        List {
            Section("审核队列") {
                ForEach(store.reviewTracks.filter { $0.status == "review" }) { song in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(song.title)
                            Text(song.artist).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("待审核").font(.caption)
                    }
                }
            }
            Section("说明") {
                Text("可查看真实待审核内容；涉及版权与发布的审核写操作尚未开放，避免误操作。")
            }
        }
        .navigationTitle("Administration")
    }
}

private struct RINLUSignIn: View {
    @ObservedObject var store: RINLUStore
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Sign in") {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                    Button(store.busy ? "Connecting…" : "Sign in") {
                        Task {
                            await store.login(email: email, password: password)
                            if store.account != nil { dismiss() }
                        }
                    }
                    .disabled(store.busy || email.isEmpty || password.isEmpty)
                }
                Section {
                    Text("账号连接使用现有 RINLU 服务端 HTTPS 会话。Google OAuth 原生回调尚未接入。")
                        .font(.caption)
                }
            }
            .navigationTitle("RINLU Account")
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("Close") { dismiss() }
            }}
        }
    }
}

private struct RINLUPulseLobby: View {
    @ObservedObject var store: RINLUStore
    @ObservedObject var audio: RINLUMusicEngine

    var body: some View {
        List {
            Section {
                Text("听哪首音乐，就玩哪首音乐。")
                    .foregroundStyle(.secondary)
            }
            Section("Pulse Highway") {
                ForEach(store.catalog) { song in
                    NavigationLink {
                        RINLUPulseGame(song: song, audio: audio)
                    } label: {
                        Label(song.title, systemImage: "gamecontroller")
                    }
                }
            }
        }
        .navigationTitle("Music & play")
    }
}

private struct RINLUPulseGame: View {
    let song: RINLUSong
    @ObservedObject var audio: RINLUMusicEngine
    @State private var game: RINLUHighwayResponse?
    @State private var lane = 1
    @State private var points = 0
    @State private var scored = Set<Int>()
    @State private var difficulty = "normal"
    @State private var error: String?

    private var scene: SCNScene {
        let scene = SCNScene()
        scene.background.contents = UIColor.black
        let camera = SCNCamera()
        camera.fieldOfView = 60
        let node = SCNNode()
        node.camera = camera
        node.position = SCNVector3(0, 3, 7)
        node.eulerAngles.x = -0.35
        scene.rootNode.addChildNode(node)
        let floor = SCNBox(width: 4.6, height: 0.08, length: 35, chamferRadius: 0)
        floor.firstMaterial?.diffuse.contents = UIColor(white: 0.12, alpha: 1)
        let platform = SCNNode(geometry: floor)
        platform.position = SCNVector3(0, -0.65, -10)
        scene.rootNode.addChildNode(platform)
        for column in 0..<3 {
            let strip = SCNBox(width: 0.04, height: 0.02, length: 35, chamferRadius: 0)
            strip.firstMaterial?.diffuse.contents = UIColor(white: 0.35, alpha: 1)
            let line = SCNNode(geometry: strip)
            line.position = SCNVector3(Float(column) * 1.5 - 2.25, -0.59, -10)
            scene.rootNode.addChildNode(line)
        }
        let marble = SCNSphere(radius: 0.3)
        marble.firstMaterial?.diffuse.contents = UIColor.white
        let hero = SCNNode(geometry: marble)
        hero.position = SCNVector3(Float(lane - 1) * 1.5, -0.15, 3)
        scene.rootNode.addChildNode(hero)
        if let game = game {
            for (i, event) in game.level.events.enumerated()
            where abs(Double(event.time) / 1000 - audio.position) < 11 {
                let box = SCNBox(width: 0.48, height: 0.45, length: 0.48, chamferRadius: 0.06)
                box.firstMaterial?.diffuse.contents = event.kind == "gem" ? UIColor.systemYellow : UIColor.systemRed
                let obstacle = SCNNode(geometry: box)
                obstacle.name = "event-\(i)"
                obstacle.position = SCNVector3(Float(event.lane - 1) * 1.5, -0.22,
                    Float(3 - (Double(event.time) / 1000 - audio.position) * 3))
                scene.rootNode.addChildNode(obstacle)
            }
        }
        return scene
    }

    var body: some View {
        VStack {
            HStack {
                Text("Pulse Highway").font(.headline)
                Spacer()
                Text("Score: \(points)").monospacedDigit()
            }
            .padding(.horizontal, 16)
            if let error = error { Text(error).foregroundStyle(.red).font(.caption) }
            if game == nil {
                ProgressView("正在加载已审核的关卡…")
                    .frame(maxHeight: .infinity)
            } else {
                SceneView(scene: scene, options: [.allowsCameraControl])
                    .frame(maxHeight: .infinity)
                    .background(.black)
                HStack {
                    ForEach(0..<3, id: \.self) { value in
                        Button(value == 0 ? "◀" : value == 2 ? "▶" : "●") {
                            lane = value
                            checkHits()
                        }
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(lane == value ? Color.white.opacity(0.3) : Color.white.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding(.horizontal)
            }
            Text("玩法与音频均使用当前真实歌曲；正式计分及 DSP 延迟校准尚需验证。")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding()
        }
        .task {
            do {
                let level: RINLUHighwayResponse = try await RINLUAPI.shared.get(
                    "games/highway/\(song.id)?difficulty=\(difficulty)")
                game = level
                await audio.play(song)
            } catch { self.error = error.localizedDescription }
        }
        .onChange(of: audio.position) { _ in checkHits() }
        .navigationTitle(song.title)
    }

    private func checkHits() {
        guard let game = game else { return }
        for (i, event) in game.level.events.enumerated()
        where event.kind == "gem" && !scored.contains(i) &&
            abs(Double(event.time) / 1000 - audio.position) < 0.25 {
            scored.insert(i)
            if lane == event.lane { points += 100 }
        }
    }
}
