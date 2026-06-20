# ProGuard rules para release build
# Por defecto la minificacion esta desactivada en build.gradle.kts; este
# archivo solo se usa si activas isMinifyEnabled = true.

-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions

# WebView JS interfaces (si añadiéramos @JavascriptInterface en el futuro)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
