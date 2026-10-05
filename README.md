# Ladepark-Check

Vormals „Traffic Opportunity Score“. Repo, Vercel-Projekt und Adresse heißen weiterhin `traffic-opportunity-score`.

Dieses öffentliche Repository enthält die Strecken-, Regions- und Standortanalyse für
halböffentliches Lkw-Laden in Deutschland sowie den Korridor-Report und die Ladepark-Planungsengine.

Traffic-Opportunity-Projekt: https://traffic-opportunity-score.vercel.app

## Getrennte Projekte

| Tool | GitHub-Repository | Lokaler Checkout | Sichtbarkeit |
| --- | --- | --- | --- |
| Ladepark-Check (vormals Traffic Opportunity Score) | `Fliegenbart/traffic-opportunity-score` | `~/Documents/Truckonomics` | öffentlich |
| TCO-Rechner | `Fliegenbart/truckonomics` | `~/Documents/truckonomics-tco` | privat |
| Depot Readiness Check | `Fliegenbart/DepotReadinessCheck` | `~/Documents/DepotReadinessCheck` | privat |

TCO- und Readiness-Implementierungen sowie deren APIs gehören nicht in dieses Repository.
Alte Seitenlinks `/tco`, `/embed` und `/depot-readiness` werden auf die jeweiligen Projekte
weitergeleitet. Die Traffic-Einbettung bleibt über `?embed=1` verfügbar. Fremde API-Routen
werden weder weitergeleitet noch durch die SPA beantwortet. `npm run test:boundaries`
prüft diese Projektgrenzen; die Prüfung ist Teil von `npm test`.

## Ladepark-Check

- Frontend: `client/src/pages/traffic-opportunity.tsx`, Karte in `client/src/components/traffic-map.tsx`
- Tutorial: ein- und ausschaltbare, nicht blockierende Führung mit 13 Schritten, markierten
  Bedienelementen und Hinweisen zu Annahmen und offenen Prüfungen. Startet beim ersten
  regulären Besuch; Einstellung und Fortschritt bleiben lokal im Browser gespeichert.
  Im Embed-Modus kein automatischer Start. Das Tutorial setzt keine Standorte oder
  Berechnungsannahmen selbst. Ohne Standort wartet die Führung bei der Auswahl.
  Komponente: `client/src/components/traffic-tutorial.tsx`, Inhalte und Zustandsprüfung:
  `client/src/lib/traffic-tutorial.ts`; Tests: `npm run test:tutorial` (Teil von `npm test`).
- Score-Logik: `shared/traffic-opportunity.ts` (Test: `npm run test:traffic`)
- Daten: `client/public/data/traffic-opportunity-de.json`, generiert aus der lokalen Mendeley-ZIP
  (liegt bewusst nicht im Repo) per `python3 scripts/build_traffic_opportunity_de.py`
- Validierung: `python3 scripts/validate_against_bast.py` vergleicht die synthetischen Netzkanten
  mit den BASt-Autobahn-Dauerzählstellen (Schwerverkehrs-DTV) und schreibt
  `data/external/bast-validation.json`; der Generator bettet das Ergebnis in die App-JSON ein.
  Reihenfolge: erst Validierung, dann Generator.
- Standort-Check (4. Workspace-Tab): bis zu 3 Standorte per Karten-Klick oder Ortssuche
  (Nominatim) setzen → getrennte Aussagen zu Verkehr, Ladebedarf und Evidenz.
  Screening und Simulation verwenden dieselbe explizite Quellenwahl und das vollständige
  Netz mit 2.964 Modellstrecken, nicht nur die 60 Hotspots. Stationsmessung und synthetisches
  Modell werden nicht stillschweigend gemischt. Regions-Score und Netzanschluss-Proxy bleiben Kontext (nächstes Umspannwerk ≥110 kV aus OSM,
  `python3 scripts/build_substations_de.py` → `client/public/data/substations-de.json`)
  und Ladepark-Szenarien 2027–2036 (E-Lkw-Anteil Niedrig/Basis/Hoch, Annahmen deklariert)
  (Logik in `shared/standort-check.ts` und `shared/charging-planning/`, Test: `npm run test:standort`
  und `bash scripts/check_charging_planning.sh`),
  Vergleichstabelle und Lead-Formular (POST an `/api/leads`, tenant `standort-check`).
- Deep-Links: `?region=<id>`, `?strecke=<edgeId>`, `?korridor=<originId-destId>`,
  `?standorte=<lon,lat;lon,lat>` und `?tab=` werden beim Laden übernommen und bei Auswahl
  in die URL gespiegelt.
- Embed-Modus: `?embed=1` blendet Navigation und CTA aus (für Präsentationen/iFrames).
- Korridor-Report: Routen laufen nur über explizit konfigurierte, kommerziell freigegebene OSRM-kompatible Dienste (Straßen-km und
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

### Szenariorechnung für Ladepark-Betreiber

Im Standort-Check öffnet „Wirtschaftlichkeit berechnen“ den Szenariorechner.
Eine ausgewählte Strecke kann über „Standort an dieser Strecke prüfen“ übernommen werden;
die Streckenmitte ist eine Suchposition, keine bestätigte Zufahrt oder verfügbare Fläche.

- Bis zu drei Standorte mit identischen, veränderbaren Annahmen vergleichen.
- Explizite Verkehrsbasis: ausreichend vollständige BASt-Messstation innerhalb von 3 km
  oder synthetische Modellkante innerhalb von 10 km mit angenommenem gleichmäßigem Tagesprofil.
  Gemeinsame Quellenauflösung: `shared/site-traffic.ts`; Hotspot-Mengen und Koordinaten werden
  gegen das vollständige Netz geprüft. Widersprüche sperren Standortberechnungen.
  BASt-Tageswert ist der Mittelwert gültiger Stunden × 24, kein Jahres-DTV.
- Nachfrage aus erreichbarem Verkehr, angenommenem E-Lkw-Anteil und Anhaltequote sowie Ankerkunden.
- Fünf-Minuten-Simulation mit Fahrzeugobergrenze, Ladeplätzen, Netzleistung, Warteschlange, Öffnungszeit,
  Wechselzeiten und Ladeverlusten.
- Jahrescashflows 2027–2036, Kapitalwert und diskontierte Amortisation einschließlich
  Kostenentwicklung, Ersatzinvestitionen und Restwert.
- Quellen, Modellversion und Eingaben sind über CSV/JSON und einen Fingerprint nachvollziehbar.
  `/api/charging-plan` erlaubt einen Abgleich der Browser- und Serverrechnung.
- Fehlende Netzleistung, unzugängliche Standorte oder ein benötigter, unbekannter Richtungssplit
  sperren die Berechnung. Wettbewerb bleibt ohne Standortprüfung unbekannt.

Die Startwerte sind illustrative Beispielannahmen, keine recherchierten Marktpreise.
Niedrig/Basis/Hoch sind keine Wahrscheinlichkeitsintervalle. Saisonabhängigkeit, reale Ladekurven,
Ausfälle, Steuern und Finanzierung fehlen; die Ladenachfrage ist nicht empirisch validiert.
Chronos-2 skaliert die Wirtschaftlichkeit nicht. Kein Ergebnis wird als investitionsreif ausgegeben.

Frontend: `client/src/components/charging-planner.tsx`, Simulation im Web Worker.
Rechenlogik: `shared/charging-planning/`. Der frühere Traffic-Tagesmittelrechner
in `shared/site-economics.ts` bleibt als getestetes Legacy-Modul erhalten, ist aber nicht
an die Oberfläche angebunden. Vollständiger Rechenvertrag und Datenstand:
[Ladepark-Planungsengine](docs/charging-planning-engine.md).

Öffentliche Referenzen stehen im vorhandenen Planer: SMARD-Preisjahr 2025 mit frei
festgelegtem Bezugsaufschlag, DWD-Temperaturkontext mit explizitem Energiestress,
BASt-Vergleich Januar/Juli 2026, Renault-Leistungsobergrenzen und historische
DHL-Namensreferenzen. Eine Anzeige verändert keine Annahme automatisch. Übernommene
Parameter behalten Quellen und Methodennotizen im CSV/JSON; manuelle Änderungen
entfernen die betreffende Referenz. MaStR/VNBdigital/PVGIS bleiben offene
Recherchezugänge, keine bestätigte Netzkapazität oder importierten Standortlasten.

HERE-Lkw-Routing ist unter `/api/site-access` implementiert und separat getestet.
Serverseitig sind `HERE_API_KEY` und die explizite Aktivierung `HERE_ROUTING_ENABLED=1`
erforderlich. Niemals den Schlüssel als `VITE_`-Variable verwenden. Vor öffentlicher
Aktivierung müssen Anbieterbudget und kommerzielle Nutzung geprüft werden;
Instanz-Ratenlimits sind keine globale Kostenbegrenzung. Der Korridor-Report verwendet
weiterhin seine eigene OSRM-Konfiguration, nicht automatisch HERE.
Importverfahren, Hash-Bereiche, Nutzungsrechte und Grenzen:
[Öffentliche Referenzdaten](docs/public-context.md).

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
Für reine Frontend-Arbeit ohne API reicht `npm run dev`.

## Deploy

Das Projekt ist auf Vercel ausgelegt. Vor dem Deployment muss `.vercel/project.json` auf
`traffic-opportunity-score` zeigen, nicht auf den TCO-Rechner oder Depot Readiness Check.
Vercel führt aus:

```bash
npm run build
```

Die statischen Dateien landen in `dist/public`. Nicht-API-Routen werden per `vercel.json`
auf die App zurückgeschrieben; die drei alten Tool-Seiten werden vorher weitergeleitet.

## API-Endpunkte

- `POST /api/charging-plan`: validiert die Eingaben und berechnet Ladepark-Szenarien.
- `POST /api/leads`: nimmt Standort- und Beratungsanfragen entgegen.
- `POST /api/site-access`: vergleicht A→B und B→A mit/ohne Standort über einen konfigurierten Routingdienst.

### Straßenprüfung anschließen

Serverseitig `SITE_ROUTING_BASE_URL` auf den Basis-URL eines eigenen oder kommerziell
freigegebenen OSRM-kompatiblen Dienstes setzen; optional `SITE_ROUTING_PROFILE` (Standard: `driving`).
Für lokale Tests vor `npm run dev` als Umgebungsvariable setzen. Vite stellt nur diese
neue API lokal bereit; für die übrigen APIs weiterhin `npm run dev:vercel` verwenden.
Für Vercel dieselben Variablen serverseitig konfigurieren und neu deployen.
Kein Dienst wird automatisch gebucht oder gestartet.

Für den bestehenden Korridor-Report zusätzlich `VITE_CORRIDOR_ROUTING_BASE_URL` und optional
`VITE_CORRIDOR_ROUTING_PROFILE` beim Build setzen. Diese Werte sind öffentlich und dürfen
keine Zugangsdaten enthalten; der Dienst benötigt Browser-CORS. Authentifizierte Dienste
benötigen einen eigenen serverseitigen Proxy. Die öffentlichen Demo-Hosts
`router.project-osrm.org` und `routing.openstreetmap.de` werden abgewiesen.
Grund: [OSRM-Demoserver-Richtlinie](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server)
beschränkt die Nutzung auf angemessene nichtkommerzielle Fälle.

Ohne Konfiguration: explizit `not_configured`, keine Abfrage eines Demoservers.
Bei Timeout, fehlender Route, unplausiblen Werten oder zu großem Snapping: `unavailable`,
keine scheinbare Teilerreichbarkeit. Maximaler Straßenabstand: Standort 100 m,
Modell-Endpunkte 500 m. A/B sind Modell-Endpunkte, keine belegten Autobahnanschlüsse
oder BASt-Richtungsanteile. Mehrzeit ist zusätzliche Fahrzeit, ohne Laden, Warten oder
Live-Verkehr. Keine Umrechnung in einen automatischen erreichbaren Verkehrsanteil.
Auch ein erfolgreicher Straßenvergleich bleibt `road_proxy` mit `truckAccessVerified=false`.
Lkw-Abmessungen, Gewichte, Verbote, Zufahrt, Wendefläche und Öffnungszeiten bleiben offen.
Vor kundenseitiger Nutzung sind Providerrechte, Profil, Netzstand, Zugangsschutz,
Ratenbegrenzung und SLA zu prüfen. Ein anders benanntes Profil allein bestätigt keine Lkw-Tauglichkeit.

Keine TCO-Berechnungs-, Readiness-Submit- oder Readiness-Export-API wird hier veröffentlicht.

Für den Lead-Versand werden optional diese Environment Variables genutzt:

- `LEAD_TO_EMAIL`
- `LEAD_FROM_EMAIL`
- `RESEND_API_KEY`

Optional schützt `SITE_PASSWORD` das Deployment über die bestehende Basic-Auth-Middleware.
`ADMIN_EXPORT_TOKEN` und `READINESS_STORAGE_PATH` gehören ausschließlich ins Depot-Readiness-Projekt.
Bereits dort oder in Vercel gespeicherte Daten und Umgebungsvariablen werden durch diese
Codebereinigung nicht automatisch gelöscht oder migriert.

## Tests

```bash
npm test
```

Ladepark-Planung einschließlich Datenimport und nativer API-Laufzeit:

```bash
bash scripts/check_charging_planning.sh
```

## Automatischer BNetzA-Import

`python3 scripts/refresh_truck_charging_de.py` lädt und validiert den aktuellen öffentlichen
CSV-Download und erzeugt die Ladepark-Datei. Der vorbereitete GitHub-Workflow prüft täglich.
Abrufdatum und tatsächlicher Datenstand bleiben getrennt. Die tagesaktuelle REST-Anbindung
benötigt noch die von der BNetzA auf Anfrage bereitgestellte OpenAPI-Beschreibung.
Details, Einrichtung und vorbereitete Anfrage: [BNetzA-Abruf](docs/bnetza-daily-import.md).
