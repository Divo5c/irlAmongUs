# Step-Detector Failover (PDR 2.2)

## Symptom (real device)
MOTION: WALKING, but HW_STEPS: 0, TOTAL_STEPS: 0, VALIDATOR: RESET,
STEP_LOG empty, PDR frozen at (0,0).

## Root cause
`positioning_service.dart:410` read `capabilities.hasStepDetector`
synchronously right after `start()`. The flag is optimistically `true`;
the native UNAVAILABLE error arrives asynchronously via the EventChannel.
On any device without a working step detector the service therefore
committed to the hardware branch, attached to a stream that never emits,
and never attached the fallback PDR listener (`else` branch). The
validator was never called (reason frozen at RESET/—), while motion —
fed by userAcceleration in both branches — correctly reported WALKING.
Channel names verified identical on both sides; MainActivity.kt itself
is correct.

## Fix (no new detection, no PDR/heading/map changes)
- `android_sensor_provider.dart`: native step-detector errors are forwarded
  into the controller (`addError`) + event count/error string tracked.
- `fake_sensor_provider.dart`: `failStepDetector()` test helper (additive).
- `positioning_service.dart`:
  - hardware stream `onError` → `_switchToFallback('hw-error')`;
  - watchdog: 8s continuous WALKING with zero raw hardware events →
    `_switchToFallback('no-hw-events')` (standing still resets the grace,
    so healthy hardware always gets a fresh window);
  - failover is sticky, keeps the hardware subscription for diagnostics,
    ignores late hardware events for advancement (no double counting);
  - fallback PDR body extracted verbatim into `_processFallbackReading`
    and shared by both paths;
  - new diagnostics: `fallbackActive`, `failoverReason`,
    `stepDetectorError`; version bumped to
    `1.0.0+1 PDR2.2-stepFailover 2026-09-09` (visible in Diagnostics →
    proves which APK is installed).
- `diagnostics_panel.dart`: `fallback` + `hwError` rows.
- MainActivity.kt unchanged.

## Tests (all passing)
- J: native error → fallback engages, walking counted via fallback.
- K: silent channel + sustained walking → failover after grace, steps counted.
- L: healthy hardware events → accepted, no failover, source hardware.
- flutter analyze: 0 errors. flutter test: 89/89. npm test: 142/142.

## Real-device check procedure
1. Install APK containing build `PDR2.2-stepFailover` (verify BUILD row).
2. Diagnostics → 1. STEP_DETECTOR must show `supported: yes/no`,
   `useHardware: HARDWARE/FALLBACK`, `hwError` if native failed.
3. If sensor absent: walk → after ~8s `fallback: ACTIVE(no-hw-events)`,
   steps counted, position moves.
4. If sensor present: steps counted immediately via HARDWARE, no fallback.

## Addendum PDR2.3 — Gegenläufiger Pfeil & stehende Position (Analyse)

### A) Warum der Pfeil entgegengesetzt dreht — KEINE Codeänderung
Winkelkonventionen (mathematisch verifiziert):
- 0° = Nord = oben (-Y), 90° = Ost = rechts (+X), 180° = Süd, 270° = West.
- Magnetometer (`atan2(mx,my)`), Pfeil (`sin,-cos`) und PDR (`sin,-cos`)
  sind alle korrekt und konsistent.
- Gyroskop-Integration (`heading += ωz·dt`) hat dagegen das falsche
  Vorzeichen: Für das flache Gerät (Annahme des gesamten Codes) gilt per
  starrer Körperrotation Kompassrate Ω = −ωz. Eine physische Rechtsdrehung
  (N→O) liefert negatives ωz, der Code zählt es positiv → Fusion und damit
  Pfeil UND PDR-Pfad drehen gespiegelt. Das Magnetometer (korrekt) zieht mit
  nur 2 %/Sample dagegen — der Pfeil schlägt bei Drehung sichtbar falsch aus.
- Eine Pfeil-Negierung wurde bewusst NICHT gemacht: Sie würde den Pfeil vom
  PDR-Glauben (dx/dy, STEP_LOG) entkoppeln und das Debug-Tool fälschen.
  Follow-up (1 Zeile, braucht Freigabe): Vorzeichen in
  `HeadingFusion.updateFromGyroscope` bzw. am Aufrufort korrigieren.

### B) Warum die Position bei 0 bleibt — Verluststellen + Fix
Der Service friert ein, sobald Gehen ohne akzeptierte Steps anhält:
1. Spärliche Hardware-Blips inkrementieren den Raw-Counter (Watchdog (a)
   deaktiviert), werden vom Validator (2er-Regel) aber nie akzeptiert.
2. Unklar war zusätzlich, ob Fallback-PDR reale Daten filtert — jetzt
   sichtbar: PDR zählt Candidates/Drops pro Stufe (`below-min`,
   `interval`, `no-valley`, `low-conf`) plus letzte Magnituden, als
   `cand/rej`- und `filt/raw`-Zeilen in Diagnostics 5. PDR.
3. Fix: Failover-Kriterium (b) — 12 s ununterbrochenes Gehen ohne einen
   einzigen akzeptierten Step schaltet auf Fallback-PDR (kein Doppelzählen:
   Hardware-Events werden dann ignoriert). Gesundes Gerät akzeptiert
   innerhalb ~1 s, kann also nie auslösen. Version:
   `1.0.0+1 PDR2.3-stepLiveness 2026-09-10`.
4. Nebenbefund: `PositionMapView` besitzt keinen SensorProvider (nur
   manueller Debug-Tap sendet) — In-Game-Position kann sich dort per Design
   nicht bewegen; Scan-Flow (MapSetupScreen) ist der live Pfad.
