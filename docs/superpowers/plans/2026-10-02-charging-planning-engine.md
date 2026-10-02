# Ladepark-Planungsengine Implementation Plan

> Ausführung im bestehenden Checkout, ausschließlich neue Engine-, Datenpipeline-, Test- und Dokumentationsdateien. Vorhandene Design- und Wirtschaftsdateien bleiben unangetastet.

**Goal:** Den freigegebenen Standortplan als reproduzierbare, geprüfte Szenarioengine bereitstellen.

**Architecture:** Versionierte Zod-Verträge, separate Nachfrage-, Kapazitäts- und Finanzmodule, gemeinsamer Orchestrator. Python mit PROJ/RDF-Parser exportiert echte Quellartefakte; TypeScript-API und CLI verwenden dieselbe Engine.

**Tech Stack:** TypeScript, Zod, Node assert/tsx, Python unittest/csv/zipfile, Vercel Functions.

## Aufgaben

- [x] 1. Verträge und Rechentests: neue Dateien in `shared/charging-planning/`; Tests zunächst rot, danach grün. Eingaben strikt und endlich; Szenarien benötigen explizite Jahreswerte.
- [x] 2. Datenpipeline: vollständiges Originalnetz samt SHA-256, echte BASt-Archive, Qualitätsbericht und lizenzgeprüfte manuelle Aktualisierung. Prüfung mit `bash scripts/check_charging_planning.sh` und isolierten Python-Abhängigkeiten.
- [x] 3. Nachfrage und Tagesbetrieb: Seed, Tagesrundung, Anker-Überlappung, gemeinsame Netzleistung, FCFS, Verlustbilanz, Öffnungsfenster und Restenergie. Jahresaggregation erhält auch kleine Nachfrage durch gewichtete Referenztage.
- [x] 4. Jahreswirtschaftlichkeit und Evidenz: Kalendergewichtung, Cashflows, NPV, Ersatzinvestitionen, Restwert, analytischer Energie-Break-even, physikalische Kapazitätsobergrenze und Sperren bei fehlender Evidenz. Sensitivitäten und vergleichbare Standortlisten.
- [x] 5. Integration: API, CLI, JSON-/CSV-Exporte und Dokumentation für Claude. Keine bestehenden Client-Design- oder Package-Dateien geändert; neue Quellartefakte liegen im eigenen öffentlichen Datenverzeichnis.
- [x] 6. Verifikation: neue Tests und HTTP-Vertrag, 16 Python-Tests, bestehende JavaScript-Tests, TypeScript und Produktionsbuild erfolgreich. Beispiel/Re-Test byte-identisch; neue Quellartefakte im Build enthalten. Grenzen dokumentiert. Kein Push/Deployment.
