plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.playertv.web"
    compileSdk = 37        // requerido por androidx.core 1.19+

    defaultConfig {
        applicationId = "app.playertv.web"
        minSdk = 21          // Android 5.0+
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"
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
}

// Por si Android Studio resuelve dependencias transitivas a versiones que
// requieren un compileSdk distinto, dejamos las nuestras ya alineadas con 37.
configurations.all {
    resolutionStrategy {
        // Coherencia: forzar el grupo androidx.core a su ultima 1.19.x compatible con 37.
        force("androidx.core:core:1.19.0")
        force("androidx.core:core-ktx:1.19.0")
    }
}

dependencies {
    // Versiones alineadas con compileSdk = 37.
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.google.android.material:material:1.14.0")
    // Soporte minimo para Android TV (Leanback)
    implementation("androidx.leanback:leanback:1.0.0")
}
