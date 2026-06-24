package app.playertv.web

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import fi.iki.elonen.NanoHTTPD

/**
 * Wrapper nativo Android (movil + Android TV) sobre la PWA player-tv.pages.dev.
 *
 * - WebView a pantalla completa con JS, DOM storage y descarga delegada al
 *   DownloadManager del sistema (permite "Abrir con VLC/MX Player/MPV...").
 * - Soporte de input[type=file] (subir videos desde la galeria/almacenamiento).
 * - Soporte de fullscreen del <video> de la web.
 * - En Android TV: la navegacion DPad funciona sobre los .focusable de la web.
 */
class MainActivity : AppCompatActivity() {
    companion object {
        // URL de tu PWA
        private const val START_URL = "https://player-tv.pages.dev/"
    }

    private lateinit var web: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var fullscreenView: android.view.View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var streamServer: LocalStreamServer? = null

    private val pickFile = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileChooserCallback?.onReceiveValue(uris.toTypedArray())
        fileChooserCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this)
        web.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        // Que el WebView pueda recibir foco con DPad y mostrar el teclado del sistema
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.descendantFocusability = ViewGroup.FOCUS_BEFORE_DESCENDANTS
        web.setBackgroundColor(android.graphics.Color.parseColor("#0a1a3a"))

        setContentView(web)

        // Activar cookies de terceros (TWA/sesion en localStorage)
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        // ---- Settings del WebView ----
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            // En TV-boxes, esto fuerza que el IME aparezca al enfocar inputs
            javaScriptCanOpenWindowsAutomatically = true
            // Sufijo en el UA: la web puede detectar que es la APK
            userAgentString = userAgentString + " TvPlayer-App/1.0"
        }

        // En TV box, indicar al WebView que acepte input
        web.requestFocus(android.view.View.FOCUS_DOWN)

        // ---- Servidor local + puente para el reproductor NATIVO (ExoPlayer) ----
        startStreamServer()
        web.addJavascriptInterface(NativeHost(), "NativeHost")

        // ---- Cliente Web (navegacion) ----
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url == null) return false
                // Esquemas externos: deja que el sistema los abra (acestream://, vlc://, intent:, magnet:, mailto:, tel:...)
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
                    return true
                }
                return false
            }
        }

        // ---- Cliente Chrome (file picker, fullscreen, permisos) ----
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                val mimeTypes = fileChooserParams?.acceptTypes?.joinToString(",")?.ifBlank { "*/*" } ?: "*/*"
                pickFile.launch(mimeTypes)
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                // Concedemos permisos web (camara/microfono/etc) sin preguntar.
                // Si quieres pedirle al usuario, sustituye por requestPermissions del sistema.
                request?.grant(request.resources)
            }

            override fun onShowCustomView(view: android.view.View?, callback: CustomViewCallback?) {
                if (fullscreenView != null) { callback?.onCustomViewHidden(); return }
                fullscreenView = view
                fullscreenCallback = callback
                window.decorView.systemUiVisibility = (
                    android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    android.view.View.SYSTEM_UI_FLAG_FULLSCREEN or
                    android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                )
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                (window.decorView as FrameLayout).addView(view, FrameLayout.LayoutParams(-1, -1))
            }

            override fun onHideCustomView() {
                val v = fullscreenView ?: return
                (window.decorView as FrameLayout).removeView(v)
                fullscreenView = null
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                window.decorView.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_VISIBLE
            }
        }

        // ---- Descargas: usar el DownloadManager del sistema (notificacion, abrir con app) ----
        web.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            val req = DownloadManager.Request(Uri.parse(url))
            val fname = guessFileName(contentDisposition, mimeType, url)
            req.setTitle(fname)
            req.setDescription("Tv Player")
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fname)
            req.allowScanningByMediaScanner()
            try {
                val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(req)
            } catch (_: Exception) {}
        }

        // Boton atras: navegar atras en el WebView si puede
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreenView != null) {
                    web.webChromeClient?.onHideCustomView(); return
                }
                if (web.canGoBack()) web.goBack() else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(START_URL)
    }

    private fun guessFileName(disposition: String?, mime: String?, url: String): String {
        // Primero intentamos extraer del Content-Disposition (asi nos llega el filename real)
        if (!disposition.isNullOrBlank()) {
            val regex = Regex("""filename\s*=\s*"?([^";]+)"?""", RegexOption.IGNORE_CASE)
            val m = regex.find(disposition)
            if (m != null) return m.groupValues[1].trim()
        }
        // Fallback: ultimo segmento de la URL
        return android.webkit.URLUtil.guessFileName(url, disposition, mime)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    // En Android TV el menu lo abre el boton MENU del mando: muestra/oculta navbar
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            web.evaluateJavascript("(function(){var n=document.querySelector('.navbar');if(n)n.classList.toggle('forcehide')})();", null)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    // ---- Servidor de streaming local (puente ExoPlayer <-> GramJS) ----
    private fun startStreamServer() {
        if (streamServer != null) return
        val ports = intArrayOf(8970, 8971, 8972, 8973, 8974)
        for (p in ports) {
            try {
                val s = LocalStreamServer(p, web)
                s.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                streamServer = s
                NativeStreamHolder.server = s
                break
            } catch (_: Exception) { /* puerto ocupado: probar siguiente */ }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try { streamServer?.stop() } catch (_: Exception) {}
        NativeStreamHolder.server = null
    }

    /**
     * Interfaz JS expuesta como `window.NativeHost`. La web la usa para pedir
     * que un video (que el navegador no puede decodificar: MKV/AVI/...) se abra
     * en el reproductor NATIVO ExoPlayer dentro de esta misma app.
     */
    inner class NativeHost {
        /** ref = JSON {kind,a,b} que identifica el mensaje de Telegram.
         *  engine = "exo" | "vlc" | "" (auto segun formato). */
        @JavascriptInterface
        fun play(refJson: String, title: String?, mime: String?, engine: String?) {
            val srv = streamServer ?: return
            val url = srv.prepare(refJson, mime ?: "")
            val it = Intent(this@MainActivity, NativePlayerActivity::class.java)
            it.putExtra(NativePlayerActivity.EXTRA_URL, url)
            it.putExtra(NativePlayerActivity.EXTRA_TITLE, title ?: "")
            it.putExtra(NativePlayerActivity.EXTRA_MIME, mime ?: "")
            it.putExtra(NativePlayerActivity.EXTRA_ENGINE, engine ?: "")
            runOnUiThread { startActivity(it) }
        }

        /** La web comprueba si el reproductor nativo esta disponible. */
        @JavascriptInterface
        fun isAvailable(): Boolean = streamServer != null

        /** Puerto del servidor local al que la web sube los bytes (meta/feed). */
        @JavascriptInterface
        fun serverPort(): Int = streamServer?.listeningPort ?: 0

        /**
         * "Abrir con...": muestra el selector del sistema para que el usuario
         * elija CON QUE app abrir el video (VLC, MX Player, etc.). Usa la URL del
         * servidor local (127.0.0.1) que esas apps SI pueden leer.
         */
        @JavascriptInterface
        fun openWith(refJson: String, title: String?, mime: String?) {
            val srv = streamServer ?: return
            val url = srv.prepare(refJson, mime ?: "")
            runOnUiThread {
                try {
                    val view = Intent(Intent.ACTION_VIEW)
                    view.setDataAndType(Uri.parse(url), if (mime.isNullOrBlank()) "video/*" else mime)
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    startActivity(Intent.createChooser(view, "Abrir con"))
                } catch (e: Exception) { /* ignore */ }
            }
        }
    }
}
