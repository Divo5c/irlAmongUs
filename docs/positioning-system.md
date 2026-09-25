# Positioning System — Real Life Among Us

## Overview

The positioning system enables automatic player location tracking on the host-created 2D map. Players should not manually report their position during normal gameplay — the system estimates it from sensors (or manual debug input) and the server validates + corrects via map matching.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CLIENT (Flutter)                  │
│                                                     │
│  ┌──────────┐    ┌─────────────────────┐            │
│  │ Sensors  │───▶│ PositioningService  │            │
│  │ (IMU)    │    │ (fusion + threshold)│            │
│  └──────────┘    └─────────┬───────────┘            │
│                            │                        │
│  ┌──────────┐              │                        │
│  │ Manual   │──────────────┘                        │
│  │ Debug    │                                       │
│  └──────────┘              ▼                        │
│                    PositionEstimate                  │
│                         │                           │
│                    socket.emit                      │
│                    'position:update'                 │
└─────────────────────────────────────┬───────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────┐
│                   SERVER (Node.js)                  │
│                                                     │
│  sanitizePositionEstimate()                         │
│       │                                             │
│       ▼                                             │
│  isPositionPlausible() ── reject if speed/clock    │
│       │                                             │
│       ▼                                             │
│  resolveRoomMembership()                            │
│    ├── pointInPolygon() → roomId                    │
│    └── snapToCorridor() → onCorridor                │
│       │                                             │
│       ▼                                             │
│  Store position (authoritative)                     │
│       │                                             │
│       ├──▶ socket.emit('position:confirmed')        │
│       │    (to sender only, privacy)                │
│       │                                             │
│       └──▶ io.to('admin:code').emit(                │
│              'admin:positions') (if admin authed)   │
└─────────────────────────────────────────────────────┘
```

## Server-Side Components

### `server/src/game/positioning.js`

Pure functions for position processing:

| Function | Purpose |
|----------|---------|
| `pointInPolygon(px, py, polygon)` | Ray-casting point-in-polygon test |
| `isPointOnEdge(px, py, ax, ay, bx, by)` | Checks if point lies on segment |
| `pointToSegmentDistance(px, py, ax, ay, bx, by)` | Distance from point to segment |
| `snapToCorridor(px, py, map)` | Snaps position to nearest corridor |
| `resolveRoomMembership(px, py, map)` | Full map matching: room → corridor → unmatched |
| `sanitizePositionEstimate(raw)` | Validates + sanitizes client input |
| `distance(a, b)` | Euclidean distance |
| `isPositionPlausible(current, previous)` | Temporal/spatial plausibility check |

### `server/src/game/proximity.js`

Proximity utilities for future Kill/Report enforcement:

| Function | Purpose |
|----------|---------|
| `isWithinDistance(a, b, max)` | Range check |
| `canKill({killerPos, targetPos, ...})` | Kill proximity gate |
| `canReport({reporterPos, bodyPos, ...})` | Report proximity gate |

**Status**: Foundation ready, NOT wired into killPlayer/reportBody yet.

### RoomStore Extensions

- `updatePosition(code, playerId, estimate)` — Validates phase, sanitizes, map matches, stores
- `getPlayerPosition(code, playerId)` — Returns confirmed position
- `getAdminPositions(code)` — Returns all positions (admin only)
- `authenticateAdmin(code, playerId, pin)` — PIN-based admin auth
- `isAdmin(code, playerId)` — Checks admin auth status

### Socket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `position:update` | C→S | Client sends estimated position |
| `position:confirmed` | S→C (private) | Server confirms authoritative position |
| `position:error` | S→C (private) | Position rejected (non-fatal) |
| `admin:authenticate` | C→S | Host authenticates for admin tracking |
| `admin:authenticated` | S→C | Auth result |
| `admin:track` | C→S | Request all player positions |
| `admin:positions` | S→C | All positions (admin room broadcast) |

## Client-Side Components

### `app/lib/core/models/position_estimate.dart`

`PositionEstimate` model with x, y, heading, confidence, source, timestamp, roomId, onCorridor.

### `app/lib/core/positioning/positioning_service.dart`

`PositioningService` manages:
- Position state (current, last sent)
- Threshold-based update logic (min interval, distance, heading change)
- Debug mode (manual tap on map)
- Sensor mode (IMU/PDR via `SensorProvider`)
- Server confirmation processing
- Calibration management
- Sensor stream lifecycle (start/stop)

### `app/lib/core/positioning/pdr_engine.dart`

Pedestrian Dead Reckoning engine:
- Step detection from user acceleration peak detection
- Stride length: `stepLengthFactor × √(peakMagnitude)`
- Position update: `position += stride × (cos(heading), sin(heading))`
- Stationary detection: `isStationary(nowMs)` — true if no step for `stationaryThresholdMs` (default 2s)
- Calibration: `calibrate(distance, steps, avgMagnitude)` updates `stepLengthFactor`

### `app/lib/core/positioning/heading_fusion.dart`

Complementary filter for heading fusion:
- Gyroscope: fast response, drifts over time
- Magnetometer: absolute heading from magnetic north, noisy
- Alpha = 0.98 (mostly gyroscope, slow magnetometer correction)
- Output: 0–360° compass heading (0 = north)

### `app/lib/core/positioning/sensor_provider.dart`

Abstract interface:
- `userAcceleration` — gravity-free acceleration (m/s²)
- `gyroscope` — angular velocity (rad/s)
- `magnetometer` — magnetic field (µT)
- Implementations: `AndroidSensorProvider` (real), `FakeSensorProvider` (tests)

### `app/lib/core/positioning/calibration_service.dart`

Step length calibration state machine:
- idle → walking → processing → complete/error
- Collects acceleration peaks during a known-distance walk
- Computes: `stepLengthFactor = distance / (steps × √(avgMagnitude))`

### `app/lib/features/map/presentation/position_map_view.dart`

Map view showing:
- Complete game map (corridors, rooms, connections)
- Own position marker ("YOU") with heading indicator
- Current room name
- Debug mode toggle (tap to set position manually)
- Diagnostics panel (position details)

### `app/lib/features/game/presentation/game_screen.dart`

During IN_GAME:
- "Show Position Map" button toggles position view
- Admin tracking toggle (host only, PIN-protected)
- Admin player list when tracking enabled

## Map Canvas Coordinate System (Round 9)

The `MapCanvas` renders the game map using a world→canvas transformation:

```
World coordinates: 1 unit = 1 meter
Canvas pixels:     1 meter = pixelsPerMeter (8.0) pixels

_w2c(x,y) = Offset(origin.dx + x * ppm, origin.dy + y * ppm)
```

- Canvas dynamically sizes to fit all map content (nodes, rooms, pending points)
- Auto-centers on the bounding box of all content
- Grid drawn in world-space: minor (2m), major (10m)
- InteractiveViewer handles pan/zoom with boundary margin of 10000

### Node Rendering
- Committed nodes: radius 3px (primary color)
- Pending nodes: radius 3.5px (5px for last point)
- Corridor lines: 4px stroke, round caps, 85% opacity

### Host Position Marker (MAP_SETUP)
- Outer ring (surface + tertiary border, radius 7)
- Inner dot (tertiary, radius 3)
- "YOU" label below marker
- Fed from `PositioningService.currentPosition` via PDR

### Room Rendering
- Fill: room type color at 20% opacity
- Stroke: room type color, 2px
- Label: room name (auto-set from RoomType)
- Door links: 1.5px from room center to nearest corridor node

## Map Matching Algorithm

1. **Check rooms**: If point is inside any room polygon → accept, set roomId
2. **Snap to corridor**: If near a corridor segment (≤5 units) → snap to closest point on segment
3. **Reject**: If neither → keep last valid position, reject update

### Constants

| Name | Value | Purpose |
|------|-------|---------|
| `MAX_SNAP_DISTANCE` | 5.0 | Max distance to snap to corridor |
| `MAX_SPEED_MPS` | 8.0 | Max plausible human speed |
| `MAX_POSITION_AGE_MS` | 5000 | Max age for plausible update |
| `MIN_CONFIDENCE` | 0.0 | Min confidence threshold |

## Privacy Model

- **Normal player**: Sees only their own position (server confirms privately)
- **Host without admin auth**: Sees only their own position
- **Host with admin auth (PIN)**: Sees all player positions via admin:positions
- **Admin PIN**: Room code itself (simple for MVP, extensible later)
- **Server never broadcasts**: Individual player positions to all clients

## Debug/Testing Mode

- Toggle in position map view (bug icon)
- Tap on map to set position manually
- Confidence = 1.0, source = MANUAL_DEBUG
- Coordinates shown in real-time
- Cannot be accidentally enabled in production (requires explicit toggle)

## Map Scanning (Round 8)

During MAP_SETUP, the host walks the real building and creates the map:

### "+ Point" Semantics

1. `"+ Point"` reads the current PDR position from `PositioningService`
2. If position is valid, creates a corridor node at that location
3. If position is too close to the last point (< 0.3m), the point is rejected (stationary)
4. Falls back to synthetic layout only when no positioning service is available

### Scan Session Lifecycle

```
GameScreen creates PositioningService
  ↓
MapSetupScreen.initState()
  ├── setInitialPosition(0, 0)
  ├── enableSensorMode() → starts sensor listening
  └── subscribes to positionStream
  ↓
Host walks and taps "+ Point"
  ├── reads positioningService.currentPosition
  ├── checks min distance (0.3m)
  └── creates MapNode at PDR position
  ↓
MapSetupScreen.dispose()
  └── positioningService.disable() → stops sensors
```

### Coordinate Origin

- Starting position is (0, 0) in world coordinates
- All subsequent positions are relative to the start
- 1 world unit ≈ 1 meter (from PDR stride estimation)

## Android Configuration

Permissions in `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION"/>
<uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS"/>
```

- `ACTIVITY_RECOGNITION`: Required for step counter sensor (Android 10+)
- `HIGH_SAMPLING_RATE_SENSORS`: Allows high-frequency sensor data

## Accuracy Expectations

| Source | Accuracy | Notes |
|--------|----------|-------|
| IMU + PDR | 2-5% of distance | Drifts without Map Matching |
| Map Matching | Bounded by corridors/rooms | Prevents wall-clipping |
| Manual Debug | Exact (tap position) | Testing/development only |

**Reality**: With Map Matching, position stays within walkable areas. Without external calibration (BLE beacons, etc.), absolute accuracy depends on step length estimation and magnetometer quality.

## Future Extensions

- BLE beacon trilateration (requires hardware deployment)
- UWB positioning (requires compatible devices)
- PDR with personalized stride length
- WiFi fingerprinting (requires per-building calibration)
- ARCore visual positioning (heavy, narrow device support)
