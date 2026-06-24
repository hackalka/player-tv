package app.playertv.web

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

/**
 * Reproductor NATIVO a pantalla completa con dos motores (ExoPlayer + libVLC) y
 * barra superior con TITULO y boton CERRAR (X) accesible con el mando (focusable).
 */
class NativePlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_URL = "extra_url"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_MIME = "extra_mime"
        const val EXTRA_ENGINE = "extra_engine"
        private val VLC_EXT = listOf(".avi", ".wmv", ".flv", ".rmvb", ".rm", ".mpg", ".mpeg", ".vob", ".divx", ".ogm", ".asf", ".3gp", ".m2ts", ".mts")
    }


    private var exo: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private var libVlc: LibVLC? = null
    private var vlcPlayer: MediaPlayer? = null
    private var vlcLayout: VLCVideoLayout? = null

    private lateinit var root: FrameLayout
    private var url: String = ""
    private var title: String = ""
    private var mime: String? = null
    private var triedVlcFallback = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        url = intent.getStringExtra(EXTRA_URL) ?: intent.dataString ?: ""
        title = intent.getStringExtra(EXTRA_TITLE) ?: ""
        mime = intent.getStringExtra(EXTRA_MIME) ?: intent.type
        if (url.isBlank()) {
            Toast.makeText(this, "Sin video que reproducir", Toast.LENGTH_LONG).show()
            finish(); return
        }

        root = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(-1, -1)
            setBackgroundColor(Color.BLACK)
        }
        setContentView(root)

        val engine = (intent.getStringExtra(EXTRA_ENGINE) ?: "").ifBlank { pickEngine(url, mime) }
        if (engine == "vlc") startVlc() else startExo()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { finish() }
        })
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()


    /** Coloca la superficie del reproductor + la barra superior con boton cerrar. */
    private fun mount(surface: View) {
        root.removeAllViews()
        root.addView(surface, FrameLayout.LayoutParams(-1, -1))

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#99000000"))
            val pad = dp(6)
            setPadding(pad, pad, pad, pad)
        }
        val close = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setPadding(dp(16), dp(8), dp(16), dp(8))
            // En TV-box NO es focusable (para no robar el foco): se cierra con ATRAS.
            // En movil/tablet se cierra tocandolo.
            isFocusable = false
            isClickable = true
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { finish() }
        }
        val tv = TextView(this).apply {
            text = title
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            lp.leftMargin = dp(8)
            layoutParams = lp
        }
        bar.addView(close)
        bar.addView(tv)
        root.addView(bar, FrameLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
    }

    private fun pickEngine(u: String, m: String?): String {
        val low = u.lowercase()
        if (VLC_EXT.any { low.contains(it) }) return "vlc"
        if (m != null && (m.contains("x-msvideo") || m.contains("avi") || m.contains("x-ms-wmv"))) return "vlc"
        return "exo"
    }


    // ---------------- ExoPlayer ----------------
    private fun startExo() {
        releaseVlc()
        val pv = PlayerView(this).apply {
            keepScreenOn = true
            useController = true
            setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
        }
        playerView = pv
        mount(pv)

        val p = ExoPlayer.Builder(this).build()
        exo = p
        pv.player = p
        val builder = MediaItem.Builder().setUri(Uri.parse(url))
        normalizeMime(mime, url)?.let { builder.setMimeType(it) }
        p.setMediaItem(builder.build())
        p.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                if (!triedVlcFallback) {
                    triedVlcFallback = true
                    Toast.makeText(this@NativePlayerActivity, "Cambiando a motor libVLC...", Toast.LENGTH_SHORT).show()
                    releaseExo(); startVlc()
                } else {
                    Toast.makeText(this@NativePlayerActivity, "No se pudo reproducir: ${error.errorCodeName}", Toast.LENGTH_LONG).show()
                }
            }
        })
        p.playWhenReady = true
        p.prepare()
    }

    private fun normalizeMime(m: String?, u: String): String? {
        val low = u.lowercase()
        return when {
            low.contains(".m3u8") -> MimeTypes.APPLICATION_M3U8
            low.endsWith(".mkv") || m == "video/x-matroska" -> MimeTypes.VIDEO_MATROSKA
            low.endsWith(".webm") -> MimeTypes.VIDEO_WEBM
            low.endsWith(".mp4") || m == "video/mp4" -> MimeTypes.VIDEO_MP4
            low.endsWith(".ts") -> MimeTypes.VIDEO_MP2T
            else -> null
        }
    }


    // ---------------- libVLC ----------------
    private fun startVlc() {
        releaseExo()
        val args = ArrayList<String>().apply {
            add("--no-drop-late-frames"); add("--no-skip-frames")
            add("--network-caching=1500"); add("--http-reconnect")
        }
        val vlc = LibVLC(this, args)
        libVlc = vlc
        val layout = VLCVideoLayout(this).apply { keepScreenOn = true }
        vlcLayout = layout
        mount(layout)

        val mp = MediaPlayer(vlc)
        vlcPlayer = mp
        mp.attachViews(layout, null, false, false)
        try {
            val media = Media(vlc, Uri.parse(url))
            media.setHWDecoderEnabled(true, false)
            mp.media = media
            media.release()
            mp.play()
        } catch (e: Exception) {
            Toast.makeText(this, "Error libVLC: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun releaseExo() {
        try { exo?.release() } catch (_: Exception) {}
        exo = null
        playerView?.player = null
        playerView = null
    }

    private fun releaseVlc() {
        try { vlcPlayer?.stop() } catch (_: Exception) {}
        try { vlcPlayer?.detachViews() } catch (_: Exception) {}
        try { vlcPlayer?.release() } catch (_: Exception) {}
        vlcPlayer = null
        try { libVlc?.release() } catch (_: Exception) {}
        libVlc = null
        vlcLayout = null
    }


    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
    }

    // ---------------- Mando / teclado (TV-box) ----------------
    // LEFT/RIGHT = saltar -+10s · OK/CENTER = pausa/play · ATRAS = cerrar
    // MENU = mostrar controles. Funciona con ExoPlayer y con libVLC.
    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
        when (keyCode) {
            android.view.KeyEvent.KEYCODE_DPAD_LEFT,
            android.view.KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-10000); return true }
            android.view.KeyEvent.KEYCODE_DPAD_RIGHT,
            android.view.KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(10000); return true }
            android.view.KeyEvent.KEYCODE_DPAD_CENTER,
            android.view.KeyEvent.KEYCODE_ENTER,
            android.view.KeyEvent.KEYCODE_SPACE,
            android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { togglePlay(); return true }
            android.view.KeyEvent.KEYCODE_MEDIA_PLAY -> { setPlaying(true); return true }
            android.view.KeyEvent.KEYCODE_MEDIA_PAUSE -> { setPlaying(false); return true }
            android.view.KeyEvent.KEYCODE_MEDIA_STOP,
            android.view.KeyEvent.KEYCODE_BACK -> { finish(); return true }
            android.view.KeyEvent.KEYCODE_MENU,
            android.view.KeyEvent.KEYCODE_DPAD_DOWN -> { playerView?.showController(); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun seekBy(deltaMs: Long) {
        exo?.let {
            val dur = if (it.duration > 0) it.duration else Long.MAX_VALUE
            it.seekTo((it.currentPosition + deltaMs).coerceIn(0, dur))
            playerView?.showController()
            return
        }
        vlcPlayer?.let {
            val len = it.length
            val t = (it.time + deltaMs)
            it.time = if (len > 0) t.coerceIn(0, len) else maxOf(0, t)
            Toast.makeText(this, if (deltaMs >= 0) "⏩ +10s" else "⏪ -10s", Toast.LENGTH_SHORT).show()
        }
    }

    private fun togglePlay() {
        exo?.let { if (it.isPlaying) it.pause() else it.play(); playerView?.showController(); return }
        vlcPlayer?.let { if (it.isPlaying) it.pause() else it.play() }
    }

    private fun setPlaying(play: Boolean) {
        exo?.let { if (play) it.play() else it.pause(); return }
        vlcPlayer?.let { if (play) it.play() else it.pause() }
    }

    override fun onPause() {
        super.onPause()
        try { exo?.pause() } catch (_: Exception) {}
        try { vlcPlayer?.pause() } catch (_: Exception) {}
    }

    override fun onDestroy() {
        super.onDestroy()
        releaseExo()
        releaseVlc()
    }
}
