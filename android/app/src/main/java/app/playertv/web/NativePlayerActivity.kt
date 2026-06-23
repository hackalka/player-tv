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

/**
 * Reproductor NATIVO a pantalla completa basado en ExoPlayer (media3).
 *
 * Reproduce:
 *  - La URL del servidor local (videos de Telegram via puente GramJS), que se
 *    pasa en EXTRA_URL desde MainActivity.
 *  - Cualquier video que otra app le envie por un intent VIEW (content://,
 *    file://, http(s) a un fichero de video).
 *
 * ExoPlayer trae su propio decodificador (MKV, MP4, WebM, TS, MOV...), asi que
 * NO depende del navegador ni de FFmpeg.wasm.
 */
class NativePlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_URL = "extra_url"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_MIME = "extra_mime"
    }

    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        playerView = PlayerView(this).apply {
            layoutParams = FrameLayout.LayoutParams(-1, -1)
            keepScreenOn = true
            useController = true
            setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
        }
        setContentView(playerView)

        val url = intent.getStringExtra(EXTRA_URL) ?: intent.dataString
        if (url.isNullOrBlank()) {
            Toast.makeText(this, "Sin video que reproducir", Toast.LENGTH_LONG).show()
            finish(); return
        }
        val mime = intent.getStringExtra(EXTRA_MIME) ?: intent.type
        startPlayback(url, mime)
    }

    private fun startPlayback(url: String, mime: String?) {
        val exo = ExoPlayer.Builder(this).build()
        player = exo
        playerView.player = exo

        val builder = MediaItem.Builder().setUri(Uri.parse(url))
        // Pista para el extractor segun el mime/extension (ayuda con MKV/TS).
        normalizeMime(mime, url)?.let { builder.setMimeType(it) }

        exo.setMediaItem(builder.build())
        exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                Toast.makeText(
                    this@NativePlayerActivity,
                    "No se pudo reproducir: ${error.errorCodeName}",
                    Toast.LENGTH_LONG
                ).show()
            }
        })
        exo.playWhenReady = true
        exo.prepare()
    }

    /** Devuelve un MIME de media3 cuando podemos deducirlo (mejora la deteccion). */
    private fun normalizeMime(mime: String?, url: String): String? {
        val u = url.lowercase()
        return when {
            u.contains(".m3u8") -> MimeTypes.APPLICATION_M3U8
            u.endsWith(".mkv") || mime == "video/x-matroska" -> MimeTypes.VIDEO_MATROSKA
            u.endsWith(".webm") -> MimeTypes.VIDEO_WEBM
            u.endsWith(".mp4") || mime == "video/mp4" -> MimeTypes.VIDEO_MP4
            u.endsWith(".ts") -> MimeTypes.VIDEO_MP2T
            else -> null
        }
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
        player?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        player?.release()
        player = null
        // Avisar a MainActivity para que cierre el servidor local si procede.
        try { NativeStreamHolder.server?.let { } } catch (_: Exception) {}
    }
}
