# DESIGN.md – Real Life Among Us (PWA)

> Diese Datei ist die verbindliche Design- und Code-Vorgabe für alle UI-Arbeiten.
> Lies sie vollständig, bevor du irgendeine Datei im Frontend änderst.
> Bei Konflikten zwischen dieser Datei und deinem eigenen Geschmack gilt diese Datei.

---

## 0. Auftrag in einem Satz

Die App soll sich anfühlen wie die Benutzeroberfläche des echten Among Us: ein Raumschiff-Terminal mit dunklen, kantig-abgerundeten Tafeln, dicken hellen Rändern, runder freundlicher Schrift, klaren Farbsignalen (Rot = Gefahr, Gelb = Aufgabe, Grün = erledigt) und knackigem Feedback. Die Umsetzung muss **hochwertig und poliert** wirken, nicht wie ein Pixel-Retro-Spiel und nicht wie ein bunter Farbbaukasten.

**Nicht erwünscht:** Pixel-Art, 8-Bit-Schriften, Neon-Regenbogen, Standard-Material-/Bootstrap-Look, weiße App-Oberflächen, Emoji als Icons, generische SaaS-Cards.

**Rechtlicher Hinweis:** Verwende keine extrahierten Original-Assets (Sprites, Sounds, Logos, Schriftdateien aus dem Spiel). Zeichne alle Grafiken als **eigene SVGs** im Stil des Spiels (Bohnen-Silhouette mit Visier, Raumschiff-Panels). Die Anmutung ist „inspiriert von“, nicht „kopiert aus“.

---

## 1. Vor dem Programmieren (Pflicht)

1. **Bestehenden Stack erkennen.** Schau in `package.json`, Ordnerstruktur und vorhandene Client-Dateien. Die App ist weit fortgeschritten (Node.js + Socket.IO Server, Browser-PWA mit GPS/OpenStreetMap, getrennter Flutter-Client).
2. **Nichts neu schreiben.** Keine Framework-Migration, keine neue Build-Toolchain, keine Umbenennung von Socket-Events oder Server-Logik. Design wird in die vorhandene Struktur eingebaut.
3. **Der Flutter-/Android-Client ist nicht Teil dieser Aufgabe**, außer ich sage es ausdrücklich. Diese Datei gilt für die PWA.
4. **Die 216 Server-Tests müssen weiter grün bleiben.** Führe sie nach Änderungen aus. Design-Änderungen dürfen keine Spiel- oder Netzwerklogik berühren.
5. **Arbeite schrittweise:** erst Design-Tokens und Basis-Komponenten, dann Screen für Screen. Nach jedem Screen kurz prüfen, ob er mobil funktioniert.

---

## 2. Code-Regeln

### 2.1 Technik
- **Vanilla-first, passend zum Bestand.** Wenn die PWA bereits ein Framework nutzt, bleib dabei. Wenn nicht, dann reines HTML, modernes CSS und ES-Module. Kein neues UI-Framework einführen.
- **Kein Tailwind, kein Bootstrap, keine fertige Komponentenbibliothek.**
- **Keine Abhängigkeit von fremden CDNs zur Laufzeit.** Schriften, Icons und Bibliotheken werden lokal ausgeliefert, damit die PWA offline und bei schlechtem Mobilfunk startet.
- **Icons und Grafiken:** inline SVG oder ein einziges SVG-Sprite (`<use href="#icon-name">`). Keine Icon-Fonts, keine Emojis in der UI.
- **Kein Canvas für normale UI.** Canvas nur, wenn ein Minispiel es wirklich braucht.

### 2.2 CSS-Architektur
- **Ein zentrales Token-File** `styles/tokens.css` mit allen Farben, Abständen, Radien, Schatten, Schriftgrößen, Z-Index-Stufen und Animationszeiten als **CSS Custom Properties** auf `:root`.
- Weitere Dateien nach Aufgabe getrennt: `base.css` (Reset, Typografie), `components.css` (Buttons, Panels, Chips …), `screens/*.css` (Lobby, Karte, Meeting …), `motion.css` (Keyframes).
- **Keine Hex-Werte, Pixelwerte für Abstände oder Schriftgrößen außerhalb von `tokens.css`.** Immer `var(--…)` benutzen.
- Namensschema **BEM-artig**: `.panel`, `.panel__header`, `.panel--danger`. Keine tief verschachtelten Selektoren, keine IDs zum Stylen, kein `!important`.
- **Mobile-first** mit `min-width`-Media-Queries. Bevorzuge `clamp()`, `min()`, `max()`, Grid und Flexbox statt fester Breiten.
- Nutze `@layer reset, base, components, screens, utilities;`, um Spezifitätsprobleme zu vermeiden.
- Dunkles Design ist **das** Design, kein Theme-Schalter. Setze `color-scheme: dark;`.

### 2.3 JavaScript
- ES-Module, `const`/`let`, kein `var`. Kleine Funktionen, sprechende Namen.
- **UI-Rendering strikt getrennt von Netzwerk- und Spiellogik.** Socket.IO-Handler aktualisieren State, die UI reagiert auf State. Keine Spiellogik in Komponenten kopieren.
- Eine kleine Hilfsfunktion `el(tag, props, ...children)` oder `<template>`-Elemente statt String-Konkatenation mit `innerHTML`. **Nie unescapte Spielernamen in `innerHTML`** (XSS). Namen immer über `textContent`.
- Bildschirmwechsel über **ein einziges Attribut** (`data-screen="lobby"` am Root) und CSS, nicht über verstreutes `display:none` per JS.
- Animationen per CSS-Klassen/Attribute auslösen, nicht per `setTimeout`-Ketten.
- Event-Delegation für Listen (Spielerliste, Abstimmung).
- Keine neuen globalen Variablen. Keine Polling-Schleifen für UI.

### 2.4 Barrierefreiheit und Qualitätsgrenze
- Semantisches HTML: `<button>`, `<dialog>` oder `role="dialog"` für Overlays, `<progress>`/`role="progressbar"` für Fortschrittsbalken, `aria-live="polite"` für Chat und Statusmeldungen.
- **Sichtbarer Fokus** (`:focus-visible`, 3 px heller Ring) auf allen interaktiven Elementen.
- **Touch-Ziele mindestens 48 × 48 px.** Primäre Aktionen am unteren Bildschirmrand erreichbar mit dem Daumen.
- Kontrast Text/Hintergrund mindestens WCAG AA (4.5:1). Gefahr und Fortschritt **nie nur über Farbe**, immer zusätzlich Icon oder Text.
- `@media (prefers-reduced-motion: reduce)`: Wackeln, Pulsieren, Screen-Shake und Dauerblinken abschalten, Zustandswechsel bleiben sichtbar (z. B. statisches Rot).
- **Blinken maximal 3 Mal pro Sekunde** (Fotosensitivität). Sabotage-Alarm pulsiert weich (ca. 1 Hz), kein hartes Stroboskop.
- Safe Areas beachten: `padding: env(safe-area-inset-*)`, `viewport-fit=cover`, `height: 100dvh` statt `100vh`.
- Keine Zoom-Sperre. Text skaliert mit `rem`.

### 2.5 Performance (Spiel läuft draußen, Akku und GPS sind knapp)
- Nur `transform` und `opacity` animieren. Keine Layout-Animationen.
- `backdrop-filter`/Blur sparsam: maximal ein Blur-Overlay gleichzeitig.
- Keine dauerhaft laufenden Hintergrundanimationen auf dem Kartenscreen. Dort hat GPS/Karte Vorrang.
- SVGs klein halten, keine Rastergrafiken für UI. Schrift als `woff2`, nur benötigte Gewichte, `font-display: swap`.
- Service Worker: neue CSS/Font/SVG-Dateien in den Precache aufnehmen und Cache-Version erhöhen.

---

## 3. Visuelle Identität

### 3.1 Grundidee
Zwei Welten, die sich abwechseln:
- **Schiff (Standard):** tiefes Weltraum-Blau-Schwarz, Panels wie Wandterminals mit hellem Rand.
- **Alarm / Meeting:** das Schiff schaltet um. Sabotage taucht den Rand in Rot, das Meeting wechselt in einen hellen, ruhigeren Tisch-Raum (Cafeteria-Stimmung).

### 3.2 Farb-Tokens

Lege diese Werte in `tokens.css` an (Namen verbindlich, Werte dürfen minimal nachjustiert werden, wenn Kontrast es verlangt):

```css
:root {
  /* Weltraum / Schiff */
  --space-950: #070A14;
  --space-900: #0B1020;
  --space-800: #111A30;
  --space-700: #19243F;
  --space-600: #24325A;

  /* Panels (Tablet / Terminal) */
  --panel-fill: #1A2540;
  --panel-fill-raised: #223054;
  --panel-border: #C9D6EE;      /* heller Rand wie im Spiel */
  --panel-border-dim: #51638E;

  /* Text */
  --text-primary: #F2F6FF;
  --text-secondary: #A9B7D6;
  --text-disabled: #6B7898;

  /* Signalfarben */
  --signal-danger: #E5252A;     /* Sabotage, Impostor, Not-Knopf */
  --signal-danger-deep: #8E1216;
  --signal-task: #F5D84A;       /* Aufgaben, Hinweise */
  --signal-ok: #3DDC84;         /* erledigt, bereit */
  --signal-info: #4CC9FF;       /* Kommunikation, Cyan-Terminal */
  --signal-warn: #FF9A2E;

  /* Crewfarben (nur für Spieler-Identität) */
  --crew-red:    #C51111;
  --crew-blue:   #132ED1;
  --crew-green:  #117F2D;
  --crew-pink:   #ED54BA;
  --crew-orange: #EF7D0D;
  --crew-yellow: #F5F557;
  --crew-black:  #3F474E;
  --crew-white:  #D6E0F0;
  --crew-purple: #6B2FBB;
  --crew-brown:  #71491E;
  --crew-cyan:   #38FEDC;
  --crew-lime:   #50EF39;

  /* Meeting-Raum (heller Gegenpol) */
  --meeting-bg: #C9D4E6;
  --meeting-panel: #EEF3FB;
  --meeting-ink: #1A2238;
}
```

**Regeln zur Farbe**
- Fläche ist **dunkel und gedämpft**, Farbe ist **Information**. Maximal eine Akzentfarbe pro Screen im Vordergrund.
- Crewfarben ausschließlich für Spieler (Avatar, Name-Chip, Abstimmungs-Marker). Nie als Button- oder Dekorfarbe.
- Jede Crewfarbe bekommt eine **Schattierung** für den Körper (`color-mix(in oklab, var(--crew-x), black 28%)`), damit die Bohne plastisch wirkt, kein flaches Pixel-Rot.
- Keine Verläufe als Dekoration. Erlaubt: dezenter Verlauf im Weltraum-Hintergrund und Glanzkante auf Panels.

### 3.3 Typografie
- **Schrift:** runde, freundliche Grotesk. Der Look des Spiels kommt von einer Schrift wie **Varela Round**. Nutze eine lizenzfreie Variante (Varela Round oder Nunito, OFL), **lokal eingebunden als `woff2`**.
- Stack: `"Varela Round", "Nunito", ui-rounded, system-ui, sans-serif;`
- Zahlen (Timer, Codes): `font-variant-numeric: tabular-nums;`, damit Countdowns nicht springen.
- Skala als Tokens (`--fs-xs` … `--fs-display`), Basis 16 px, Verhältnis ca. 1.25. Display-Titel mit `clamp()`.
- Titel kräftig (Gewicht 700–800), Fließtext 400–600. **Satzschreibung** statt durchgehender Versalien. Versalien nur für kurze Statusstempel wie `SABOTAGE` oder `EMERGENCY MEETING`.
- **Textkontur wie im Spiel:** große Titel und Stempel mit dunkler Außenkontur (`paint-order: stroke fill; -webkit-text-stroke: 4px var(--space-950);`), dadurch lesbar auf jedem Hintergrund.
- Zeilenlänge unter 70 Zeichen, Zeilenhöhe 1.4–1.5.

### 3.4 Form, Rand und Tiefe
- **Radien:** Panels `--r-panel: 20px`, Buttons `--r-pill: 999px` oder `14px`, Chips `10px`. Nicht alles gleich rund machen: großer Container = großer Radius, kleines Element = kleiner Radius.
- **Der Among-Us-Panel-Look:** dunkle Füllung, **2–3 px hellgrauer Rand**, darum ein **äußerer dunkler Ring** (zweiter Rand, z. B. `box-shadow: 0 0 0 4px var(--space-950)`), innen dezente Glanzkante oben (`inset 0 2px 0 rgba(255,255,255,.12)`).
- **Ecken-Details:** kleine „Schrauben“ oder abgeschrägte Ecken per SVG-Maske/`clip-path` nur an großen Panels (Aufgaben-Tablet, Karten-Overlay), nicht überall.
- **Schatten:** ein weicher, tiefer Schatten pro Ebene (`--shadow-1/2/3`). Kein zufälliges Grau.
- **Hintergrund:** Weltraum aus `--space-950` mit sehr feinem, statischem Sternenfeld (CSS `radial-gradient`-Punkte oder ein SVG-Tile). Keine animierten Sterne auf dem Kartenscreen.

---

## 4. Komponenten

Baue zuerst diese Basiskomponenten, alle anderen Screens bestehen nur aus ihnen.

### 4.1 Button
- **Primär (Aktion, z. B. „Start“, „Aufgabe starten“):** helle Füllung (`--text-primary` auf `--space-900`-Rand, oder Gelb `--signal-task` für Aufgaben), fette Schrift, dunkle Außenkontur, **fühlbare Tiefe** durch untere dickere Kante (`box-shadow: 0 5px 0 rgba(0,0,0,.45)`). Beim Drücken `translateY(3px)` und Kante schrumpft.
- **Gefahr (Sabotage, Notfallmeeting):** `--signal-danger` mit hellem Rand.
- **Sekundär:** dunkle Panel-Füllung mit hellem Rand.
- **Deaktiviert:** entsättigt, `--text-disabled`, kein Schatten, `aria-disabled`.
- **Cooldown-Zustand** (Kill, Sabotage, Notfallknopf): Button zeigt kreisförmigen oder balkenförmigen Füllfortschritt plus verbleibende Sekunden als Zahl.

### 4.2 Panel
Basis für alles. Varianten: `--terminal` (blau-dunkel), `--danger` (rot getönt), `--meeting` (hell). Optionaler Header mit Titel links und Schließen-Button rechts.

### 4.3 Crewmate-Avatar (SVG)
- Eigene Bohnen-Silhouette: Körper, Rucksack, **Visier mit Glanz** (abgerundetes Rechteck, Cyan-Verlauf, weiße Reflexion), zwei Beine.
- Als **SVG-Symbol mit CSS-Variablen** (`--crew-body`, `--crew-shade`), damit alle 12 Farben aus einem Symbol entstehen.
- Zustände: `alive`, `dead` (Geist-Variante, halbtransparent, Knochen-Detail optional), `speaking` (Visier-Glühen), `voted` (kleines „Ich habe gewählt“-Abzeichen), `ejected`.
- Größen: `--avatar-s 32px`, `--avatar-m 56px`, `--avatar-l 120px`.

### 4.4 Spieler-Chip
Pillenform mit Mini-Avatar, Name (Ellipsis bei Überlänge, `max-width`), optional Statuspunkt (bereit / tot / Host). Name immer über `textContent`.

### 4.5 Fortschrittsbalken (Gesamt-Aufgaben)
Wie im Spiel: ein breiter Balken oben, dunkle Mulde, **grüne Füllung mit Glanzlinie**, Prozent daneben. Füllung per `transform: scaleX()`, weiche Übergangszeit 400 ms.

### 4.6 Timer
Große tabellarische Ziffern, Konturschrift. Unter 10 Sekunden färbt sich die Zahl `--signal-danger` und pulsiert dezent. **Kritische Sabotage hat 90 Sekunden**, der Timer ist dabei der dominante Bildschirmeintrag.

### 4.7 Toast / Hinweis
Kleine Panel-Leiste oben, gleiche Sprache wie Buttons („Aufgabe erledigt“). Gleiche Aktion heißt überall gleich. Fehlertexte nennen Ursache **und** Lösung („Du bist zu weit weg. Geh näher an den Raum.“), ohne Entschuldigung.

### 4.8 Bottom Sheet und Dialog
Für Rolle, Aufgabenliste, Einstellungen. Von unten einfahrend, Backdrop dunkel (kein Blur auf der Karte). Schließbar per Button, Geste und ESC.

### 4.9 Eingabefelder
Lobby-Code als **großes Feld mit Einzelzeichen-Kacheln** (Monospace-Ziffern über `tabular-nums`, Auto-Uppercase, `inputmode` passend, `autocomplete="off"`). Namensfeld mit Zeichenzähler.

---

## 5. Screens

Für jeden Screen gilt: ein klarer Hauptzweck, eine primäre Aktion, Rest zurückhaltend.

### 5.1 Start / Lobby-Beitritt
- Großes Titel-Lockup „Real Life Among Us“ mit Konturschrift, darunter Code-Eingabe und zwei Buttons: **Lobby beitreten** (primär), **Lobby erstellen** (sekundär).
- Hintergrund: Sternenfeld, langsam schwebende Silhouette einer Bohne im Visier-Licht ist erlaubt (einzige Daueranimation der App, nur hier).

### 5.2 Lobby
- Oben: Lobby-Code groß und kopierbar.
- Mitte: **Spielerraster** der Crew-Avatare (wie die Wartelobby der Dropship), jeder mit Namens-Chip. Host trägt Krone/Stern-Abzeichen.
- Farbwahl als Raster der 12 Crewfarben, vergebene Farben ausgegraut.
- Unten: Host sieht **Spiel starten** (Gelb, groß), andere sehen „Warte auf den Host“. Einstellungen (übernommene Karte, letzte Einstellungen) in einem Sekundär-Panel.

### 5.3 Rollen-Enthüllung
Kurze, dramatische Sequenz, **die eine Hero-Animation der App**:
- Schwarzer Bildschirm, Titel „Du bist ein Crewmate“ bzw. „Impostor“, die Hintergrundfarbe wechselt (Crew: kühles Cyan-Blau-Licht, Impostor: Rot).
- Avatare erscheinen gestaffelt. Bei Impostor werden Mit-Impostor rot hervorgehoben.
- Die Rollenanzeige bleibt bis zur Bestätigung stehen. Tippen oder „Weiter“ öffnet das HUD.
- Bei `prefers-reduced-motion`: statisches Bild mit Einblendung.

### 5.4 Haupt-HUD mit Karte (der wichtigste Screen)
- **Karte füllt den Bildschirm.** Alles andere liegt als schlankes Overlay darüber.
- **Oben:** Gesamt-Fortschrittsbalken, daneben kleine Statusanzeige (GPS-Genauigkeit als Icon plus Balken).
- **Unten links:** kompakte **Aufgabenliste** (aufklappbar). Offen = gelb markiert, erledigt = grün mit Haken und durchgestrichen.
- **Unten rechts:** Aktionsbuttons, **rund und groß wie im Spiel**: `Benutzen`, `Melden`, bei Impostor zusätzlich `Kill` und `Sabotage`. Nicht verfügbare Buttons bleiben sichtbar, sind aber entsättigt (Cooldown-Ring). So lernt man die Positionen.
- **Karten-Styling:** Die OSM-Basiskarte wird **abgedunkelt und entsättigt** (CSS-Filter auf der Tile-Ebene oder dunkler Style), damit Spielmarker leuchten. Straßen als helle, dünne Linien auf `--space-800`.
- **Räume** erscheinen als halbtransparente Zonen mit hellem gestrichelten Rand. **Beschriftungen zeigen per Pfeil auf den jeweiligen Raum** (bestehendes Feature bleibt erhalten): Label als kleines Panel, Pfeil als SVG-Spitze, kollisionsarm platziert.
- **Spielermarker:** der eigene Spieler als Avatar mit Pulsring in Crewfarbe, andere nur wenn Spielregeln es erlauben. Tote als Geister-Avatar.
- **Aufgaben-Marker:** gelbes Ausrufezeichen-Symbol (SVG) mit leichtem Glühen, wird bei Nähe größer und aktiviert den `Benutzen`-Button.
- **Nähe-Feedback:** ist ein Ziel in Reichweite, leuchtet der passende Aktionsbutton auf und der Marker bekommt einen Ring. Außer Reichweite: dezenter Hinweis „Zu weit weg“.

### 5.5 Aufgaben / Minispiele
- Öffnet als **Vollbild-Terminal-Panel** über der Karte (wie die Wandtablets im Spiel): dunkles Panel, heller Rand, Titel oben links, Schließen oben rechts.
- Jedes Minispiel nutzt dieselbe Rahmenkomponente, nur der Inhalt wechselt.
- Interaktionen **groß, griffig, mit sofortigem Feedback**: Treffer = grüner Impuls + kurzer Ton, Fehler = kurzes Rütteln + rotes Aufblitzen (Reduced-Motion: nur Farbwechsel).
- Abschluss: Häkchen-Animation, Panel schließt, Toast „Aufgabe erledigt“, Fortschrittsbalken wächst sichtbar.

### 5.6 Sabotage (Alarm)
- **Sofortiger Moduswechsel:** roter, weich pulsierender Rahmen um den ganzen Bildschirm (`inset box-shadow`, ca. 1 Hz), oben ein Alarmbanner mit Titel, betroffenem Raum (mit Pfeil-Verweis auf der Karte) und Timer.
- **Kritische Sabotage:** 90-Sekunden-Countdown, rot, groß, dominanter Bildschirmeintrag. Zusätzliche Anzeige, was zu tun ist („Geh zum Reaktor und halte beide Handflächen“ bzw. das tatsächliche Reparaturziel).
- Nicht-kritische Sabotage: kleineres Banner, Rahmen nur als roter Akzent.
- Nach Reparatur: Rahmen blendet in 600 ms aus, grünes „Repariert“-Toast.

### 5.7 Meeting – Cafeteria
- **Einleitung:** „EMERGENCY MEETING“ bzw. „Leiche gefunden“ als roter Stempel, Konturschrift, mit kurzem Impact (Scale-Bounce). Danach Wechsel zum Tisch.
- **Cafeteria-Raum:** Hier ist der Moment, in dem das Design **hell** wird (`--meeting-bg`). Die Spieler sitzen als Avatare in einem Halbkreis oder Raster um einen runden Tisch (SVG-Ellipse als Tisch).
- Die Meeting-Phase **führt über die Cafeteria zur Abstimmung** (so ist es im Spiel implementiert). Das UI zeigt klar die aktuelle Phase: **Treffen → Diskussion → Abstimmung**, mit Timer.

### 5.8 Abstimmung
- Raster aus **Spielerkarten** (Avatar, Name, Status). Tote Spieler ausgegraut, nicht wählbar.
- Auswahl: Karte hebt sich, bekommt Rand in `--signal-info`, unten erscheint **Bestätigen** (✓) und **Abbrechen** (✕) als große runde Buttons. Zusätzlich Karte „Überspringen“.
- Nach Abgabe: kleines **„Ich habe gewählt“-Abzeichen** am Avatar, nicht wer wen gewählt hat (bis zum Ergebnis).
- **Ergebnis:** Stimmen erscheinen nacheinander als kleine Avatar-Marker an der Karte des Gewählten. Bei Mehrheit folgt die Auswurf-Sequenz.

### 5.9 Auswurf-Sequenz
Dunkler Weltraum, die Bohne treibt rotierend durchs Bild, Text darunter: „X war ein Impostor“ / „X war kein Impostor“ (je nach Server-Einstellung). Typewriter-Effekt für den Text, ca. 4 s, überspringbar.

### 5.10 Spielende
Großes Banner **„Crew gewinnt“** (Cyan-Blau) oder **„Impostor gewinnt“** (Rot), darunter alle Spieler mit enthüllter Rolle, Aufgabenstand und Kills. Primärer Button „Zurück zur Lobby“.

### 5.11 Tot / Geist-Modus
Bildschirm leicht entsättigt, kühler Ton, Geister-Avatar, Hinweisleiste „Du bist ausgeschieden. Du kannst weiter Aufgaben erledigen“ (nur, wenn die Spielregeln das erlauben). Aktionsbuttons entsprechend reduziert.

---

## 6. Bewegung

Gesamtprinzip: **wenig, aber bedeutungsvoll.** Bewegung antwortet auf Aktionen oder markiert dramatische Spielmomente. Keine Einblend-Animation für jedes Element.

| Moment | Bewegung | Dauer |
|---|---|---|
| Button drücken | Tiefe nach unten | 80 ms |
| Panel öffnen | Scale 0.96→1 + Fade | 180 ms |
| Bottom Sheet | von unten einfahren | 240 ms |
| Aufgabe erledigt | Haken zeichnen (stroke-dashoffset) | 350 ms |
| Fortschrittsbalken | scaleX | 400 ms |
| Rollen-Enthüllung | gestaffelt (Hero-Moment) | ca. 3 s |
| Meeting-Stempel | Scale-Bounce | 400 ms |
| Sabotage-Rahmen | Puls ca. 1 Hz | Dauerschleife |
| Auswurf | Rotation + Drift | ca. 4 s |

Easing-Tokens: `--ease-out: cubic-bezier(.2,.8,.2,1)`, `--ease-bounce: cubic-bezier(.34,1.56,.64,1)`. Alles komplett abschaltbar über `prefers-reduced-motion`.

---

## 7. Ton und Haptik

- **Sound** (optional, per Schalter, standardmäßig an, aber erst nach der ersten Nutzerinteraktion wegen Autoplay-Regeln): kurze UI-Klicks, Aufgabenfertig-Ton, Alarmton bei Sabotage, Meeting-Gong. Eigene oder lizenzfreie Sounds, **keine Original-Spielsounds**. Dateien klein (`.ogg`/`.mp3`, wenige KB), lazy geladen, im Service Worker gecacht.
- **Vibration** (`navigator.vibrate`, nur wo unterstützt, mit Feature-Check): kurzer Impuls bei Aufgabe erledigt, Doppelimpuls bei Sabotage, langer Impuls bei Meeting. Einstellbar.
- Beides ist **Zusatz**, nie einzige Information.

---

## 8. Texte (Copy)

- Deutsch, du-Form, kurz, aktive Verben, Satzschreibung.
- Button sagt, was passiert: „Aufgabe starten“, „Abstimmen“, „Lobby erstellen“. Nicht „OK“ oder „Senden“.
- Rollen- und Statusstempel dürfen englisch bleiben, wenn sie so auch im Spiel stehen (`EMERGENCY MEETING`, `SABOTAGE`), sonst konsistent deutsch.
- Ein Begriff pro Sache, überall gleich (z. B. immer „Aufgabe“, nie mal „Task“, mal „Auftrag“).
- Fehlermeldungen: Was ist passiert, was tun? Keine Entschuldigungen, keine Fachbegriffe wie „Socket disconnected“. Stattdessen „Verbindung verloren. Wir verbinden dich neu.“
- Leere Zustände geben eine Handlung vor („Noch keine Spieler. Teile den Code.“).

---

## 9. Responsives Verhalten und PWA

- **Primär Smartphone Hochformat (360–430 px Breite).** Querformat muss benutzbar sein (Aktionsbuttons seitlich), Tablet/Desktop zentrierter Container mit max. Breite, kein unendliches Strecken.
- Wichtige Bedienelemente im unteren Drittel (Daumenzone).
- PWA: `manifest.webmanifest` mit `display: standalone`, `theme_color: #0B1020`, `background_color: #070A14`, Icon-Set mit eigener Bohnen-Silhouette als Maskable-Icon.
- Statusleiste und Splash in `--space-900`, damit der Start nahtlos wirkt.
- Wake Lock (falls schon vorhanden) und GPS-Hinweise visuell dezent, GPS-Verlust wird **sichtbar und erklärend** angezeigt (Banner, nicht nur Icon).
- Offline/Verbindungsverlust: eigenes Banner und **Wiederverbinden-Zustand**. Räume und Sessions liegen serverseitig nur im Arbeitsspeicher; deshalb bei verlorener Sitzung klare Meldung mit Weg zurück zur Startseite.

---

## 10. Arbeitsweise und Abnahme

### Reihenfolge
1. `tokens.css`, Schrift lokal einbinden, `base.css`.
2. Basiskomponenten (Panel, Button, Chip, Avatar-SVG, Fortschritt, Timer, Toast).
3. Screens in dieser Reihenfolge: Haupt-HUD → Meeting/Abstimmung → Lobby → Sabotage → Rollen-Enthüllung → Auswurf/Ende → Rest.
4. Zum Schluss Bewegung, Sound, Haptik, Feinschliff.

### Definition of Done (jede Änderung prüfen)
- [ ] Keine Hex-Werte und keine losen Pixel außerhalb von `tokens.css`
- [ ] Keine Änderung an Socket-Events, Payloads oder Serverlogik
- [ ] Alle 216 Server-Tests grün
- [ ] Funktioniert bei 360 px Breite ohne horizontales Scrollen
- [ ] Touch-Ziele ≥ 48 px, Fokus sichtbar
- [ ] Spielernamen nur über `textContent`
- [ ] `prefers-reduced-motion` getestet
- [ ] Kein Blinken über 3 Hz
- [ ] Keine externen Laufzeit-CDNs, neue Dateien im Service-Worker-Cache
- [ ] Kartenscreen läuft flüssig, keine Dauerblur-Effekte
- [ ] Alle Texte in einheitlicher Wortwahl
- [ ] Keine Original-Assets aus Among Us verwendet

### Wenn etwas unklar ist
Triff die Entscheidung, die am ehesten zur Optik eines **dunklen Raumschiff-Terminals mit klaren Signalfarben** passt, halte sie im Code mit einem kurzen Kommentar fest, und liste am Ende deiner Arbeit alle getroffenen Annahmen auf. Frage nur dann nach, wenn eine Entscheidung Spiel- oder Netzwerklogik betrifft.

---

## 11. Verboten (Kurzliste)

- Pixel-Fonts, 8-Bit-Optik, Retro-Sprites
- Helle App-Oberfläche außerhalb der Meeting-Phase
- Regenbogen- oder Neonfarbschemata
- Emojis als UI-Icons
- Standard-Framework-Look (Material, Bootstrap, Tailwind-Defaults)
- Gleiche Card-Optik für alles, identischer Radius überall
- Animierter Dauer-Hintergrund auf dem Kartenscreen
- Original-Grafiken, -Sounds oder -Schriften aus Among Us
- Änderungen an Server, Tests oder Spielregeln im Rahmen dieser Aufgabe
