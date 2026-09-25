# Implementation Report — Round 10: Robust Indoor Positioning / PDR 2.0

## Original Problem

Shaking the phone counted as steps and moved the position, while stationary was stable and walking was mostly okay but drifted noticeably on return walks.

## Root Cause

`PdrEngine.processAcceleration` was naive:
```dart
isAbove = magnitude > 0.5
if (wasAbove && !isAbove && lastPeak >=1.2 && interval >=250) step++
```
Any magnitude peak >1.2 crossing the 0.5 threshold counted, regardless of frequency, regularity or magnitude plausibility. Shaking with 90ms intervals and 4.5 m/s² peaks generated many false steps at full stride length.

Headless issues: no low-pass filtering, no valley check, no interval plausibility, no confidence, no map snap.

## Technical Changes

### 1. PdrEngine — Robust State Machine
- **Low-pass filter:** exponential MA `filtered = 0.65*raw + 0.35*filtered` to suppress high-frequency shake.
- **State machine:** `idle → rising → peak→validate → idle`. Idle enters on any filtered>0.8 or raw>1.0; rising tracks max; falling triggers validation.
- **Valley gate:** must dip below 1.4 m/s² since last peak (walking dips to 0.2-0.4, shaking stays high).
- **Interval window:** `min 300ms, max 1800ms`, very short (<250ms) rejected, ideal 400-900ms.
- **Magnitude bands:** 1.5-2.8 ideal (1.0), 1.2-1.5 (0.6), 2.8-3.5 (0.65), 3.5-4.5 (0.3) — large shake peaks get low confidence.
- **Periodicity:** new interval vs last interval ratio >0.75 ideal (1.0), <0.35 shake-like (0.12); both short intervals penalized.
- **Confidence weighted:** `0.5*mag +0.30*interval+0.20*periodicity`; threshold 0.45 rejects low-confidence shakes.
- **Confidence-weighted stride:** `effective = stride*(0.6+0.4*conf)` — false steps make small displacement, limiting drift.
- `PdrUpdate` now carries `confidence`; getters `lastConfidence`, `lastIntervalMs`, `lastPeakMag`.

### 2. FakeSensorProvider — Realistic Simulations
- Added `setFakeTime/nextTime`, `pushUserAccelerationAt`.
- New simulations: `simulateStationary(n=20)`, `simulateWobble`, `simulateShake(bursts=10, 60-120ms, 2.8-5.0)`, `simulateWalk(steps, 550ms interval, 6 samples/step peak 2.0 valley 0.25)`, `simulateWalkAndTurn`, `simulateWalkAndReturn`.

### 3. HeadingFusion — Indoor Interference Gate
- Tracks last magnetometer heading/time. If jump >50° in <800ms → treat as metal/speaker interference, dampens alpha to 0.995 (vs 0.98). 30-50° dampens to 0.985. Preserves confidence calc.

### 4. CalibrationService — Same Robustness
- Added valley tracking and maxPeak/valley gates (`1.2-4.5`, valley<0.9) and interval 300ms to avoid counting shake during calibration.

### 5. PositioningService — Gentle Map Snap
- New `_applyMapSnap`: if map available, not inside a room, and closest corridor distance <4.0m, blend 30% toward snapped point. Inside rooms no snap. Syncs PDR position after snap to avoid divergence. Confidence multiplied with heading confidence.

### 6. Production Wiring Fix
- `position_map_view.dart:127` changed `FakeSensorProvider()` → `AndroidSensorProvider()` for calibration dialog. Verified no `FakeSensorProvider` in `app/lib` except definition/comment.

### 7. Diagnostics
- `SensorStatus` extended with `isStationary`, `lastStepConfidence`, `lastIntervalMs`. Panel shows Movement STILL/MOVING, Step Conf, Step Interval alongside existing fields.

## Tests

New group `Robust Step Detection (Round 10)` — 13 tests:

- A stationary 30 samples tiny noise →0 steps ✅
- B small wobble 0.4-0.9 →0 steps ✅
- C strong shake 12 bursts 90ms 3.8-4.8 → <4 steps (vs 12) ✅
- D normal walking 6 steps 600ms →4-6 steps ✅
- E regular intervals → interval 350-800 ✅
- F walk+turn 90° → y>prev y ✅
- G walk 4 then 20 still samples → steps frozen, stationary true ✅
- H walk10 east then 10 west → |x|<0.4*midX (drift limited) ✅
- I NaN/inf/1000 mag → no crash <2 steps ✅
- J no data → stays at (5,5) stationary ✅
- plus stationary large-mag shake, confidence field, etc.

Total: **flutter test 61/61 PASS** (49 existing +12 new), server 156/156.

## Android Verification

- Build: `flutter build apk --release` PASS (52.8 MB)
- Provider: `GameScreen._scanPositioning` uses `AndroidSensorProvider` (real sensors_plus streams at 50 Hz). `PositionMapView` calibration also now uses `AndroidSensorProvider`.
- Permissions: ACTIVITY_RECOGNITION + HIGH_SAMPLING_RATE_SENSORS present.
- Lifecycle: start/stop/dispose audited.

## APK

`app/build/app/outputs/flutter-apk/app-release.apk` (51 MB)

## Known Limitations

- PDR still drifts ~10-20% over >50m without loop closure; map snap mitigates but not eliminates.
- Heading still phone-orientation dependent (flat vs upright); magnitude used but heading still affected.
- No barometer/floor detection; single floor.
- No BLE/UWB; offline LAN only.
- Extreme running (>3 m/s) may be under-counted due to large mag penalty.

## Next Step for Real Device Test

1. Install APK, host MAP_SETUP, walk 20m hallway, +Point at corners → map should show corridor length ~20m (±30%) and not spawn points when shaken.
2. Shake phone 5 sec standing still → steps should increase ≤1, position should not wander >2m.
3. Walk out and back to start → return position within 5m of origin.
4. Turn 90° at intersection → subsequent corridor should be orthogonal (not diagonal drift).
