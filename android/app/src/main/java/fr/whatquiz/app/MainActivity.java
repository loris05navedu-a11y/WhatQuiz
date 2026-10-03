package fr.whatquiz.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Coquille Android de WhatQuiz : affiche le site WhatQuiz (GitHub Pages) en plein écran dans une WebView.
 *
 * Surveillance des parties : l'activité transmet au site ce que voit le système (bouton Accueil, applis récentes,
 * volet de notifications, écran partagé, écran éteint…) par l'événement JavaScript « whatquiz-native ».
 * Pendant une partie surveillée, le site peut aussi épingler l'application, garder l'écran allumé et
 * empêcher les captures d'écran.
 */
public class MainActivity extends Activity {
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";
    private static final int FILE_CHOOSER_REQUEST = 1;

    private WebView web;
    private String siteUrl;
    private ValueCallback<Uri[]> pendingChooser;
    private boolean pinRequested;

    /** Écran éteint (bouton marche/arrêt ou mise en veille) : signalé avant même la mise en pause. */
    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) signal("screen-off");
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        siteUrl = getString(R.string.app_url);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.stage));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        applySystemBarInsets(root);

        // Pas d'inspection à distance de la page : la surveillance ne peut pas être modifiée depuis un ordinateur.
        WebView.setWebContentsDebuggingEnabled(false);
        registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " WhatQuizAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "WhatQuizAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        // Toujours repartir de la dernière version publiée du site (pas de pages gardées en cache).
        web.clearCache(true);

        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) return;
        web.loadUrl(siteUrl);
    }

    /** Android 15 affiche l'application sous les barres système : on décale le contenu (et le clavier). */
    private void applySystemBarInsets(View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    /** Seules les pages du site WhatQuiz restent dans l'application ; les autres liens s'ouvrent dans le navigateur. */
    private boolean isSiteUrl(Uri uri) {
        Uri site = Uri.parse(siteUrl);
        return site.getScheme().equalsIgnoreCase(uri.getScheme())
                && site.getHost().equalsIgnoreCase(uri.getHost())
                && site.getPort() == uri.getPort();
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("file".equals(uri.getScheme()) || isSiteUrl(uri)) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) {
                // Aucun navigateur : on reste simplement sur la page.
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !"file".equals(request.getUrl().getScheme())) {
                view.loadUrl(OFFLINE_URL);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingChooser != null) pendingChooser.onReceiveValue(null);
            pendingChooser = callback;

            List<String> mimeTypes = new ArrayList<>();
            boolean anyFile = false;
            for (String type : params.getAcceptTypes()) {
                for (String part : type.split(",")) {
                    String trimmed = part.trim();
                    if (trimmed.isEmpty()) continue;
                    if (trimmed.contains("/")) mimeTypes.add(trimmed);
                    else anyFile = true;
                }
            }
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            if (anyFile || mimeTypes.isEmpty()) {
                intent.setType("*/*");
            } else if (mimeTypes.size() == 1) {
                intent.setType(mimeTypes.get(0));
            } else {
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
            }
            try {
                startActivityForResult(Intent.createChooser(intent, "Choisir un fichier"), FILE_CHOOSER_REQUEST);
                return true;
            } catch (ActivityNotFoundException e) {
                pendingChooser = null;
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && pendingChooser != null) {
            pendingChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingChooser = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** Fonctions appelées par le site (window.WhatQuizAndroid). */
    private class Bridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(siteUrl));
        }

        @JavascriptInterface
        public void saveFile(String fileName, String mimeType, String base64) {
            String safeName = fileName == null ? "whatquiz.txt" : fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String location = writeDownload(safeName, mimeType, bytes);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Fichier enregistré : " + location, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Impossible d'enregistrer le fichier", Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** Épinglage de l'écran (Android demande une confirmation à l'élève). */
        @JavascriptInterface
        public void pin(boolean on) {
            runOnUiThread(() -> setPinned(on));
        }

        @JavascriptInterface
        public boolean isPinned() {
            return lockTaskActive();
        }

        @JavascriptInterface
        public boolean isInMultiWindow() {
            return MainActivity.this.isInMultiWindowMode();
        }

        /** Le professeur anime une partie depuis l'application : l'écran reste allumé (la partie tourne sur cet appareil). */
        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        /** Partie surveillée en cours : écran toujours allumé (pas de fausse sortie par mise en veille) et captures bloquées. */
        @JavascriptInterface
        public void gameMode(boolean on) {
            runOnUiThread(() -> {
                int flags = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_SECURE;
                if (on) getWindow().addFlags(flags);
                else getWindow().clearFlags(flags);
            });
        }
    }

    private void setPinned(boolean on) {
        pinRequested = on;
        try {
            if (on) startLockTask();
            else if (lockTaskActive()) stopLockTask();
        } catch (RuntimeException ignored) {
            // Épinglage refusé ou indisponible : le site le constate avec isPinned() et prévient le professeur.
        }
    }

    private boolean lockTaskActive() {
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        return manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    /** Transmet un signal du système au site (window « whatquiz-native »). Le nom est toujours une constante. */
    private void signal(String name) {
        if (web == null) return;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('whatquiz-native',{detail:'" + name + "'}))", null);
    }

    /** Bouton Accueil ou applis récentes : l'élève quitte volontairement l'application. */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        signal("leave");
    }

    /** Volet de notifications, fenêtre par-dessus, écran partagé… : l'application n'a plus la main. */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        signal(hasFocus ? "focus" : "unfocus");
    }

    @Override
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode, Configuration newConfig) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig);
        signal(isInMultiWindowMode ? "multiwindow-on" : "multiwindow-off");
    }

    @Override
    protected void onStop() {
        signal("stop");
        super.onStop();
    }

    private String writeDownload(String name, String mimeType, byte[] bytes) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/WhatQuiz");
            ContentResolver resolver = getContentResolver();
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("insert");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("stream");
                out.write(bytes);
            }
            return "Téléchargements/WhatQuiz/" + name;
        }
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = getFilesDir();
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file.getAbsolutePath();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        // Signalé avant la mise en pause de la page, pour que le message parte encore.
        signal("pause");
        super.onPause();
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        signal("resume");
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
            // Déjà désinscrit.
        }
        if (pinRequested) setPinned(false);
        web.destroy();
        super.onDestroy();
    }
}
