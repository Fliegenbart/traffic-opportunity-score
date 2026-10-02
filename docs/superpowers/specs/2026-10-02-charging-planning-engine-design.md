# Ladepark-Planungsengine v1

Freigegeben am 2. Oktober 2026: Daten- und Rechenengine hinter der vorhandenen Oberfläche; keine Änderungen an Claudes Design, keine automatische Veröffentlichung.

## Ergebnis

Ein reproduzierbarer Standortplan verbindet versionierte Verkehrsquellen mit ausdrücklich benannten Nachfrageannahmen. Er liefert stündliche Last, simulierte Wartezeiten, bediente und nicht bediente Nachfrage sowie mehrjährige Projekt-Cashflows. Er ist eine Szenariorechnung, keine empirisch kalibrierte Absatz- oder Investitionsprognose.

## Daten und Zugänglichkeit

Das vollständige Mendeley-v2-Netz mit mindestens einem deutschen Endpunkt wird aus dem Originalarchiv exportiert. Streckenverkehr ist bidirektional und synthetisch. Luftliniennähe oder Netz-Endpunkte beweisen weder Zufahrt noch Fahrtrichtung. Eine Standortrechnung fordert deshalb explizite Angaben zu erreichbarem Verkehrsanteil und Zufahrtsstatus. Mehrere benachbarte Netzkanten werden nicht zu einer Nachfrage addiert.

BASt-Stundenwerte werden mit Zeitabdeckung, Fahrzeugklasse, Richtungsangaben und Quellenhash importiert. Negative Werte, Dubletten und Lücken werden nicht stillschweigend aufgefüllt. Bestehende historische Tagesprofile bleiben als solche gekennzeichnet; aktuelle Rohdaten werden erst nach geprüfter Formatzuordnung verwendet. Ungeklärte Lizenzen blockieren eine kommerzielle Freigabe der betreffenden Quelle.

## Rechenmodell

Stündliche Profile bestimmen Ankunftsgewichte. Eine deterministische, mit Seed reproduzierbare Generierung erzeugt einzelne Szenario-Ladevorgänge; Rundung erfolgt auf Tagesebene, nicht pro Stunde. Ankerkunden tragen eine Angabe, ob sie bereits in der vorbeifahrenden Nachfrage enthalten sind. Überlappungen werden abgezogen. Niedrig/Basis/Hoch sind Annahmeszenarien und keine Konfidenzintervalle.

Die Tagesrechnung simuliert in Fünf-Minuten-Schritten FCFS-Warteschlangen, Ladeplätze, gemeinsame Netzleistung, Ladeverluste, Wechselzeit, maximale Wartezeit und Öffnungsfenster. Restbedarf am Tagesende wird ausgewiesen; es gibt keinen impliziten Übertrag auf den Folgetag. Teilweise gelieferte Energie wird bilanziert, aber nicht als abgeschlossene Ladung gezählt. Fehlende Netzleistung ist unbekannt, nicht null.

Die Jahresaggregation erhält auch Nachfrage unter einer Ladung pro Tag: ganzzahlige Floor-/Ceil-Referenztage werden mit ihrem jeweiligen Anteil gewichtet. Das sind Szenario-Erwartungswerte, keine beobachteten Ereignisse oder kalibrierten Wahrscheinlichkeiten. Gleichzeitige Ankünfte verwenden einen stabilen ID-Tiebreak ohne sprachabhängige Sortierung.

Die Jahresrechnung gewichtet Werktag/Samstag/Sonntag nach dem jeweiligen Kalenderjahr. Jedes Szenario hat eine explizite jährliche Verkehrsskalierung und E-Lkw-Quote. Die Wirtschaftlichkeit enthält Verkauf, Energiebezug, variable und fixe Kosten, Ersatzinvestitionen, Restwert, NPV und diskontierten/undiskontierten kumulierten Cashflow. Projektrechnung netto, vor Steuern und Finanzierung; Förderungen werden nicht automatisch angenommen. Kein IRR bei uneindeutigem Vorzeichenverlauf.

## Evidenz und Integration

Messung, Modell, Annahme und unbekannt bleiben getrennt. Die Engine gibt fachliche Sperren und fehlende Standortprüfung aus. Kein Gesamt-Score, der fehlende Evidenz durch hohe Verkehrsmengen kompensiert. Alle Quellen, Inputs, Seed und Modellversion begleiten JSON/CSV-Exporte. Eine gemeinsame TypeScript-Schnittstelle, ein POST-Endpunkt und eine CLI sind die Integrationspunkte für Claudes Oberfläche.

## Akzeptanz

Tests prüfen Energie- und Nachfrageerhaltung, Spitzen statt Tagesmittel, Netz- und Ladeplatzgrenzen, Öffnungsfenster, Doppelzählung, Nullfälle, ungültige Eingaben, Kalenderjahre, Cashflow-Zeitpunkte, Wiederholbarkeit, Export-Sicherheit und HTTP-Fehler. Bestehende Tests, TypeScript und Produktionsbuild bleiben grün. Beobachtete Ergebnisse aus echten Ladeparks bleiben ein separates Validierungsgate.
