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
}
