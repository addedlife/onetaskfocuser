plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.shamash.phonehost"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.shamash.phonehost"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "b4"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Zero external dependencies on purpose: the whole host (OBEX, MAP, PBAP, HFP,
// HTTP API) is hand-rolled on framework APIs, same as the Windows host.
dependencies {}
