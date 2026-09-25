# Positioning Research — Real Life Among Us

## Goal
Automatically estimate player position on a host-created 2D map during gameplay.
Players should not manually report their position during normal play.

## Technology Assessment

### GPS/GNSS
- **Accuracy**: 3–10m outdoor, 10–50m indoor (severely degraded)
- **Indoor**: Unreliable — signal attenuation through walls/roof
- **Android support**: All devices with location permission
- **Permissions**: ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION
- **Battery**: Moderate–High (continuous GPS drain)
- **Privacy**: Location permission triggers OS prompt; may alarm users
- **Verdict**: NOT suitable for indoor school gameplay. Use only as outdoor fallback.

### WiFi RTT / WiFi Scan
- **Accuracy**: 1–5m (RTT), 10–20m (scan RSSI)
- **Indoor**: Good in buildings with many APs
- **Android support**: WiFi RTT requires Android 9+ and RTT-capable APs (rare in schools)
- **Permissions**: ACCESS_FINE_LOCATION (Android 8+ for scan results)
- **Battery**: Low–Moderate
- **Verdict**: RSSI fingerprinting possible but requires calibration per-building. Not MVP.

### Bluetooth Low Energy (BLE) Beacons
- **Accuracy**: 1–3m with calibrated beacons, 5–10m with iBeacon
- **Indoor**: Excellent with deployed beacons
- **Android support**: All BLE-capable devices
- **Permissions**: BLUETOOTH_SCAN (Android 12+), ACCESS_FINE_LOCATION (older)
- **Battery**: Low (BLE scan in background is efficient)
- **Verdict**: Best indoor option WITH deployed hardware. Not available in MVP (no beacons deployed yet). Interface prepared.

### UWB (Ultra-Wideband)
- **Accuracy**: 10–30cm
- **Indoor**: Excellent
- **Android support**: Very few devices (Samsung S21+, Pixel 6 Pro+)
- **Battery**: Low
- **Verdict**: Too rare for MVP. Interface prepared for future.

### Accelerometer / Gyroscope / Magnetometer (IMU)
- **Accuracy**: Step detection 95%+, heading ±5–15°, distance accumulates drift
- **Indoor**: Always available — no special hardware
- **Android support**: All smartphones
- **Permissions**: None (sensors are always accessible)
- **Battery**: Low (hardware sensors, minimal CPU)
- **Verdict**: BEST available option for MVP indoor positioning.

### Step Counter (Hardware)
- **Accuracy**: 97%+ step detection
- **Indoor**: Always available
- **Android support**: All modern Android (TYPE_STEP_COUNTER since API 19)
- **Permissions**: ACTIVITY_RECOGNITION (Android 10+)
- **Battery**: Very low (hardware sensor)
- **Verdict**: Core component of PDR system.

### Pedestrian Dead Reckoning (PDR)
- **Method**: Step Counter × Stride Length + Heading from Magnetometer
- **Accuracy**: 2–5% of distance traveled before Map Matching correction
- **Drift**: Accumulates over time; corrected by Map Matching
- **Verdict**: Primary positioning algorithm for MVP.

### Map Matching
- **Method**: Project sensor estimate onto walkable corridor graph / room polygons
- **Accuracy**: Bounded by map geometry (player can't be in walls)
- **Verdict**: Essential correction layer. Server-authoritative.

### ARCore / Visual-Inertial Odometry
- **Accuracy**: High in controlled conditions
- **Android support**: ARCore-supported devices only (~200M of 3B+ Android)
- **Battery**: Very high (camera + GPU)
- **Privacy**: Camera access concerns
- **Verdict**: Too heavy, too narrow support for MVP.

### QR / Reference Points
- **Accuracy**: Depends on QR placement density
- **Indoor**: Good with physical markers
- **Verdict**: Requires physical setup at school. Future option.

## Recommended Architecture: IMU + Map Matching

### Why IMU-first
1. Available on ALL Android devices (no special hardware)
2. Low battery impact
3. No special permissions beyond ACTIVITY_RECOGNITION
4. Works indoors (no GPS dependency)
5. Combined with Map Matching, drift is bounded by corridor/room geometry

### Fallback Chain
```
UWB available?     → use (future, very rare)
BLE beacons?       → use (future, calibrated)
IMU + Step Counter → use (MVP primary)
GPS (outdoor)      → fallback only
Manual debug       → development/testing only
```

### Stride Length Estimation
- Default: 0.7m per step (average adult)
- Configurable in debug mode
- Future: estimate from user height/step frequency

### Heading from Magnetometer
- Raw magnetometer + accelerometer → tilt-compensated compass heading
- Smoothing: exponential moving average (α=0.3)
- Declination not corrected (simplified for MVP)

### Map Matching Algorithm
1. Check if point is inside any room polygon (point-in-polygon)
2. If inside room → accept position, set roomId
3. If outside rooms → snap to nearest corridor segment (if within threshold)
4. If too far from any corridor/room → reject update (keep last valid)

### Battery Considerations
- Step Counter: hardware sensor, negligible CPU
- Magnetometer: hardware sensor, negligible CPU
- Position updates sent to server: max 5/second (throttled)
- Network: only (x, y, heading, confidence) — ~60 bytes per update
- Total additional battery drain: < 5% per hour of gameplay

### Privacy
- No audio recording
- No camera usage
- No persistent storage of raw sensor data
- Sensor data → local processing → position estimate → raw data discarded
- Server receives only position estimates (x, y, heading, confidence)

## Testing Plan
1. Unit tests: point-in-polygon, snap-to-corridor, map matching
2. Integration tests: room membership computation, proximity calculation
3. E2E tests: position update flow, admin tracking auth
4. Device tests (manual): sensor availability, step detection accuracy, heading stability
5. Field test: walk through school, compare estimates with actual path

## Known Limitations (MVP)
- Drift accumulates without Map Matching anchor points
- Step length is averaged (not personalized)
- Magnetometer affected by metal structures in building
- No multi-floor support
- No elevation/altitude tracking
- Map Matching is 2D only
