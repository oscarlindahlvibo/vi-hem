import UIKit
import WebKit
import Capacitor

class VIHEMBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(SupplierBrowserPlugin()) }
}

@objc(SupplierBrowserPlugin)
public class SupplierBrowserPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SupplierBrowserPlugin"
    public let jsName = "SupplierBrowser"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)]
    private var active = false

    @objc func open(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.scheme == "https", ["www.jula.se", "www.biltema.se"].contains(url.host ?? ""),
              url.user == nil, url.password == nil, url.port == nil,
              let script = call.getString("script"), script.count < 8000 else {
            call.reject("Ogiltig butikssökning"); return
        }
        DispatchQueue.main.async {
            guard !self.active, let presenter = self.bridge?.viewController else { call.reject("Butiksvyn är redan öppen"); return }
            self.active = true
            let page = SupplierPage(url: url, script: script) { product in
                self.active = false
                if let product = product { call.resolve(["product": product]) } else { call.resolve([:]) }
            }
            let navigation = UINavigationController(rootViewController: page)
            navigation.modalPresentationStyle = .fullScreen
            presenter.present(navigation, animated: true)
        }
    }
}

private class SupplierPage: UIViewController, WKNavigationDelegate {
    private let initialURL: URL
    private let script: String
    private let finish: ([String: Any]?) -> Void
    private var finished = false
    private var reading = false
    private var web: WKWebView!
    private var choose: UIBarButtonItem!

    init(url: URL, script: String, finish: @escaping ([String: Any]?) -> Void) {
        initialURL = url; self.script = script; self.finish = finish
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = initialURL.host == "www.jula.se" ? "Jula" : "Biltema"
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        // Separate WKWebView: no Capacitor bridge, app cookies or injected credentials.
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = .systemBackground
        view.addSubview(web)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Stäng", style: .plain, target: self, action: #selector(close))
        choose = UIBarButtonItem(title: "Välj produkt", style: .done, target: self, action: #selector(selectProduct))
        navigationItem.rightBarButtonItem = choose
        toolbarItems = [UIBarButtonItem(title: "Tillbaka", style: .plain, target: self, action: #selector(goBack)), UIBarButtonItem(systemItem: .flexibleSpace), UIBarButtonItem(title: "Ladda om", style: .plain, target: self, action: #selector(reload))]
        navigationController?.isToolbarHidden = false
        web.load(URLRequest(url: initialURL))
    }
    @objc private func goBack() { if web.canGoBack { web.goBack() } }
    @objc private func reload() { web.reload() }
    @objc private func close() { complete(nil) }
    private func complete(_ product: [String: Any]?) {
        guard !finished else { return }; finished = true
        web.stopLoading()
        dismiss(animated: true) { self.finish(product) }
    }
    @objc private func selectProduct() {
        guard !reading, let url = web.url, allowed(url) else { return }
        reading = true; choose.isEnabled = false
        web.evaluateJavaScript(script) { result, error in
            self.reading = false; self.choose.isEnabled = true
            guard error == nil, let data = result as? [String: Any], let name = data["name"] as? String, !name.isEmpty,
                  let resultURL = data["url"] as? String, let parsed = URL(string: resultURL), self.allowed(parsed),
                  self.web.url == parsed,
                  (parsed.host == "www.jula.se" && parsed.path.hasPrefix("/catalog/") || parsed.host == "www.biltema.se" && parsed.path.range(of: "-200[0-9]{7}/?$", options: .regularExpression) != nil) else {
                self.message("Öppna en produktsida och tryck på Välj produkt igen."); return
            }
            self.complete(["name": String(name.prefix(300)), "sku": String((data["sku"] as? String ?? "").prefix(80)), "url": parsed.absoluteString])
        }
    }
    private func allowed(_ url: URL) -> Bool { url.scheme == "https" && url.host == initialURL.host && url.user == nil && url.password == nil && url.port == nil }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        // Subframes/resources may contain retailer infrastructure. Main navigation stays at retailer.
        if navigationAction.targetFrame?.isMainFrame != false && !allowed(url) { decisionHandler(.cancel); return }
        if navigationAction.targetFrame == nil { decisionHandler(.cancel); web.load(URLRequest(url: url)); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { message("Butiken kunde inte laddas. Kontrollera uppkopplingen och använd Ladda om.") }
    }
    private func message(_ text: String) {
        let alert = UIAlertController(title: "Butikssökning", message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default)); present(alert, animated: true)
    }
}
