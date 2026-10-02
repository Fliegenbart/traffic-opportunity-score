# Truckonomics

Truckonomics ist ein Vercel-Projekt für einen deutschen TCO-Rechner für Diesel- und Elektro-LKW.
Zusätzlich enthält das Projekt einen B2B DepotOne Readiness Check als Lead-Generation-Funnel für Depot-Elektrifizierung
sowie den Traffic Opportunity Score (Startseite `/`): eine Strecken- und Regionsanalyse für halböffentliches Lkw-Laden.

Traffic-Opportunity-Projekt: https://traffic-opportunity-score.vercel.app

## Traffic Opportunity Score

- Frontend: `client/src/pages/traffic-opportunity.tsx`, Karte in `client/src/components/traffic-map.tsx`
- Score-Logik: `shared/traffic-opportunity.ts` (Test: `npm run test:traffic`)
- Daten: `client/public/data/traffic-opportunity-de.json`, generiert aus der lokalen Mendeley-ZIP
  (liegt bewusst nicht im Repo) per `python3 scripts/build_traffic_opportunity_de.py`
- Validierung: `python3 scripts/validate_against_bast.py` vergleicht die synthetischen Netzkanten
  mit den BASt-Autobahn-Dauerzählstellen (Schwerverkehrs-DTV) und schreibt
  `data/external/bast-validation.json`; der Generator bettet das Ergebnis in die App-JSON ein.
  Reihenfolge: erst Validierung, dann Generator.
- Standort-Check (4. Workspace-Tab): bis zu 3 Standorte per Karten-Klick oder Ortssuche
  (Nominatim) setzen → Ampel-Bewertung aus nächster Hotspot-Strecke, Lade-Lücke und
  Regions-Score, plus Netzanschluss-Proxy (nächstes Umspannwerk ≥110 kV aus OSM,
  `python3 scripts/build_substations_de.py` → `client/public/data/substations-de.json`)
  und Wirtschaftlichkeitsszenarien 2030 (E-Lkw-Anteil konservativ/Basis/ambitioniert, Annahmen deklariert) (Logik in `shared/standort-check.ts` und `shared/site-economics.ts`, Test: `npm run test:standort`),
  Vergleichstabelle und Lead-Formular (POST an `/api/leads`, tenant `standort-check`).
- Deep-Links: `?region=<id>`, `?strecke=<edgeId>`, `?korridor=<originId-destId>`,
  `?standorte=<lon,lat;lon,lat>` und `?tab=` werden beim Laden übernommen und bei Auswahl
  in die URL gespiegelt.
- Embed-Modus: `?embed=1` blendet Navigation und CTA aus (für Präsentationen/iFrames).
- Korridor-Report: Routen laufen über OSRM/OpenStreetMap (echte Straßen-km und
  Ladelücken ±10 km entlang der Route; Fallback Luftlinie, gekennzeichnet). Kostenmodell
  inkl. THG-Quotenerlös und Sensitivitäts-Spanne (Diesel ±0,15 €/l, Strom +0,10/−0,05 €/kWh).
- Korridor-Report: personalisierte 4-Seiten-Analyse für Logistiker (eTruckathon-Funnel).
  Konfiguration je Kunde unter `client/public/data/reports/<id>.json` (siehe `demo.json`),
  Ansicht unter `/korridor-report?id=<id>`, PDF per
  `./scripts/create_korridor_report_pdf.sh <id> [output.pdf]` (Playwright headless Chrome).
  Bewertungslogik in `shared/korridor-report.ts` (Test: `npm run test:report`):
  Machbarkeits-Ampel je Relation (Reichweite vs. größte Ladelücke), vereinfachtes
  Energie- und Mautkosten-Modell mit ausgewiesenen Annahmen, CO₂-Einsparung.
- Realtrend & Tagesgang (Chronos-2): Pipeline in drei Schritten —
  (1) lokal `python3 scripts/map_hotspots_to_bast_stations.py` (Hotspot-Kante → nächste
  BASt-Dauerzählstelle), (2) auf dem Chronos-Server (`/opt/truckonomics-trend/`, eigenes venv)
  `server_extract_bast_series.py` (lädt bast.de/videos/<jahr>_A_S.zip 2016–2023, baut
  Wochenreihen + Tagesgang-Profile) und `server_chronos_trend.py` (Chronos-2-Backtest gegen
  Saisonal-Naiv + 52-Wochen-Forecast mit Quantilband), (3) Ergebnisse per scp nach
  `data/external/` und `python3 scripts/build_traffic_trend_de.py` →
  `client/public/data/traffic-trend-de.json`. Backtest-Stand: Punktprognose ≈ Saisonfigur
  (Median-Skill −0,007), 80-%-Band deckt 79,7 % ab — kommuniziert wird deshalb Band + Profil.
- Lkw-Ladeparks: `python3 scripts/build_truck_charging_de.py` erzeugt
  `client/public/data/truck-charging-de.json` aus dem BNetzA-Ladesäulenregister
  (CSV nach `data/external/bnetza_ladesaeulen.csv` laden; Link auf bundesnetzagentur.de unter
  E-Mobilität → Download und Kontakt) plus der handkuratierten Liste
  `curated/truck-charging-de.json` (Quelle + Prüfdatum je Eintrag). Verifizierte Hubs
  (Milence, Aral pulse MCS, Daimler TruckCharge, E.ON Drive/MAN, Lkw-geflaggte
  Register-Einträge) erscheinen als Rauten auf der Karte; die App rechnet daraus
  Weiße-Flecken-Badges je Hotspot-Strecke und Ladelücken je Korridor
  (Geo-Helfer in `shared/geo.ts`, Test: `npm run test:geo`).

## Technik

### Investitionscheck für Ladepark-Betreiber

Im Standort-Check öffnet „Wirtschaftlichkeit berechnen“ den Szenariorechner.
Eine ausgewählte Strecke kann über „Standort an dieser Strecke prüfen“ übernommen werden;
die Streckenmitte ist eine Suchposition, keine bestätigte Zufahrt oder verfügbare Fläche.

- Bis zu drei Standorte mit identischen, veränderbaren Annahmen vergleichen.
- Nachfrage aus erreichbarem Verkehr, E-Lkw-Anteil und Anhaltequote, plus zusätzlichen Ankerkunden.
- Kapazität als Minimum aus Ladeplätzen und Netzanschluss, einschließlich mittlerer Ladeleistung,
  Öffnungszeit, Verfügbarkeit, Wechselzeit und Ladeverlusten.
- Netto-Umsatz abzüglich Strombezug, variabler Kosten und Fixkosten; operativer Break-even
  und einfache Amortisation bei konstantem Szenariojahr 2030.
- Validierte Annahmen bleiben im lokalen Browser gespeichert (`traffic-opportunity:economics:v1`).
  Standortlinks enthalten Koordinaten, nicht die individuellen Annahmen. Der CSV-Export enthält
  alle Standorte, drei Szenarien, Annahmen, Quellenstand und Rechengrenzen.
- Fehlende Ladepark-Daten gelten als unbekannter Wettbewerb. Ohne Modellstrecke im 25-km-Umkreis
  gibt es keine Ertragsberechnung. Die Regionssuche akzeptiert Umlaute und Umschreibungen.

Die Startwerte sind illustrative Beispielannahmen, keine recherchierten Marktpreise.
Ankunftsspitzen, Finanzierung, Steuern, Förderung, Abschreibung und Ersatzinvestitionen sind
nicht modelliert. Chronos-2 skaliert die Wirtschaftlichkeit nicht: Der gespeicherte Lauf auf
Zähldaten bis 2023 ist historisch und belegt keinen durchgängigen Vorteil gegenüber Saisonal-Naiv.
Der Datenbestand wurde für diese Erweiterung nicht aktualisiert.

Frontend: `client/src/components/site-economics.tsx` und `site-economics.css`.
Rechenlogik, Eingabevalidierung und CSV: `shared/site-economics.ts`.
Regressionstests: `shared/site-economics.test.ts` (Teil von `npm test`).

### Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- API: Vercel Serverless Functions in `api/`
- Build-Ausgabe: `dist/public`

## Lokal starten

```bash
npm install
npm run dev:vercel
```

`npm run dev:vercel` nutzt die Vercel CLI per `npx`, damit Frontend und `/api/*` lokal wie auf Vercel laufen.
Fuer reine Frontend-Arbeit ohne API reicht `npm run dev`.

## Deploy

Das Projekt ist auf Vercel ausgelegt. Vercel fuehrt aus:

```bash
npm run build
```

Die statischen Dateien landen in `dist/public`. Alle nicht-API-Routen werden per `vercel.json` auf die App zurueckgeschrieben.

## API-Endpunkte

- `POST /api/calculate-tco`: berechnet den TCO-Vergleich.
- `POST /api/leads`: nimmt Beratungsanfragen entgegen.
- `POST /api/readiness-submit`: validiert den Depot Readiness Check, berechnet Score und Lead-Klasse und speichert die Submission.
- `GET /api/readiness-export?format=json&token=...`: exportiert Readiness Leads als JSON.
- `GET /api/readiness-export?format=csv&token=...`: exportiert Readiness Leads als CSV.

Für den Lead-Versand werden optional diese Environment Variables genutzt:

- `LEAD_TO_EMAIL`
- `LEAD_FROM_EMAIL`
- `RESEND_API_KEY`

Für den Depot Readiness Export wird benötigt:

- `ADMIN_EXPORT_TOKEN`: einfacher MVP-Schutz für JSON-/CSV-Export.
- `READINESS_STORAGE_PATH`: optionaler Dateipfad für gespeicherte Readiness Submissions. Ohne Wert nutzt die App `/tmp/truckonomics-readiness-submissions.json`.

## Depot Readiness Check

Lokal starten:

```bash
npm install
npm run dev:vercel
```

Dann im Browser oeffnen:

```text
http://127.0.0.1:3000/depot-readiness
```

Der Check ist auf DepotOne ausgerichtet und dient als qualifizierter Lead-Funnel. Er umfasst:

- mehrstufigen Wizard für Unternehmen, Fuhrpark, Einsatzprofil, Depot, Energie, Wirtschaftlichkeit und Kontaktfreigabe
- Score von 0 bis 100 mit Readiness-Level
- Lead-Klassen A, B und C
- DSGVO-Struktur mit separater Kontakt- und Marketing-Einwilligung
- DepotOne-orientiertes Design mit E.ON Drive, NEoT und Mitsui als Partnerbezug
- Mock-Schnittstelle in `api/crmAdapter.ts` für spätere Anbindung an HubSpot, Salesforce, Pipedrive oder DepotOne/E.ON-Endpunkte

Tests ausfuehren:

```bash
npm test
```

Nur Scoring-Tests:

```bash
npm run test:readiness
```

## Automatischer BNetzA-Import

`python3 scripts/refresh_truck_charging_de.py` lädt und validiert den aktuellen öffentlichen
CSV-Download und erzeugt die Ladepark-Datei. Der vorbereitete GitHub-Workflow prüft täglich.
Abrufdatum und tatsächlicher Datenstand bleiben getrennt. Die tagesaktuelle REST-Anbindung
benötigt noch die von der BNetzA auf Anfrage bereitgestellte OpenAPI-Beschreibung.
Details, Einrichtung und vorbereitete Anfrage: [BNetzA-Abruf](docs/bnetza-daily-import.md).
