import SwiftUI
import AVKit
import WebKit

extension RINLUSong {
    var artURL: URL? {
        Self.artURL(cover)
    }
    static func artURL(_ cover:String?) -> URL? {
        guard let cover, !cover.isEmpty else { return nil }
        let builtIn = ["dune","solar","tide","plum","orbit","sage"].contains(cover)
        return RINLUAPI.site.appendingPathComponent(builtIn ? "art" : "api/artwork").appendingPathComponent(builtIn ? cover + ".jpg" : cover)
    }
}
private struct Cover: View {
    let url: URL?
    init(song:RINLUSong) {url=song.artURL}
    init(cover:String?) {url=RINLUSong.artURL(cover)}
    var body: some View {
        ZStack {
            LinearGradient(colors: [.indigo.opacity(0.78),.pink.opacity(0.55)],startPoint: .topLeading,endPoint: .bottomTrailing)
            Image(systemName: "music.note").foregroundStyle(.white)
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Color.clear }
        }.aspectRatio(1,contentMode: .fit).clipped().accessibilityHidden(true)
    }
}
private struct Portal: Identifiable { let path: String; let title: String; var id: String { path } }
struct RINLUNativeRootView: View {
    @StateObject private var store = RINLUStore()
    @StateObject private var audio = RINLUMusicEngine()
    @State private var expanded = false
    @State private var portal: Portal?
    @State private var query = ""
    @Environment(\.scenePhase) private var phase
    private var matches: [RINLUSong] {
        let q=query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? store.catalog : store.catalog.filter { [$0.title,$0.artist,$0.genre ?? ""].contains { $0.localizedCaseInsensitiveContains(q) } }
    }
    var body: some View {
        TabView {
            page("Home") {
                if !store.catalog.isEmpty {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top,spacing: 16) {
                                ForEach(store.catalog.prefix(8)) { item in
                                    Button { Task { await audio.play(item,queue: store.catalog) } } label: {
                                        VStack(alignment: .leading,spacing: 6) {
                                            Cover(song:item).frame(width: 188,height:188).clipShape(RoundedRectangle(cornerRadius:12))
                                            Text(item.title).font(.headline).lineLimit(1)
                                            Text(item.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                        }.frame(width:188,alignment:.leading)
                                    }.buttonStyle(.plain).accessibilityIdentifier("featuredSong")
                                }
                            }.padding(.vertical,6)
                        }.listRowInsets(EdgeInsets()).accessibilityIdentifier("releaseShelf")
                    } header: { Text("New recordings") }
                    Section("Songs") { rows(store.catalog) }
                } else { empty(store.busy ? "Loading music…" : "No recordings available") }
            }.tabItem { Label("Home",systemImage:"house.fill") }
            page("Search") {
                if !query.isEmpty {
                    let releases=store.releases.filter { $0.title.localizedCaseInsensitiveContains(query) || artist($0).localizedCaseInsensitiveContains(query) }
                    if !releases.isEmpty { Section("Albums") {albumRows(releases)} }
                }
                if matches.isEmpty { empty("No matching songs") }
                else { rows(matches) }
            }.searchable(text:$query,prompt:"Songs, artists and genres").tabItem { Label("Search",systemImage:"magnifyingglass") }
            page("Library") {
                Section {
                    Button { web("settings","Account") } label: { Label(store.account?.name ?? "Sign in or create an account",systemImage:"person.crop.circle") }
                    NavigationLink { List { rows(store.catalog.filter { store.favorites.contains($0.id) }); if store.favorites.isEmpty { empty("No favorites yet") } }.navigationTitle("Favorites") } label: { Label("Favorites",systemImage:"heart") }
                    NavigationLink { List { albumRows(store.releases); if store.releases.isEmpty {empty("No albums available")} }.navigationTitle("Albums") } label: {Label("Albums",systemImage:"square.stack")}
                    NavigationLink { List { rows(store.history); if store.history.isEmpty { empty("No listening history yet") } }.navigationTitle("Recently played") } label: { Label("Recently played",systemImage:"clock") }
                    Button { web("library","Playlists") } label: { Label("Manage playlists",systemImage:"music.note.list") }
                }
                if !store.playlists.isEmpty { Section("Your playlists") { ForEach(store.playlists) { list in Button(list.name) { web("playlist/"+list.id,list.name) } } } }
                Section("RINLU") {
                    Button { web("play","Pulse Highway") } label: { Label("Pulse Highway",systemImage:"gamecontroller") }
                    Button { web("studio","Creator Studio") } label: { Label("Creator Studio",systemImage:"mic") }
                    if ["admin","reviewer"].contains(store.account?.role ?? "") {
                        Button { web("admin","Moderation") } label: { Label("Moderation",systemImage:"checkmark.seal") }
                    }
                }
            }.tabItem { Label("Library",systemImage:"square.stack.fill") }
        }
        .tint(.pink)
        .task { await BusinessPage.restoreSession(); await refresh() }
        .onChange(of: phase) { phase in if phase == .active && portal == nil { Task { await refresh() } } }
        .sheet(isPresented:$expanded) {
            if let song=audio.track { PlayerSheet(audio:audio,store:store,song:song).presentationDragIndicator(.visible) }
        }
        .sheet(item:$portal,onDismiss:{ Task { await BusinessPage.importSession(); await refresh() } }) { destination in
            NavigationStack {
                BusinessPage(path:destination.path,onMusic:{ id in
                    Task {
                        await BusinessPage.importSession()
                        do {
                            let song: RINLUSong
                            if let known=store.catalog.first(where:{$0.id==id}) { song=known }
                            else { let data: TrackDetail=try await RINLUAPI.shared.get("track/"+id); song=data.track }
                            portal=nil
                            await audio.play(song,queue:store.catalog.contains(song) ? store.catalog : [song])
                            expanded=true
                        } catch { store.error=error.localizedDescription }
                    }
                },onPreview:{audio.pause()})
                .navigationTitle(destination.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.confirmationAction){Button("Done"){portal=nil}} }
            }
        }
    }
    private func web(_ path:String,_ title:String){ portal=Portal(path:path,title:title) }
    private func refresh() async { await store.refresh(); audio.apply(store.dspPolicy); audio.syncLibrary(store.catalog, account:store.account?.id) }
    private func empty(_ title:String)->some View { Text(title).foregroundStyle(.secondary).padding(.vertical,12) }
    private func page<Content:View>(_ title:String,@ViewBuilder content:()->Content)->some View {
        NavigationStack {
            List {
                if let error=store.error { VStack(alignment:.leading){Text(error).font(.footnote);Button("Retry"){Task{await refresh()}}} }
                content()
            }.listStyle(.insetGrouped).navigationTitle(title).refreshable { await refresh() }
            .safeAreaInset(edge:.bottom,spacing:0) { if let song=audio.track {
                HStack {
                    Button { expanded=true } label: {
                        HStack { Cover(song:song).frame(width:42,height:42).clipShape(RoundedRectangle(cornerRadius:6))
                            VStack(alignment:.leading){Text(song.title).font(.subheadline.bold());Text(song.artist).font(.caption).foregroundStyle(.secondary)}.lineLimit(1)
                            Spacer() }.contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("openPlayer")
                    if audio.loading { ProgressView() }
                    Button { audio.toggle() } label: { Image(systemName:audio.playing ? "pause.fill":"play.fill").frame(width:44,height:44) }.accessibilityLabel(audio.playing ? "Pause":"Play")
                    Button { Task { await audio.next() } } label: { Image(systemName:"forward.fill").frame(width:44,height:44) }.accessibilityLabel("Next song").disabled(!audio.hasNext)
                }.padding(.horizontal).padding(.vertical,5).background(.regularMaterial)
            } }
        }
    }
    private func artist(_ release:RINLURelease)->String {
        store.artists.first { $0.id==release.artist_id }?.name ?? "RINLU"
    }
    private func albumRows(_ releases:[RINLURelease])->some View {
        ForEach(releases){ release in
            NavigationLink {
                let tracks=release.orderedIDs.compactMap { id in store.catalog.first { $0.id==id } }
                List {
                    VStack(alignment:.leading,spacing:10){
                        Cover(cover:release.cover).frame(maxWidth:300).clipShape(RoundedRectangle(cornerRadius:12))
                        Text(artist(release)).font(.title3).foregroundStyle(.secondary)
                        if let first=tracks.first {
                            Button {Task{await audio.play(first,queue:tracks)}} label:{Label("Play album",systemImage:"play.fill")}.buttonStyle(.borderedProminent)
                        }
                    }
                    rows(tracks)
                    Button("View on RINLU"){web("album/"+release.id,release.title)}
                }.navigationTitle(release.title)
            } label: {
                HStack {Cover(cover:release.cover).frame(width:52,height:52).clipShape(RoundedRectangle(cornerRadius:6));VStack(alignment:.leading){Text(release.title);Text(artist(release)).font(.caption).foregroundStyle(.secondary)}}
            }
        }
    }
    private func rows(_ songs:[RINLUSong])->some View {
        ForEach(songs){song in
            Button { Task { await audio.play(song,queue:songs) } } label: {
                HStack(spacing:12){Cover(song:song).frame(width:48,height:48).clipShape(RoundedRectangle(cornerRadius:7))
                    VStack(alignment:.leading,spacing:4){Text(song.title).font(.body.weight(.medium));Text(song.artist).font(.subheadline).foregroundStyle(.secondary)}.lineLimit(1)
                    Spacer()
                    if audio.track?.id==song.id {Image(systemName:"waveform").foregroundStyle(.pink)}
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            .swipeActions { if store.account != nil { Button("Favorite"){Task{await store.toggleFavorite(song)}}.tint(.pink) } }
        }
    }
}
private struct TrackDetail:Decodable {let track:RINLUSong}
private struct LyricsResponse:Decodable {struct Track:Decodable {let lyrics:String?};let track:Track}
private struct OutputPicker:UIViewRepresentable {
    func makeUIView(context:Context)->AVRoutePickerView { AVRoutePickerView() }
    func updateUIView(_ view:AVRoutePickerView,context:Context){}
}
private struct PlayerSheet:View {
    @ObservedObject var audio:RINLUMusicEngine
    @ObservedObject var store:RINLUStore
    let song:RINLUSong
    @State private var pane=0
    @State private var drag:Double?
    @State private var lyrics=""
    @Environment(\.dismiss) private var dismiss
    private var current:RINLUSong {audio.track ?? song}
    private func clock(_ t:Double)->String { let n=Int(max(0,t));return String(format:"%d:%02d",n/60,n%60) }
    var body:some View {
        ScrollView {
            VStack(spacing:20){
                HStack { Button { dismiss() } label: {Image(systemName:"chevron.down").frame(width:44,height:44)}.accessibilityLabel("Close player")
                    Spacer(); OutputPicker().frame(width:44,height:44) }
                if pane==0 {Cover(song:current).clipShape(RoundedRectangle(cornerRadius:16)).shadow(color:.black.opacity(0.17),radius:12,y:7).frame(maxWidth:360)}
                HStack {
                    VStack(alignment:.leading,spacing:6){Text(current.title).font(.title2.bold());Text(current.artist).font(.title3).foregroundStyle(.secondary)}
                    Spacer()
                    if store.account != nil { Button { Task { await store.toggleFavorite(current) } } label:{Image(systemName: store.favorites.contains(current.id) ? "heart.fill":"heart").frame(width:44,height:44)}.accessibilityLabel("Favorite") }
                }
                VStack {
                    Slider(value:Binding(get:{min(drag ?? audio.position,max(1,audio.duration))},set:{drag=$0}),in:0...max(1,audio.duration),onEditingChanged:{editing in if !editing,let drag { audio.seek(to:drag);self.drag=nil } }).accessibilityLabel("Playback position")
                    HStack{Text(clock(drag ?? audio.position));Spacer();Text("−"+clock(audio.duration-(drag ?? audio.position)))}.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                HStack(spacing:36) {
                    Button { Task {await audio.previous()} } label:{Image(systemName:"backward.fill").frame(width:44,height:44)}.accessibilityLabel("Previous song")
                    Button { audio.toggle() } label:{Image(systemName:audio.playing ? "pause.fill":"play.fill").font(.system(size:42)).frame(width:62,height:62)}.accessibilityLabel(audio.playing ? "Pause":"Play")
                    Button { Task{await audio.next()} } label:{Image(systemName:"forward.fill").frame(width:44,height:44)}.accessibilityLabel("Next song").disabled(!audio.hasNext)
                }.font(.title2).foregroundStyle(.primary)
                if audio.loading {ProgressView("Loading recording…")}
                if let err=audio.error {Text(err).font(.footnote).foregroundStyle(.secondary)}
                Picker("Player view",selection:$pane){Text("Artwork").tag(0);Text("Lyrics").tag(1);Text("Queue").tag(2)}.pickerStyle(.segmented)
                if pane==1 { LyricLines(text:lyrics,time:audio.position,seek:audio.seek) }
                if pane==2 {ForEach(audio.queue){t in Button {Task{await audio.play(t,queue:audio.queue)}} label:{HStack{Text(t.title);Spacer();if t.id==current.id{Image(systemName:"waveform")}}}.padding(.vertical,7)} }
                Toggle(isOn:Binding(get:{audio.dspEnabled},set:{_ in audio.toggleDSP(policy:store.dspPolicy)})){
                    VStack(alignment:.leading){Text("RINLUDSP");Text(audio.dspName).font(.caption).foregroundStyle(.secondary)}
                }.disabled(store.dspPolicy?.enabled != true).tint(.pink)
            }.padding(24).frame(maxWidth:540).frame(maxWidth:.infinity)
        }.background(LinearGradient(colors:[Color.pink.opacity(0.09),Color(uiColor:.systemBackground)],startPoint:.topLeading,endPoint:.bottomTrailing))
        .task(id:current.id) {
            let id=current.id;lyrics="Loading lyrics…"
            do {let r:LyricsResponse=try await RINLUAPI.shared.get("track/"+id);if !Task.isCancelled { lyrics=r.track.lyrics ?? "" }}
            catch {if !Task.isCancelled {lyrics="Could not load lyrics."}}
        }
    }
}
private struct LyricLines:View {
    let text:String;let time:Double;let seek:(Double)->Void
    private struct Line {let time:Double?;let words:String}
    private var lines:[Line] {
        text.components(separatedBy:.newlines).flatMap { s -> [Line] in
            let tags=s.matches(of:#/\[(\d+):(\d+(?:\.\d+)?)\]/#)
            if tags.isEmpty{return [Line(time:nil,words:s)]}
            let words=String(s[tags.last!.range.upperBound...])
            return tags.map{Line(time:(Double($0.1) ?? 0)*60+(Double($0.2) ?? 0),words:words)}
        }
    }
    var body:some View {
        let values=lines
        let active=values.indices.last { (values[$0].time ?? .infinity)<=time }
        ScrollViewReader { proxy in ScrollView {
            VStack(alignment:.leading,spacing:12){
                if text.isEmpty {Text("Lyrics unavailable").foregroundStyle(.secondary)}
                ForEach(values.indices,id:\.self){i in
                    Button {if let t=values[i].time {seek(t)}} label:{Text(values[i].words).font(.headline).foregroundStyle(active==i || values[i].time==nil ? .primary:.secondary).frame(maxWidth:.infinity,alignment:.leading)}
                    .buttonStyle(.plain).id(i)
                }
            }
        }.frame(height:215).onChange(of:active){i in if let i{withAnimation{proxy.scrollTo(i,anchor:.center)}}} }
    }
}
