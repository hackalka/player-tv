package app.playertv.web

/**
 * Contenedor global del servidor de streaming local, para que tanto MainActivity
 * (que tiene la WebView/GramJS) como NativePlayerActivity (ExoPlayer) compartan
 * la misma instancia mientras dura la reproduccion.
 */
object NativeStreamHolder {
    @Volatile var server: LocalStreamServer? = null
}
