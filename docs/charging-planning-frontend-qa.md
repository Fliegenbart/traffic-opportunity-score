# Frontend-Anbindung und Vercel-Veröffentlichung

Prüfdatum: 2. Oktober 2026.

## Veröffentlichung

- Checkout: `/Users/davidwegener/Documents/Truckonomics`, Remote `git@github.com:Fliegenbart/traffic-opportunity-score.git`.
- Git-Basis: `f0f4bfa3820dadc6b25768dad725469997ce835b`; Veröffentlichung aus dem lokalen Arbeitsstand, nicht aus einem neuen Commit. Vorhandene Änderungen wurden erhalten. Kein neuer Commit oder Push.
- Bestätigtes Vercel-Projekt: `davids-projects-f2bdba89/traffic-opportunity-score`, Projekt-ID `prj_v8YqNPnVMkBImwz5NTE9Tp2qYdRv`.
- Finale Vorschau: [Traffic Opportunity Score](https://traffic-opportunity-score-8toep18xe-davids-projects-f2bdba89.vercel.app/traffic-opportunity).
- Deployment-ID: `dpl_8KPiWF221BKw6mNtUVR4nEpx7xXQ`, Ziel `preview`, Status durch Vercel Inspect bestätigt: `Ready`.
- `api/charging-plan` ist als Funktion enthalten. Der Test wurde nach `shared/charging-planning/api.test.ts` verschoben und erscheint nicht mehr als API-Funktion.
- Die Vorschau war zunächst durch den bestehenden Vercel-Login geschützt. Keine Schutzänderung und keine Authentifizierungsumgehung.

## Produktion nach Freigabe

- Auf die Nachfrage zur Live-Version erteilte der Nutzer mit „dann deploye bitte“ die Produktionsfreigabe.
- Live: [Traffic Opportunity Score](https://traffic-opportunity-score.vercel.app/traffic-opportunity).
- Finales Deployment: `dpl_wKwr4dcuFsmaCWBbEs1fkyiELdSg`, URL `https://traffic-opportunity-score-9mcrhpgio-davids-projects-f2bdba89.vercel.app`, Ziel `production`, Status `Ready`; öffentliche Aliase durch Vercel Inspect bestätigt.
- Das erste produktive Deployment zeigte die Oberfläche, aber der Server-Abgleich scheiterte. Vercel-Laufzeitlogs belegten `ERR_MODULE_NOT_FOUND` für Imports ohne `.js`-Endung in der kompilierten ESM-Funktion. Der Fehler wurde lokal ohne tsx reproduziert.
- Relative Imports der API und ihrer Engine-Abhängigkeiten wurden auf `.js` umgestellt. Keine Modell-, Daten- oder Designänderung. `scripts/test_charging_runtime.mjs` kompiliert die API, lädt sie mit nativer Node-ESM-Auflösung und prüft die Zehnjahresrechnung und HTTP-Methodensperre. Der Test scheiterte vor der Korrektur und besteht danach; er ist im gemeinsamen Prüflauf und in den CI-Pfadfiltern enthalten.
- Nach dem korrigierten Produktionsdeployment wurde die öffentliche Seite im Browser neu geladen, Köln-Longerich als Verkehrsbasis gewählt und die Standortrechnung ausgeführt. Sichtbarer Status: „Server-Abgleich bestätigt · identische Ergebnisse“. Keine Warnungen oder Fehler im geprüften Browser-Log.
- Live-Nachweis: `/private/tmp/traffic-opportunity-live-verified.jpg`.
- Rückfallversion vor dieser Veröffentlichung: `dpl_5oQbbsyoVwsUJWxYazNVyqhQnXVe`. Kein neuer Git-Commit oder GitHub-Push.

## Lokal geprüft

- Vollständige bestehende `npm test`-Suite, `npm run check`, Engine-/API-/Frontend-Vertragstests und zehn Python-Planungsdatentests bestanden.
- Lokaler und Vercel-Build erfolgreich. Bestehende Warnungen zu großen Bundles, Browserslist und PostCSS bleiben bestehen.
- Standorttab, explizite BASt-Quellenwahl (Köln-Longerich), Neuberechnung bei Anhaltequote, drei Hochlaufszenarien, Stundenleistung und Cashflows sichtbar geprüft.
- Ein-Faktor-Sensitivitäten mit getrennten Kapitalwertdifferenzen sichtbar geprüft.
- Unbekannte Netzleistung entfernt Erträge und zeigt eine Sperre. Wechselzeit außerhalb des Fünf-Minuten-Rasters entfernt Ergebnisse. Modellquelle mit einseitiger Zufahrt und unbekanntem Richtungssplit gesperrt.
- Drei Standorte: unterschiedliche Quellen getrennt berechnet, Standort ohne Daten nicht berechnet. Keine automatische Stationsergänzung.
- Desktop und 390 × 844 Pixel: Screenshots geprüft, kein horizontaler Seitenüberlauf; mobile Auswahl und Szenariowechsel funktionsfähig. Keine Warnungen oder Fehler im geprüften Browser-Log.
- JSON und CSV über sichtbare Download-Schaltflächen heruntergeladen. JSON-Ergebnis aus gespeicherten Eingaben exakt mit der gemeinsamen Engine reproduziert; CSV mit UTF-8-BOM, Umlauten und zehn Jahreszeilen geprüft.
- Lokaler Screenshot: `/private/tmp/traffic-planning-local-qa.jpg`.

Die Prüfung bestätigt Funktion und Reproduzierbarkeit der Szenariorechnung, nicht die empirische Richtigkeit der Ladenachfrage oder eine Investitionsfreigabe. Die CI-Konfiguration wurde ergänzt, aber noch nicht nach GitHub gepusht oder dort ausgeführt.
