# Öffentliche Referenzdaten

Die Ergänzung arbeitet im bestehenden Traffic-Tool, nicht im privaten Depot- oder Portfolio-Planer. Keine Betriebsdaten von Logistikpartnern, keine neuen JavaScript-Abhängigkeiten. Neue Funktionalität ist kein Deployment-Nachweis.

## Tatsächlich integrierte Quellen

| Datei unter `client/public/data/context/` | Inhalt | Berechnungswirkung |
| --- | --- | --- |
| `electricity-de.json` | SMARD DE/LU, 2025, 8.760 gültige Stunden, EUR/MWh; Mittel 89,3283, 573 negative Stunden | Nur nach ausdrücklicher Übernahme: ausgewählte Marktreferenz / 1.000 plus freier Bezugsaufschlag |
| `weather-de.json` | DWD, 2025, 61 räumlich ausgewählte Stationen mit mindestens 95 % Stundenabdeckung; zwei Kandidaten verworfen | Standortkontext bis 100 km; ein frei gewählter Energiestress wirkt erst nach Übernahme und auf das gesamte Planjahr |
| `traffic-months-de.json` | BASt Januar/Juli 2026, 935 vergleichbare Stationen | Vergleich derselben Station, Straße, Fahrzeugklasse und Tagtypen; keine automatische Verkehrsänderung |
| `catalogs-de.json` | Drei Renault-Spitzenladeleistungen und 38 historische DHL-Referenznamen | Fahrzeugobergrenze nach Auswahl; DHL-Namen nur recherchierbar, ohne Koordinaten, heutigen Betriebsnachweis oder Nachfrage |

Die bestehende BNetzA-Ladeinfrastruktur und OSM-Netznähe bleiben getrennte Kontextquellen. MaStR, VNBdigital und PVGIS sind verlinkte Recherchezugänge, **keine neu importierten Standortdatensätze**. Registeranlagen, Netzbetreiber-Zuordnung und PV-Potenzial liefern weder freie Netzkapazität noch Lastgänge. Touren, Ladefenster und reale Verbrauchs-/Ladeverläufe müssen Partner liefern.

## Herkunft und Rechte

- [SMARD](https://www.smard.de/en/downloadcenter/download-market-data), Bundesnetzagentur, CC BY 4.0. Öffentliche Chart-Dateien der Preisreihe 4169; keine garantierte API. UTC-Jahr, keine Lastgewichtung oder Preisprognose. Negative Preise werden nicht auf null gesetzt. Perzentile sind historische Stundenperzentile, keine Szenario-Wahrscheinlichkeiten. Quellenhash = SHA-256 des mit `json.dumps(manifest, sort_keys=True)` erzeugten UTF-8-Manifests; jedes Manifestelement referenziert URL und Hash seiner Rohdatei.
- [DWD-Temperaturbeschreibung](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/air_temperature/DESCRIPTION_obsgermany_climate_hourly_air_temperature_en.pdf), DWD, CC BY 4.0. Historische Stundenarchive, QN 3/5/7/8/9/10 akzeptiert, Sentinelwerte verworfen, UTC. Eine Station je 1°-Zelle unter 600 m, keine vollständige Stationsliste; lokale Höhenunterschiede ungeprüft. Einzelquellenhash = ZIP-Rohdatei. Das Rohcache-Verzeichnis enthält auch Stationsmetadaten und den Archivindex. Keine Temperatur-Verbrauchskalibrierung.
- [BASt](https://www.govdata.de/suche/daten/automatische-dauerzahlstellen-rohdaten): Rohdaten, ausdrücklich nicht vom Anbieter plausibilisiert. Lizenz wird pro Distribution anhand gespeicherter RDF-Metadaten geprüft; unbekannter Status bleibt unbekannt. Quellenhash = jeweiliges Monatsarchiv. Beide Profile brauchen mindestens 95 % Abdeckung und drei Beobachtungen je Stunde/Tagtyp. Koordinatenabweichung höchstens 100 m; kein Klassenwechsel. Die Tagesprofile trennen Mo–Fr/Samstag/Sonntag, nicht Ferien/Feiertage. Zwei Monate sind kein Jahresmodell.
- [Renault Trucks](https://www.renault-trucks.de/product/renault-trucks-e-tech-t-540-t-585-t-780): redaktionelle Einzelangaben, Stand 02.10.2026, 350/720/720 kW für T 540 4×2/T 585 6×2/T 780 6×2. HTML-Rohseitenhash. Keine offene Herstellerdatenlizenz behauptet; Rechte als ungeklärt markiert. Spitzenleistung ist keine dauerhafte Leistungszusage, Kompatibilitätsprüfung oder Ladekurve. Keine Batteriegröße aus Namen abgeleitet.
- [DHL-Mitteilung vom 24.05.2024](https://group.dhl.com/de/presse/pressemitteilungen/2024/30-jahre-paketzentren.html): redaktionelle Namensreferenzen. Rohseitenabruf mit Python schlug mit Timeout fehl; die öffentliche Seite wurde über Recherchezugang geprüft. Hash = SHA-256 der UTF-8-Namensliste (`ensure_ascii=False`, kompakte JSON-Trenner), **kein HTML-Rohseitenhash**. Keine offene Datenlizenz, bestätigten Adressen oder heutigen Standortbestände behauptet. Rechte als ungeklärt markiert.

Im UI werden originale Messwerte und freigegebene Annahmen getrennt. Prozentuale Energiestressfaktoren stammen vom Nutzer, nicht vom DWD. Herstellerobergrenzen werden als konstante Simulationsgrenze genutzt; dies kann bei real abfallender Ladekurve noch optimistisch sein. Keine Quelle wird dadurch zu einer validierten Ladenachfrage.

## Reproduzierbarkeit

```bash
python3 scripts/public_context.py --source prices --year 2025
python3 scripts/public_context.py --source weather --year 2025
python3 scripts/public_context.py --source catalogs
PYTHONPATH=data/planning-python python3 scripts/public_context.py --source bast
bash scripts/check_charging_planning.sh
npm test
```

Rohdateien stehen ausschließlich im ignorierten `data/raw/public-context/`, BASt in `data/raw/bast/`. Vorhandene Rohdateien werden bewusst wiederverwendet, **nicht automatisch aktualisiert**. Abweichende Quellenstände erfordern eine bewusste neue Rohdatenaufnahme und redaktionelle Prüfung. Abrufdaten der gecachten Messquellen bleiben ihre Datei-Capture-Zeit, nicht das Datum der Neuberechnung. Der feste BASt-Vergleich nutzt Januar/Juli 2026. Die Renault/DHL-Faktenauswahl ist redaktionell gepflegt, nicht automatisch aus beliebig geänderten Webseiten abgeleitet.

Neue Snapshots werden erst nach erfolgreicher Verarbeitung atomar je Datei ersetzt. Unterschiedliche Quellen können unterschiedliche Stände haben; Ausfälle bleiben je Quelle sichtbar, keine Ersatzwerte null. Zod prüft Browserdaten und Übernahmen, Python prüft Rohimporte. Widersprüchliche Dubletten werden nicht gemittelt. Die Renault-Tabelle muss zur redaktionellen Modell-/Achskonfigurations-/Leistungsauswahl passen; Änderungen oder Mehrdeutigkeit stoppen den Katalogimport zur Prüfung.

`SiteInput.references` und `PlanningRequest.references` tragen Feld, Ausgangswert, übernommenen Wert, Quelle und Methodennotiz. Werte müssen exakt zum tatsächlich verwendeten Parameter passen. Manuelle Änderungen entfernen die betroffene Referenz; Rücknahme stellt den ursprünglichen Wert wieder her. Wiederholter Energiestress baut auf dem ursprünglichen Ausgangswert auf, nicht auf dem bereits erhöhten Wert. Alte lokale V1-Annahmen bleiben lesbar. JSON/CSV und die Engine-Quellenliste erhalten tatsächlich übernommene Referenzen; eine Anzeige ohne Übernahme verändert die Simulation nicht. Ein Preis-Sensitivitätstest entfernt die alte Preisreferenz im geänderten Fall.

## HERE-Lkw-Routing

`POST /api/site-access` nutzt HERE Routing v8 nur bei serverseitigem `HERE_API_KEY` **und** `HERE_ROUTING_ENABLED=1`. Keine `VITE_`-Variable, kein Schlüssel im Client, Git oder Quell-Snapshot. Der bereits auf Vercel hinterlegte Schlüssel wird nicht ausgelesen oder exportiert. Ohne explizite Aktivierung bleibt das vorhandene OSRM-kompatible Backend bzw. der offene Konfigurationsstatus bestehen. Dieser Änderungssatz aktiviert oder deployt Produktion nicht.

Pro neuer Prüfung bis zu vier Anbieteranfragen: A→B, A→Standort→B und die Gegenrichtung. Beispielmaße sind editierbare Annahmen; Abmessungen werden in Zentimetern und Gewichte in Kilogramm übertragen. `departureTime=any`: keine Live-Verkehrsprognose oder zeitabhängige Freigabe. Kritische/verletzte Restriktionen, unvollständige Abschnitte, große Snap-Abstände (>100 m am Standort, >500 m an Modell-Endpunkten), Abschnittslücken und widersprüchliche Umwege liefern keine Teilfreigabe. `truckAccessVerified` bleibt immer `false`.

15-Minuten-Erfolgscache (maximal 100 Einträge), maximal acht neue Prüfungen je Caller und 32 je Stunde/Serverinstanz, beschränkte Caller-Liste. Das ist **kein globales Kostenlimit** bei Vercel-Skalierung. Vor öffentlicher Aktivierung HERE-Projektkontingente/Budget und kommerzielle Nutzung prüfen; für garantierte Limits zusätzlich dauerhaftes Gateway/Auth/Rate-Limit vorsehen. Keine automatische Änderung von Erreichbarkeit, Anhaltequote oder NPV aufgrund einer Route.

Am 02.10.2026 wurde der echte HERE-Anschluss einmal mit dem öffentlichen Kölner Testpunkt (6,95/50,97, Modellkante 2603159) geprüft: vier HTTP-200-Antworten, beide Richtungen, Status `truck_route_proxy`, keine Restriktionshinweise. Mehrwege 5,936/6,333 km, Mehrzeiten etwa 13,58/13,13 Minuten; Standort-Snap etwa 95,9 m. Das ist Anschlussnachweis für diesen Test, **kein Nachweis einer tatsächlich nutzbaren Grundstückszufahrt, dauerhaften Verfügbarkeit oder produktiven Veröffentlichung**. Der Schlüssel blieb nur im Speicher/verdeckten stdin.

Für Investitionsentscheidungen fehlen weiterhin bestätigte Zufahrt, Netzangebot, Standortlast, Wettbewerb, Ankerkundenverträge und beobachtete Ladepark-Nachfrage.
