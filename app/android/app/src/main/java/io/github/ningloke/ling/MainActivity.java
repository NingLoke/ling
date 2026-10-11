package io.github.ningloke.ling;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChatGPTPanelPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor does nothing on back by itself (the app would just leave). The page pushes a history entry for
        // each dialog, sheet, map layer and the game, so back walks the WebView history: popstate closes what is
        // open. With nothing left to close, the app goes to the background and keeps its state.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge != null ? bridge.getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
