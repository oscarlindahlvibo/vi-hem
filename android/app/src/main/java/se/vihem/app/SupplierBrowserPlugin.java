package se.vihem.app;

import android.app.Dialog;
import android.net.Uri;
import android.graphics.Color;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "SupplierBrowser")
public class SupplierBrowserPlugin extends Plugin {
    private Dialog dialog;
    @PluginMethod public void open(PluginCall call) {
        String raw = call.getString("url", ""), script = call.getString("script", "");
        Uri initial = Uri.parse(raw);
        if (!allowed(initial, initial.getHost()) || !("www.jula.se".equals(initial.getHost()) || "www.biltema.se".equals(initial.getHost())) || script.length() > 8000 || script.isEmpty()) { call.reject("Ogiltig butikssökning"); return; }
        getActivity().runOnUiThread(() -> {
            if (dialog != null) { call.reject("Butiksvyn är redan öppen"); return; }
            Dialog current = new Dialog(getActivity()); dialog = current;
            LinearLayout layout = new LinearLayout(getActivity()); layout.setOrientation(LinearLayout.VERTICAL); layout.setBackgroundColor(Color.WHITE);
            layout.setOnApplyWindowInsetsListener((v, insets) -> {
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                } else { v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); }
                return insets;
            });
            LinearLayout toolbar = new LinearLayout(getActivity());
            Button close = new Button(getActivity()); close.setText("Stäng");
            Button back = new Button(getActivity()); back.setText("Tillbaka");
            Button select = new Button(getActivity()); select.setText("Välj produkt");
            toolbar.addView(close); toolbar.addView(back); toolbar.addView(select);
            WebView web = new WebView(getActivity());
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setAllowFileAccess(false);
            web.getSettings().setAllowContentAccess(false);
            web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            // Separate WebView, no Capacitor/Javascript interface or app authentication headers.
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return request.isForMainFrame() && !allowed(request.getUrl(), initial.getHost());
                }
            });
            layout.addView(toolbar); layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); current.setContentView(layout);
            final JSObject[] result = {new JSObject()};
            current.setOnDismissListener(ignored -> { web.stopLoading(); web.destroy(); dialog = null; call.resolve(result[0]); });
            close.setOnClickListener(v -> current.dismiss());
            back.setOnClickListener(v -> { if (web.canGoBack()) web.goBack(); else web.reload(); });
            select.setOnClickListener(v -> {
                if (!allowed(Uri.parse(web.getUrl() == null ? "" : web.getUrl()), initial.getHost())) return;
                select.setEnabled(false);
                web.evaluateJavascript("JSON.stringify(" + script + ")", encoded -> {
                    select.setEnabled(true);
                    try {
                        String json = new org.json.JSONTokener(encoded).nextValue().toString();
                        JSONObject p = new JSONObject(json); Uri selected = Uri.parse(p.optString("url"));
                        boolean productPage = "www.jula.se".equals(selected.getHost()) ? selected.getPath().startsWith("/catalog/") : selected.getPath().matches(".*-200[0-9]{7}/?");
                        if (!allowed(selected, initial.getHost()) || !productPage || p.optString("name").isEmpty() || !selected.toString().equals(web.getUrl())) throw new Exception();
                        JSObject product = new JSObject(); product.put("name", p.getString("name")); product.put("sku", p.optString("sku")); product.put("url", selected.toString()); result[0].put("product", product); current.dismiss();
                    } catch (Exception error) { Toast.makeText(getActivity(), "Öppna en produktsida och välj produkten igen.", Toast.LENGTH_LONG).show(); }
                });
            });
            current.show(); current.getWindow().setLayout(-1, -1); web.loadUrl(raw);
        });
    }
    private boolean allowed(Uri url, String host) {
        return "https".equals(url.getScheme()) && host != null && host.equals(url.getHost()) && url.getUserInfo() == null && url.getPort() == -1;
    }
    @Override protected void handleOnDestroy() { if (dialog != null) dialog.dismiss(); }
}
