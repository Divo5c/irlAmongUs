# Implementation Report — Round 8

## Root Cause

The `"+ Point"` button in the Map Editor used a synthetic coordinate generator `_nextAutoPoint()` that returned hardcoded offsets:
- First tap: `(20, -40)`
- Each subsequent tap: `+60` on the x-axis

There was **zero connection** to `PositioningService`, PDR, or any sensor data. The map editor was completely decoupled from the positioning system.

## What Was Implemented

### 1. Real PDR Position in Map Editor

**File:** `app/lib/features/map/presentation/map_setup_screen.dart`

- `MapSetupScreen` now accepts an optional `positioningService` parameter
- When provided, sensors are enabled on `initState()` and disabled on `dispose()`
- `"+ Point"` now reads `positioningService.currentPosition` instead of generating synthetic offsets
- Falls back to synthetic layout only when no positioning service is available (manual testing)

### 2. Minimum Distance Threshold

- New constant `_minPointDistance = 0.3` (meters/world units)
- Prevents duplicate points when standing still and pressing `"+ Point"` multiple times
- Checks distance against both committed nodes and pending points

### 3. Stationary Detection

**File:** `app/lib/core/positioning/pdr_engine.dart`

- New `stationaryThresholdMs` parameter (default: 2000ms)
- `isStationary(int nowMs)` returns `true` if no step detected within threshold
- Convenience getter `isStationaryNow`

### 4. PositioningService in GameScreen

**File:** `app/lib/features/game/presentation/game_screen.dart`

- `GameScreen` creates a `PositioningService` with `FakeSensorProvider` for map scanning
- Passed to `MapSetupScreen` as `positioningService` parameter
- Properly disposed on `GameScreen.dispose()`

### 5. Diagnostics Bar

- Position, step count, and calibration status shown during map scanning
- Green sensor icon when active, orange when inactive
- Monospace font for easy reading

## Coordinate System

- **World coordinates:** 1 unit ≈ 1 meter
- **PDR convention:** heading 0° (compass north) → displacement in +x; heading 90° (east) → displacement in +y
- **Canvas:** world (0,0) maps to canvas pixel (600, 600) center
- **Origin:** starting position of the host during map scan

## Tests

### New Unit Tests (positioning_test.dart)

| # | Test | Description |
|---|------|-------------|
| 1 | initial position is (0,0) | PDR starts at origin |
| 2 | isStationary true when not initialized | Before first step, device is stationary |
| 3 | isStationary false right after step | Recent step → not stationary |
| 4 | isStationary true after threshold | 2s+ without steps → stationary |
| 5 | standing still: position stays stable | No steps → no position change |
| 6 | walking: position changes | Steps produce displacement |
| 7 | heading 0: X changes, Y stable | Heading 0° → +x displacement |
| 8 | turning: trajectory changes | Heading change → different direction |
| 9 | calibration factor affects stride | Higher factor → longer stride |

### Widget Tests

All 13 existing widget tests pass unchanged. MapSetupScreen tests already covered by existing test suite.

### Server Tests

All 156 server tests pass (no server changes in R8).

## Known Limitations

1. **FakeSensorProvider used in MapSetupScreen** — On real Android, `AndroidSensorProvider` should be used. The `FakeSensorProvider` is injected in `GameScreen` for now; on real hardware this should be swapped.

2. **No real hardware verification** — Unit tests validate the mathematical pipeline. Actual Android sensor behavior must be tested on-device.

3. **Heading convention** — PDR uses mathematical unit-circle convention (0°=+x, 90°=+y) while HeadingFusion outputs compass convention (0°=north, 90°=east). These are consistent but the mapping should be documented.

## Files Changed

| File | Change |
|------|--------|
| `app/lib/features/map/presentation/map_setup_screen.dart` | PDR integration, min distance, diagnostics |
| `app/lib/features/game/presentation/game_screen.dart` | PositioningService creation and disposal |
| `app/lib/core/positioning/pdr_engine.dart` | Stationary detection |
| `app/test/positioning_test.dart` | 9 new stationary/PDR tests |
