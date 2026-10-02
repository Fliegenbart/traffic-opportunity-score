# BNetzA-Abruf

## Nutzbarer öffentlicher CSV-Import

```sh
python3 -m pip install -r scripts/requirements-charging.txt
python3 scripts/refresh_truck_charging_de.py
```

Der Import findet den aktuellen offiziellen CSV-Link auf der BNetzA-Seite,
prüft Spalten, Datenstand, Koordinaten, Zahlen und IDs und baut die App-Datei
`client/public/data/truck-charging-de.json` neu. Ein fehlerhafter, zu kleiner
oder stark geschrumpfter Import ersetzt den letzten guten App-Datensatz nicht.
Ein unveränderter Quellbestand erzeugt keinen neuen Commit.

Der GitHub-Workflow `.github/workflows/refresh-charging.yml` prüft täglich um
05:17 UTC (07:17 MESZ / 06:17 MEZ). Er wird erst nach Übernahme auf den
Default-Branch aktiv; Actions muss aktiviert sein und Branch-Regeln müssen
Bot-Pushes erlauben. Bei Fehlern schlägt der Workflow sichtbar fehl.
Er committet ausschließlich die validierte Ladepark-Datei. Für die Website
ist zusätzlich ein funktionierendes Vercel-Git-Deployment nötig; dies wurde
hier nicht aktiviert oder bestätigt.

**Tägliches Prüfen des CSV-Downloads ist kein tagesaktueller REST-Abruf.**
`bnetzaDataDate` kommt aus der Datei; `retrievedAt` bezeichnet den erfolgreichen
Download des übernommenen Snapshots. Der erfolgreiche Check eines unveränderten
Bestands steht im Actions-Log. Der Snapshot enthält auch Quell-URL, SHA256,
Zeilenzahl und übersprungene ungültige Zeilen. `registerSourceMode=public_csv`
kennzeichnet diese Quelle ausdrücklich.

Betreiber-Einträge bleiben handkuratiert und behalten ihr `checkedAt`.
Der Import aktualisiert weder diese Prüfung noch Verkehrs-/Trenddaten.
Proxies bleiben unbestätigte Lkw-Standorte. Der bestehende 3-km-Filter nutzt
alle 2.918 deutschen Modellkanten aus Mendeley v2; die kleine eingefrorene
Geometriedatei ersetzt die bisher notwendige lokale 300-MB-ZIP.
Reproduktion: `python3 scripts/export_charging_network.py <mendeley-v2.zip>`.

## Tagesaktuelle REST-Schnittstelle: noch offener Anschluss

Die BNetzA bestätigt einen einmal täglich aktualisierten öffentlichen
Registerdatensatz. Ihre Seite nennt keine öffentlich dokumentierte Abruf-URL
oder JSON-Struktur und bietet die OpenAPI-Beschreibung auf Anfrage an:

https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Schnittstellen/start.html

Entsprechend wird kein geratenes JSON-Schema implementiert und der CSV-Import
nicht als REST-Dienst bezeichnet. Benötigt werden die OpenAPI-Spezifikation,
Abrufadresse und gegebenenfalls Zugangsbedingungen. Danach kann der REST-Adapter
die normalisierten Registerzeilen an dieselbe geprüfte Ladepark-Pipeline liefern.

Vorbereitete Anfrage (nicht versendet):

An: ladesaeulenregister@bnetza.de

Betreff: Öffentliche tagesaktuelle Schnittstelle zum Ladesäulenregister

Guten Tag,

wir möchten die öffentliche, täglich aktualisierte Schnittstelle zum
Ladesäulenregister für unsere Anwendung Traffic Opportunity Score nutzen.
Bitte senden Sie uns die OpenAPI-Beschreibung der öffentlichen Abrufschnittstelle
sowie die Informationen zur Abrufadresse, etwaiger Authentifizierung,
Nutzungsbedingungen und Abruflimits. Wir benötigen ausschließlich lesenden
Zugriff auf den veröffentlichten Registerdatensatz, keinen Betreiber-Import.

Vielen Dank!
