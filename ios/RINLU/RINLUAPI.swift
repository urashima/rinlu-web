import Foundation
import Combine

// All endpoints below are verified against the published RINLU server source.
// No mock catalog, account or DSP preset data is used in this client.
struct RINLUSong: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let artist_name: String?
    let cover: String?
    let genre: String?
    let duration: Double?
    let status: String?
    let version: Int?
    var artist: String { artist_name ?? "RINLU" }
}
struct RINLUAccount: Decodable {
    let id: String
    let name: String
    let email: String?
    let role: String?
    let is_owner: Bool?
}
struct RINLUMe: Decodable { let user: RINLUAccount? }
struct RINLUCatalog: Decodable { let tracks: [RINLUSong] }
struct RINLUPlaylist: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let track_ids: String?
}
struct RINLULibrary: Decodable {
    let favorites: [String]
    let history: [RINLUSong]
    let playlists: [RINLUPlaylist]
}
struct RINLUStudio: Decodable { let tracks: [RINLUSong] }
struct RINLUAdmin: Decodable { let tracks: [RINLUSong] }
struct RINLUAuthorizedMedia: Decodable {
    let url: String
    let expires_at: Double
}
struct RINLUDSPSettings: Decodable {
    let quality: String
    let bands: Int
    let gains: [Float]
    let bass: Float
    let clarity: Float
    let room: Float
    let width: Float
    let boost: Float
    let compression: Float
    let leveling: Float
    let preamp: Float
    let fir: [Float]
}
struct RINLUActivePreset: Decodable {
    let id: String
    let name: String
    let strength: Float
    let settings: RINLUDSPSettings
}
struct RINLUDSPPolicy: Decodable {
    let revision: Int
    let enabled: Bool
    let default_on: Bool
    let active: RINLUActivePreset
}
struct RINLUHighwayEvent: Decodable {
    let time: Int
    let lane: Int
    let kind: String
}
struct RINLUHighwayLevel: Decodable {
    let version: String
    let duration: Int
    let events: [RINLUHighwayEvent]
}
struct RINLUHighwayResponse: Decodable {
    let level: RINLUHighwayLevel
    let hash: String
}

enum RINLUServiceError: LocalizedError {
    case invalidResponse
    case backend(Int, String)
    case invalidMediaURL
    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "服务端响应无法解析。"
        case .backend(let code, let message): return "\(message) (HTTP \(code))"
        case .invalidMediaURL: return "服务器返回的音乐地址不安全或无效。"
        }
    }
}

final class RINLUAPI {
    static let shared = RINLUAPI()
    static let site = URL(string: "https://rinlu.com/music/")!
    private let decoder = JSONDecoder()
    private let session: URLSession

    private init() {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 35
        session = URLSession(configuration: configuration)
    }

    func get<T: Decodable>(_ endpoint: String, as type: T.Type = T.self) async throws -> T {
        try await request(endpoint, method: "GET", body: nil, as: type)
    }

    func post<T: Decodable>(_ endpoint: String, payload: [String: Any], as type: T.Type = T.self) async throws -> T {
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try await request(endpoint, method: "POST", body: body, as: type)
    }

    func put<T: Decodable>(_ endpoint: String, payload: [String: Any], as type: T.Type = T.self) async throws -> T {
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try await request(endpoint, method: "PUT", body: body, as: type)
    }

    private func request<T: Decodable>(_ endpoint: String, method: String,
                                       body: Data?, as type: T.Type) async throws -> T {
        guard !endpoint.hasPrefix("/"), !endpoint.contains(".."),
              let url = URL(string: "api/" + endpoint, relativeTo: Self.site)?.absoluteURL,
              url.host == "rinlu.com", url.scheme == "https" else {
            throw RINLUServiceError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        // Existing site gateway requires an exact Origin for writes.
        if method != "GET" { request.setValue("https://rinlu.com", forHTTPHeaderField: "Origin") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw RINLUServiceError.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            let detail = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw RINLUServiceError.backend(response.statusCode,
                detail?["error"] as? String ?? "服务暂不可用")
        }
        do { return try decoder.decode(type, from: data) }
        catch { throw RINLUServiceError.invalidResponse }
    }

    func login(email: String, password: String) async throws {
        let _: [String: Bool] = try await post("accounts/login",
            payload: ["email": email, "password": password])
    }
    func register(name: String, email: String, password: String) async throws {
        let _: [String: Bool] = try await post("accounts/register",
            payload: ["name": name, "email": email, "password": password])
    }
    func logout() async throws {
        let _: [String: Bool] = try await post("accounts/logout", payload: [:])
        HTTPCookieStorage.shared.cookies?.forEach { cookie in
            if cookie.domain.contains("rinlu.com") { HTTPCookieStorage.shared.deleteCookie(cookie) }
        }
    }
    func setFavorite(trackID: String, active: Bool) async throws {
        let _: [String: Bool] = try await post("favorites",
            payload: ["track_id": trackID, "active": active])
    }
    func authorize(trackID: String) async throws -> URL {
        let data: RINLUAuthorizedMedia = try await post("playback/authorize",
                                                        payload: ["track_id": trackID])
        let url = URL(string: data.url, relativeTo: Self.site)?.absoluteURL
        guard let url = url, url.scheme == "https", url.host == "rinlu.com",
              data.expires_at > Date().timeIntervalSince1970 * 1000 else {
            throw RINLUServiceError.invalidMediaURL
        }
        return url
    }
    func mediaDownload(_ url: URL) async throws -> URL {
        // URLSession and the website gateway share the native account cookie;
        // authenticated bytes are never persisted in public storage.
        let (location, response) = try await session.download(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              (response.mimeType?.hasPrefix("audio/") ?? false) else {
            throw RINLUServiceError.invalidResponse
        }
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("rinlu-" + UUID().uuidString + ".mp3")
        try FileManager.default.moveItem(at: location, to: temporary)
        return temporary
    }
}

@MainActor
final class RINLUStore: ObservableObject {
    @Published var account: RINLUAccount?
    @Published var catalog: [RINLUSong] = []
    @Published var favorites: Set<String> = []
    @Published var history: [RINLUSong] = []
    @Published var playlists: [RINLUPlaylist] = []
    @Published var studioTracks: [RINLUSong] = []
    @Published var reviewTracks: [RINLUSong] = []
    @Published var dspPolicy: RINLUDSPPolicy?
    @Published var error: String?
    @Published var busy = false

    func refresh() async {
        busy = true
        defer { busy = false }
        do {
            async let catalogRequest: RINLUCatalog = RINLUAPI.shared.get("catalog")
            async let meRequest: RINLUMe = RINLUAPI.shared.get("me")
            async let policyRequest: RINLUDSPPolicy = RINLUAPI.shared.get("sound/policy")
            let result = try await (catalogRequest, meRequest, policyRequest)
            catalog = result.0.tracks
            account = result.1.user
            dspPolicy = result.2
            error = nil
            if account != nil { await refreshPrivate() }
        } catch { self.error = error.localizedDescription }
    }

    func refreshPrivate() async {
        guard let user = account else { return }
        do {
            let library: RINLULibrary = try await RINLUAPI.shared.get("library")
            favorites = Set(library.favorites)
            history = library.history
            playlists = library.playlists
        } catch { self.error = error.localizedDescription }
        if ["artist", "admin"].contains(user.role ?? "") {
            if let studio: RINLUStudio = try? await RINLUAPI.shared.get("studio") {
                studioTracks = studio.tracks
            }
        }
        if ["admin", "reviewer"].contains(user.role ?? "") {
            if let admin: RINLUAdmin = try? await RINLUAPI.shared.get("admin") {
                reviewTracks = admin.tracks
            }
        }
    }

    func login(email: String, password: String) async {
        busy = true; defer { busy = false }
        do {
            try await RINLUAPI.shared.login(email: email, password: password)
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    func toggleFavorite(_ song: RINLUSong) async {
        guard account != nil else { error = "请先登录账号"; return }
        let desired = !favorites.contains(song.id)
        do {
            try await RINLUAPI.shared.setFavorite(trackID: song.id, active: desired)
            if desired { favorites.insert(song.id) } else { favorites.remove(song.id) }
        } catch { self.error = error.localizedDescription }
    }
}
