# Implementation Report — Sitting-Still Fix (PDR 2.1)

## 1. What was wrong

Old PDR was **peak = step**. Any userAcceleration peak >1.2 with interval >300ms counted, even if user sat. Sitting + hand shake/rotate produced:
- accel peaks 3-5 m/s²
- intervals 90-400ms irregular
- PDR confidence sometimes >0.45 → false step → position moved.
No body-motion gate, so hand movement == walking.

## 2. Architecture changed

```
Before: Sensor → PDR peak → Position
After:  Sensor → MotionClassifier → WalkingValidator → PDR → Position
        + Hardware TYPE_STEP_DETECTOR (preferred) via EventChannel
```

New files:
- `motion_classifier.dart` — STILL/WALKING/UNKNOWN via 1s variance windows (accel + gyro). STILL: var<0.18 & gyroVar<0.08 & mean<0.7. WALKING: accelVar 0.35-4.0 & gyroVar<0.6 & mean<1.6, hysteresis 3/2 windows.
- `walking_validator.dart` — requires 2 consecutive plausible steps, rejects STILL, interval 320-2000ms, periodicity ratio <0.35 reject, hardware boost +0.15.
- `SensorProvider` extended with `hasStepDetector` + `stepDetector` stream.
- `AndroidSensorProvider` now bridges native `TYPE_STEP_DETECTOR` via `EventChannel com.example.real_life_amongus_app/step_detector` (Kotlin `MainActivity.kt`). Falls back gracefully if sensor unavailable.
- `PositioningService` rewired:.hardware path validates via `WalkingValidator` before `PdrEngine.onHardwareStep`; fallback path gated by `MotionClassifier.isStill` (zero-velocity) and uses `PdrEngine` only when not still; map snap preserved; heading gyro frozen when still.
- `PdrEngine` added `onHardwareStep` + getters `lastPeakMag/lastConfidence`; filter alpha 0.65, valley 1.4.
- `CalibrationService` valley/maxPeak gate.
- Diagnostics `SensorStatus` extended: `motionState, stepSource, walkingConfidence, lastStepReason, useHardwareStepDetector, isStationary`.

## 3. Which Android sensors now used

| Sensor | Stream | Purpose |
|---|---|---|
| `TYPE_STEP_DETECTOR` | `stepDetector` EventChannel | Primary step events (hardware, less hand-sensitive) |
| `userAcceleration` | sensors_plus | Motion variance, fallback peak detection |
| `gyroscope` | sensors_plus | Heading fusion (gated when still) + motion variance |
| `magnetometer` | sensors_plus | Heading correction with outlier gate (>50°/800ms damped) |
| `accelerometer` | sensors_plus | Reserved (not used for motion) |

If step detector unavailable (`hasStepDetector false`), automatically falls back to PDR fallback detector.

Check: `sensorManager.getDefaultSensor(TYPE_STEP_DETECTOR) != null` in Kotlin; Dart capabilities `hasStepDetector`.

## 4. How stationary vs walking is determined

`MotionClassifier` sliding window 25 samples (~0.5s at 50Hz):
- computes mean/variance for accel mag and gyro mag
- STILL: low var + low mean → 3 consecutive → STILL
- WALKING: moderate accelVar + low gyroVar → 2 consecutive → WALKING
- else UNKNOWN (holds previous)
WalkingValidator adds second gate: STILL → immediate reject, pending 2 steps → walking.

Zero-velocity: when STILL, `PositioningService` skips all position integration, gyro heading frozen, validator reset.

## 5. How false steps from phone movement are rejected

- **Shaking while sitting:** accelVar high but gyroVar also high (>0.6) → not WALKING → UNKNOWN/STILL → hardware validator rejects (needs WALKING+2 consecutive), fallback gated by isStill. Even if accel peak passes PDR, confidence low (large mag >4.5 → magC 0.08) and interval short → rejected. Position not moved.
- **Rotation while sitting:** gyro large but accelVar low → stays STILL → all steps rejected.
- **Irregular movements:** WalkingValidator periodicity ratio <0.35 → reject, interval <320ms → reject.
- **Single phone move:** requires 2 consecutive → first is PENDING, no movement.

Result: sitting + shake/rotate → 0-1 steps, position stays within <1m (validated by tests).

## 6. Test results

- `flutter analyze` 0 errors (warnings only pre-existing)
- `flutter test` **69/69 PASS** (61 previous +8 new regression)
  - A sitting still → 0 steps, STILL ✅
  - B rotation → 0 steps, no movement ✅
  - C shaking → <2 steps ✅
  - E walking → ≥2 steps ✅
  - F walk→stop stabilizes STILL ✅
  - MotionClassifier still vs walking ✅
  - WalkingValidator consecutive ✅
  - Fallback when detector unavailable ✅
  - All Round10 robust tests still passing
- `npm test` 156/156 PASS
- `flutter build apk` PASS 52.8 MB

## 7. APK path

`app/build/app/outputs/flutter-apk/app-release.apk` (51 MB, SERVER_URL http://<LAN-HOST>:3000)

## 8. Remaining limitations

- Step detector not present on some low-end devices → fallback less robust (still better than before).
- Very vigorous walking with phone vertical may still have heading offset (phone orientation vs body direction).
- Long drift 10-20% over >50m remains (map snap only 30% blend <4m).
- No barometer/floor, no BLE/UWB.
- Hardware detector latency ~ one step delay due to 2-step validation (first step pending).

Next device test: sit 30s still → 0 steps; shake 5s ×3 → ≤1 step each; straight 15m walk → 12-18 steps; out-and-back → within 5m.
