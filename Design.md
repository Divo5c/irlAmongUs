# Design.md — universelles Design-System (Dark Glass, Akzent Rot)

Wiederverwendbare Design-Spezifikation, abgeleitet aus dem Cucuri-Look (SpaceEdu-Redesign).
Gültig für jede Website/App: Die Regel lautet **Design = Tokens + Komponenten-Rezepte**, nie
hartkodizierte Farben. Eine andere KI kann mit diesem Dokument jedes Produkt im selben Stil bauen,
indem sie nur die Token-Werte einsetzt. Akzentfarbe hier: **ROT** (statt Blau/Cyan).

---

## 1. Design-Philosophie

1. **Dark-First:** Fast schwarzer, leicht getönter Hintergrund; Layout atmet durch Dunkelheit, nicht durch Linien.
2. **Glassmorphism subtil:** Karten sind halbtransparent, 1px helle Kontur, großer weicher Schatten, leichtes Backdrop-Blur. Nie milchig, nie undurchsichtig.
3. **Ein Akzent, sparsam:** Rot kenntzeichnet Interaktion (Fokus, aktive Elemente, Links, Sprech-Status). Alles andere ist Weißtöne auf Dunkel. Akzentfläche < 10 % der Seite.
4. **Serif als Logo-/Titelschrift, neutrale Grotesk als Text:** eleganter "Editorial"-Kontrast statt Standard-Windows-Look.
5. **Pill statt Kante:** Buttons, Badges, Umschalter sind Kapseln (border-radius: 999px); Panels sind weich gerundete Karten (22px).
6. **Primär-Button = glänzendes Weiß-Pill ("glossy"), kein Akzentfarb-Button:** der Akzent ruft, das CTA leuchtet. Das hält die Seite ruhig und macht CTAs unverwechselbar.
7. **Dekorativer Textur-Grid:** hauchfeines Linienraster über dem Hintergrund (soft-light, opacity ~0.25–0.35), nie sichtbar störend.
8. **Motion dosiert:** nur translateY(-1px) bei Hover, 0.15–0.4s ease Übergänge, respect `prefers-reduced-motion`.
9. **Status erklären sich nicht nur über Farbe:** Badges mit Text, Icons zusätzlich; Farben sind Verstärker, nicht einzige Information.

---

## 2. Farbsystem (Akzent: ROT)

### 2.1 Basis (dunkel)

| Token         | Wert                     | Verwendung                              |
| ------------- | ------------------------ | --------------------------------------- |
| `--bg0`       | `#1a0a0f`                | Hintergrund außen (fast schwarz, rot getönt) |
| `--bg1`       | `#2a1018`                | Hintergrund Mitte (Verlaufs-Zwischenton) |
| `--card`      | `rgba(32, 12, 20, 0.78)` | Glas-Kartenfläche                       |
| `--card-border` | `rgba(255, 255, 255, 0.14)` | Karten-/Panel-Kontur                |
| `--rule`      | `rgba(255, 255, 255, 0.23)` | Trennlinien unter Header              |

Grund-Verlauf: `linear-gradient(var(--bg0), var(--bg1) 55%, var(--bg0))`
plus ein **radialer Schein** oben mittig in Akzentfarbe (10–14 % Alpha):
`radial-gradient(1100px 500px at 50% -10%, rgba(255, 71, 87, 0.14), transparent 60%)`

Alternativ darf `--bg0/--bg1` neutral-schwarz bleiben (`#0b0a0d`), wenn das Produkt warmere Töne ablehnt — entscheide pro Projekt, aber halte Kontrast >= WCAG AA.

### 2.2 Text

| Token    | Wert                        | Verwendung                         |
| -------- | --------------------------- | ---------------------------------- |
| `--ink`  | `#ffffff`                   | Primärtext                         |
| `--muted`| `rgba(255, 255, 255, 0.68)` | Sekundärtext, Beschreibungen       |
| `--faint`| `rgba(255, 255, 255, 0.48)` | Meta, Zeitstempel, Hints           |

### 2.3 Akzent (ROT-Skala)

Role   | Hex          | rgba (für Glow/Fills) | Verwendung
------ | ------------ | --------------------- | ----------------------------------
Akzent | `#ff4757`    | `rgba(255, 71, 87, x)`| Links, Fokus, aktive Zustände, Highlights
Akzent hell | `#ff8d98` | `rgba(255, 141, 152, x)` | Text auf Dunkel wenn Akzent zu grell
Akzent dunkel/gebacken | `#c92030` | –           | Hover-Vertiefung / große Flächen
Akzent-Pastell | `#ffd7dc` | –                 | Badges-Text auf Akzent-Glas

Empfohlene Glow-Intensitäten (wie im Original): 0.2–0.45 Alpha, Reichweite 10–26px
(`box-shadow: 0 0 10/12/14/16/26 px rgba(255,71,87, .2–.45)`).

### 2.4 Semantik (kollidiert NICHT mit Akzent, weil Ton/strength – und immer Text + Icon dazu)

| Rolle     | Palette                                   | Regeln                                            |
| --------- | ----------------------------------------- | ------------------------------------------------- |
| Danger/Fehler | `#c92030` + Text `#ff8d98`, Glas `rgba(201,32,48,.12)` | dunkler & satter als Akzent, panic-Kontext |
| Warnung   | Gold/Amber-Verlauf `#ffd166 → #ff9a3c`    | nur Fortschritt, Budget, protective UI            |
| Erfolg    | `#4ade80` (sparsam!)                      | Bestätigungen, wird sonst selten verdient         |
| Info/neutral | Weißtöne (muted/faint)                 | Standardtext, Listen                              |

**Kollisionsregel:** Akzent-Rot und Fehler-Rot nutzen dieselbe Familie — deshalb:
Fehler NIE rein über Farbe (Icon `⚠` oder Text inklusive), und Fehlerflächen sind
dunkler (`#c92030`) während interaktiver Akzent hell (`#ff4757`) bleibt.

### 2.5 Button-Tinte auf glänzendem Weiß

`--btn-ink: #2a1018` (dunkel, warm — nicht schwarz), damit der CTA-Text zur background-Familie passt.

---

## 3. Typografie

| Rolle        | Font             | Fallback                     | Gewicht |
| ------------ | ---------------- | ---------------------------- | ------- |
| Display/Titel | Serif (Prata, Georgia, serif) | Georgia, serif | 400     |
| Body/UI      | Grotesk (Hanken Grotesk) | system-ui, Segoe UI, sans | 400–700 |
| Logo/Wordmark | Poppins (geometrisch)    | sans-serif            | 500–600 |
| Tech/Game/Spezial | Orbitron          | monospace                 | 400–900 |

Konkret umgesetzte Weights (self-hosted WOFF2, `font-display: swap`, KEIN Google-CDN — DSGVO/Privatsphäre: Fonts liegen lokal, z. B. `fonts/…-400.woff2`):
- Serif: 400
- Body: 400/500/600/700
- Logo: 500/600
- Orbitron: 400/700/900

### 3.1 Skala & Muster

| Element            | Font     | Größe/Details                                                 |
| ------------------ | -------- | ------------------------------------------------------------- |
| Logo/Chat-Titel    | Logo     | 1.15rem, gew. 600, weiß, letter-spacing -0.01em                 |
| Modal/Section-Titel (Serif) | Serif | 1.4–1.6rem, lower case gewicht 400, wirkt durch Serif   |
| "Coming Soon" Hero | Logo     | 2.8rem, letter-spacing .12em                                   |
| Untertitel/Tagline | Body     | 1.1rem, letter-spacing .35em, Akzentfarbe                      |
| Eyebrow/Label      | Body     | 0.68–0.85rem, gew. 700, UPPERCASE, letter-spacing .08–.14em, Akzent |
| Body               | Body     | 0.9–0.95rem, line-height 1.45–1.6                              |
| Meta/Hint          | Body     | 0.72–0.8rem, Farbe faint, line-height 1.4                      |
| Buttons            | Body     | 0.8–0.95rem, gew. 600–700                                       |

**Muster:** Titel stehen in Serif (ruhig, 400), UI/Sektionen/Badges/Labels in Grotesk — fett &
kurz. Uppercase nur für Labels/Eyebrows, nie für Absätze. `-webkit-font-smoothing: antialiased` setzen.

---

## 4. Form

### 4.1 Radien

| Token          | Wert  | Verwendung                                  |
| -------------- | ----- | ------------------------------------------- |
| `--radius-lg`  | 22px  | Karten, Modals, Haupt-Container              |
| `--radius-md`  | 14px  | Inputs, Textareas, Standard-Buttons          |
| `--radius-sm`  | 10px  | Tabellen-Zeilen-Karten, Listen-Items, Avatare, Chips |
| `--radius-pill`| 999px | Buttons-Pills, Badges, Fortschrittsbalken, Umschalter |

Kleingruppen: Panels, die seitlich andocken (Drawer/Menü), runden nur
die Innerseite (z. B. `0 16px 16px 0`).

### 4.2 Schatten

| Token        | Wert                                 |
| ------------ | ------------------------------------ |
| `--shadow-lg`| `0 18px 45px rgba(0, 0, 0, 0.55)`    |
| Glow (Akzent)| `0 0 10–26px rgba(255, 71, 87, 0.2–0.45)` |
| Weiß-Glow (CTA) | `0 10px 18px -8px rgba(255,255,255,.5), 0 0 26px rgba(255,255,255,.14)` |

### 4.3 Abstände (Eyebrow-Regel: konsistent, keine festen Scales erzwungen)

Container-Padding 20px; Modals 30px (Desktop) / 22px 16px (Mobile);
Komponent-Abstände 8–15px; Seitenabstand (Header/Seite) 25px, Mobile 12px.
`sizes` Erwartung: alles ist 44px+ klickbar (Touch).

---

## 5. Komponenten-Rezepte

### 5.1 Primär-Button (CTA) — "glossy white pill"

```css
.btn-primary {
  background: linear-gradient(180deg, #ffffff 0%, #d6e8f8 4%, #d9ecfe 72%, #ffffff 100%);
  /* kühl halten im Akzent-Rot-Theme? Nein: Weiß-Verlauf neutral lassen, kein Blaustich */
  color: var(--btn-ink);
  border: 0;
  border-radius: var(--radius-pill);
  font-weight: 700;
  box-shadow:
    0 10px 18px -8px rgba(255, 255, 255, 0.5),
    0 0 26px rgba(255, 255, 255, 0.14),
    inset 0 0 0 2px rgba(255, 255, 255, 0.9);
}
.btn-primary:hover { transform: translateY(-1px); filter: brightness(1.03); }
.btn-primary:disabled { opacity: 0.65; cursor: wait; transform: none; }
```

Höhe 46–50px, volle Breite im Modal, inline mit Padding 0 22px im Chat.
Verlaufstop-Töne wie `#d6e8f8/#d8ecfe` wirken kühl — im Rot-Theme neutralisieren auf
`linear-gradient(180deg, #ffffff 0%, #f1e2e5 5%, #f6eaec 72%, #ffffff 100%)`.

### 5.2 Sekundär-Button (Ghost-Pill)

```css
.btn-ghost {
  padding: 8px 16px;
  border-radius: var(--radius-pill);
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: transparent;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
}
.btn-ghost:hover { background: rgba(255, 255, 255, 0.1); transform: translateY(-1px); }
.btn-ghost.active { background: (CTA-Verlauf wie 5.1, aber 9%-Stopvariante); color: var(--btn-ink); border-color: rgba(255,255,255,.9); }
```

### 5.3 Danger-Button

`background: #c92030; color: #fff; box-shadow: none;` (flach, ohne Glow — Panic-Free und eindeutig).

### 5.4 Glas-Karte / Panel

```css
.panel {
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  color: var(--ink);
  overflow: hidden;
}
```

Varianten: dunklere Sidebar (`rgba(bg0, 0.6)`), Header-Bar (`rgba(bg0, 0.72)` + blur 12px),
modales Backdrop: fixed inset 0, `rgba(bg0, 0.72)` + blur 8px.

### 5.5 Badge / Pill / Rang

```css
.badge {
  font-size: 0.6–0.65rem; font-weight: 800; letter-spacing: .1–.12em;
  text-transform: uppercase; color: var(--accent-light);
  border: 1px solid rgba(255, 71, 87, 0.6); background: rgba(255, 71, 87, 0.12);
  border-radius: 999px; padding: 1px 7px; white-space: nowrap;
}
```

Statusabstufungen via Alpha (0.12 fill / 0.6 Rand) — gleiche Karte, andere Rolle
=> andere Farbe, gleiche Form.

### 5.6 Input / Textarea

```css
.field {
  height: 50px;  /* Textarea: min-height 64px */
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.07);
  color: #fff; font-size: 16px; outline: none;
}
.field::placeholder { color: var(--faint); }
.field:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(255, 71, 87, 0.2);
}
```

Checkboxes/Ranges: `accent-color: var(--accent)`.
Immer eigene Handler erlauben — kein Autofokus-Zwang.

### 5.7 Modal

Komposition: `.modal` (fixed, Backdrop 5.4) > `.modal-content` (Panel, 380px breit,
max-width 100%, max-height `calc(100dvh - 40px)`, `overflow-y: auto`,
`overscroll-behavior: contain`, zentriert, padding 30px, text-align center,
Schließen-`×` absolute top 10 right 15). Fokus-Verhalten:
`outline-offset: 3px`.

### 5.8 Fortschrittsbalken / Capture-Bar

```css
.bar { height: 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.bar__fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #ffd166, #ff9a3c); transition: width .4s ease; }
```

### 5.9 Karten-/Listen-Items (Chat-Nachrichten, Online-Liste, Voice-Member)

Muster: Zeile = kleine Karte (`--radius-sm`, `rgba(255,255,255,.05/.07)`,
`border 1px rgba(255,255,255,.08–.1)`), links 3px Akzentstreifen
(`border-left: 3px solid var(--accent)`) für Betonung/Zustand;
Hover: warmer Glow `0 0 0 2px rgba(accent, .35)` oder deletable-Aktion blendet ein (opacity .25 → 1).

### 5.10 Segmented Control / Tabs (z. B. Chat/World-Switch)

Wrap in Kapsel: `background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 3px; gap: 2px; display: flex;`
Buttons transparent, aktiv = CTA-Verlauf (5.1) mit `inset 0 0 0 1px rgba(255,255,255,.9)`,
Text `var(--btn-ink)`.

### 5.11 Footer / Legal

`text-align: center; padding: 18px 12px 26px; font-size: 0.8rem; color: var(--faint);`
Links `color: var(--muted)`, hover Akzent + underline. Legal-Seiten geben
`max-width: 640px`, Serif-H1, Akzent-H2, Body 0.95rem line-height 1.6
auf `linear-gradient(bg0, bg1 55%, bg0)`.

### 5.12 Scrollbars

```css
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.18); border-radius: 8px; }
```

---

## 6. Hintergrund-Dekor (Texturen)

1. Seiten-/Hero-Hintergrund = 2-Lagen-Verlauf (siehe 2.1) + radialer Akzent-Schein.
2. Fixed Linien-Grid 44px (body::before oder eigenes Overlay):
   `linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)`,
   `linear-gradient(180deg, rgba(255,255,255,.03) 1px, transparent 1px)`,
   `background-size: 44px 44px; opacity: .35; mix-blend-mode: soft-light; pointer-events: none;`
3. Button-Nebenfläche/Chip: weiß-Glas-Verlauf (Joj-Knob, Interact-Button):
   `linear-gradient(180deg, #ffffff 0%, #f1e2e5 30%, #f6eaec 75%, #ffffff 100%)`,
   `box-shadow: 0 8px 22px rgba(0, 0, 0, .4);`

---

## 7. Motion

| Effekt          | Wert                            |
| --------------- | ------------------------------- |
| Hover-Lift      | `transform: translateY(-1px)` + `filter: brightness(1.03)` |
| Standard-Ease   | `0.15s ease` (Farbe/Hintergrund), `0.3s ease-in-out` (Drawer) |
| Bar-Wachstum    | `width .4s ease`                |
| Scroll-Html     | `scroll-behavior: smooth`       |
| Folder-Regel    | `@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }` — alle Deko-Animationen abschalten |
| Pulse/Loading   | Button-Download: `#loginBtn.loading { opacity: .65; cursor: wait; transform: none; }` |

---

## 8. Responsivität & A11y

- **Breakpoints:** 900px (Layout umbricht: Sidebar nach oben, Voice-Panel als Drawer),
  768px (Mobile: Container 100dvh, kein Margin, Header kompakter `safe-area-inset-top`),
  640px (Schrift und Kopfzeile kompakter: Logo verstecken, Buttons schmaler).
- Touch-Ziele >= 44px min-height; Inputs `font-size: 16px` (verhindert iOS-Zoom).
- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }` überall.
- Kontrast: white `#fff` auf Glas ok; `--muted = 68% Alpha` fällt noch über 4.5:1 auf bg0;
  FAINT nur für Meta/Zeitstempel (kein Pflichttext).
- Text nie nur farbcodiert: Badges tragen Text, Fehler-Icons dazu.
- `overscroll-behavior: contain` auf Modals & Listen (verhindert Scroll-Chaining).
- Safe-Areas: `env(safe-area-inset-*)` in Header/Input-Paddings (iPhone-Notch).

---

## 9. Media-Handling

- Fonts lokal einbinden (DSGVO/no cookie-requests), mit `font-display: swap`.
- Canvas-/Welt-Grafik: dunkler Hintergrund `#060b16`, Panel um Canvas mit
  `border-radius: 18px; border: 1px solid var(--card-border);` und `--shadow-lg`.
- Sprech-/Aktivitätsanzeige: akzentgetönte Avatare/Border (`rgba(accent, .2/.4)`).

---

## 10. Do & Don't

**Do**
- Ein Akzent, eine Rolle. Rot = interaktiv/aktiv/aufmerksam.
- Serif für Titel, Grotesk für alles andere — strikt.
- Primär-CTA weiß/glänzend; Akzent-Rot nur für Fokus, aktive Checks, Fortschritt, Eyebrow.
- Badges & Status = Pill mit 0.12-Alpha-Fläche + 0.6-Alpha-Frame.
- Panels immer mit 1px weißem Border (0.08–0.23) — das gibt die "edle Glas"-Optik.
- Reduziere auf Dunkel: `bg`-Verlauf immer vom dunkelsten Ton wieder zurück.

**Don't**
- Keine Akzent-Overlay-Buttons als Standard (`#ff4757` als Button-BG liest sich wie Fehler).
- Kein Blau/Grau-Standard-Look (keine `#3b82f6`, keine Tailwind-Defaults).
- Keine sharp corners (alles hat Radius, min. 8px).
- Keine Text-gradient-Extras, kein "Cyberpunk"-Glow auf Fließtext (Glow nur auf Badges/State-Pills/Canvas).
- Kein Akzent-Glow auf großen Flächen (max. ~26px Reichweite, max. 0.45 Alpha).
- Nie Google-Fonts-/CDN-requests (Datenschutz), alles self-hosted.
- `prefers-reduced-motion` nicht ignorieren.

---

## 11. Kopier-Block: komplette `:root` im Cucuri-Style

```css
:root {
  /* Text */
  --ink: #ffffff;
  --muted: rgba(255, 255, 255, 0.68);
  --faint: rgba(255, 255, 255, 0.48);
  /* Akzent ROT */
  --accent: #ff4757;
  --accent-light: #ff8d98;
  --accent-deep: #c92030;
  --accent-pastel: #ffd7dc;
  --accent-rgb: 255, 71, 87;
  /* Basis */
  --bg0: #1a0a0f; --bg1: #2a1018;
  --card: rgba(32, 12, 20, 0.78);
  --card-border: rgba(255, 255, 255, 0.14);
  --rule: rgba(255, 255, 255, 0.23);
  --btn-ink: #2a1018;
  /* Form */
  --radius-lg: 22px; --radius-md: 14px; --radius-sm: 10px; --radius-pill: 999px;
  --shadow-lg: 0 18px 45px rgba(0, 0, 0, 0.55);
  /* Fonts */
  --font-serif: 'Prata', Georgia, serif;
  --font-body: 'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-logo: 'Poppins', sans-serif;
  --font-tech: 'Orbitron', monospace;
}
```

---

## 12. Referenz: Cucuri-Umsetzung (Basis der Regeln)

- `public/style.css` — Haupt-Design (Tokens, Header, Glas-Karte, Modals, Buttons, Liste, Voice, Admin, Welt, Responsive).
- `public/Jugendwort/jw-style.css` — Bot-Frontend mit Orbitron, zeigt Token-Reuse über Projektgrenzen.
- `public/legal.css` — schlanke Legal-Seite (bestätigt: Tokens genügen für neue Seiten).
- Herkunft: SpaceEdu-Spec (Design.txt Sec.4/5/7), übersetzt in Profil-, Lobby-, Welt-, Bot- und Legal-Komponenten.

Wenn eine andere KI einen neuen Screen baut: Tokens setzen, Rezept aus Kap. 5 wählen,
nur neue Komponenten benennen — Farben, Fonts, Radien, Schatten, Verläufe nie neu erfinden.
