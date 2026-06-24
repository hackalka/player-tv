plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.playertv.web"
    compileSdk = 34          // probado y estable

    defaultConfig {
        applicationId = "app.playertv.web"
        minSdk = 21          // Android 5.0+
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    // Nombre del APK al compilar: "TvPlayerPlus-<version>-<abi>-<debug|release>.apk"
    // Incluimos el ABI porque con los splits se generan varios APK y no deben
    // colisionar de nombre (sin espacios para evitar problemas de rutas).
    applicationVariants.all {
        val variant = this
        outputs.all {
            val output = this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            val abi = output.getFilter(com.android.build.OutputFile.ABI) ?: "universal"
            output.outputFileName =
                "TvPlayerPlus-${variant.versionName}-${abi}-${variant.buildType.name}.apk"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { viewBinding = true }

    // ============================================================
    //  SPLITS POR ABI: con libVLC el APK engorda (~30-40 MB por
    //  arquitectura). En vez de un unico APK gigante con TODAS las
    //  arquitecturas, generamos un APK por ABI (mas un APK universal
    //  por si quieres uno que funcione en todo).
    //  - arm64-v8a    -> moviles/TV modernos (el mas comun)
    //  - armeabi-v7a  -> moviles/TV antiguos
    //  - x86 / x86_64 -> emuladores y algun TV-box Intel
    //  Cada usuario instala SOLO el de su arquitectura (menos MB).
    // ============================================================
    splits {
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
            isUniversalApk = true   // genera ademas un APK que vale para todo
        }
    }
}

// ============================================================
//  CLAVE: forzar versiones DE TODAS las androidx.* compatibles
//  con compileSdk = 34. Esto evita que dependencias transitivas
//  de Material/Appcompat/Webkit metan androidx.core 1.19+ que
//  exige Android 37.
// ============================================================
configurations.all {
    resolutionStrategy {
        force("androidx.core:core:1.13.1")
        force("androidx.core:core-ktx:1.13.1")
        force("androidx.appcompat:appcompat:1.6.1")
        force("androidx.appcompat:appcompat-resources:1.6.1")
        force("androidx.activity:activity:1.8.2")
        force("androidx.activity:activity-ktx:1.8.2")
        force("androidx.fragment:fragment:1.6.2")
        force("androidx.lifecycle:lifecycle-runtime:2.7.0")
        force("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
        force("androidx.lifecycle:lifecycle-viewmodel:2.7.0")
        force("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")
        force("androidx.annotation:annotation:1.7.1")
        force("androidx.annotation:annotation-experimental:1.4.0")
        force("androidx.collection:collection:1.4.0")
        force("androidx.savedstate:savedstate:1.2.1")
    }
}

dependencies {
    // Versiones del 2023-2024 alineadas con compileSdk = 34. NO subir.
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.webkit:webkit:1.10.0")
    implementation("com.google.android.material:material:1.11.0")
    // Soporte minimo para Android TV (Leanback)
    implementation("androidx.leanback:leanback:1.0.0")

    // ---- Reproductor NATIVO (ExoPlayer / media3) ----
    // Decodifica MKV/MP4/WebM/TS/MOV con su propio motor, sin depender del
    // navegador ni de FFmpeg.wasm. media3 1.3.x es compatible con compileSdk 34.
    implementation("androidx.media3:media3-exoplayer:1.3.1")
    implementation("androidx.media3:media3-ui:1.3.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.3.1")
    implementation("androidx.media3:media3-datasource:1.3.1")
    // libVLC: reproduce TODO (AVI, WMV, FLV, RMVB, VOB, DivX y codecs raros).
    // Se usa para formatos que ExoPlayer no decodifica y como fallback.
    implementation("org.videolan.android:libvlc-all:3.6.0")
    // Servidor HTTP local minusculo: hace de puente para que ExoPlayer/libVLC
    // pidan rangos del video que la WebView (GramJS) descarga de Telegram.
    implementation("org.nanohttpd:nanohttpd:2.3.1")
}
