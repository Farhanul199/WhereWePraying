package com.wherewepraying.tv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * WhereWePraying TV - opens the XP1 dashboard full screen.
 * The dashboard itself lives on the website, so it updates without a new app.
 */
public class MainActivity extends Activity {

    private static final String HOME_URL = "https://wherewepraying.com/xp1";
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";
    private static final long RETRY_MS = 30000;

    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean showingOffline = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#FBF3E6"));
        setContentView(web);
        hideSystemBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage (location, settings, pairing)
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // YouTube autoplay
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " WhereWePrayingTV/1.0");

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                // Stay inside the app for our own site; ignore links to anywhere else.
                return !"wherewepraying.com".equals(u.getHost()) && !"file".equals(u.getScheme());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
        });

        web.setFocusable(true);
        web.requestFocus();

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(HOME_URL);
    }

    private void showOffline() {
        if (showingOffline) return;
        showingOffline = true;
        web.loadUrl(OFFLINE_URL);
        handler.postDelayed(this::retry, RETRY_MS);
    }

    private void retry() {
        showingOffline = false;
        web.loadUrl(HOME_URL);
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // Remote Back: close an open pop-up on the dashboard first; exit only if none is open.
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && !showingOffline) {
            web.evaluateJavascript(
                "(function(){var o=document.querySelector('.xp1-overlay.open');" +
                "if(!o)return 'none';" +
                "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));" +
                "return 'closed';})()",
                result -> { if (result == null || result.contains("none")) finish(); });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); hideSystemBars(); }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }
}
