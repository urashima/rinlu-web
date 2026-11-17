import UIKit
import WebKit

/// iOS counterpart of the Android v0.1.0 web host.
/// The website/server owns login, content, games and authorization.
/// No app-owned JS bridge, auth headers or hard-coded credentials.
final class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private static let home = URL(string: "https://rinlu.com/music/")!
    private let ink = UIColor(red: 17 / 255, green: 17 / 255, blue: 17 / 255, alpha: 1)

    // AVPlayer remains the sole audio transport when the site opts into native playback.
    private lazy var nativeAudio = NativeAudioPlayer { [weak self] state in
        self?.emitNativeAudioState(state)
    }

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // persistent first-party cookies
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let scripts = WKUserContentController()
        scripts.add(WeakNativeAudioScriptHandler(receiver: self), name: "rinluNativeAudio")
        scripts.addUserScript(WKUserScript(source: NativeAudioBridge.javascript,
                                          injectionTime: .atDocumentStart,
                                          forMainFrameOnly: true))
        configuration.userContentController = scripts

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.translatesAutoresizingMaskIntoConstraints = false
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.backgroundColor = ink
        view.scrollView.backgroundColor = ink
        view.isOpaque = false
        #if DEBUG
        if #available(iOS 16.4, *) { view.isInspectable = true }
        #endif
        return view
    }()

    private let progressBar = UIProgressView(progressViewStyle: .bar)
    private let loadingView = UIActivityIndicatorView(style: .medium)
    private let offlineOverlay = UIView()
    private var progressObservation: NSKeyValueObservation?
    private var downloadLocations: [ObjectIdentifier: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = ink
        configureLayout()
        configureOfflineOverlay()
        _ = nativeAudio // register system media controls before the first song
        progressObservation = webView.observe(\.estimatedProgress, options: [.initial, .new]) { [weak self] observed, _ in
            DispatchQueue.main.async {
                self?.progressBar.progress = Float(observed.estimatedProgress)
                self?.progressBar.isHidden = observed.estimatedProgress >= 1
            }
        }
        loadHome()
    }

    private func configureLayout() {
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])

        progressBar.translatesAutoresizingMaskIntoConstraints = false
        progressBar.progressTintColor = .white
        progressBar.trackTintColor = .clear
        progressBar.isHidden = true
        view.addSubview(progressBar)
        NSLayoutConstraint.activate([
            progressBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
        ])
        loadingView.translatesAutoresizingMaskIntoConstraints = false
        loadingView.color = .white
        view.addSubview(loadingView)
        NSLayoutConstraint.activate([
            loadingView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loadingView.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    private func configureOfflineOverlay() {
        offlineOverlay.translatesAutoresizingMaskIntoConstraints = false
        offlineOverlay.backgroundColor = ink
        offlineOverlay.isHidden = true
        view.addSubview(offlineOverlay)
        NSLayoutConstraint.activate([
            offlineOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            offlineOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            offlineOverlay.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            offlineOverlay.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])

        let title = UILabel()
        title.text = "无法连接到 RINLU"
        title.font = .systemFont(ofSize: 18, weight: .semibold)
        title.textColor = .white
        title.textAlignment = .center

        let subtitle = UILabel()
        subtitle.text = "请检查网络后重新连接"
        subtitle.textColor = .lightGray
        subtitle.font = .systemFont(ofSize: 14)
        subtitle.textAlignment = .center

        var buttonConfig = UIButton.Configuration.filled()
        buttonConfig.title = "重新连接"
        buttonConfig.baseBackgroundColor = .white
        buttonConfig.baseForegroundColor = .black
        buttonConfig.cornerStyle = .medium
        let retry = UIButton(configuration: buttonConfig)
        retry.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, subtitle, retry])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        offlineOverlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: offlineOverlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: offlineOverlay.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: offlineOverlay.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: offlineOverlay.trailingAnchor, constant: -24)
        ])
    }

    // The canonical site uses window.RINLUNativeAudio; never accept messages
    // from an iframe, another scheme or a different origin.
    func didReceiveNativeAudioCommand(_ message: WKScriptMessage) {
        guard message.name == "rinluNativeAudio",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol.lowercased() == "https",
              message.frameInfo.securityOrigin.host.lowercased() == "rinlu.com",
              let payload = message.body as? [String: Any] else { return }
        nativeAudio.handle(payload)
    }

    private func emitNativeAudioState(_ state: [String: Any]) {
        guard let url = webView.url, isRinluOrigin(url),
              JSONSerialization.isValidJSONObject(state),
              let data = try? JSONSerialization.data(withJSONObject: state),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__rinluNativeAudioUpdate?.(\(json));", completionHandler: nil)
    }

    private func loadHome() {
        webView.load(URLRequest(url: Self.home, cachePolicy: .useProtocolCachePolicy))
    }

    @objc private func retryTapped() {
        offlineOverlay.isHidden = true
        if webView.url == nil { loadHome() } else { webView.reload() }
    }

    private func isRinluOrigin(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == "rinlu.com"
    }

    private func openOutside(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(),
              ["https", "http", "mailto", "tel"].contains(scheme) else { return }
        UIApplication.shared.open(url)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        // External authentication is intentionally handed to Safari. A future
        // callback/deep-link needs explicit backend support and real QA.
        guard isRinluOrigin(url) else {
            if navigationAction.targetFrame?.isMainFrame != false { openOutside(url) }
            decisionHandler(.cancel)
            return
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame,
           !navigationResponse.canShowMIMEType,
           let url = navigationResponse.response.url,
           isRinluOrigin(url) {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else { return nil }
        if isRinluOrigin(url) { webView.load(URLRequest(url: url)) }
        else { openOutside(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        offlineOverlay.isHidden = true
        loadingView.startAnimating()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offlineOverlay.isHidden = true
        loadingView.stopAnimating()
        emitNativeAudioState(nativeAudio.snapshot())
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        loadingView.stopAnimating()
        offlineOverlay.isHidden = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        loadingView.stopAnimating()
        offlineOverlay.isHidden = false
    }

    // Only the trusted first-party origin may request capture. The OS remains
    // responsible for asking user consent. No silent camera/mic approval.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard origin.protocol.lowercased() == "https", origin.host.lowercased() == "rinlu.com" else {
            decisionHandler(.deny)
            return
        }
        decisionHandler(.prompt)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let safeName = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        let filename = safeName.isEmpty || safeName == "." ? "RINLU-download" : safeName
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Downloads", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(UUID().uuidString + "-" + filename)
            downloadLocations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        } catch {
            completionHandler(nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadLocations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // Let the user export to Files/iCloud Drive. Not an automatic media import.
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        present(picker, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadLocations.removeValue(forKey: ObjectIdentifier(download))
        let alert = UIAlertController(title: "下载失败", message: "请稍后重试", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default))
        present(alert, animated: true)
    }
}
