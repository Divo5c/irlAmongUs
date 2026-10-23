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
