# Scripts — One-Click Build + Install

## Schnellstart (1 Klick)

**Windows:**

Doppelklick auf `scripts\build_install.bat` oder in PowerShell:

```powershell
.\scripts\build_install.ps1 -ServerUrl https://game.example.net
```

The release build script requires a public HTTPS server URL; it cannot bake a developer PC or plain-HTTP address into the APK. For local network testing, build a debug APK directly with `flutter build apk --debug --dart-define=SERVER_URL=http://<reachable-host>:10000`.

## Was passiert?

1. Prüft `flutter` (via `FLUTTER_CMD` oder `where flutter` oder gängige Pfade)
2. Prüft `adb` (via `ADB_CMD` / `ANDROID_HOME` / `where adb` / scrcpy)
3. Prüft Gerät: `adb devices` → muss `device` zeigen
4. Baut APK: `flutter build apk --release --dart-define=SERVER_URL=...`
5. Installiert: `adb install -r app\build\app\outputs\flutter-apk\app-release.apk`
6. Startet App: `adb shell am start -n com.example.real_life_amongus_app/com.example.real_life_amongus_app.MainActivity`
7. Zeigt Erfolg / Fehler deutlich

Kein manuelles APK-Auswählen. Immer die gerade gebaute APK.

## Konfiguration (falls flutter/adb nicht in PATH)

```powershell
# Einmalig persistent setzen:
[Environment]::SetEnvironmentVariable("FLUTTER_CMD", "C:\src\flutter\bin\flutter.bat", "User")
[Environment]::SetEnvironmentVariable("ADB_CMD", "C:\platform-tools\adb.exe", "User")
[Environment]::SetEnvironmentVariable("SERVER_URL", "https://game.example.net", "User")

# Oder nur für diese Session:
$env:FLUTTER_CMD="C:\src\flutter\bin\flutter.bat"
$env:ADB_CMD="C:\platform-tools\adb.exe"
.\scripts\build_install.ps1
```

Oder `notification/config.env` nutzen (wird von `build_install.ps1` gelesen wenn vorhanden).

## Fehler

- `Kein Android-Gerät über ADB gefunden.` → USB-Debugging aktivieren, Kabel prüfen, `adb devices` sollte `device` zeigen, ggf. `unauthorized` Dialog am Handy bestätigen
- `Flutter nicht gefunden` → `FLUTTER_CMD` setzen
- `ADB nicht gefunden` → `ADB_CMD` oder `ANDROID_HOME` setzen
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` → `adb uninstall com.example.real_life_amongus_app` dann erneut

## Mit WSL

Falls Flutter nur in WSL installiert ist (`~/.local/flutter/bin/flutter`), in Windows `FLUTTER_CMD` auf `wsl`-Wrapper setzen oder Flutter auch unter Windows installieren. Das Skript erkennt `wsl which flutter` und warnt.

## Optional: Benachrichtigung nach Build

Wenn `notification/notify.ps1` existiert, wird nach Erfolg automatisch `Muse Spark fertig` Desktop+Handy Benachrichtigung gesendet (via gleiche Notification-Abstraktion).
