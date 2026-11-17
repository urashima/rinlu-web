package com.rinlu.music;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;

/** Thin Android host; authentication and sessions stay server-owned.
 * Never inject website JS or use addJavascriptInterface for login. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://rinlu.com/music/";
    private static final int FILE_PICKER = 101;
    private static final int MEDIA_PERMISSION = 102;
    private FrameLayout root;
    private WebView browser;
    private ProgressBar progress;
    private LinearLayout offlinePanel;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private PermissionRequest permissionRequest;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(Color.rgb(17,17,17));
        getWindow().setNavigationBarColor(Color.rgb(17,17,17));
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(17,17,17));
        root.setFitsSystemWindows(true);
        setContentView(root);
        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(17,17,17));
        configure();
        root.addView(browser, new FrameLayout.LayoutParams(-1,-1));
        progress = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress,new FrameLayout.LayoutParams(-1,dp(2),Gravity.TOP));
        showOffline(false);
        if (state == null || browser.restoreState(state) == null) browser.loadUrl(HOME);
    }

    private void configure() {
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(browser,false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags
            & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                if (internal(request.getUrl())) return false;
                return external(request.getUrl());
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon) {
                showOffline(false);
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view,String url) {
                progress.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest req,WebResourceError error) {
                if (req.isForMainFrame()) showOffline(true);
            }
        });

        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view,int value) {
                progress.setProgress(value);
            }
            @Override public boolean onShowFileChooser(WebView view,
                    android.webkit.ValueCallback<Uri[]> cb,FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent,FILE_PICKER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    cb.onReceiveValue(null);
                    toast("没有找到文件选择器");
                    return false;
                }
            }
            @Override public void onShowCustomView(View view,CustomViewCallback cb) {
                if (fullscreen != null) { cb.onCustomViewHidden(); return; }
                fullscreen = view;
                fullscreenCallback = cb;
                browser.setVisibility(View.GONE);
                progress.setVisibility(View.GONE);
                root.setFitsSystemWindows(false);
                root.addView(view,new FrameLayout.LayoutParams(-1,-1));
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
                immersive(true);
            }
            @Override public void onHideCustomView() { closeFullscreen(); }
            @Override public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> askMedia(req));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest req) {
                if (permissionRequest == req) permissionRequest = null;
            }
        });
        browser.setDownloadListener(download);
    }

    private boolean internal(Uri url) {
        return "https".equalsIgnoreCase(url.getScheme()) &&
               "rinlu.com".equalsIgnoreCase(url.getHost());
    }

    private boolean external(Uri url) {
        String scheme = url.getScheme();
        if (scheme == null) return true;
        if (!scheme.equalsIgnoreCase("https") && !scheme.equalsIgnoreCase("http") &&
            !scheme.equalsIgnoreCase("mailto") && !scheme.equalsIgnoreCase("tel")) return true;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW,url);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException e) { toast("无法打开外部链接"); }
        return true;
    }

    private final DownloadListener download = (url,agent,disposition,mime,length) -> {
        Uri uri = Uri.parse(url);
        if (!"https".equalsIgnoreCase(uri.getScheme())) return;
        try {
            String file = URLUtil.guessFileName(url,disposition,mime);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle(file);
            request.setMimeType(mime);
            request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (agent != null) request.addRequestHeader("User-Agent",agent);
            if ("rinlu.com".equalsIgnoreCase(uri.getHost())) {
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie",cookie);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,file);
            else request.setDestinationInExternalFilesDir(
                this,Environment.DIRECTORY_DOWNLOADS,file);
            ((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
            toast("开始下载");
        } catch (Exception e) { toast("下载失败，请重试"); }
    };

    private void askMedia(PermissionRequest req) {
        if (permissionRequest != null) permissionRequest.deny();
        permissionRequest = null;
        if (!internal(req.getOrigin())) { req.deny(); return; }
        List<String> needed = new ArrayList<>();
        for (String resource: req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource))
                needed.add(Manifest.permission.RECORD_AUDIO);
            else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource))
                needed.add(Manifest.permission.CAMERA);
            else { req.deny(); return; }
        }
        if (needed.isEmpty()) { req.deny(); return; }
        List<String> missing = new ArrayList<>();
        for (String permission: needed)
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED)
                missing.add(permission);
        if (missing.isEmpty()) req.grant(req.getResources());
        else {
            permissionRequest = req;
            requestPermissions(missing.toArray(new String[0]),MEDIA_PERMISSION);
        }
    }

    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(code,permissions,results);
        if (code != MEDIA_PERMISSION || permissionRequest == null) return;
        PermissionRequest req = permissionRequest;
        permissionRequest = null;
        boolean allowed = results.length > 0;
        for (int result: results) allowed &= (result == PackageManager.PERMISSION_GRANTED);
        if (allowed) req.grant(req.getResources()); else req.deny();
    }

    @Override protected void onActivityResult(int code,int result,Intent data) {
        super.onActivityResult(code,result,data);
        if (code == FILE_PICKER && fileCallback != null) {
            android.webkit.ValueCallback<Uri[]> cb = fileCallback;
            fileCallback = null;
            cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));
        }
    }

    private void showOffline(boolean show) {
        if (offlinePanel == null) {
            offlinePanel = new LinearLayout(this);
            offlinePanel.setOrientation(LinearLayout.VERTICAL);
            offlinePanel.setGravity(Gravity.CENTER);
            offlinePanel.setPadding(dp(24),dp(24),dp(24),dp(24));
            offlinePanel.setBackgroundColor(Color.rgb(17,17,17));
            TextView message = new TextView(this);
            message.setText("网络连接不可用\n请检查网络后重试");
            message.setGravity(Gravity.CENTER);
            message.setTextColor(Color.WHITE);
            message.setTextSize(16);
            offlinePanel.addView(message);
            Button retry = new Button(this);
            retry.setText("重新连接");
            retry.setOnClickListener(v -> { showOffline(false); browser.reload(); });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2,-2);
            params.topMargin = dp(16);
            offlinePanel.addView(retry,params);
            root.addView(offlinePanel,new FrameLayout.LayoutParams(-1,-1));
        }
        offlinePanel.setVisibility(show?View.VISIBLE:View.GONE);
    }

    private void closeFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        browser.setVisibility(View.VISIBLE);
        root.setFitsSystemWindows(true);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        immersive(false);
    }

    private void immersive(boolean active) {
        getWindow().getDecorView().setSystemUiVisibility(active
            ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
              View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
              View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            : View.SYSTEM_UI_FLAG_VISIBLE);
    }
    private void toast(String text) { Toast.makeText(this,text,Toast.LENGTH_SHORT).show(); }
    private int dp(int n) {
        return Math.round(n*getResources().getDisplayMetrics().density);
    }
    @Override public void onConfigurationChanged(Configuration config) { super.onConfigurationChanged(config); }
    @Override public void onBackPressed() {
        if (fullscreen != null) closeFullscreen();
        else if (browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if (browser != null) browser.saveState(out);
        super.onSaveInstanceState(out);
    }
    @Override protected void onStop() {
        CookieManager.getInstance().flush();
        super.onStop();
        // WebView.onPause() might interrupt HTML audio. Media3 replacement is planned.
    }
    @Override protected void onDestroy() {
        if (permissionRequest != null) permissionRequest.deny();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (fullscreen != null) closeFullscreen();
        if (browser != null) {
            root.removeView(browser);
            browser.stopLoading();
            browser.destroy();
            browser = null;
        }
        super.onDestroy();
    }
}
