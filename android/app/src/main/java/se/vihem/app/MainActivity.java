package se.vihem.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SupplierBrowserPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
