# Öffentliche Standortdaten und HERE

**Goal:** Die freigegebenen öffentlichen Quellen in der bestehenden Traffic-App nutzbar machen, ohne daraus gemessene Ladenachfrage oder freie Netzkapazität abzuleiten.

**Architecture:** Bestehende Verkehrsbasis und Simulation bleiben erhalten. Ein serverseitiger HERE-Adapter ergänzt die explizite Straßenprüfung. Validierte, versionierte öffentliche Snapshots ergänzen historische Strompreise, Temperatur und Fahrzeugparameter. Ein Standort-Kontext in der bestehenden Planeransicht erlaubt bewusste Szenarioübernahmen; externe Quellen und Änderungen stehen auch im Export.

**Tech Stack:** React/Vite, TypeScript/Zod, Vercel Functions, Python-Standardbibliothek für reproduzierbare öffentliche Importe.

## Routing
- [x] Tests zuerst: vier Routen, Fahrzeugmaße, beide Richtungen, Snapping, mehrteilige Ergebnisse, kritische Hinweise, Fehler und Geheimnisfreiheit.
- [x] HERE-Adapter mit festem Anbieterhost, Timeout, konservativer Fehlerbehandlung und deklarierter Fahrzeugkonfiguration; echter Anschluss separat mit vier HTTP-200-Antworten geprüft.
- [x] UI für Fahrzeugmaße; kein automatischer Nachweis privater Zufahrten oder Änderung der Anhaltequote.
- [x] Begrenzter Cache und Instanz-Ratenlimit; globale Kostenbegrenzung bleibt beim Anbieter erforderlich. Keine öffentliche Aktivierung in diesem Änderungssatz.

## Öffentliche Referenzen
- [x] Importtests zuerst: Nullwerte, negative Marktpreise, Duplikate, Kalender/DST, DWD-Qualität und Sentinelwerte; Quellenhash-Bereiche dokumentiert.
- [x] SMARD-Referenzjahr 2025 (8.760 Stunden) und 61 räumlich ausgewählte DWD-Stationen mit mindestens 95 % Jahresabdeckung importiert; Rohdateien nur lokal.
- [x] Fester BASt-Vergleich Januar/Juli 2026 aus vorhandenen Archiven: 935 vergleichbare Stationen; bestehende Verkehrsquelle nicht ersetzt. Kein vollständiges saisonales Jahresmodell.
- [x] Dokumentierte Renault-Ladeleistungsobergrenzen und historische DHL-Standortreferenzen ergänzt; keine erfundenen Batterie- oder Koordinatendaten. Herstelleränderungen stoppen den Import zur Prüfung.
- [x] MaStR/VNBdigital/PVGIS als offene Recherchelinks mit sichtbarem Datenstatus ergänzt, kein behaupteter Standortimport.

## Planung und Oberfläche
- [x] Tests zuerst: €/MWh → €/kWh, ausdrücklich gewählter Bezugsaufschlag, Winter-Stress ohne automatische Verbrauchskalibrierung, Fahrzeugleistungsgrenze, Quellen im Export.
- [x] Standort-Kontext und explizite Szenarioübernahmen im vorhandenen Planer; keine neue Marketingseite oder Designüberarbeitung.
- [x] Rücknahme/Reset, Fehlermeldungen, neue Quellen und Parameter im kanonischen JSON/CSV erhalten. Tatsächlich heruntergeladene Dateien auf drei Referenzen und Quellenhashes geprüft; alte lokale Eingaben bleiben lesbar.
- [x] Tests, Typprüfung, native API-Laufzeit, Produktionsbuild und Browserprüfung auf Desktop (1280×720)/Mobil (390×844) bestanden; keine neuen Konsolenfehler oder horizontaler Überlauf im geprüften Ablauf. Quellenhashes gegen 53 SMARD-Dateien, 61 DWD-Archive, zwei BASt-Archive und Katalogartefakte abgeglichen. Echter HERE-Abruf getrennt von Fixtures dokumentiert; Produktion unverändert. Vorhandene Browserslist/PostCSS/Bundlegrößen-Warnungen bleiben.

## Grenzen
Keine geheimen Schlüssel in Dateien, Logs, Browserbundle oder Git. Keine neuen Verträge, kostenpflichtigen Abonnements oder Veröffentlichung von Partnerdaten. Keine automatisch abgeleiteten Netzangebote, Betreiberfreigaben, Ladekurven, saisonalen Verbrauchsmodelle oder Investitionsfreigaben. Private Depot-/Portfolio-Repos bleiben unverändert. Neue lokale Funktionalität wird nicht ohne geprüfte Laufzeit als bereits produktiv bezeichnet.
