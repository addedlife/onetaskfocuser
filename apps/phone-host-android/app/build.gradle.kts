plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ── ONE bump point per release ──────────────────────────────────────────────
// hostBuild drives versionCode/versionName, the launcher label ("Shamash Phone Host b7"),
// the icon background color (cycles a palette so every build looks different on
// the home screen — owner ticket: "put a different icon each build so it's
// recognizable"), and HostService.BUILD_STAMP via BuildConfig.HOST_BUILD.
val hostBuild = 10
val iconPalette = listOf(
    "#00796B", // teal
    "#C2185B", // pink
    "#1565C0", // blue
    "#EF6C00", // orange
    "#6A1B9A", // purple
    "#2E7D32", // green
    "#455A64", // blue-gray
    "#B8860B", // dark gold
)

android {
    namespace = "com.shamash.phonehost"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.shamash.phonehost"
        minSdk = 26
        targetSdk = 34
        versionCode = hostBuild
        versionName = "b$hostBuild"
        resValue("string", "app_name", "Shamash Phone Host b$hostBuild")
        resValue("color", "ic_launcher_bg", iconPalette[hostBuild % iconPalette.size])
        buildConfigField("int", "HOST_BUILD", "$hostBuild")
    }

    buildFeatures {
        buildConfig = true
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
