import SwiftUI
import WebKit

/// URLSession and WebKit have independent cookie jars. Only transfer cookies for the platform host.
@MainActor
struct BusinessPage: UIViewControllerRepresentable {
    let path:String
    let onMusic:(String)->Void
    let onPreview:()->Void
    static func platformCookie(_ c:HTTPCookie)->Bool {
        c.domain.trimmingCharacters(in:CharacterSet(charactersIn:".")) == "rinlu.com"
    }
    static func importSession() async {
        let web = await WKWebsiteDataStore.default().httpCookieStore.allCookies().filter(platformCookie)
        let native=HTTPCookieStorage.shared
        for c in (native.cookies ?? []).filter(platformCookie) where !web.contains(where:{$0.name==c.name && $0.path==c.path && $0.domain==c.domain}) { native.deleteCookie(c) }
        web.forEach(native.setCookie)
    }
    func makeUIViewController(context:Context)->PortalController {
        let controller=PortalController()
        controller.path=path;controller.onMusic=onMusic;controller.onPreview=onPreview
        return controller
    }
    func updateUIViewController(_ uiViewController:PortalController,context:Context){}
    static func dismantleUIViewController(_ controller:PortalController,coordinator:()){controller.close()}
}
@MainActor final class PortalController:UIViewController,WKNavigationDelegate,WKScriptMessageHandler {
    var path="",onMusic:((String)->Void)?,onPreview:(()->Void)?
    private var web:WKWebView!
    private let back=UIButton(type:.system), retry=UIButton(type:.system)
    private let status=UILabel()
    private let spinner=UIActivityIndicatorView(style:.medium)
    private var ready=false
    override func viewDidLoad(){
        super.viewDidLoad()
        let config=WKWebViewConfiguration()
        config.allowsInlineMediaPlayback=true
        let script="""
        (() => {
          if (location.origin !== 'https://rinlu.com') return;
          const original = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = function() {
            let url; try { url = new URL(this.currentSrc || this.src, location.href); } catch {}
            const preview = /^\\/music\\/(play(?:\\/|$)|studio|admin)/.test(location.pathname);
            const match = url && url.origin === location.origin && url.pathname.match(/^\\/music\\/api\\/media\\/([a-zA-Z0-9_-]+)$/);
            if (!preview && match) {
              this.pause();
              window.webkit.messageHandlers.transport.postMessage({song:match[1]});
              return Promise.resolve();
            }
            window.webkit.messageHandlers.transport.postMessage({preview:true});
            return original.call(this);
          };
        })()
        """
        config.userContentController.addUserScript(WKUserScript(source:script,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        config.userContentController.add(self,name:"transport")
        web=WKWebView(frame:.zero,configuration:config)
        web.navigationDelegate=self;web.allowsBackForwardNavigationGestures=true
        back.setTitle("Back",for:.normal);back.addTarget(self,action:#selector(goBack),for:.touchUpInside)
        retry.setTitle("Retry",for:.normal);retry.addTarget(self,action:#selector(reload),for:.touchUpInside)
        status.font = .preferredFont(forTextStyle:.footnote);status.numberOfLines=2
        let tools=UIStackView(arrangedSubviews:[back,spinner,status,retry]);tools.spacing=12
        tools.isLayoutMarginsRelativeArrangement=true;tools.layoutMargins=UIEdgeInsets(top:4,left:16,bottom:4,right:16)
        let stack=UIStackView(arrangedSubviews:[tools,web]);stack.axis = .vertical;stack.translatesAutoresizingMaskIntoConstraints=false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor),stack.bottomAnchor.constraint(equalTo:view.bottomAnchor),stack.leadingAnchor.constraint(equalTo:view.leadingAnchor),stack.trailingAnchor.constraint(equalTo:view.trailingAnchor)])
        back.isHidden=true;retry.isHidden=true;spinner.startAnimating()
        Task {
            let jar=config.websiteDataStore.httpCookieStore, cookies=(HTTPCookieStorage.shared.cookies ?? []).filter(BusinessPage.platformCookie)
            for c in await jar.allCookies().filter(BusinessPage.platformCookie) where !cookies.contains(where:{$0.name==c.name && $0.path==c.path && $0.domain==c.domain}) {await jar.deleteCookie(c)}
            for c in cookies {await jar.setCookie(c)}
            ready=true;reload()
        }
    }
    @objc private func reload(){guard ready else{return};if web.url != nil {web.reload()}else{web.load(URLRequest(url:RINLUAPI.site.appendingPathComponent(path)))}}
    @objc private func goBack(){web.goBack()}
    func close(){web.stopLoading();web.configuration.userContentController.removeScriptMessageHandler(forName:"transport");web.navigationDelegate=nil}
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){
        guard message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="rinlu.com",message.frameInfo.securityOrigin.protocol=="https",let payload=message.body as? [String:Any] else{return}
        if let id=payload["song"] as? String, (1...100).contains(id.count), id.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) {onMusic?(id)}
        else if payload["preview"] as? Bool == true {onPreview?()}
    }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=action.request.url else{decisionHandler(.cancel);return}
        if url.scheme=="https",url.host=="rinlu.com",url.port==nil || url.port==443 {
            if action.targetFrame==nil {decisionHandler(.cancel);webView.load(action.request)}else{decisionHandler(.allow)}
        }else if url.scheme=="about" {decisionHandler(.allow)}
        else{decisionHandler(.cancel);if url.scheme=="https"{UIApplication.shared.open(url)}}
    }
    func webView(_ webView:WKWebView,didStartProvisionalNavigation navigation:WKNavigation!){spinner.startAnimating();retry.isHidden=true;status.text=nil}
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){spinner.stopAnimating();back.isHidden = !webView.canGoBack}
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){failed(error)}
    func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error){failed(error)}
    private func failed(_ error:Error){guard (error as NSError).code != NSURLErrorCancelled else{return};spinner.stopAnimating();retry.isHidden=false;status.text=error.localizedDescription}
}
