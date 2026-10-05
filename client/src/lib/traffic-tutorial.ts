export type TutorialTab = "strecken" | "korridore" | "regionen" | "standort";

interface TutorialStep {
  id: string;
  target: string;
  tab?: TutorialTab;
  title: string;
  text: string;
  caution?: string;
  needsSite?: boolean;
}

export const TUTORIAL_STORAGE_KEY = "traffic-opportunity:tutorial:v1";
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "overview", target: "tutorial-control", title: "Schritt für Schritt zum Standort",
    text: "Beginne mit dem Verkehrsüberblick. Danach wählst du einen konkreten Standort und prüfst, unter welchen Annahmen sich dort ein Ladepark rechnen könnte. Du kannst die markierten Bereiche direkt bedienen und diese Führung jederzeit ausschalten.",
    caution: "Das Tool hilft bei der ersten Auswahl. Es bestätigt weder Ladenachfrage noch einen möglichen Netzanschluss.",
  },
  {
    id: "map", target: "map", tab: "strecken", title: "Interessante Straßenabschnitte finden",
    text: "Wähle eine hervorgehobene Strecke auf der Karte oder einen Eintrag in der Liste daneben. Rechts siehst du den berechneten Verkehr. Über „Standort an dieser Strecke prüfen“ kannst du später einen ersten Prüfpunkt setzen.",
    caution: "Die Streckenwerte für 2030 sind berechnet, nicht gemessen. Die Streckenmitte ist noch kein geeignetes Grundstück.",
  },
  {
    id: "gaps", target: "gaps", tab: "strecken", title: "Wo fehlt ein bekanntes Ladeangebot?",
    text: "Mit „Ohne nahen Ladepark“ grenzt du die Liste auf Abschnitte ein, in deren Nähe kein Lkw-Ladepark in Betrieb erfasst ist. Fehlt der Filter, sind keine entsprechenden Ladepark-Daten verfügbar.",
    caution: "Der Abstand ist Luftlinie. Eine Lücke in unseren Daten ist kein Nachweis für fehlende Konkurrenz oder zahlende Kunden.",
  },
  {
    id: "corridors", target: "corridors", tab: "korridore", title: "Verbindungen zwischen Regionen ansehen",
    text: "Wähle eine Verbindung aus der Liste. So erkennst du, zwischen welchen Regionen im Modell viele Lkw fahren und welche Verbindungen für eine weitere Untersuchung interessant sein könnten.",
    caution: "Ein hoher Score bedeutet weder hohe Auslastung noch sicheren Umsatz an einem einzelnen Standort.",
  },
  {
    id: "regions", target: "region-search", tab: "regionen", title: "Deine Region eingrenzen",
    text: "Suche eine Region, zum Beispiel Köln oder Hamburg, und wähle sie in der Liste aus. Hier vergleichst du größere Räume. Für ein konkretes Grundstück geht es als Nächstes zum Standort-Check.",
    caution: "Die Bewertung einer Region lässt sich nicht unmittelbar auf ein Grundstück übertragen.",
  },
  {
    id: "choose-site", target: "site-search", tab: "standort", title: "Jetzt einen echten Standort auswählen",
    text: "Gib eine Adresse oder einen Ort ein und drücke „Prüfen“. Alternativ kannst du einen Punkt auf der Karte setzen. Ein Suchergebnis ist nur eine erste Position: Prüfe, ob die Markierung wirklich auf der vorgesehenen Fläche liegt. Bis zu drei Standorte sind möglich.",
  },
  {
    id: "basis", target: "basis", tab: "standort", needsSite: true, title: "Die Verkehrsdaten bewusst auswählen",
    text: "Wähle eine nahe Zählstelle oder den berechneten Verkehr für 2030. Achte auf Entfernung, Jahr und erfasste Fahrzeuge. Eine Zählstelle ist nur hilfreich, wenn sie den Verkehr am Grundstück tatsächlich abbildet.",
    caution: "Schwere Fahrzeuge können auch Busse enthalten. Gibt es keine passende Quelle, bleibt die Rechnung offen; das Tutorial wählt keine für dich aus.",
  },
  {
    id: "access", target: "access", tab: "standort", needsSite: true, title: "Kommen die Lkw wirklich auf die Fläche?",
    text: "Prüfe unter „Zufahrt & Umweg“ das Fahrzeug und, wenn verfügbar, die Route aus beiden Richtungen. Kläre zusätzlich Einfahrt, Wendefläche, Beschränkungen und Öffnungszeiten vor Ort.",
    caution: "Ist die Routenprüfung nicht aktiviert, bleibt die Erreichbarkeit ungeprüft. Auch eine berechnete Route bestätigt keine private Einfahrt.",
  },
  {
    id: "demand", target: "demand", tab: "standort", needsSite: true, title: "Aus Verkehr werden nicht automatisch Kunden",
    text: "Trage ein, welcher Anteil den Standort erreichen kann und welcher Anteil der erreichbaren E-Lkw dort laden würde. Feste Kunden sind ein eigener Eingang. Nutze möglichst Gespräche, Zusagen oder Betriebsdaten statt der Beispielwerte.",
    caution: "Diese Angaben bestimmen die angenommene Nachfrage. Werden feste Kunden schon im Verkehr mitgezählt, markiere das, damit sie nicht doppelt zählen.",
  },
  {
    id: "capacity", target: "capacity", tab: "standort", needsSite: true, title: "Ladeplätze und Netzleistung abstimmen",
    text: "Öffne „Ladepark & Öffnungszeiten“. Prüfe Ladeplätze, Leistung je Platz, verfügbare Netzleistung und Wartezeiten. Alle Ladeplätze teilen sich die Netzleistung. Ein nahes Umspannwerk liefert dafür noch keinen verfügbaren Wert.",
    caution: "Eine für die Rechnung angenommene Netzleistung ist keine Zusage des Netzbetreibers. Ohne Netzangabe kann die Rechnung blockiert bleiben.",
  },
  {
    id: "costs", target: "costs", tab: "standort", needsSite: true, title: "Preise, Baukosten und E-Lkw-Anteil prüfen",
    text: "Ersetze in „Preise & Kosten“ die Beispiele durch eigene Angebote und Tarife. Vergiss Netzanschluss, Bau, Pacht und Wartung nicht. Darunter stellst du drei mögliche E-Lkw-Anteile ein; sie gelten für alle ausgewählten Standorte gleich.",
    caution: "Niedrig, Basis und Hoch sind Annahmen, keine Wahrscheinlichkeiten. Öffentliche Strommarktpreise ersetzen nicht deinen Stromvertrag.",
  },
  {
    id: "results", target: "results", tab: "standort", needsSite: true, title: "Ergebnisse vergleichen, nicht als Zusage lesen",
    text: "Wechsle zwischen Niedrig, Basis und Hoch. Prüfe sowohl das Investitionsergebnis als auch vollständige Ladungen, Wartezeiten und laufende Kosten. Mit „Was passiert bei anderen Annahmen?“ siehst du, wie empfindlich das Ergebnis ist.",
    caution: "Ein positives Ergebnis gilt nur unter deinen Eingaben. Eine fehlende Datenquelle oder ein Ausschlussgrund kann die Berechnung verhindern.",
  },
  {
    id: "export", target: "exports", tab: "standort", needsSite: true, title: "Die nächste Prüfung vorbereiten",
    text: "CSV liefert berechnete Ergebnisse als Tabelle; JSON enthält auch Eingaben und Herkunftsnachweise. Für einen Vergleich kannst du bis zu drei Standorte setzen. Kläre vor einer Investition Netzangebot, Zufahrt, Genehmigungen und echte Kunden.",
    caution: "Exporte sind erst mit einer gültigen Berechnung verfügbar. Sie dokumentieren ein Szenario, nicht die gesicherte Rentabilität.",
  },
];

export interface TutorialState { enabled: boolean; step: number }
export const SITE_STEP = TUTORIAL_STEPS.findIndex((step) => step.id === "choose-site");

export function readTutorialState(raw: string | null, autoStart = true): TutorialState {
  const fallback = { enabled: autoStart, step: 0 };
  if (!raw) return fallback;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("enabled" in saved) || !("step" in saved)) return fallback;
    if (typeof saved.enabled !== "boolean" || typeof saved.step !== "number" || !Number.isInteger(saved.step) || saved.step < 0 || saved.step >= TUTORIAL_STEPS.length) return fallback;
    return { enabled: saved.enabled, step: saved.step };
  } catch { return fallback; }
}

export function availableTutorialStep(step: number, hasSite: boolean): number {
  return TUTORIAL_STEPS[step].needsSite && !hasSite ? SITE_STEP : step;
}
