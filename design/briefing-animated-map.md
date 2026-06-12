# Design-Briefing: Animierte Deutschland-Karte „Traffic Opportunity Score"

## Kontext & Zweck

Die Karte ist das Herzstück eines Pitch- und Analyse-Tools für Lkw-Ladeinfrastruktur
(Zielgruppe: E.ON Drive, Logistiker wie DB Schenker, Investoren wie Mitsui). Sie zeigt,
**wo sich Deutschlands Lkw-Verkehr 2030 bündelt — und wo entlang dieser Ströme noch kein
Lkw-Ladepark steht.** Die Karte wird live in Meetings bedient (Klicken, Zeigen, Erzählen)
und ist gleichzeitig die Arbeitsfläche eines Workspace mit vier Tabs (Strecken, Korridore,
Regionen, Standort-Check).

**Die eine Botschaft, die die Karte ohne Worte erzählen muss:**
> „Türkis ist Verkehr. Amber ist Gelegenheit."
> Versorgte Verkehrsadern leuchten türkis, unversorgte (= Investitionschancen) glühen amber.

## Stilwelt (bestehend, bitte fortführen)

- **Dark-Mode-Kontrollraum:** Hintergrund #141519, Landmasse #1b1e24 mit Hairline-Grenze
  rgba(255,255,255,0.14). Premium, präzise, instrumentenhaft — kein verspieltes Infotainment.
- **Farben:** Türkis #0DBBC8 / #19c8d4 (Verkehr, Marke), Amber #e8a13a (Lade-Lücken =
  Gelegenheit), Violett #a78bfa (Lkw-Ladeparks), Weiß für Auswahl/Pins. Eine helle Variante
  (#f1f2f5 Landmasse auf Weiß) existiert für den Print-Report — Animationen betreffen nur dark.
- **Typo:** E.ON Brix Sans; Karten-Labels als gesperrte Versalien (ANKERSTÄDTE in
  rgba(255,255,255,0.32)).
- **Designsprache drumherum:** 8px-Radien, keine Schatten, Tabellenziffern, ruhige Flächen.

## Das Problem mit dem Ist-Zustand (bitte lösen)

Die 60 Hotspot-Strecken sind reale, oft nur 3–10 km kurze Autobahnabschnitte. Damit sie
sichtbar sind, strecken wir sie künstlich auf Mindestlänge und rendern sie als dicke Linien
mit runden Kappen — **das Ergebnis sieht aus wie verstreute Würstchen/Kapseln**, nicht wie
ein Verkehrsnetz. Gesucht ist eine Darstellung, die kurze Segmente als **Energie-/Verkehrsknoten
im Netz** lesbar macht, ohne sie zu fälschen — z. B. als pulsierende Knoten, als Glühen auf
einem angedeuteten Netzgraphen, als gerichtete Partikelströme o. Ä. Künstlerische Freiheit
ausdrücklich erwünscht, solange die Geometrie ehrlich bleibt (keine erfundenen Streckenverläufe).

## Ebenen der Karte (mit echten Datengrößen)

1. **Landmasse:** echter Deutschland-Umriss (vorprojizierter SVG-Pfad, 20 Polygone, liegt vor).
2. **Punkt-Textur:** 429 Regions-Zentroiden als feine Dots (#2b2f36) — Materialität der Fläche.
3. **Hotspot-Strecken (Held #1):** 60 Segmente mit je Koordinatenpaar, Lkw/Tag (10.000–39.000),
   Flag `whiteSpot` (31 von 60 = amber). Breite/Intensität skaliert heute mit Verkehr.
4. **Lkw-Ladeparks (Held #2):** 33 aktive + 3 angekündigte als violette Rauten (MCS größer
   als HPC; angekündigt = Umriss).
5. **Relationen/Routen:** gestrichelte Linien, jetzt mit echten OSRM-Polylinien (100–300 Punkte).
6. **Standort-Pins:** nummerierte weiße Kreise (1–3), aktiver Pin amber.
7. **Ankerstädte:** 6 Versalien-Labels.
8. Auswahl-Zustände: selektierte Strecke/Region/Korridor hervorgehoben, Rest gedimmt.

## Animations-Ideen (Vorschläge, gern übertreffen)

- **Fließender Verkehr:** subtile gerichtete Partikel oder wandernde Dash-Offsets entlang
  der Türkis-Adern — Geschwindigkeit/Dichte ∝ Lkw/Tag. Der Verkehr soll *fließen*, nicht blinken.
- **Glut statt Blinken für Lade-Lücken:** Amber-Knoten atmen langsam (2–4 s Puls), wie Glut —
  sie sind das Verkaufsargument und dürfen magnetisch wirken.
- **Lade-Puls an Parks:** Violette Rauten geben gelegentlich einen feinen Ring ab
  („hier wird geladen").
- **Eingangs-Choreografie (einmalig, ≤2 s):** Umriss zeichnet sich, Textur blendet ein,
  Adern fluten von Nord nach Süd, Lücken glühen zuletzt auf — danach Ruhe-Loop.
- **Hover/Select:** sanftes Aufleuchten + Dimmen des Rests; Tooltip-Stil existiert
  (dunkle Pille, weiße Schrift).
- **Routen-Zeichnen:** Wird ein Korridor gewählt, zeichnet sich die OSRM-Route als Linie
  von A nach B (stroke-dashoffset-Animation).

## Harte Anforderungen

- **Ruhe-Tauglichkeit:** Die Karte läuft minutenlang im Meeting — der Loop muss nach der
  Eingangs-Choreografie unaufdringlich sein (keine Daueraufmerksamkeits-Effekte).
- **Performance:** SVG/CSS/WAAPI in React, keine Canvas/WebGL-Pflicht, ~500 DOM-Knoten OK;
  60 fps auf einem MacBook; `prefers-reduced-motion` → statisch.
- **Interaktivität bleibt:** Klick auf Strecke/Region/Pin-Modus (Crosshair) sind Kernfunktionen.
- **Print-Fallback:** Die helle Variante muss als eingefrorenes Standbild im PDF funktionieren.
- **Verhältnis 295 × 382** (equirektangulare Projektion, lon 5,4–15,6 / lat 47–55,3, ist fix).

## Anti-Ziele

- Keine „Würstchen": keine gestreckten Kapseln mit runden Kappen als Hauptdarstellung.
- Kein Tile-/Satelliten-Look, keine Straßenkarten-Ästhetik — es ist ein abstrahiertes Kartenwerk.
- Kein Regenbogen: maximal Türkis/Amber/Violett + Neutrals.
- Nichts, was Datenpräzision vortäuscht, die wir nicht haben (z. B. erfundene Netz-Topologie).

## Deliverable

Animierter Prototyp der Dark-Karte (gern als React/SVG-Komponente oder Motion-Spezifikation
mit Timings/Easings je Ebene), der sich in die bestehende `traffic-map.tsx` übersetzen lässt.
Datenstrukturen und projizierte Koordinaten liefern wir als JSON.
