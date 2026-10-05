# Ladepark-Planungsengine

## Stand und Grenzen

Die Engine ist an den Standort-Check angebunden. `client/src/components/charging-planner.tsx` verwendet die bestehende Gestaltung, lädt die vollständige Planungsdatenbasis und führt Simulationen in `client/src/lib/charging-planning.worker.ts` aus. Die alte Tagesmittelrechnung bleibt als unverändertes Legacy-Modul erhalten, wird in der Oberfläche aber nicht mehr verwendet. Git- und Deployment-Stand werden separat geprüft; diese Dokumentation ist kein Veröffentlichungsnachweis.

Pro Standort ist eine ausdrückliche Quellenwahl erforderlich: ausreichend vollständige BASt-Station innerhalb von 3 km oder nächste Modellkante innerhalb von 10 km mit ausdrücklich angenommenem gleichmäßigem Profil. Keine automatische Stationszuordnung, keine unbemerkte Imputation. Das Modellprofil senkt Wochenenden nicht ab. Die Monatsmessung ist eine Referenz, kein Jahres-DTV oder gemessener Verkehr am Grundstück.

Die Oberfläche zeigt 2027–2036, editierbare E-Lkw-Zielanteile 2030 (linearer Hochlauf, danach konstant), Betriebsjahr/Tagtyp, Kapitalwert, diskontierte Amortisation, Stundenleistung, Warteschlange, Jahrescashflows, Standortvergleich, Ein-Faktor-Sensitivitäten sowie CSV/JSON. Unbekannte Netzleistung, unzugänglicher Standort oder fehlender Richtungssplit sperren Erträge. Ein Server-Abgleich unter `/api/charging-plan` verifiziert auf Vercel die Übereinstimmung der lokalen und serverseitigen Berechnung; fehlende Serverprüfung wird angezeigt. Lokal benötigt die Oberfläche keinen API-Dev-Server.

`charging-planning-v2` erzeugt nachvollziehbare Szenarien, keine validierten Nachfrageprognosen. V2 ergänzt die Fahrzeug-Leistungsobergrenze und prüfbare Parameterreferenzen. Kein Ergebnis wird als investitionsreif ausgegeben. Elektrifizierung, Anhaltequote, Ankerkunden, Preise und Netzanschluss sind ausdrücklich Eingaben. Niedrig/Basis/Hoch sind keine Wahrscheinlichkeitsintervalle. Chronos ist kein notwendiger Bestandteil.

## Daten

- `client/public/data/planning/network-de.json`: alle 2.964 Modellkanten mit mindestens einem deutschen Endpunkt, Jahresverkehr 2019/2030 in beiden Richtungen. Quelle: [Speth et al., Mendeley v2](https://data.mendeley.com/datasets/py2zkrb65h/2), CC BY 4.0. Keine vollständige lokale Straßenkarte; regionale Verkehre fehlen teilweise. Geradlinige Endpunkt-Geometrie beweist keine Zufahrt. Bekannte umgekehrte OD-Pfade werden nicht zur Richtungsermittlung verwendet.
- `client/public/data/planning/bast-hourly-de.json`: importierter Monat Juli 2026. Quelle: [BASt über GovData](https://www.govdata.de/suche/daten/automatische-dauerzahlstellen-rohdaten). Lizenz wird pro Download aus RDF-Metadaten geprüft. Rohdaten sind ausdrücklich nicht durch den Anbieter plausibilisiert.
- `client/public/data/planning/example-request.json`: reproduzierbarer Demostandort am Zählpunkt Köln-Longerich, kein geprüftes Grundstück. Verkehr und Tagesprofil stammen vom Zählpunkt; Lade-, Netz-, Kosten- und Zukunftsparameter sind illustrativ. Die Modellkante dient nur zur räumlichen Einordnung.

Jede Quelle enthält Abrufdatum, Beobachtungsdatum, Version, Lizenzstatus und SHA-256 des referenzierten Artefakts. Verkehrsdaten referenzieren Rohdateien; bei den neuen Kontextdaten sind die abweichenden Hash-Bereiche in [Öffentliche Referenzdaten](public-context.md) dokumentiert. Negative/fehlende Verkehrswerte, Schätzkennzeichen, Zeitumstellungen und unvollständige Richtungen werden ausgeschlossen. Negative Strommarktpreise bleiben dagegen erhalten. Identische Dubletten werden gezählt, widersprüchliche führen zum Abbruch. Lücken bleiben `null`. Nicht unterstützte Dateien und ungültige Koordinaten stehen im Qualitätsbericht.

Ein vollständiges Referenzprofil erfordert mindestens 95 Prozent vollständige Querschnittsstunden und drei Beobachtungen je Stunde/Tagtyp. Vollständigkeit beweist keine Plausibilität. `LoA + LmA + Sat` beziehungsweise `LoA + Lzg` schließen Busse aus. Reine `Lkw`-/`SV`-Gruppen bleiben als `heavy_traffic_proxy` markiert. PROJ transformiert EPSG:25832 nach EPSG:4326.

## Nutzung

```bash
bash scripts/check_charging_planning.sh
node_modules/.bin/tsx scripts/run_charging_plan.ts --example --out output/planning-demo
node_modules/.bin/tsx scripts/run_charging_plan.ts --input client/public/data/planning/example-request.json --out output/my-plan
```

Die CLI schreibt Eingaben, JSON-Ergebnis, CSV und Sensitivitäten. `--full` ergänzt einzelne Ankünfte und Fünf-Minuten-Verläufe. Der Fingerprint ist SHA-256 aus Modellversion und normalisierten Eingaben. Für einen Re-Test die gespeicherten Eingaben verwenden, nicht einen neuen Beispielstandort auswählen.

Manuelle Aktualisierung ohne Veröffentlichung oder Zeitplan:

```bash
python3 -m pip install --target data/planning-python -r scripts/requirements-planning.txt
PYTHONPATH=data/planning-python python3 scripts/refresh_planning_data.py
```

Der Import wählt den neuesten abgeschlossenen, offiziell angebotenen Monatsdownload mit bestätigter CC-BY-4.0-Lizenz. `--month 2026-07` friert die Auswahl ein. BASt wird erneut geladen, um Revisionen zu erfassen; Mendeley wird gecacht. `--force-mendeley` lädt dessen großes Archiv erneut. Quellhosts, Downloadgrößen, Formate und Lizenzen sind begrenzt/geprüft. Fehler ersetzen keine App-Datei durch leere Ergebnisse. Keine neuen JavaScript-Abhängigkeiten.

## Integration für Claude

Browserfähige Funktionen stehen in `shared/charging-planning/index.ts`:

```ts
import { loadPlanningData, matchTrafficEdge, findStationCandidates,
  stationProfiles, runChargingPlan, summarizePlan, runSensitivity,
  compareSitePlans, exportPlanCsv } from "@shared/charging-planning";

const { network, bast } = await loadPlanningData();
const edge = matchTrafficEdge(point, network.edges);
const stations = findStationCandidates(point, bast.stations);
// Nähe ist nur ein Kandidatenkriterium, kein Beweis für dieselbe Straße.
const profiles = stationProfiles(stations[0].station, bast.source);
const plan = runChargingPlan(request);
const compactPlan = summarizePlan(plan);
```

Alle Felder sind strikt in `contracts.ts` und dem vollständigen Beispiel definiert. Keine impliziten Marktpreis- oder Elektrifizierungsdefaults. `traffic.referenceYear` bezeichnet die Verkehrsbasis; jährliche `trafficMultiplier` und `evShare` sind explizit. `reachableShare` gilt für die gewählten Fahrtrichtungen. Bei `directions: r1/r2` ist `directionShareR1` erforderlich. R1/R2 muss zur Zählstation passen, nicht zu den willkürlichen Modell-A/B-Endpunkten. Der Richtungssplit ist über den Tag konstant angenommen.

`anchors[].includedInPassing` verhindert eine doppelte Addition. `activeOn` begrenzt Anker auf Tagtypen. Der Abzug erfolgt vom Tagesvolumen; die zeitliche Zuordnung ist eine Annahme. Überschreiten Anker die modellierte Durchgangsnachfrage, wird eine Warnung ausgegeben. Anhaltequote und lokale Konkurrenz müssen fachlich geprüft werden. Registerpunkte allein belegen keine Lkw-Zugänglichkeit oder freie Kapazität; BNetzA bleibt eine getrennte Quelle für die Standortprüfung.

Alternativ: `POST /api/charging-plan`, `Content-Type: application/json`, Body = `request`. Antwort: kompakte Tagesmetriken/Stundenverläufe, Cashflows, Evidenzlücken, Eingaben, Fingerprint. `400` ungültiges JSON, `413` mehr als 250 KB, `415` falscher Medientyp, `422` ungültiger Vertrag oder mehr als 5.000 Ladungen pro Referenztag beziehungsweise 100.000 simulierte Ladungen insgesamt. Fachliche Sperren ergeben HTTP 200 mit `status: blocked` und ohne berechnete Szenarien. Vites einfacher Dev-Server führt Vercel Functions nicht aus; lokal die gemeinsame Funktion oder Vercel Dev verwenden.

Angebotene, vollständig bediente, abgewiesene und teilweise bediente Ladungen zusammen darstellen. Wartezeit-P95 beschreibt nur gestartete simulierte Ladungen, keine Prognosegüte. `compareSitePlans` verlangt gleiche Szenarien, E-Lkw-Quoten, Jahre und Diskontierung; die Rangfolge ist ausschließlich ein Szenario-NPV.

## Rechenvertrag

- Seed-gesteuerte Ankünfte innerhalb der Stunde, tägliche Ganzzahlen mit größtem Rest; keine Poisson-Prognose. Die Jahresrechnung gewichtet zwei benachbarte ganzzahlige Referenztage (`representativeWeight`, `annualWeightDays`), damit beispielsweise 0,1 Ladungen pro Tag nicht auf null verschwinden. Jahresladungen sind Erwartungswerte eines Szenarios, keine gezählten Ereignisse.
- Fünf-Minuten-Raster, FCFS, Fahrzeug-/Ladeplatz-/Netzgrenzen, Verluste, Wechselzeiten, Wartezeitgrenze und Öffnungsfenster. Kleine Restladungen weisen freie Leistung innerhalb eines Schritts nicht erneut zu; konservative Näherung. Fahrzeug- und Portleistung DC, Netzleistung AC. `capacity.vehiclePowerKw` ist eine konstante Obergrenze, keine Ladekurve; ältere Anfragen ohne dieses Feld behalten ihre bisherige Port-/Netzgrenze.
- Begonnene Ladungen pausieren bei Schließung. Restbedarf wird am Tagesende ausgewiesen, ohne Übertrag auf den Folgetag. Teilenergie zählt zum Absatz, nicht als abgeschlossene Ladung.
- Werktag/Samstag/Sonntag mit jeweils ein oder zwei Referenztagen werden nach dem Kalenderjahr einschließlich Schaltjahren gewichtet. Gewichte je Tagtyp summieren sich zu dessen Kalendertagen. Stundenmetriken für die Oberfläche mit `representativeWeight` mitteln; P95-Wartezeiten nicht mitteln oder als Jahresperzentil darstellen. Jahreszeiten, Feiertage, Ausfälle, Ladekurven und Speicher fehlen ausdrücklich.
- Projekt-Cashflows netto vor Steuern/Finanzierung, Anfangsinvestition vor Betriebsbeginn, Jahreszahlungen am Jahresende. Explizite Kostenentwicklung, Ersatzinvestitionen, Restwert. Kein ungeprüfter IRR. Betriebskosten-Break-even beweist weder Amortisation noch Nachfrage.
- Reproduzierbarkeit erfordert gleiche Eingaben, Quellen und Modellversion. Änderungen am Rechenvertrag benötigen eine neue Modellversion und Regressionstests.

Für eine Investitionsentscheidung fehlen weiterhin Grundstücks-/Zufahrtsprüfung, Netzangebot, Konkurrenzprüfung, Ankerkundenverträge und beobachtete Ladepark-Nachfrage. Ein hoher Traffic Score ersetzt diese Evidenz nicht.
