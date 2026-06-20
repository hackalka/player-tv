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
        // Limpiar focus para que TVs con DPad puedan navegar dentro del WebView
        web.isFocusable = true
        web.isFocusableInTouchMode = true

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
            // Permitir tamaño/zoom adaptativos (para TV es importante para el escalado)
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            // User agent: añadimos sufijo para que la web pueda detectarnos si quiere
            userAgentString = userAgentString + " TvPlayer-App/1.0"
        }

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
}
