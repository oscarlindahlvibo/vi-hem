from pathlib import Path
import tempfile,subprocess
s=Path('ios/App/App/SupplierBrowserPlugin.swift').read_text();a=s.index('    private func samePage');b=s.index('    func webView(',a);methods=s[a:b].replace('private func','func')
global_helper=s[s.index('private func publicStoreURL'):s.index('class VIHEMBridgeViewController')].replace('private func','func')
code='''import Foundation
'''+global_helper+'''
class MockWeb { var url: URL? }
class Probe {
 let web = MockWeb(); var customStore = false; var initialURL = URL(string:"https://www.jula.se/search/")!
'''+methods+'''}
let p=Probe()
for raw in ["https://www.jula.se/catalog/bygg/maskeringstejp-021489/", "https://www.jula.se/catalog/bygg/maskeringstejp-021489", "https://www.byggmax.se/lantbruksstro-p45521/#913=57190", "https://www.jemfix.se/skruv/3100/9073414/"] {
 let url=URL(string:raw)!;p.initialURL=url;p.web.url=url
 assert(p.productPage(url,sku:"45521"),raw)
 assert(p.samePage(url),raw)
 var altered=URLComponents(url:url,resolvingAgainstBaseURL:false)!;altered.fragment="variant"
 assert(p.samePage(altered.url!),"fragment")
 altered.path="/other-p123";assert(!p.samePage(altered.url!),"different document")
 altered.host="evil.test";assert(!p.samePage(altered.url!),"foreign host")
}
assert(!p.productPage(URL(string:"https://www.jula.se/catalog/bygg/")!,sku:""))
assert(!p.productPage(URL(string:"https://www.bauhaus.se/skruvdragare-qa")!,sku:""))
assert(p.productPage(URL(string:"https://www.bauhaus.se/skruvdragare-qa")!,sku:"123"))
p.customStore=true;p.initialURL=URL(string:"https://www.autodoc.se")!
assert(p.allowed(URL(string:"https://autodoc.se/jurid/9951466")!))
assert(!p.allowed(URL(string:"https://www.autodoc.se.evil.com/jurid/9951466")!))
for raw in ["http://www.autodoc.se", "https://127.0.0.1", "https://office.local", "https://user@www.autodoc.se", "https://www.autodoc.se:444"] { assert(!publicStoreURL(URL(string:raw)!)) }
print("PASS actual Swift URL checks: Jula trailing slash, Byggmax variants, jemfix, BAUHAUS SKU, foreign host/document rejected")
'''
with tempfile.TemporaryDirectory(prefix='vihem-native-url-') as directory:
 p=Path(directory)/'check.swift';p.write_text(code)
 subprocess.run(['swift',str(p)],check=True)
