package app.playertv.web

import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.TimeUnit

/**
 * Servidor HTTP local (127.0.0.1) que hace de PUENTE entre ExoPlayer (nativo) y
 * la WebView (GramJS). ExoPlayer pide rangos del video a este servidor; el
 * servidor le pide esos bytes a la pagina JavaScript (window.NativeStream), que
 * los descarga de Telegram con la sesion GramJS ya iniciada.
 *
 * Protocolo interno:
 *  - ExoPlayer  ->  GET /stream            (con cabecera Range)
 *  - servidor   ->  JS NativeStream.pump(ref, start, len, reqId)   (en hilo UI)
 *  - JS         ->  POST /feed?id=<reqId>  con los bytes binarios
 *  - servidor   ->  responde 206 Partial Content a ExoPlayer
 *
 * El tamaño total del fichero se obtiene una vez al principio con
 *  NativeStream.meta(ref, reqId)  ->  POST /meta?id=<reqId>  {size, mime}.
 */
class LocalStreamServer(
    port: Int,
    private val web: WebView
) : NanoHTTPD("127.0.0.1", port) {

    /** Referencia del video actual (JSON {kind,a,b}) y metadatos. */
    @Volatile private var currentRef: String = ""
    @Volatile private var totalSize: Long = 0
    @Volatile private var mime: String = "video/mp4"

    private val ui = Handler(Looper.getMainLooper())

    // Buzones para correlacionar peticiones a JS con sus respuestas (por reqId).
    private val byteMailboxes = ConcurrentHashMap<String, SynchronousQueue<ByteArray>>()
    private val metaMailboxes = ConcurrentHashMap<String, SynchronousQueue<LongArrayMeta>>()
    private var reqCounter = 0L

    data class LongArrayMeta(val size: Long, val mime: String)

    /** Prepara una nueva reproduccion. Devuelve la URL local que usara ExoPlayer. */
    fun prepare(refJson: String, mimeType: String): String {
        currentRef = refJson
        mime = if (mimeType.isNotBlank()) mimeType else "video/mp4"
        totalSize = 0
        return "http://127.0.0.1:${listeningPort}/stream"
    }

    private fun nextId(): String { synchronized(this) { return "r" + (++reqCounter) } }

    private fun evalJs(js: String) {
        ui.post { try { web.evaluateJavascript(js, null) } catch (_: Exception) {} }
    }

    /** Llamado desde el bridge JS cuando entrega los metadatos del fichero. */
    fun deliverMeta(reqId: String, size: Long, mimeType: String) {
        metaMailboxes[reqId]?.offer(LongArrayMeta(size, mimeType))
    }

    /** Llamado desde el POST /feed: entrega los bytes de un rango pedido. */
    private fun deliverBytes(reqId: String, data: ByteArray) {
        byteMailboxes[reqId]?.offer(data)
    }

    private fun ensureSize(): Long {
        if (totalSize > 0) return totalSize
        val id = nextId()
        val box = SynchronousQueue<LongArrayMeta>()
        metaMailboxes[id] = box
        evalJs("window.NativeStream && NativeStream.meta(${quote(currentRef)}, ${quote(id)});")
        val meta = box.poll(30, TimeUnit.SECONDS)
        metaMailboxes.remove(id)
        if (meta != null) {
            totalSize = meta.size
            if (meta.mime.isNotBlank()) mime = meta.mime
        }
        return totalSize
    }

    private fun fetchRange(start: Long, length: Int): ByteArray? {
        val id = nextId()
        val box = SynchronousQueue<ByteArray>()
        byteMailboxes[id] = box
        evalJs("window.NativeStream && NativeStream.pump(${quote(currentRef)}, $start, $length, ${quote(id)});")
        val data = box.poll(60, TimeUnit.SECONDS)
        byteMailboxes.remove(id)
        return data
    }

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri ?: ""
        return try {
            when {
                uri.startsWith("/feed") -> handleFeed(session)
                uri.startsWith("/meta") -> handleMetaPost(session)
                uri.startsWith("/stream") -> handleStream(session)
                else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404")
            }
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "err: ${e.message}")
        }
    }

    /** La WebView (JS) sube aqui los bytes binarios de un rango. */
    private fun handleFeed(session: IHTTPSession): Response {
        val id = session.parameters["id"]?.firstOrNull() ?: session.parms["id"] ?: ""
        val lenHeader = session.headers["content-length"]?.toIntOrNull() ?: 0
        val input = session.inputStream
        val data = readExactly(input, lenHeader)
        deliverBytes(id, data)
        return newFixedLengthResponse(Response.Status.OK, "text/plain", "ok")
    }

    /** La WebView (JS) sube aqui los metadatos {size,mime} como cabeceras. */
    private fun handleMetaPost(session: IHTTPSession): Response {
        val id = session.parameters["id"]?.firstOrNull() ?: session.parms["id"] ?: ""
        val size = (session.headers["x-size"] ?: "0").toLongOrNull() ?: 0
        val m = session.headers["x-mime"] ?: ""
        deliverMeta(id, size, m)
        return newFixedLengthResponse(Response.Status.OK, "text/plain", "ok")
    }

    /** ExoPlayer pide el video (con Range). */
    private fun handleStream(session: IHTTPSession): Response {
        val size = ensureSize()
        if (size <= 0) return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "no size")

        val rangeHeader = session.headers["range"]
        var start = 0L
        var end = size - 1
        var partial = false
        if (rangeHeader != null) {
            val m = Regex("bytes=(\\d+)-(\\d*)").find(rangeHeader)
            if (m != null) {
                start = m.groupValues[1].toLong()
                if (m.groupValues[2].isNotEmpty()) end = minOf(m.groupValues[2].toLong(), size - 1)
                partial = true
            }
        }
        // Limitar el tamaño por respuesta para no agotar memoria (2 MB por bloque).
        val maxBlock = 2 * 1024 * 1024
        if (end - start + 1 > maxBlock) end = start + maxBlock - 1
        val length = (end - start + 1).toInt()

        val data = fetchRange(start, length)
            ?: return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "no data")

        val status = if (partial) Response.Status.PARTIAL_CONTENT else Response.Status.OK
        // Content-Type neutro: dejamos que el reproductor (libVLC/ExoPlayer)
        // detecte el formato por el contenido. Un mime erroneo (p.ej. video/mkv)
        // hacia que libVLC demuxease mal y se perdiera el AUDIO.
        val res: Response = newFixedLengthResponse(status, "application/octet-stream", ByteArrayInputStream(data), data.size.toLong())
        res.addHeader("Accept-Ranges", "bytes")
        if (partial) res.addHeader("Content-Range", "bytes $start-$end/$size")
        return res
    }

    private fun readExactly(input: InputStream, len: Int): ByteArray {
        if (len <= 0) return input.readBytes()
        val out = ByteArray(len)
        var off = 0
        while (off < len) {
            val r = input.read(out, off, len - off)
            if (r < 0) break
            off += r
        }
        return if (off == len) out else out.copyOf(off)
    }

    companion object {
        fun quote(s: String): String = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    }
}
