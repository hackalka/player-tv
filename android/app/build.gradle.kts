plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.playertv.web"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.playertv.web"
        minSdk = 21          // Android 5.0+
        targetSdk = 36
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

// Fuerza versiones de AndroidX compatibles con compileSdk = 36.
// Si Android Studio/algun plugin intenta resolver a 1.19+ (que exige SDK 37)
// las baja a la version compatible para que el proyecto siga compilando.
configurations.all {
    resolutionStrategy.eachDependency {
        if (requested.group == "androidx.core") {
            useVersion("1.13.1")
            because("compileSdk = 36; las versiones 1.19+ exigen compileSdk 37")
        }
    }
}

dependencies {
    // Versiones FIJAS compatibles con compileSdk 36. No subir sin actualizar
    // tambien el compileSdk del proyecto (las 1.19+ exigen Android 37).
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.android.material:material:1.12.0")
    // Soporte minimo para Android TV (Leanback)
    implementation("androidx.leanback:leanback:1.0.0")
}
