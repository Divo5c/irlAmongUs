# Map-System (Runde 5)

Die Karte ist die Grundlage der langfristigen Kette:

```text
Map → Player Position → Room Detection → Proximity → Kill / Report / Tasks
```

Sie ist bewusst **2D, eine Etage, manuell vom Host gezeichnet** (kein GPS,
kein CV-„Scan"). „Scannen" heißt: Der Host läuft durch die reale Umgebung und
bildet Gänge und Räume als vereinfachte Graph-/Polygonstruktur ab.

## 1. Datenmodell (`shared/models/map.schema.json`)

```text
GameMap
 ├── version        int    – Server setzt bei jedem Save +1
 ├── width/height   float? – informativ
 ├── nodes[]        { id, x, y }                     Korridor-Wegpunkte
 ├── corridors[]    { id, a, b }                     Kanten zwischen Knoten
 ├── rooms[]        { id, name, type, polygon[3..40 Punkte] }
 └── connections[]  { roomId, nodeId }               „Türen": Raum ↔ Gang
```

- Weltkoordinaten: freie Einheiten (±50000), **keine Bildschirmpixel**.
  Clients rendern mit Pan/Zoom (InteractiveViewer) und auto-fit.
- IDs: `^[A-Za-z0-9_-]{1,24}$`, serverseitig auf Eindeutigkeit geprüft.
- Räume sind implizit geschlossen (letzter Punkt → erster).
- `connections`: Jeder Raum sollte mit mindestens einem Gangknoten verknüpft
  sein. Der Editor verknüpft automatisch mit dem nächstgelegenen Knoten.

## 2. RoomType (Spielrolle eines echten Raums)

`NORMAL, CAFETERIA, MEDBAY, SECURITY, REACTOR, ELECTRICAL, STORAGE, ADMIN,
O2, WEAPONS` (siehe `enums.schema.json $defs.RoomType`).

Bewusst **nur Metadaten**: SECURITY hat noch keine Kameras etc. Später kann
pro Typ Verhalten implementiert werden (Tasks, Sichtlinien, Meeting-Punkt),
ohne das Datenmodell zu ändern.

## 3. Lebenszyklus & Server-Autorität

```text
LOBBY --host: map:start--> MAP_SETUP --host: map:save--> MAP_READY
                                 ↑  │
                    host: map:edit┘  └─ host: game:start --> IN_GAME
```

- **Nur der Host** darf `map:start/update/save/edit` senden (Server prüft
  Host-Rolle anhand der Socket-Session, nicht anhand von Payloads).
- `map:update` überträgt einen **atomaren Voll-Snapshot** des Entwurfs.
  Der Server validiert komplett (`sanitizeGameMap`) und hält die Karte im
  Room-State — Clients sind nur Darstellung.
- `map:save` validiert erneut (+ Minimum: ≥1 Korridor über ≥2 Knoten),
  erhöht `version` und setzt den Raum auf `MAP_READY`. Bestätigung an den
  Host: Event `map:saved`.
- `game:start` ist nur aus `MAP_READY` möglich, sonst `MAP_REQUIRED`.
- Während `MAP_SETUP` ist Config gesperrt (`CONFIG_LOCKED`); in `MAP_READY`
  darf der Host sie weiterhin ändern.
- Joining ist in LOBBY/MAP_SETUP/MAP_READY möglich.

### Events

| Event | Richtung | Inhalt |
|---|---|---|
| `map:start` | C→S (Host) | `{code}` |
| `map:update` | C→S (Host) | `{code, map}` (vollständiger Snapshot) |
| `map:save` | C→S (Host) | `{code, map?}` |
| `map:edit` | C→S (Host) | `{code}` (MAP_READY → MAP_SETUP) |
| `room:updated` | S→C | enthält `status`, komplette `map`, … |
| `map:saved` | S→C | `{code, version, status}` |

## 4. Limits (`MAP_LIMITS` in `server/src/game/map.js`)

300 Nodes · 600 Corridors · 30 Rooms · 40 Polygonpunkte/Room ·
±50000 Koordinaten · Namen ≤ 40 Zeichen. Verstöße → `MAP_INVALID{field}`.

## 5. Rejoin

Der Map-State liegt serverseitig und ist Teil jeder öffentlichen Projektion.
Ein Rejoin (`room:rejoin`) liefert daher sofort: Status (`MAP_SETUP` →
Waiting-UI bzw. Editor beim Host; `MAP_READY` → Kartenansicht), die komplette
Karte inkl. `version`. Rollen/Tasks werden weiterhin privat wiederhergestellt.

## 6. Rematch

`resetToLobby` verwirft Runden-Daten, **behält aber die gespeicherte Karte**
(das echte Gebäude ändert sich nicht). Mit Map landet der Rematch direkt in
`MAP_READY`; ohne Map (nie passiert nach Runde 5) wäre es `LOBBY`.

## 7. Geheimhaltung

Die Karte ist **öffentlich** (alle sehen dieselbe Schule). Geheim bleiben:
Rollen, Einzelstimmen, interne Timer/Kill-Daten, Session-Tokens.

## 8. Vorbereitung für Spielerpositionen (später)

Geplant (noch NICHT implementiert):

```text
PlayerPosition { playerId, x, y, roomId?, updatedAt, confidence? }
```

Die Struktur von nodes/corridors/rooms/connections ist so gewählt, dass
später aus einer Position per Point-in-Polygon + Graph-Distanz der Raum und
die Nähe zu anderen Spielern serverseitig berechnet werden kann. Die
PROXIMITY-HOOKs in `killPlayer`/`reportBody` nehmen dann eine Zone-Prüfung auf.

## 9. Bewusst nicht Teil dieser Phase

GPS/BLE/UWB/Sensorfusion · Multi-Floor · Kamera-Erkennung · Task-Orte auf der
Karte · Admin-Spielertracking · Offline-Editing.
