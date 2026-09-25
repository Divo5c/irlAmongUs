@echo off
REM One-Click APK Build + Install (Wrapper fuer build_install.ps1)
REM Aufruf: scripts\build_install.bat
REM Benoetigt: PowerShell 5+, Flutter, ADB
REM Hinweis: bewusst reines ASCII (keine Umlaute), damit CMD in jeder Codepage stabil bleibt.
REM UTF-8-Ausgabe regelt build_install.ps1 selbst (Console OutputEncoding).

setlocal

REM Projekt-Root ist Parent von scripts\
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

REM PowerShell finden
where powershell >nul 2>&1
if %errorlevel% neq 0 (
  echo [FEHLER] PowerShell nicht gefunden
  exit /b 1
)

REM build_install.ps1 ausfuehren, alle Argumente weiterleiten
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build_install.ps1" %*

set "EXITCODE=%errorlevel%"
if %EXITCODE% neq 0 (
  echo.
  echo [FEHLER] Build/Install fehlgeschlagen. Siehe Meldung oben.
  echo Tipps:
  echo   - Flutter: where flutter
  echo   - ADB   : where adb oder ANDROID_HOME setzen
  echo   - Geraet: adb devices
) else (
  echo.
  echo [OK] Fertig. App sollte auf dem Handy installiert sein.
)
exit /b %EXITCODE%
