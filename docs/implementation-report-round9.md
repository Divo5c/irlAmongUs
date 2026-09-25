# Implementation Report — Round 9

## Root Cause: Why the Map Was Wrong

The `MapCanvas` used a **1:1 pixel mapping** between world coordinates and canvas pixels:

```dart
static const Offset origin = Offset(600, 600);
Offset toCanvas(double x, double y) => origin + Offset(x, y);
```

This meant:
- Walking 10 meters in the real world → 10 pixels on screen (invisible)
- The grid was drawn in **pixel space** (0→size.width), completely disconnected from world coordinates
- The canvas was a fixed 1200×1200 pixels representing 1200×1200 meters — far too coarse for a school building
- Nodes were drawn at radius 7 (14px diameter) — comically large for a 1-meter-scale map
- No live host position marker during map scanning
- Room names required manual typing instead of auto-filling from RoomType

## What Changed

### 1. World→Canvas Transformation (`map_canvas.dart`)

**Before:** `toCanvas(x,y) = Offset(600,600) + Offset(x,y)` — fixed 1:1 pixel mapping.

**After:** `_w2c(x,y) = Offset(ox + x*ppm, oy + y*ppm)` — configurable scale + dynamic centering.

- `pixelsPerMeter = 8.0` (default) — 1 meter = 8 pixels
- Canvas dynamically sizes to fit all map content + padding
- Auto-centers on the bounding box of all nodes, rooms, pending points, and host position
- `InteractiveViewer` boundary margin increased to 10000 for large maps

### 2. Grid (`_paintGrid`)

**Before:** Fixed pixel-space grid (50px intervals), not aligned to world coordinates.

**After:** World-space grid with:
- Minor lines every 2 meters (0.5px stroke, 25% opacity)
- Major lines every 10 meters (1px stroke, 45% opacity)
- Grid follows world coordinates — consistent at any zoom/pan
- World origin marked with a small dot

### 3. Nodes + Corridors (`_paintCorridors`)

**Before:** Nodes at radius 7 (14px diameter), corridor stroke 8px.

**After:** Nodes at radius 3 (6px diameter), corridor stroke 4px with round caps. Corridors visually dominant over nodes.

### 4. Live Host Position (`_paintHostMarker`)

New marker drawn during MAP_SETUP:
- Outer ring (surface fill + tertiary border, radius 7)
- Inner dot (tertiary, radius 3)
- "YOU" label below the marker
- Only shown when `hostPosition` is provided (via `MapSetupScreen`)

### 5. Room Rendering (`_paintRooms`)

- Room polygon fill opacity reduced from 30% to 20% (less overwhelming)
- Room stroke reduced from 4px to 2px (cleaner edges)
- Door links reduced from 3px to 1.5px with round caps
- Room labels show only the room name (no redundant type label)

### 6. Pending Points (`_paintPending`)

- Pending lines: 3px stroke at 70% opacity (lighter than committed corridors)
- Pending dots: radius 3.5 (last point: 5) — smaller than committed nodes
- Room preview closing edge at 35% opacity

### 7. Room Type → Auto Name (`_saveRoomDialog`)

**Before:** Manual text field "Room 1" + separate RoomType dropdown.

**After:** Single dropdown for RoomType. Name auto-set from `roomTypeLabel(type)`:
- `CAFETERIA` → "Cafeteria"
- `MEDBAY` → "MedBay"
- `REACTOR` → "Reactor"
- etc.

The manual text field was removed.

### 8. Scanning UX (`_scanningHint`)

Context-sensitive hints:
- Corridor mode, no sensors: "Tap waypoints along your corridor"
- Corridor mode, 0 nodes: "Start walking and place your first waypoint"
- Corridor mode, N nodes: "Walk to the next corner and tap + Point"
- Room mode: "Tap the corners of the room"

### 9. Status Bar

Changed from "X pts · Y rooms" to "X corridors · Y rooms" — more meaningful during scanning.

## Coordinate System

```
World coordinates: 1 unit = 1 meter
Canvas pixels:     1 meter = pixelsPerMeter (8.0) pixels

World (0,0) → Canvas (ox, oy) where ox/oy center the map content
Heading: 0° (compass north) → +x in PDR, 90° (east) → +y in PDR
```

## Files Changed

| File | Change |
|------|--------|
| `app/lib/features/map/presentation/map_canvas.dart` | Complete rewrite: dynamic sizing, world-space grid, smaller nodes, host marker, scale |
| `app/lib/features/map/presentation/map_setup_screen.dart` | Host position passthrough, auto room name, UX hints, compact diagnostics |
| `app/test/widget_test.dart` | Updated status text assertions |

## Tests

- **flutter analyze:** 0 errors, 5 pre-existing warnings
- **flutter test:** 49/49 PASS
- **npm test:** 156/156 PASS
- **flutter build apk:** PASS (52.8 MB)

## APK

```
APK PATH: D:\Python\App-Projects\real-life-amongus\app\build\app\outputs\flutter-apk\app-release.apk
```

## Known Limitations

1. **No real hardware test** — The map rendering improvements are code-verified but not tested on a physical Android device during this round.
2. **Scale is fixed at 8px/m** — For very large buildings (>200m), the canvas may need panning. For very small areas, zoom may be needed. The InteractiveViewer handles this.
3. **No multi-floor** — Single floor only, as designed.
4. **Heading convention** — PDR heading 0° = +x (not compass north in screen coordinates). The host marker moves in the PDR coordinate frame.

## Next Steps

1. Test on real Android device — verify that walking + tapping produces a visible, sensible map
2. Adjust `pixelsPerMeter` if needed based on real-world feedback
3. Consider adding a "re-center" button for when the host pans away from their position
4. Room polygon mode: test walking along walls to create room outlines
