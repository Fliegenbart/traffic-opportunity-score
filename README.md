# Truckonomics

Truckonomics ist ein Vercel-Projekt für einen deutschen TCO-Rechner für Diesel- und Elektro-LKW.
Zusätzlich enthält das Projekt einen B2B DepotOne Readiness Check als Lead-Generation-Funnel für Depot-Elektrifizierung
sowie den Traffic Opportunity Score (Startseite `/`): eine Strecken- und Regionsanalyse für halböffentliches Lkw-Laden.

Live: https://truckonomics.vercel.app

## Traffic Opportunity Score

- Frontend: `client/src/pages/traffic-opportunity.tsx`, Karte in `client/src/components/traffic-map.tsx`
- Score-Logik: `shared/traffic-opportunity.ts` (Test: `npm run test:traffic`)
- Daten: `client/public/data/traffic-opportunity-de.json`, generiert aus der lokalen Mendeley-ZIP
  (liegt bewusst nicht im Repo) per `python3 scripts/build_traffic_opportunity_de.py`
- Validierung: `python3 scripts/validate_against_bast.py` vergleicht die synthetischen Netzkanten
  mit den BASt-Autobahn-Dauerzählstellen (Schwerverkehrs-DTV) und schreibt
  `data/external/bast-validation.json`; der Generator bettet das Ergebnis in die App-JSON ein.
  Reihenfolge: erst Validierung, dann Generator.
- Deep-Links: `?region=<id>` und `?strecke=<edgeId>` werden beim Laden übernommen und bei Auswahl
  in die URL gespiegelt.
- Embed-Modus: `?embed=1` blendet Navigation und CTA aus (für Präsentationen/iFrames).
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
