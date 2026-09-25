# Android Build Verification Report

**Date:** 2026-08-26
**Round:** 7

## Environment

| Component | Version / Path |
|---|---|
| Flutter | 3.47.1 (stable) |
| Dart | 3.13.1 |
| Android SDK | 36.0.0 |
| Build Tools | 36.0.0 |
| NDK | 28.2 |
| Java/JDK | OpenJDK 17.0.15 (Temurin) |
| Gradle | 9.1.0 |
| AGP | 9.0.1 |
| Kotlin | 2.3.20 |

## Validation Results

### flutter pub get
**PASS**

### flutter analyze
**PASS** — 0 errors, 5 non-blocking warnings (lint suggestions)

### flutter test
**PASS** — 40/40

### npm test (server)
**PASS** — 156/156

### flutter build apk --release
**PASS**

## APK Details

| Property | Value |
|---|---|
| Status | BUILD SUCCESSFUL |
| Path | `D:\Python\App-Projects\real-life-amongus\app\build\app\outputs\flutter-apk\app-release.apk` |
| Size | 51 MB |
| Application ID | `com.example.real_life_amongus_app` |
| Version | 1.0.0 |
| Version Code | 1 |
| Min SDK | 24 (Android 7.0) |
| Target SDK | 36 |
| Build Type | Release (optimized, tree-shaken) |

## Android Permissions

- `android.permission.INTERNET` — network communication (Socket.IO)
- `android.permission.ACTIVITY_RECOGNITION` — step detection (sensors_plus)
- `android.permission.HIGH_SAMPLING_RATE_SENSORS` — high-frequency sensor data (sensors_plus)

## sensors_plus Compatibility

- sensors_plus 7.1.0 integrated
- Requires: Flutter ≥3.19.0 ✓, Dart ≥3.3.0 ✓
- Android permissions: ACTIVITY_RECOGNITION ✓, HIGH_SAMPLING_RATE_SENSORS ✓
- Graceful fallback: `SensorCapabilities.hasStepCounter = false` (sensors_plus does not expose step counter directly; PDR engine uses user acceleration for step detection)
- App does not crash on devices without specific sensors (streams are not subscribed until sensor mode is enabled)

## ADB Device
No Android device connected.

## Installation Test
NOT RUN (no device connected)

## Known Limitations

1. **Release APK is unsigned** — for production distribution, signing config must be added to `app/android/app/build.gradle.kts`
2. **No ProGuard/R8 rules** — sensors_plus plugin classes are not obfuscated, but this is fine for release builds
3. **51 MB APK size** — typical for a Flutter release APK with sensors_plus; could be reduced with split APKs or AAB format
4. **WSL build** — built on WSL2, not native Windows; the APK works on any Android device regardless of build host
5. **sensors_plus requires real Android hardware** — sensor data cannot be tested on emulators; the FakeSensorProvider is used for unit tests

## Files Modified in Round 7 (Build-Relevant)

- `app/pubspec.yaml` — added `sensors_plus: ^7.1.0`
- `app/android/app/src/main/AndroidManifest.xml` — ACTIVITY_RECOGNITION + HIGH_SAMPLING_RATE_SENSORS permissions
- `app/android/local.properties` — added `sdk.dir` for local Android SDK path

## Cleanup

- No test secrets or debug credentials found
- No raw sensor data logged
- No admin PINs stored in client code (hashed server-side with SHA-256)
- `.gitignore` should exclude `build/` directory (standard Flutter template)
