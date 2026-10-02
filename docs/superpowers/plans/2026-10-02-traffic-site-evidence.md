# Traffic Site Evidence Implementation Plan

**Goal:** Einheitliche Standort-Verkehrsbasis, richtungsbezogene Straßenprüfung und getrennte Evidenz für Verkehr und Ladenachfrage.

**Architecture:** Ein gemeinsamer, validierter Planungsdatensatz und eine Quellenwahl je Standort speisen Screening und Simulation. Die Karte behält ihre Hotspot-Auswahl. Straßenerreichbarkeit kommt aus einem konfigurierten OSRM-kompatiblen Dienst; kein kommerzieller Einsatz des öffentlichen Demoservers und keine automatische Bestätigung der Lkw-Zufahrt.

**Tech Stack:** Bestehendes React/Vite, TypeScript, Zod, Vercel Functions.

## Tasks
- [x] Regressionstests für Quellenkonsistenz, vollständiges Netz, Quellenwahl und fehlende Evidenz schreiben und scheitern sehen.
- [x] Gemeinsame Standort-Verkehrsauflösung implementieren; Planer und Screening verbinden.
- [x] Tests für Routingkonfiguration, beide Richtungen, Umwege, Snapping und Fehler schreiben und scheitern sehen.
- [x] Routingadapter und API implementieren; fehlende Konfiguration als offen behandeln.
- [x] Quellenwahl, Verkehr, Nachfrage, Evidenz und Straßenprüfung in die vorhandene Oberfläche integrieren.
- [x] Tests, Typprüfung, Produktionsbuild und Browserprüfung durchführen.

## Verification
`npm test`, `bash scripts/check_charging_planning.sh`, `npm run check`, `npm run build`
und `git diff --check` bestanden. Native Node-ESM-Imports beider APIs geprüft.
Routing-HTTP-Transport mit lokaler Testfixture geprüft, nicht mit realen Lkw-Routen.
Browser: 1280×720 und 390×844, Quellenwechsel in beiden Ansichten, unabhängige Quellenwahl
für zwei Standorte, Szenariorechnung und `not_configured`-Status geprüft. Keine relevanten
Konsolenfehler, kein Fehleroverlay, kein horizontaler Seitenüberlauf.

Offen: echter freigegebener Routingdienst, Lkw-Zufahrtsnachweise, Nachfragedaten von
Logistikern, produktiver Provider-Schutz/SLA, Push und Deployment. Bestehende Buildwarnungen
zu Browserslist, PostCSS und Bundlegröße bleiben unverändert.

## Boundaries
Keine neue Portfolio-Anwendung, keine Kalibrierung aus synthetischen Flottendaten, keine Änderungen an anderen Tool-Repos, kein Push oder Deployment. Flottennachfrage und Anhaltequote bleiben Annahmen bis zu einer unabhängigen Prüfung mit Logistikern. Pkw-Straßenrouting bestätigt weder Zufahrt, Abmessungen, Beschränkungen noch Öffnungszeiten. Die geometrische Modellstreckenzuordnung bleibt ungeprüft und die Richtungen A/B sind keine BASt-R1/R2-Anteile.
