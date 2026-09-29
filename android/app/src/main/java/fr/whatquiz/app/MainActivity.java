package fr.whatquiz.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
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
 * Coquille Android de WhatQuiz : affiche le site servi par le serveur WhatQuiz (Termux, PC…)
 * dans une WebView, avec un écran pour choisir l'adresse du serveur.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "whatquiz";
    private static final String KEY_SERVER = "server";
    private static final String SETUP_URL = "file:///android_asset/setup.html";
    private static final int FILE_CHOOSER_REQUEST = 1;

    private WebView web;
    private SharedPreferences prefs;
    private String serverUrl;
    private ValueCallback<Uri[]> pendingChooser;
    private boolean clearHistoryOnLoad;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        serverUrl = prefs.getString(KEY_SERVER, null);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.stage));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        applySystemBarInsets(root);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " WhatQuizAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "WhatQuizAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) return;
        if (serverUrl == null) showSetup(null);
        else web.loadUrl(serverUrl);
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

    private void showSetup(String error) {
        StringBuilder url = new StringBuilder(SETUP_URL).append("?server=").append(Uri.encode(serverUrl == null ? "" : serverUrl));
        if (error != null) url.append("&error=").append(Uri.encode(error));
        web.loadUrl(url.toString());
    }

    /** Ajoute http:// et le port 3000 par défaut quand l'utilisateur tape seulement une adresse IP. */
    static String normalizeServer(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        boolean hasScheme = value.matches("(?i)^https?://.*");
        if (!hasScheme) value = "http://" + value;
        Uri uri = Uri.parse(value);
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        String origin = uri.getScheme().toLowerCase() + "://" + uri.getHost();
        if (uri.getPort() != -1) origin += ":" + uri.getPort();
        else if (!hasScheme) origin += ":3000";
        return origin;
    }

    private boolean isServerUrl(Uri uri) {
        if (serverUrl == null) return false;
        Uri server = Uri.parse(serverUrl);
        return server.getScheme().equalsIgnoreCase(uri.getScheme())
                && server.getHost().equalsIgnoreCase(uri.getHost())
                && server.getPort() == uri.getPort();
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("file".equals(uri.getScheme()) || isServerUrl(uri)) return false;
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
                showSetup("Impossible de joindre le serveur " + serverUrl + ". Vérifiez qu'il est lancé et que vous êtes sur le même Wi-Fi.");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (clearHistoryOnLoad && !url.startsWith("file:")) {
                clearHistoryOnLoad = false;
                view.clearHistory();
            }
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
        public void connect(String raw) {
            String normalized = normalizeServer(raw);
            runOnUiThread(() -> {
                if (normalized == null) {
                    showSetup("Adresse invalide. Exemple : 192.168.1.20:3000");
                    return;
                }
                serverUrl = normalized;
                prefs.edit().putString(KEY_SERVER, normalized).apply();
                clearHistoryOnLoad = true;
                web.loadUrl(normalized);
            });
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(() -> showSetup(null));
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
        super.onPause();
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
