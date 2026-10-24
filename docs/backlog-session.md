# Backlog Nächste Session (v17 → v18)

## Bugs (v17 Feedback)
1. **Tasks nicht abhakbar für... falsche Leute**: Eigene Tasks SOLL abhakbar sein? User: "Man soll seine eigenen Tasks nicht als erledigt markieren können" → Erwartung: **Use-Button am Task-Marker** (ortsgebunden), NICHT Knopf in Liste. Liste zeigt nur Status.
2. **Eigene Position live auf Karte**: selfPos kommt nur bei position:confirmed (~alle 2 s) → schnelleres Redraw; Marker glühen bei onCorridor.
3. **Task-Feedback fehlt**: Nach Use → "Task erledigt!"-Toast/Vibration (task:complete Retry bei error).
4. **Impostor kann Fake-Tasks nicht abhaken**: Server `completeTask` wirft/greift? Prüfen: fake ids enden auf `-fake` — vielleicht Task-NOT-FOUND durch Catalog-Suffix. Fix + Fake-Complete wirkt NICHT auf Progress (schon gefiltert).
5. **Use-Button fehlt beiden Rollen** — im Spiel zeigen bei Task-Nähe (In-Radius ~3 m um Task-Marker) und neben Meeting-Room (CAFETERIA) für Notfall-Meeting.

## Sabotage (Impostor)
- Runder **Sabotage-Button** (Impostor, separater Kreis neben Kill).
- **Kritische Räume required zum Starten des Spiels**: O2, ADMIN, CAFETERIA (Meeting + Sabotage), REACTOR (+ ?) müssen auf der Karte existieren, sonst MAP_VALIDATION-Fehler mit Hinweis.
  - At-Mindest: Warnung; Härte diskutieren.

## Sabotage-Mechaniken (Erinnerung Original-Among-Us)
- **Reactor Meltdown**: Countdown ~30 s; ZWEI Crewmate müssen gleichzeitig (A+B-Pad) den Reactor halten → Sole-Repair-UI: Stehen in金斯 REACTOR-Raum und beide alive drücken Fix im Zeitfenster; schieelter → Impostor win? Nein: Tot ab Countdown-Ende = IMPOSTOR-Sieg. UI: Vollbild "REACTOR MELTDOWN 23s" + beide Pads (im geschichten: nur physische Nähe zum Reactor-Raum).
- **O2-Depletion**: Countdown ~30 s; FIX an ZWEI Orten: O2-Raum + ADMIN (beide Codes eingeben: 4-Ziffern-Code erscheint auf dem Sabotage-Overlay bzw. random pro Round). Wie Among Us: zwei Panels mit Code.
- **ADMIN/Sabotage-rolle**: In Admin-Raum kann man die Live-Map (Karte der Spieler-Positionen in Räumen) anschauen — das ist das ADMIN-Tablet-Feature (Für IMPbart: "IMPOSTer kann Admin-Tablet nutzen um Gruppen zuайcah"). Und Admin ist auch Fixort für O2.
- **Meeting: Notfall-Button** = Use bei CAFETERIA (Physicalish) + Moderator Brook IRQ kill kills etc.
- **Sonne-Zauber**: Lights sabotage (ELECTRICAL fix) im Original auch EventBus — spare für später.

## Richtige Raumnamen (kein Freitext!)
Room-Type bestimmt Namen automatisch: CAFETERIA=»Cafeteria«, REACTOR=»Reactor«, ADMIN=»Admin«, O2=»O2«, MEDBAY=»Medbay«, ELECTRICAL=»Electrical«, SECURITY=»Security«, STORAGE=»Storage«, WEAPONS=»Weapons«, NORMAL=»Name frei«. UI: Name-Input nur bei NORMAL aktiv (disabled sonst, Auto-Fill).

## Prio morgen
1. Use-Button (Task-Orte serverseitig: tasks bekommen x/y via CUT room anchors) + Fake-Task-fix + Task-Toast.
2. Sabotage: REACTOR-Zwei-Spieler-Gate + O2-Zwei-Code-Fix + Meetings via CAFETERIA.
3. Raum-Pflichtvalidierung vor Start.
4. Live-Position smoother (Feder + 1s Redraw interpollen).

---

## Session 2026-10-25 (Second AI day, 13h) \u2014 v19.1 deployed
Alle Items der ersten Prio sind FERTIG und live:

### Done (v18\u2192v19\u2192v19.1)
- Sabotage-Engine komplett: REACTOR (2 Crew zusammen im Reactor fixen),
  O2 (Fix an O2 UND Admin), LIGHTS (Fix in Electrical, Leichen unsichtbar,
  Map gedimmt f\u00fcr Crew), COMMS (Fix in Communications, Taskliste/Marker
  weg f\u00fcr Crew). Meetings clearen laufende Sabotagen. Impostor bekommt
  Sabotage-Auswahl-Overlay (je nach gemappten R\u00e4umen). Bots fixen mit.
- Notfall-Meeting: Use-Button in CAFETERIA, 1\u00d7 pro Spieler pro Runde.
- Task-Orte + Minispiele: 19 echte Minigames in tasks.js (Fix Wiring mit
  Drag-Kabeln, Swipe Card mit Tempo-Check, Upload/Hold, Calibrate-3-Ringe,
  Start Reactor Simon, Unlock Manifolds 1-10, Enter ID Code, Reset Breakers
  1-7, Chart Course Zickzack, Clean O2 Filter Bl\u00e4tter, Empty Garbage Hebel,
  Divert Power Regler, Align Engine Zeiger, Stabilize Steering Fadenkreuz,
  Clear Asteroids Klick-Jagd, Prime Shields Hexagone, Inspect Sample mit
  Wartezeit, Submit Scan 12s, Fuel Engines Halten).
- Task-Verteilung nach Raumtyp: ROOM_TASKS in taskCatalog.js \u2014 CAFETERIA
  bekommt Garbage/Wiring/Divert, ADMIN Swipe/Upload/ID, REACTOR
  Simon/Manifolds, O2 Filter/Garbage, ELECTRICAL Distributor/Breakers,
  MEDBAY Sample/Scan, NAVIGATION Chart/Steering etc. Normale R\u00e4ume
  bekommen den General-Pool.
- Kein \u201eErledigt\u201c-Button mehr: Tasks in der Liste + Marker auf der Karte
  antippbar \u2192 Minigame \u2192 Server-Gate (4m / gleiches Zimmer / roomId).
  Use-Button zeigt echten Tasknamen, \u00f6ffnet das Minigame.
- Karte gr\u00f6\u00dfer: Portrait 52dvh, Landscape 66dvh.
- Eigene Position: sanfter Marker mit Heading-F\u00e4hnchen auf Live-Map.
- Serverseitig: tasksPerCrewmate auf max 6 gedeckelt (config bounds).
- Tests: 137\u2013148 pro Run gr\u00fcn (Timer-Flakes in socketServer bleiben
  bekannt: rejoin/meeting-Timer brauchen Wartezeit unter Last).

### N\u00e4chste sinnvolle Schritte (Prio neue Session)
1. Zwei stufige Tasks (Download \u2192 Upload, Fuellen \u2192 Tanken) \u2014 Server
   unterst\u00fctzt Single-Step, w\u00e4re ein eigener Task-Flow mit stageState.
2. kommunikations-Sabotage Code-Eingabe am Panel (Mini) statt nur Press.
3. Kill-Richtungspfeil: Crew sieht wo der Kill passierte als Leuchen.
4. Task-Marker-Cluster bei \u00fcberlappenden Spots in einem Raum ab\u00e4ndern.
5. Sound-Bank: verschiedene beeps fuer sabotage/fix/task/gameover.
