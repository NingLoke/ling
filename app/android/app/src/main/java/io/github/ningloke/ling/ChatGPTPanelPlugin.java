package io.github.ningloke.ling;

import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.URLUtil;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.activity.ComponentDialog;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.InputStream;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name = "ChatGPTPanel")
public class ChatGPTPanelPlugin extends Plugin {
    private static final int CLOSED = 0;
    private static final int HALF = 1;
    private static final int FULL = 2;
    private ComponentDialog panel;
    private WebView chat;
    private TextView status;
    private TextView modeLabel;
    private ProgressBar progress;
    private BridgeWebChromeClient webChromeClient;
    private int mode = HALF;
    private int modeBeforeIme = HALF;
    private int panelScreenHeight;
    private int imeHeight;
    private boolean imeVisible;
    private boolean lightTheme;
    private final ExecutorService fileWorker = Executors.newSingleThreadExecutor();
    private String blobMarker, blobFilename;

    @Override
    public void load() {
        webChromeClient = new BridgeWebChromeClient(getBridge()) {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                if (blobMarker == null || !message.message().startsWith(blobMarker)) return super.onConsoleMessage(message);
                String encoded = message.message().substring(blobMarker.length());
                String filename = blobFilename;
                blobMarker = null;
                if (!isChatGPTUrl(chat.getUrl())) return true;
                if (encoded.startsWith("ERROR:")) showStatus(encoded.substring(6));
                else if (encoded.length() <= PlannerFiles.LIMIT * 4 / 3 + 8) fileWorker.execute(() -> {
                    try { dispatchFile(filename, android.util.Base64.decode(encoded, android.util.Base64.DEFAULT)); }
                    catch (Exception error) { fileError(error); }
                });
                else showStatus("文件太大：每次最多512KB");
                return true;
            }
            @Override
            public void onProgressChanged(WebView view, int value) {
                if (progress != null) {
                    progress.setProgress(value);
                    progress.setVisibility(value < 100 ? View.VISIBLE : View.GONE);
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (isChatGPTUrl(request.getOrigin().toString())) super.onPermissionRequest(request);
                else request.deny();
            }
        };
    }

    static String chatThemeCss(boolean light) {
        String background = light ? "#e6e8ed" : "#0b0c10";
        String backgroundHigh = light ? "#f3f4f7" : "#15171e";
        String foreground = light ? "#1c1d22" : "#fff";
        String secondaryText = light ? "rgba(28,29,34,.78)" : "rgba(255,255,255,.8)";
        String glowOne = light ? "rgba(43,143,255,.14)" : "rgba(43,143,255,.35)";
        String glowTwo = light ? "rgba(122,92,255,.12)" : "rgba(122,92,255,.32)";
        String surface = light ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.06)";
        String surfaceHigh = light ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.09)";
        String composerSurface = light ? "rgba(243,244,247,.72)" : "rgba(21,23,30,.72)";
        return ":root{color-scheme:" + (light ? "light" : "dark") + "!important;"
            + "--main-surface-primary:transparent!important;--main-surface-secondary:" + surface + "!important;"
            + "--main-surface-tertiary:" + surfaceHigh + "!important;--sidebar-surface-primary:" + backgroundHigh + "!important;"
            + "--sidebar-surface-secondary:" + surface + "!important;--message-surface:" + surface + "!important;"
            + "--composer-surface:" + composerSurface + "!important;--bg-primary:transparent!important;"
            + "--text-primary:" + foreground + "!important;"
            + "--text-secondary:" + secondaryText + "!important;}"
            + "[role=menu],[role=dialog],[role=listbox],[data-radix-popper-content-wrapper]>*{background-color:" + backgroundHigh
            + "!important;color:" + foreground + "!important;backdrop-filter:blur(24px);box-shadow:0 12px 36px rgba(0,0,0,.24)}"
            + "#composer-background,[data-testid*=composer],form:has(#prompt-textarea),form:has([contenteditable=\"true\"]),form:has(textarea){"
            + "position:relative;z-index:10;background-color:" + composerSurface + "!important;"
            + "-webkit-backdrop-filter:blur(28px)!important;backdrop-filter:blur(28px)!important}"
            + "#composer-background textarea,#composer-background [contenteditable=true],[data-testid*=composer] textarea,[data-testid*=composer] [contenteditable=true]{background:transparent!important}"
            + "html{background-color:" + background + "!important;}"
            + "body{position:relative;isolation:isolate;background-color:" + background + "!important;color:" + foreground + "!important;}"
            + "#planner-app-backdrop{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;"
            + "background:radial-gradient(55% 35% at 85% 8%," + glowOne + ",transparent 70%),"
            + "radial-gradient(60% 40% at 0% 95%," + glowTwo + ",transparent 70%),"
            + "radial-gradient(120% 80% at 50% 40%," + backgroundHigh + " 0%," + background + " 70%)}"
            + "#planner-app-backdrop:before{content:'';position:absolute;inset:0;opacity:.35;"
            + "background-image:radial-gradient(" + (light ? "rgba(20,24,40,.12)" : "rgba(255,255,255,.18)")
            + " 1px,transparent 1.2px);background-size:18px 18px;"
            + "-webkit-mask:radial-gradient(90% 70% at 50% 60%,#000,transparent);"
            + "mask:radial-gradient(90% 70% at 50% 60%,#000,transparent)}"
            + "#planner-app-backdrop i{position:absolute;border-radius:50%;filter:blur(48px);opacity:" + (light ? ".2" : ".5") + "}"
            + "#planner-app-backdrop i:nth-child(1){left:-12%;top:34%;width:50vmin;height:50vmin;background:#2b8fff}"
            + "#planner-app-backdrop i:nth-child(2){right:-14%;top:55%;width:56vmin;height:56vmin;background:#7a5cff}"
            + "#planner-app-backdrop i:nth-child(3){left:22%;top:78%;width:44vmin;height:34vmin;background:#e06bff;opacity:" + (light ? ".12" : ".3") + "}"
            + "#root,#__next{position:relative;z-index:1;background-color:transparent!important;}";
    }

    static int modeAfterSwipe(int current, float deltaY, float threshold) {
        if (deltaY < -threshold) return FULL;
        if (deltaY > threshold) return current == FULL ? HALF : CLOSED;
        return current == HALF ? FULL : HALF;
    }

    static int modeAfterBack(int current) {
        return current == FULL ? HALF : CLOSED;
    }

    static int panelHeight(int screenHeight, int currentMode, boolean keyboardVisible) {
        return keyboardVisible ? screenHeight : screenHeight * (currentMode == FULL ? 9 : 2) / (currentMode == FULL ? 10 : 3);
    }

    static int bottomInset(int systemBars, int keyboard, boolean keyboardVisible) {
        return keyboardVisible ? Math.max(systemBars, keyboard) : systemBars;
    }

    // ChatGPT origins that receive planner-matching CSS.
    static boolean isChatGPTUrl(String value) {
        if (value == null) return false;
        try {
            URI url = new URI(value);
            String host = url.getHost();
            return "https".equalsIgnoreCase(url.getScheme()) && url.getRawUserInfo() == null
                && (url.getPort() == -1 || url.getPort() == 443)
                && ("chatgpt.com".equalsIgnoreCase(host) || "chat.openai.com".equalsIgnoreCase(host)
                    || "auth.openai.com".equalsIgnoreCase(host) || "auth0.openai.com".equalsIgnoreCase(host));
        } catch (URISyntaxException error) {
            return false;
        }
    }

    static boolean isGoogleLoginUrl(String value) {
        if (value == null) return false;
        try {
            URI url = new URI(value);
            String host = url.getHost();
            return "https".equalsIgnoreCase(url.getScheme()) && url.getRawUserInfo() == null
                && (url.getPort() == -1 || url.getPort() == 443)
                && ("accounts.google.com".equalsIgnoreCase(host)
                    || "consent.google.com".equalsIgnoreCase(host)
                    || "myaccount.google.com".equalsIgnoreCase(host)
                    || "www.google.com".equalsIgnoreCase(host));
        } catch (URISyntaxException error) {
            return false;
        }
    }

    static boolean isPlannerActionUrl(String value) {
        if (value == null) return false;
        try {
            URI url = new URI(value);
            if (!"https".equalsIgnoreCase(url.getScheme()) || url.getRawUserInfo() != null
                || (url.getPort() != -1 && url.getPort() != 443)
                || !"ningloke.github.io".equalsIgnoreCase(url.getHost())
                || !("/ling".equals(url.getRawPath()) || "/ling/".equals(url.getRawPath()))
                || url.getRawQuery() == null) return false;
            for (String parameter : url.getRawQuery().split("&")) {
                if ("add=event".equals(parameter) || "add=todo".equals(parameter) || "add=habit".equals(parameter)) return true;
            }
        } catch (URISyntaxException ignored) {
            return false;
        }
        return false;
    }

    @PluginMethod
    public void open(PluginCall call) {
        String prompt = call.getString("prompt", "");
        boolean light = "light".equals(call.getString("theme", "dark"));
        getActivity().runOnUiThread(() -> {
            try {
                if (panel == null) createPanel();
                lightTheme = light;
                imeVisible = false;
                imeHeight = 0;
                modeBeforeIme = HALF;
                applyPanelTheme();
                panel.show();
                setMode(HALF);
                chat.onResume();
                if (chat.getUrl() != null) applyChatTheme();
                if (chat.getUrl() == null || !prompt.isEmpty()) {
                    Uri.Builder url = Uri.parse("https://chatgpt.com/").buildUpon();
                    if (!prompt.isEmpty()) url.appendQueryParameter("q", prompt);
                    chat.loadUrl(url.build().toString());
                }
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Cannot open ChatGPT panel", error);
            }
        });
    }

    private void createPanel() {
        panel = new ComponentDialog(getActivity(), R.style.AppTheme_NoActionBar);
        panel.getWindow().setSoftInputMode(softInputMode());
        panel.setContentView(R.layout.chatgpt_panel);
        status = panel.findViewById(R.id.chatgpt_status);
        modeLabel = panel.findViewById(R.id.chatgpt_mode);
        chat = panel.findViewById(R.id.chatgpt_web);
        View dragHandle = panel.findViewById(R.id.chatgpt_drag_handle);
        progress = panel.findViewById(R.id.chatgpt_progress);
        WebSettings settings = chat.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); // Keep OAuth popups in this WebView and its cookie jar.
        chat.setFocusable(true);
        chat.setFocusableInTouchMode(true);
        CookieManager.getInstance().setAcceptCookie(true);
        chat.setBackgroundColor(Color.TRANSPARENT);
        chat.setWebChromeClient(webChromeClient);
        chat.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (!isChatGPTUrl(chat.getUrl())) { showStatus("请从 ChatGPT 回答里的下载按钮导入文件"); return; }
            String name = URLUtil.guessFileName(url, disposition, mime);
            if (!PlannerFiles.supported(name)) {
                name = "download" + ("application/json".equals(mime) ? ".json" : "text/calendar".equals(mime) ? ".ics" : "application/zip".equals(mime) ? ".zip" : ".txt");
            }
            final String filename = name;
            if (length > PlannerFiles.LIMIT) { showStatus("安排文件每次最多 512KB"); return; }
            if (url.startsWith("blob:")) {
                readBlobDownload(url, filename);
            } else if (safeDownloadUrl(url)) {
                final String cookie = isChatGPTUrl(url) ? CookieManager.getInstance().getCookie(url) : null;
                fileWorker.execute(() -> downloadPlannerFile(url, filename, agent, cookie));
            } else showStatus("这个下载地址不支持；请在浏览器下载后从设置导入文件");
        });
        chat.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() && blockNavigation(request.getUrl().toString());
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (blockNavigation(url)) {
                    view.stopLoading();
                    return;
                }
                status.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (isChatGPTUrl(url)) applyChatTheme();
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showStatus("网页载入失败 · 点此重试");
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showStatus("ChatGPT 网页返回错误 " + response.getStatusCode() + " · 点此重试");
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showStatus("安全连接失败，已停止载入。请检查手机时间和网络后重试。");
            }
        });
        status.setOnClickListener(view -> chat.reload());
        modeLabel.setOnClickListener(view -> setMode(mode == HALF ? FULL : HALF));
        dragHandle.setOnClickListener(view -> setMode(mode == HALF ? FULL : HALF));
        dragHandle.setOnTouchListener((view, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    view.setTag(event.getRawY());
                    return true;
                case MotionEvent.ACTION_UP:
                    float start = (float) view.getTag();
                    float delta = event.getRawY() - start;
                    float threshold = 48 * getActivity().getResources().getDisplayMetrics().density;
                    if (Math.abs(delta) <= threshold) view.performClick();
                    else applyMode(modeAfterSwipe(mode, delta, threshold));
                    return true;
                default:
                    return true;
            }
        });
        panel.getOnBackPressedDispatcher().addCallback(new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                applyMode(modeAfterBack(mode));
            }
        });
        panel.setOnDismissListener(dialog -> {
            imeVisible = false;
            imeHeight = 0;
            CookieManager.getInstance().flush();
            chat.onPause();
            setPlannerPanelMode("closed");
        });
        View content = panel.findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            if (keyboard) {
                imeHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
                if (!imeVisible) {
                    modeBeforeIme = mode;
                    imeVisible = true;
                    setMode(FULL);
                } else resizePanel();
            } else if (imeVisible) {
                imeVisible = false;
                imeHeight = 0;
                setMode(modeBeforeIme);
            }
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, mode == FULL ? bars.top : 0, bars.right,
                Build.VERSION.SDK_INT >= 30 ? bottomInset(bars.bottom, imeHeight, imeVisible) : bars.bottom);
            return insets;
        });
    }

    private void setMode(int next) {
        mode = next;
        resizePanel();
        modeLabel.setText(mode == FULL ? "一行" : "1/3");
        panel.findViewById(R.id.chatgpt_drag_handle).setContentDescription(
            mode == FULL ? "ChatGPT 已展开，向下滑动返回日程" : "ChatGPT 面板，向上展开或向下收起"
        );
        setPlannerPanelMode(mode == FULL ? "full" : "half");
    }

    private void applyPanelTheme() {
        int background = Color.parseColor(lightTheme ? "#e6e8ed" : "#0b0c10");
        float radius = 24 * getActivity().getResources().getDisplayMetrics().density;
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(background);
        drawable.setCornerRadii(new float[] { radius, radius, radius, radius, 0, 0, 0, 0 });
        drawable.setStroke(Math.max(1, Math.round(getActivity().getResources().getDisplayMetrics().density)),
            lightTheme ? 0x406a4ce0 : 0x80514b68);
        panel.findViewById(R.id.chatgpt_sheet).setBackground(drawable);
        status.setBackgroundColor(background);
        status.setTextColor(lightTheme ? 0xffa42e2e : 0xffffc6ca);
        chat.setBackgroundColor(Color.TRANSPARENT);
    }

    private void applyChatTheme() {
        String css = chatThemeCss(lightTheme).replace("\\", "\\\\").replace("'", "\\'");
        chat.evaluateJavascript("(function(){var s=document.getElementById('planner-app-theme');"
            + "if(!s){s=document.createElement('style');s.id='planner-app-theme';document.head.appendChild(s);}"
            + "s.textContent='" + css + "';"
            + "if(!document.getElementById('planner-app-backdrop')){var b=document.createElement('div');"
            + "b.id='planner-app-backdrop';b.setAttribute('aria-hidden','true');b.innerHTML='<i></i><i></i><i></i>';"
            + "document.body.insertBefore(b,document.body.firstChild);}})()", null);
    }

    private void applyMode(int next) {
        if (next == CLOSED) panel.dismiss();
        else setMode(next);
    }

    private void resizePanel() {
        Window window = panel.getWindow();
        int height = Build.VERSION.SDK_INT >= 30
            ? getActivity().getWindowManager().getCurrentWindowMetrics().getBounds().height()
            : getActivity().getResources().getDisplayMetrics().heightPixels;
        if (!imeVisible || panelScreenHeight == 0) panelScreenHeight = height;
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.setGravity(Gravity.BOTTOM);
        window.setDimAmount(0.28f);
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setSoftInputMode(softInputMode());
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, panelHeight(panelScreenHeight, mode, imeVisible));
    }

    private int softInputMode() {
        return Build.VERSION.SDK_INT >= 30
            ? WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
            : WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
    }

    private void setPlannerPanelMode(String value) {
        if (getBridge() != null) {
            getBridge().eval("window.dispatchEvent(new CustomEvent('planner:chatgpt-panel',{detail:'" + value + "'}))", null);
        }
    }

    private void showStatus(String message) {
        status.setText(message);
        status.setVisibility(View.VISIBLE);
    }

    static boolean safeDownloadUrl(String value) {
        try {
            URI url = new URI(value);
            String host = url.getHost();
            return "https".equalsIgnoreCase(url.getScheme()) && url.getRawUserInfo() == null
                && (url.getPort() == -1 || url.getPort() == 443) && host != null
                && (isChatGPTUrl(value) || host.toLowerCase(java.util.Locale.ROOT).endsWith(".oaiusercontent.com")
                    || host.toLowerCase(java.util.Locale.ROOT).endsWith(".blob.core.windows.net"));
        } catch (URISyntaxException error) { return false; }
    }

    private void readBlobDownload(String url, String filename) {
        // A scoped, random callback reads only the clicked file; no conversation text or native JS interface is exposed.
        final String marker = "ling-file-" + java.util.UUID.randomUUID() + ":";
        if (blobMarker != null) { showStatus("上一份文件仍在读取，请稍后重试"); return; }
        blobMarker = marker; blobFilename = filename;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            if (marker.equals(blobMarker)) { blobMarker = null; showStatus("文件读取超时，请从设置手动导入"); }
        }, 30000);
        chat.evaluateJavascript("(async function(){try{var r=await fetch(" + org.json.JSONObject.quote(url)
            + ");var b=await r.blob();if(b.size>" + PlannerFiles.LIMIT + ")throw Error('文件超过512KB');"
            + "var data=await new Promise(function(ok,no){var f=new FileReader();f.onload=function(){ok(f.result.split(',')[1])};f.onerror=no;f.readAsDataURL(b)});"
            + "console.log(" + org.json.JSONObject.quote(marker) + "+data)"
            + "}catch(e){console.log(" + org.json.JSONObject.quote(marker) + "+'ERROR:'+e.message)}})()", null);
    }

    private void downloadPlannerFile(String value, String filename, String agent, String cookie) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(value);
            for (int redirects = 0; redirects < 6; redirects++) {
                if (!safeDownloadUrl(url.toString())) throw new Exception("下载跳转地址不支持，请手动下载后导入");
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
                connection.setRequestProperty("User-Agent", agent);
                if (redirects == 0 && cookie != null) connection.setRequestProperty("Cookie", cookie);
                int code = connection.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = connection.getHeaderField("Location");
                    if (next == null) throw new Exception("下载跳转地址缺失");
                    URL redirected = new URL(url, next);
                    connection.disconnect(); connection = null; url = redirected; continue;
                }
                if (code != 200) throw new Exception("文件下载失败（" + code + "）");
                if (connection.getContentLengthLong() > PlannerFiles.LIMIT) throw new Exception("安排文件每次最多512KB");
                try (InputStream input = connection.getInputStream()) { dispatchFile(filename, PlannerFiles.readBounded(input, PlannerFiles.LIMIT)); }
                return;
            }
            throw new Exception("下载跳转次数过多");
        } catch (Exception error) { fileError(error); }
        finally { if (connection != null) connection.disconnect(); }
    }

    private void dispatchFile(String filename, byte[] bytes) throws Exception {
        String data = ai.annadata.plugin.capacitor.LocalModelPlugin.filesResult(filename, bytes).toString();
        getActivity().runOnUiThread(() -> {
            if (getBridge() != null) getBridge().eval("window.dispatchEvent(new CustomEvent('planner:import-files',{detail:" + data + "}))", null);
            if (panel != null && panel.isShowing()) applyMode(CLOSED);
        });
    }
    private void fileError(Exception error) { getActivity().runOnUiThread(() -> { if (status != null) showStatus("导入失败：" + error.getMessage()); }); }

    private boolean blockNavigation(String url) {
        if (isChatGPTUrl(url) || isGoogleLoginUrl(url)) return false;
        if (isPlannerActionUrl(url) && getBridge() != null) {
            getBridge().eval("window.dispatchEvent(new CustomEvent('planner:chatgpt-action-link',{detail:"
                + org.json.JSONObject.quote(url) + "}))", null);
            applyMode(CLOSED);
            return true;
        }
        String host = Uri.parse(url).getHost();
        showStatus("暂未接入此链接域名" + (host == null ? "。" : "：" + host));
        return true;
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        if (panel != null && panel.isShowing()) resizePanel();
    }

    @Override
    protected void handleOnPause() {
        if (chat != null) {
            CookieManager.getInstance().flush();
            chat.onPause();
        }
    }

    @Override
    protected void handleOnResume() {
        if (panel != null && panel.isShowing()) chat.onResume();
    }

    @Override
    protected void handleOnDestroy() {
        fileWorker.shutdown();
        if (panel != null) panel.dismiss();
        if (chat != null) {
            chat.stopLoading();
            if (chat.getParent() instanceof ViewGroup) ((ViewGroup) chat.getParent()).removeView(chat);
            chat.destroy();
        }
        panel = null;
        chat = null;
    }
}
