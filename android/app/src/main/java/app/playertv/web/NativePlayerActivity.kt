package app.playertv.web

import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.Toast
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
 * Reproductor NATIVO a pantalla completa con DOS motores:
 *
 *  - ExoPlayer (media3): ligero, aceleracion hardware. MKV/MP4/WebM/TS/MOV.
 *  - libVLC: reproduce TODO (AVI, WMV, FLV, RMVB, VOB, DivX, codecs raros).
 *
 * Estrategia:
 *  - Se elige el motor por el formato (EXTRA_ENGINE o por extension/mime).
 *  - Por defecto ExoPlayer; libVLC para AVI/WMV/FLV/etc.
 *  - Si ExoPlayer falla al decodificar, se RELANZA automaticamente con libVLC.
 *
 * Reproduce tanto la URL del servidor local (videos de Telegram via puente
 * GramJS) como cualquier video que otra app envie por un intent VIEW.
 */
class NativePlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_URL = "extra_url"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_MIME = "extra_mime"
        const val EXTRA_ENGINE = "extra_engine" // "exo" | "vlc" | "" (auto)

        // Formatos que conviene mandar directamente a libVLC.
        private val VLC_EXT = listOf(".avi", ".wmv", ".flv", ".rmvb", ".rm", ".mpg", ".mpeg", ".vob", ".divx", ".ogm", ".asf", ".3gp", ".m2ts", ".mts")
    }

    // ExoPlayer
    private var exo: ExoPlayer? = null
    private var playerView: PlayerView? = null
    // libVLC
    private var libVlc: LibVLC? = null
    private var vlcPlayer: MediaPlayer? = null
    private var vlcLayout: VLCVideoLayout? = null

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

        val engine = (intent.getStringExtra(EXTRA_ENGINE) ?: "").ifBlank { pickEngine(url, mime) }
        if (engine == "vlc") startVlc() else startExo()
    }

    /** Elige motor segun extension/mime. AVI y similares -> libVLC. */
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
            layoutParams = FrameLayout.LayoutParams(-1, -1)
            keepScreenOn = true
            useController = true
            setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
        }
        playerView = pv
        setContentView(pv)

        val p = ExoPlayer.Builder(this).build()
        exo = p
        pv.player = p

        val builder = MediaItem.Builder().setUri(Uri.parse(url))
        normalizeMime(mime, url)?.let { builder.setMimeType(it) }
        p.setMediaItem(builder.build())
        p.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                // Si ExoPlayer no puede, probamos libVLC (reproduce casi todo).
                if (!triedVlcFallback) {
                    triedVlcFallback = true
                    Toast.makeText(this@NativePlayerActivity, "Cambiando a motor libVLC...", Toast.LENGTH_SHORT).show()
                    releaseExo()
                    startVlc()
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
            add("--no-drop-late-frames")
            add("--no-skip-frames")
            add("--network-caching=1500")
            add("--http-reconnect")
        }
        val vlc = LibVLC(this, args)
        libVlc = vlc
        val layout = VLCVideoLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(-1, -1)
            keepScreenOn = true
        }
        vlcLayout = layout
        setContentView(layout)

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

    // ---------------- Limpieza ----------------
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
