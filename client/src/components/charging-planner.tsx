import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, Calculator, Check, RotateCcw } from "lucide-react";
import { stationRoadWarning } from "@shared/site-traffic";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { stroke: "#cdd2cc" };
const TICK = { fontSize: 10, fill: "#667278" };
const TOOLTIP_STYLE = { borderRadius: 6, border: "1px solid #e3e6e1", fontSize: 12, boxShadow: "0 2px 8px rgba(32,36,38,0.08)" };
import { canonicalJson } from "@shared/charging-planning";
import TrafficBasisSelect from "./traffic-basis-select";
import PublicContextPanel from "./public-context-panel";
import type { ParameterReference } from "@shared/charging-planning/contracts";
import { buildSiteRequest, DEFAULT_SITE_INPUT, siteInputSchema, type BasisChoice, type PlanningData, type PlanningSite, type SiteInput } from "@shared/charging-planning/site-input";
import type { PlanEntry, WorkerReply } from "@/lib/charging-planning.worker";
import "./site-economics.css";
import "./charging-planner.css";

type NumericKey = { [K in keyof SiteInput]-?: SiteInput[K] extends number ? K : never }[keyof SiteInput];
type Field = [NumericKey, string, string, number, number, number];
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Mögliche Ladekunden", fields: [
    ["reachablePercent", "Anteil des Verkehrs mit Zugang zum Standort", "%", 0, 100, 1], ["capturePercent", "Anteil erreichbarer E-Lkw, die hier laden", "%", 0, 100, 0.1],
    ["energyKwh", "Energie je Ladung", "kWh", 1, 2000, 10], ["anchorCount", "Feste Kunden · Ladungen Montag bis Freitag", "pro Tag", 0, 1000, 1], ["anchorHour", "Ankunft der festen Kunden", "Uhr", 0, 23, 1],
  ] },
  { title: "Ladepark & Öffnungszeiten", fields: [
    ["ports", "Ladeplätze", "Anzahl", 1, 100, 1], ["portPowerKw", "Maximale Ladeleistung je Platz", "kW", 1, 2000, 10],
    ["vehiclePowerKw", "Maximale Ladeleistung des Lkw", "kW", 1, 2000, 10],
    ["gridPowerKw", "Netzleistung für den Ladepark · angenommen", "kW", 0, 100000, 50], ["lossPercent", "Stromverlust beim Laden", "%", 0, 30, 1],
    ["startHour", "Öffnung ab", "Uhr", 0, 23, 1], ["hoursOpen", "Öffnungsdauer · bis spätestens 24 Uhr", "Stunden", 0, 24, 1],
    ["turnaroundMinutes", "Zeit zwischen zwei Ladungen", "Minuten", 0, 120, 5], ["maxWaitMinutes", "Akzeptierte Wartezeit", "Minuten", 0, 240, 5],
  ] },
  { title: "Preise & Kosten · ohne Umsatzsteuer", fields: [
    ["salePrice", "Ladepreis für Kunden", "€/kWh", 0, 5, 0.01], ["electricityPrice", "Strompreis inkl. Netzgebühren & Abgaben", "€/kWh", 0, 5, 0.01],
    ["variableCost", "Weitere Kosten je verkaufter kWh", "€/kWh", 0, 5, 0.01], ["fixedCost", "Jährliche Kosten · z. B. Pacht & Wartung", "€/Jahr", 0, 10000000, 1000],
    ["capex", "Anfangsinvestition inkl. Netzanschluss & Bau", "€", 0, 100000000, 10000], ["discountPercent", "Kalkulationszins für die Investition", "%", 0, 100, 0.5],
    ["priceEscalationPercent", "Preisänderung pro Jahr", "%", -20, 20, 0.5], ["costEscalationPercent", "Kostenänderung pro Jahr", "%", -20, 20, 0.5],
    ["replacementAmount", "Geplante Erneuerung der Technik", "€", 0, 100000000, 10000], ["replacementYear", "Jahr der Erneuerung", "Jahr", 2027, 2036, 1],
    ["residualValue", "Restwert am Ende 2036", "€", 0, 100000000, 10000],
  ] },
  { title: "Angenommener E-Lkw-Anteil ab 2030", fields: [
    ["lowSharePercent", "Niedrig", "%", 0, 100, 1], ["baseSharePercent", "Basis", "%", 0, 100, 1], ["highSharePercent", "Hoch", "%", 0, 100, 1],
  ] },
];
// The six assumptions that move the result most; everything else sits collapsed under "Weitere Annahmen".
const FIELD_BY_KEY = new Map(GROUPS.flatMap((g) => g.fields).map((f) => [f[0], f] as const));
const KEY_GROUPS: { tour: string; title: string; fields: Field[] }[] = [
  { tour: "demand", title: "Kunden", fields: [FIELD_BY_KEY.get("capturePercent")!, [...FIELD_BY_KEY.get("baseSharePercent")!.slice(0, 1), "E-Lkw-Anteil ab 2030 · Basis", ...FIELD_BY_KEY.get("baseSharePercent")!.slice(2)] as Field] },
  { tour: "capacity", title: "Ladepark", fields: [FIELD_BY_KEY.get("ports")!, FIELD_BY_KEY.get("gridPowerKw")!] },
  { tour: "costs", title: "Geld", fields: [FIELD_BY_KEY.get("salePrice")!, FIELD_BY_KEY.get("capex")!] },
];
const KEY_FIELDS = new Set<NumericKey>(KEY_GROUPS.flatMap((g) => g.fields.map((f) => f[0])));
const MORE_COUNT = GROUPS.flatMap((g) => g.fields).length - KEY_FIELDS.size;
const STORAGE_KEY = "traffic-opportunity:planning:v1";
const draftOf = (input: SiteInput) => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === "number" ? String(value) : value]));
const number = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
const euro = (value: number) => `${number(value)} €`;
const BLOCKERS: Record<string, string> = {
  grid_power_unknown: "Die Netzleistung fehlt. Ohne bestätigten Wert oder ausdrücklich gesetzte Annahme ist keine Rechnung möglich.",
  site_inaccessible: "Der Standort wurde als für Lkw unzugänglich angegeben.", traffic_direction_split_unknown: "Für die gewählte Fahrtrichtung fehlt der Verkehrsanteil. Für berechnete Strecken liegt keine Aufteilung nach Richtung vor.",
};
const GAPS: Record<string, string> = {
  charging_demand_not_validated: "Wie viele E-Lkw hier tatsächlich laden würden, ist noch nicht belegt.",
  local_and_depot_traffic_not_inferred: "Zusätzliche Kunden aus der Umgebung oder aus Depots sind nicht ermittelt.",
  scenario_assumptions_not_probabilities: "Die drei Varianten zeigen Annahmen, nicht die Wahrscheinlichkeit ihrer Entwicklung.",
  annual_seasonality_not_modelled: "Jahreszeiten, Ferien und Feiertage werden nicht gesondert berücksichtigt.",
  truck_duty_cycle_and_energy_mix_assumed: "Energiebedarf und Fahrten der Lkw sind angenommen, nicht im Betrieb gemessen.",
  truck_access_not_verified: "Die Zufahrt für Lkw ist noch nicht bestätigt.", grid_offer_not_verified: "Ein verbindliches Angebot des Netzbetreibers fehlt.",
  competition_not_reviewed: "Der Einfluss anderer Ladeparks auf die Kundenzahl ist nicht geprüft.", heavy_traffic_includes_other_vehicles: "Die Verkehrszählung enthält neben Lkw auch andere schwere Fahrzeuge, etwa Busse.",
  hourly_profile_uses_heavy_traffic_proxy: "Die Verteilung über den Tag basiert auf schweren Fahrzeugen, nicht ausschließlich auf Lkw.",
  counting_station_match_not_reviewed: "Ob die Zählstelle den Verkehr am Standort abbildet, ist noch nicht geprüft.",
  source_commercial_rights_unresolved: "Die geschäftliche Nutzung einzelner Quellen muss noch geklärt werden.",
  historical_source_not_current_observation: "Einzelne Quellen zeigen ältere Werte, nicht den heutigen Verkehr.",
  direction_split_assumed_constant_by_hour: "Der Anteil je Fahrtrichtung wird zu jeder Tageszeit gleich angesetzt.",
  direction_share_assumed_half: "Für berechneten Verkehr gibt es keine Aufteilung nach Richtung. Für eine Richtung wird die Hälfte angesetzt.",
};

export type VerdictSummary = { siteId: string; tone: "good" | "mixed" | "bad"; title: string; low: number; base: number; high: number };
export const verdictOf = (npv: { low: number; base: number; high: number }) => {
  const tone = npv.base >= 0 ? "good" as const : npv.high >= 0 ? "mixed" as const : "bad" as const;
  return { tone, title: tone === "good" ? "Vertiefte Prüfung lohnt sich" : tone === "mixed" ? "Grenzwertig – hängt an den Annahmen" : "Unter diesen Annahmen nicht tragfähig" };
};

export default function ChargingPlanner({ sites, activeId, onSelect, registerDate, data, dataError, onRetry, choices, onBasisChange, onVerdict }: {
  sites: PlanningSite[]; activeId: string; onSelect: (id: string) => void; registerDate: string | null;
  data?: PlanningData; dataError: string; onRetry: () => void;
  choices: Record<string, BasisChoice | undefined>; onBasisChange: (id: string, choice?: BasisChoice) => void;
  onVerdict?: (summary: VerdictSummary | null) => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    try {
      const saved = siteInputSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
      return draftOf(saved.success ? saved.data : DEFAULT_SITE_INPUT);
    } catch { return draftOf(DEFAULT_SITE_INPUT); }
  });
  const [scenarioId, setScenarioId] = useState("base");
  const [yearIndex, setYearIndex] = useState(3);
  const [daytype, setDaytype] = useState<"weekday" | "saturday" | "sunday">("weekday");
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [calculationError, setCalculationError] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [storageStatus, setStorageStatus] = useState("");
  const [serverStatus, setServerStatus] = useState("");
  const [sensitivity, setSensitivity] = useState<WorkerReply["sensitivity"]>();
  const [sensitivityBusy, setSensitivityBusy] = useState(false);
  const [sensitivityRun, setSensitivityRun] = useState(0);
  const parsed = useMemo(() => siteInputSchema.safeParse(Object.fromEntries(Object.entries(draft).map(([key, value]) =>
    [key, typeof DEFAULT_SITE_INPUT[key as keyof SiteInput] === "number" ? typeof value === "string" && value.trim() !== "" ? Number(value) : NaN : value]))), [draft]);
  const assumptions = parsed.success ? parsed.data : null;
  const applyReference = (ref: ParameterReference) => setDraft((d) => ({ ...d, [ref.field]: String(ref.appliedValue),
    references: [...((d.references as ParameterReference[] | undefined) || []).filter((r) => r.field !== ref.field), ref] }));
  const undoReference = (field: ParameterReference["field"]) => setDraft((d) => {
    const refs = (d.references as ParameterReference[] | undefined) || [];
    const ref = refs.find((r) => r.field === field);
    return ref ? { ...d, [field]: String(ref.baselineValue), references: refs.filter((r) => r.field !== field) } : d;
  });
  const activeSite = sites.find((s) => s.id === activeId) || sites[0];
  const sitesKey = canonicalJson(sites.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })));
  const built = useMemo(() => {
    if (!data || !assumptions) return [];
    return sites.map(({ id, label, lat, lon }) => ({ id, ...buildSiteRequest({ id, label, lat, lon }, data, assumptions, choices[id]) }));
  }, [data, parsed, sitesKey, choices]);
  const activeBasis = built.find((b) => b.id === activeSite?.id);
  const activeEntry = entries.find((e) => e.id === activeSite?.id);
  const plan = activeEntry?.plan;
  const scenario = plan?.scenarios.find((s) => s.id === scenarioId);
  const year = scenario?.years[yearIndex];
  const finance = scenario?.finance.years[yearIndex];
  const referenceDays = year?.days.filter((d) => d.daytype === daytype) || [];
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour: `${hour}:00`,
    gridKw: referenceDays.reduce((sum, d) => sum + d.representativeWeight * d.hourly[hour].meanGridKw, 0),
    queue: referenceDays.reduce((max, d) => Math.max(max, d.hourly[hour].peakQueue), 0),
  }));

  useEffect(() => {
    if (!parsed.success) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.data)); setStorageStatus("Annahmen auf diesem Gerät gespeichert"); }
    catch { setStorageStatus("Lokales Speichern nicht verfügbar"); }
  }, [parsed]);
  useEffect(() => {
    setEntries([]); setSensitivity(undefined); setCalculationError(""); setExportStatus("");
    const requests = built.flatMap((b) => b.request ? [b.request] : []);
    if (!requests.length) { setBusy(false); return; }
    setBusy(true);
    let worker: Worker | undefined;
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL("../lib/charging-planning.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<WorkerReply>) => { setEntries(event.data.entries); setCalculationError(event.data.error || ""); setBusy(false); worker?.terminate(); };
        worker.onerror = () => { setCalculationError("Die Berechnung ist fehlgeschlagen. Bitte ändere eine Annahme oder lade die Seite neu."); setBusy(false); worker?.terminate(); };
        worker.postMessage({ requests });
      } catch { setCalculationError("Die Berechnung konnte nicht starten. Bitte lade die Seite neu."); setBusy(false); }
    }, 400);
    return () => { window.clearTimeout(timer); worker?.terminate(); };
  }, [built]);
  useEffect(() => {
    if (!onVerdict) return;
    if (busy || !plan || plan.status === "blocked" || !activeSite) { onVerdict(null); return; }
    const npv = (id: string) => plan.scenarios.find((x) => x.id === id)?.finance.npv ?? 0;
    const values = { low: npv("low"), base: npv("base"), high: npv("high") };
    onVerdict({ siteId: activeSite.id, ...values, ...verdictOf(values) });
  }, [plan, busy, activeSite?.id]);
  useEffect(() => {
    setServerStatus("");
    if (!plan || plan.status === "blocked") return;
    if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") { setServerStatus("Auf diesem Gerät berechnet. Die Website verwendet denselben Rechenweg."); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => { setServerStatus("Der technische Gegencheck dauert zu lange. Angezeigt wird die Rechnung auf diesem Gerät."); controller.abort(); }, 20000);
    setServerStatus("Technischer Gegencheck der Berechnung läuft …");
    fetch("/api/charging-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.input), signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error("Serverberechnung nicht verfügbar"); return r.json(); })
      .then(({ fingerprint: _fingerprint, ...remote }) => {
        if (!controller.signal.aborted) setServerStatus(canonicalJson(remote) === canonicalJson(plan) ? "Technischer Gegencheck erfolgreich. Die zugrunde liegenden Annahmen sind damit nicht bestätigt." : "Der technische Gegencheck liefert andere Werte. Ergebnisse vor Verwendung prüfen.");
      }).catch(() => { if (!controller.signal.aborted) setServerStatus("Der technische Gegencheck ist nicht verfügbar. Angezeigt wird die Rechnung auf diesem Gerät."); })
      .finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [plan]);
  useEffect(() => {
    setSensitivity(undefined);
    if (!sensitivityRun || !plan || plan.status === "blocked") { setSensitivityBusy(false); return; }
    setSensitivityBusy(true);
    const worker = new Worker(new URL("../lib/charging-planning.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => { setSensitivity(event.data.sensitivity); setSensitivityBusy(false); if (event.data.error) setCalculationError(event.data.error); worker.terminate(); };
    worker.onerror = () => { setSensitivityBusy(false); setCalculationError("Der Vergleich geänderter Annahmen ist fehlgeschlagen."); worker.terminate(); };
    worker.postMessage({ requests: [plan.input], changes: [
      { id: "Anteil ladender E-Lkw −50 %", field: "captureShare", value: plan.input.demand.captureShare * 0.5 },
      { id: "Anteil ladender E-Lkw +50 %", field: "captureShare", value: Math.min(1, plan.input.demand.captureShare * 1.5) },
      { id: "Strompreis +20 %", field: "electricityPricePerKwh", value: Math.min(5, plan.input.finance.electricityPricePerKwh * 1.2) },
      { id: "Investition +20 %", field: "capex", value: Math.min(100000000, plan.input.finance.capex * 1.2) },
    ] });
    return () => worker.terminate();
  }, [sensitivityRun, plan]);

  // Measured (2026) and modelled (2019–2030) traffic differ by up to factor two at the same site, so never rank them side by side.
  const sourceKinds = Array.from(new Set(entries.flatMap((e) => e.plan ? [`${e.plan.input.traffic.source.kind === "measured" ? "Zählstelle" : "Berechneter Verkehr"} ${e.plan.input.traffic.referenceYear}`] : [])));
  const mixedSources = sourceKinds.length > 1 ? sourceKinds.join(" und ") : "";
  const download = (format: "csv" | "json") => {
    const ready = entries.filter((e) => e.plan);
    if (!ready.length || busy || !assumptions) return;
    try {
      const content = format === "csv" ? "\uFEFF" + ready.map((e) => e.csv!.replace(/^\uFEFF/, "")).join("\r\n\r\n") : canonicalJson({ plans: ready.map((e) => e.plan), excluded: sites.filter((s) => !ready.some((e) => e.id === s.id)).map((s) => ({ id: s.id, label: s.label, reason: built.find((b) => b.id === s.id)?.reason || entries.find((e) => e.id === s.id)?.error || "Nicht berechnet" })) });
      const url = URL.createObjectURL(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ladepark-planung-2027-2036.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus(`${ready.length} Standortpläne exportiert. ${sites.length - ready.length} Standorte ohne Berechnung.`);
    } catch { setExportStatus("Export fehlgeschlagen."); }
  };

  const renderField = ([key, label, unit, min, max, step]: Field) => {
    const issue = parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === key);
    return <div className="economics-field" key={key}><label htmlFor={`plan-${key}`}>{label}</label><div className={`economics-value${issue ? " invalid" : ""}`}><input id={`plan-${key}`} type="number" min={min} max={max} step={step} value={String(draft[key] ?? DEFAULT_SITE_INPUT[key])} disabled={key === "gridPowerKw" && !draft.gridKnown} aria-invalid={!!issue} aria-describedby={issue ? `plan-error-${key}` : undefined} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value, references: ((d.references as ParameterReference[] | undefined) || []).filter((r) => r.field !== key) }))} /><span>{unit}</span></div>{issue && <p className="economics-error" id={`plan-error-${key}`}>{issue.code === "custom" ? issue.message : `Wert zwischen ${number(min)} und ${number(max)} erforderlich.`}</p>}</div>;
  };
  // Open the collapsed block automatically when an invalid value hides inside it.
  const hiddenIssue = !parsed.success && parsed.error.issues.some((i) => !KEY_FIELDS.has(i.path[0] as NumericKey));

  return <section id="wirtschaftlichkeit" className="economics" aria-labelledby="economics-title">
    <div className="economics-inner">
      <header className="economics-header"><div>
        <p className="economics-eyebrow"><Calculator size={16} /> LADEPARK-PLANUNG · 2027–2036</p>
        <h2 id="economics-title">Kann sich der Ladepark rechnen?</h2>
        <p className="economics-subtitle">Für eigene Flotten und externe Kunden · {sites.length} {sites.length === 1 ? "Standort" : "Standorte"} · Geldwerte ohne Umsatzsteuer</p>
      </div><div data-tour="exports" className="economics-actions">
        <button className="economics-icon" title="Beispielannahmen wiederherstellen" aria-label="Beispielannahmen wiederherstellen" onClick={() => setDraft(draftOf(DEFAULT_SITE_INPUT))}><RotateCcw size={18} /></button>
        <button className="economics-export" disabled={busy || !assumptions || !entries.some((e) => e.plan)} onClick={() => download("csv")}><ArrowDownToLine size={17} /> CSV</button>
        <button className="economics-export" disabled={busy || !assumptions || !entries.some((e) => e.plan)} onClick={() => download("json")}><ArrowDownToLine size={17} /> JSON</button>
      </div></header>
      <div className="economics-evidence"><span>{data ? `${number(data.network.edges.length)} berechnete Straßenabschnitte` : "Planungsdaten werden geladen …"}</span><span>Verkehrszählung bis {data ? new Date(data.bast.period.end).toLocaleDateString("de-DE", { timeZone: "UTC" }) : "…"}</span><span>Ladepunktregister: {registerDate ? new Date(registerDate).toLocaleDateString("de-DE", { timeZone: "UTC" }) : "nicht verfügbar"}</span><a href="#methodik">Daten & Grenzen</a></div>
      <p className="economics-notice"><AlertTriangle size={16} /> Die Ergebnisse gelten unter deinen Annahmen zu Kunden, Preisen und E-Lkw-Anteil. Sie sind keine Prognose für tatsächliche Ladungen oder Gewinne. Ob der gemessene Verkehr den Standort erreicht, ist noch zu prüfen.</p>
      {dataError && <p role="alert" className="economics-empty">{dataError} <button onClick={onRetry}>Erneut laden</button></p>}
      <Verdict site={activeSite} plan={plan} busy={busy} choice={choices[activeSite?.id]} roadWarning={activeBasis ? stationRoadWarning(activeSite?.label || "", activeBasis, choices[activeSite?.id]?.basis === "station" ? (choices[activeSite.id] as { stationId: string }).stationId : undefined) : null} />
      <div className="economics-layout">
        <div className="economics-inputs">
          <div className="economics-section-heading"><h3>Annahmen</h3><span>Für alle Standorte gleich</span></div>
          {KEY_GROUPS.map((group) => <div key={group.tour} data-tour={group.tour} className="assumption-key"><p>{group.title}</p><div className="economics-fields">{group.fields.map(renderField)}</div></div>)}
          <details className="economics-group assumption-more" open={hiddenIssue || undefined}><summary>Weitere Annahmen <span>{MORE_COUNT} Werte · Beispielwerte, bitte prüfen</span></summary>
            {GROUPS.map((group) => {
              const rest = group.fields.filter(([key]) => !KEY_FIELDS.has(key));
              return rest.length ? <div className="assumption-subgroup" key={group.title}><h4>{group.title}</h4><div className="economics-fields">{rest.map(renderField)}</div></div> : null;
            })}
            <div className="assumption-subgroup"><h4>Standort</h4>
              <label className="planning-checkbox"><input type="checkbox" checked={!!draft.anchorIncluded} onChange={(e) => setDraft((d) => ({ ...d, anchorIncluded: e.target.checked }))} /> Feste Kunden sind bereits im vorbeifahrenden Verkehr mitgezählt</label>
              <label className="planning-checkbox"><input type="checkbox" checked={!!draft.gridKnown} onChange={(e) => setDraft((d) => ({ ...d, gridKnown: e.target.checked }))} /> Für die Rechnung eine Netzleistung annehmen</label>
              <label className="planning-select">Lkw-Zufahrt<select value={String(draft.access)} onChange={(e) => setDraft((d) => ({ ...d, access: e.target.value }))}><option value="assumed">Angenommen, nicht bestätigt</option><option value="unknown">Unbekannt</option><option value="verified">Vom Nutzer geprüft</option><option value="inaccessible">Nicht zugänglich</option></select></label>
            </div>
          </details>
          <details className="economics-group"><summary>So wird gerechnet</summary><ul className="assumption-notes">
            <li>Der E-Lkw-Anteil startet 2027 mit einem Viertel des angegebenen Werts und erreicht ihn 2030. Die Verkehrsmenge bleibt dabei gleich.</li>
            <li>Ladeleistung von Lkw und Ladeplatz gilt an der Batterie (DC), die Netzleistung vor Ladeverlusten (AC). Alle Plätze teilen sich die Netzleistung.</li>
            <li>Feste Kunden kommen Montag bis Freitag zur angegebenen Uhrzeit. Andere Ladeparks verringern die Kundenzahl nicht automatisch.</li>
            <li>Technische Ausfälle und schwankende Ladeleistung während einer Ladung sind nicht berücksichtigt.</li>
          </ul></details>
          <p className="economics-storage" role="status">{assumptions ? storageStatus : "Ungültige Eingaben werden nicht gespeichert."}</p>
          <PublicContextPanel site={activeSite} input={assumptions} stationId={choices[activeSite?.id]?.basis === "station" ? (choices[activeSite.id] as { stationId: string }).stationId : undefined} onApply={applyReference} onUndo={undoReference} />
        </div>
        <div className="economics-results" aria-busy={busy}>
          <div className="economics-selection"><label htmlFor="planning-site">Standort</label><select id="planning-site" value={activeSite?.id || ""} onChange={(e) => onSelect(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          <TrafficBasisSelect id="planning-basis" siteLabel={activeSite?.label} context={activeBasis} choice={choices[activeSite?.id]} onChange={(choice) => onBasisChange(activeSite.id, choice)} />
          {choices[activeSite?.id]?.basis === "model" && <p className="economics-warning"><AlertTriangle size={15} /> Der Verkehr ist berechnet, nicht gemessen. Die Menge wird zwischen den Modelljahren 2019 und 2030 interpoliert. Die Verteilung über Tag und Woche ist der Durchschnitt aller vollständigen BASt-Zählstellen, nicht dieser Strecke.</p>}
          {plan && <div className="planning-source"><strong>{plan.input.traffic.source.kind === "measured" ? "Verkehrszählung in der Nähe · Bezug zum Standort noch ungeprüft" : "Berechneter Verkehr · keine Messung"}</strong><span>{number(plan.input.traffic.trucksPerDay)} {plan.input.traffic.vehicleClass === "truck" ? "Lkw" : "schwere Fahrzeuge"} pro Tag in beiden Richtungen · Daten für {plan.input.traffic.referenceYear}</span><span>Angesetzt: {{ both: "beide Richtungen", r1: "nur Richtung R1", r2: "nur Richtung R2", one_unknown: "eine Richtung, Hälfte angenommen" }[plan.input.site.access.directions || "both"]}</span><a href={plan.input.traffic.source.url} target="_blank" rel="noreferrer">{plan.input.traffic.source.title}</a></div>}
          <div data-tour="results" className="economics-scenarios" role="group" aria-label="Angenommener E-Lkw-Anteil">{[["low", "Niedrig", draft.lowSharePercent], ["base", "Basis", draft.baseSharePercent], ["high", "Hoch", draft.highSharePercent]].map(([id, label, share]) => <button key={String(id)} aria-pressed={id === scenarioId} onClick={() => setScenarioId(String(id))}><span>{String(label)}</span><strong>{String(share)} % E-Lkw ab 2030</strong></button>)}</div>
          {!assumptions ? <p role="alert" className="economics-empty">Bitte korrigiere die markierten Werte. Vorher ist keine Berechnung möglich.</p> : busy ? <p role="status" className="economics-empty">Ladungen, Wartezeiten und Einnahmen werden berechnet …</p> : activeEntry?.error || calculationError ? <p role="alert" className="economics-empty">{activeEntry?.error || calculationError}</p> : !plan ? <p className="economics-empty">{activeBasis?.reason || "Planungsdaten werden geladen …"}</p> : plan.status === "blocked" ? <div role="alert" className="economics-empty">Noch keine Berechnung möglich.{plan.evidence.blockers.map((b) => <p key={b}>{BLOCKERS[b] || b}</p>)}</div> : scenario && year && finance && <>
            <div className="economics-kpis"><div><span>Investitionsergebnis · 2027–2036</span><strong data-testid="planning-npv" className={scenario.finance.npv >= 0 ? "positive" : "negative"}>{euro(scenario.finance.npv)}</strong><small>Kapitalwert: Einnahmen minus Kosten und Investitionen, auf den Startzeitpunkt umgerechnet. Ein positiver Wert übertrifft den gewählten Kalkulationszins.</small></div><div><span>Investition rechnerisch zurückverdient</span><strong>{scenario.finance.discountedPaybackYear ?? "Nicht bis 2036"}</strong><small>Mit Kalkulationszins. {scenario.finance.discountedPaybackYear ? scenario.finance.discountedRecoverySustained ? "Bleibt bis Ende 2036 zurückverdient." : "Spätere Ausgaben machen diesen Stand wieder zunichte." : "Unter den gewählten Annahmen."}</small></div></div>
            <label className="planning-select">Betriebsjahr<select value={yearIndex} onChange={(e) => setYearIndex(Number(e.target.value))}>{scenario.years.map((y, i) => <option value={i} key={y.year}>{y.year} · {number(y.evShare * 100, 1)} % E-Lkw</option>)}</select></label>
            <div className="economics-capacity"><div><h3>Wie viele Ladungen sind möglich? · {year.year}</h3><strong>{year.servedShare === null ? "Keine Ladungen angenommen" : `${number(year.servedShare * 100)} % vollständig geladen`}</strong></div><div className="economics-meter" role="meter" aria-label="Anteil vollständig abgeschlossener Ladungen" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((year.servedShare || 0) * 100)}><span style={{ width: `${(year.servedShare || 0) * 100}%` }} /></div><div className="economics-capacity-values"><div><strong>{number(year.offeredSessions / year.calendarDays, 1)}</strong><span>Ladewünsche pro Tag</span></div><div><strong>{number(year.completedSessions / year.calendarDays, 1)}</strong><span>Vollständige Ladungen pro Tag</span></div><div><strong>{number(year.unservedSessions / year.calendarDays, 1)}</strong><span>Nicht oder nur teilweise geladen pro Tag</span></div></div><p className="economics-footnote">Durchschnitt pro Kalendertag im angenommenen Jahr. Bei unvollständigen Ladungen zählt die abgegebene Energie zum Umsatz, der Ladevorgang aber nicht als vollständig abgeschlossen.</p></div>
            <dl className="economics-ledger"><div><dt>Umsatz aus {number(year.deliveredKwh / 1000)} MWh Ladestrom</dt><dd>{euro(finance.revenue)}</dd></div><div><dt>Eingekaufter Strom inkl. Ladeverlusten</dt><dd>− {euro(finance.electricityCost)}</dd></div><div><dt>Weitere Kosten je verkaufter kWh</dt><dd>− {euro(finance.variableCost)}</dd></div><div><dt>Jährliche feste Kosten</dt><dd>− {euro(finance.fixedCost)}</dd></div><div className="economics-total"><dt>{finance.operatingCashflow >= 0 ? "Laufender Überschuss" : "Laufender Fehlbetrag"} · {year.year}</dt><dd data-testid="operating-surplus">{euro(finance.operatingCashflow)}</dd></div></dl>
            <p className="economics-footnote">Einnahmen minus Betriebskosten, vor Investitionen, Finanzierung und Steuern. Ein Überschuss allein zeigt noch nicht, ob sich der Bau lohnt.</p>
            <p className={`economics-break-even${year.breakEven.achievedInScenario ? "" : " warning"}`}><strong>Laufende Kosten gedeckt ab: </strong>{year.breakEven.requiredEquivalentSessionsPerDay === null ? "Bei diesen Preisen werden die laufenden Kosten nicht gedeckt." : `${number(year.breakEven.requiredEquivalentSessionsPerDay, 1)} Ladungen mit je ${number(plan.input.demand.energyKwh)} kWh pro Tag. ${year.breakEven.achievedInScenario ? "In dieser Variante erreicht." : "In dieser Variante nicht erreicht."}`} Die Anfangsinvestition ist damit noch nicht zurückbezahlt.</p>
            <label className="planning-select">Strombedarf im Tagesverlauf · {year.year}<select value={daytype} onChange={(e) => setDaytype(e.target.value as typeof daytype)}><option value="weekday">Montag bis Freitag</option><option value="saturday">Samstag</option><option value="sunday">Sonntag</option></select></label>
            <div className="planning-chart" role="img" aria-label="Berechnete durchschnittliche Netzleistung je Stunde"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourly}><CartesianGrid stroke="#e4e8e8" vertical={false} /><XAxis dataKey="hour" interval={3} tick={TICK} axisLine={AXIS} tickLine={AXIS} /><YAxis tick={TICK} axisLine={false} tickLine={false} width={48} /><Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#e4f3ec" }} formatter={(value: number) => [`${number(value, 1)} kW`, "Durchschnittliche Leistung vom Netz"]} /><Bar dataKey="gridKw" fill="#0a7c63" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
            <p className="economics-footnote">Höchste berechnete Netzleistung: {number(year.peakGridKw)} kW. Größte Warteschlange an den berechneten Tagen dieses Tagtyps: {number(Math.max(0, ...hourly.map((h) => h.queue)))} Lkw. Die Balken zeigen Stundenmittel, keine einzelnen Leistungsspitzen.</p>
            <p className="planning-chart-title" aria-hidden="true">Investition und Rückflüsse bis 2036 · mit Kalkulationszins</p><div className="planning-chart" role="img" aria-label="Aufsummierte Einnahmen und Ausgaben inklusive Investition, mit Kalkulationszins bis 2036"><ResponsiveContainer width="100%" height="100%"><LineChart data={[{ year: 2026, cumulativeDiscountedCashflow: scenario.finance.initialCashflow }, ...scenario.finance.years]}><CartesianGrid stroke="#e4e8e8" vertical={false} /><XAxis dataKey="year" tick={TICK} axisLine={AXIS} tickLine={AXIS} /><YAxis width={76} tick={TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${number(v / 1000)} T€`} /><ReferenceLine y={0} stroke="#8a969a" strokeDasharray="4 3" ifOverflow="extendDomain" /><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [euro(v), "Gesamtergebnis mit Kalkulationszins"]} /><Line dataKey="cumulativeDiscountedCashflow" stroke={scenario.finance.npv >= 0 ? "#0a7c63" : "#b13632"} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
            <details className="economics-method"><summary>Ergebnisse für jedes Jahr</summary><div className="economics-table-wrap"><table className="economics-table"><thead><tr><th>Jahr</th><th>Ladestrom MWh</th><th>Unvollständige Ladungen/Tag</th><th>Laufender Überschuss</th><th>Gesamtergebnis mit Kalkulationszins</th></tr></thead><tbody>{scenario.years.map((y, i) => <tr key={y.year}><th>{y.year}</th><td>{number(y.deliveredKwh / 1000)}</td><td>{number(y.unservedSessions / y.calendarDays, 1)}</td><td>{euro(scenario.finance.years[i].operatingCashflow)}</td><td>{euro(scenario.finance.years[i].cumulativeDiscountedCashflow)}</td></tr>)}</tbody></table></div></details>
            <div className="planning-sensitivity"><button className="economics-export" disabled={sensitivityBusy} onClick={() => setSensitivityRun((n) => n + 1)}><Calculator size={16} /> {sensitivityBusy ? "Varianten werden berechnet …" : "Was passiert bei anderen Annahmen?"}</button>{sensitivity && <div className="economics-table-wrap"><table className="economics-table"><caption>{scenario.label}: jeweils eine Annahme verändert</caption><thead><tr><th>Änderung</th><th>Investitionsergebnis</th><th>Unterschied</th></tr></thead><tbody>{sensitivity.changes.filter((c) => c.scenarioId === scenarioId).map((c) => <tr key={c.id}><th>{c.id}</th><td>{euro(c.npv)}</td><td>{euro(c.npvDelta)}</td></tr>)}</tbody></table><p className="economics-footnote">Alle anderen Annahmen und die Verteilung der Ankünfte bleiben gleich. Der Vergleich zeigt die Wirkung einer Änderung, nicht die Wahrscheinlichkeit des Ergebnisses.</p></div>}</div>
          </>}
          <p className="economics-storage" role="status">{serverStatus}</p>
          {plan && <details className="economics-method"><summary>Was vor einer Investition noch fehlt</summary><ul className="planning-gaps">{plan.evidence.gaps.map((gap) => <li key={gap}>{GAPS[gap] || gap}</li>)}</ul><details><summary>Verwendete Quellen & Herkunftsnachweise</summary>{Array.from(new Map(plan.evidence.sources.map((source) => [source.id, source])).values()).map((source) => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · Lizenz: {source.license} · Stand {source.observedThrough}<br /><small>SHA-256: {source.sha256}</small></p>)}</details><p>Vor einer Investition: Lkw-Zufahrt vor Ort prüfen, ein verbindliches Netzangebot einholen und Annahmen mit festen Kunden sowie realen Ladevorgängen abgleichen.</p></details>}
        </div>
      </div>
      {sites.length > 1 && mixedSources && <p role="alert" className="economics-warning"><AlertTriangle size={15} /> Die Standorte nutzen unterschiedliche Verkehrsdaten ({mixedSources}). Die Ergebnisse sind nicht vergleichbar und werden deshalb nicht nebeneinander gezeigt. Wähle für alle Standorte dieselbe Art von Datenquelle.</p>}
      {sites.length > 1 && <div className="economics-comparison economics-table-wrap"><table className="economics-table"><caption>Standortvergleich · {scenarioId === "base" ? "Basis" : scenarioId === "low" ? "Niedrig" : "Hoch"} · gleiche Annahmen, unterschiedliche Verkehrsdaten</caption><thead><tr><th>Standort</th><th>Datenquelle</th><th>Investitionsergebnis 2027–2036</th><th>Status</th></tr></thead><tbody>{sites.map((site) => {
        const entry = entries.find((e) => e.id === site.id); const s = entry?.plan?.scenarios.find((s) => s.id === scenarioId);
        const traffic = entry?.plan?.input.traffic;
        return <tr key={site.id} className={site.id === activeSite?.id ? "selected" : ""}><th><button onClick={() => onSelect(site.id)}>{site.label}</button></th><td>{traffic ? `${traffic.source.kind === "measured" ? "Zählstelle" : "Berechneter Verkehr"} · ${traffic.referenceYear} · ${traffic.vehicleClass === "truck" ? "Lkw" : "inkl. anderer schwerer Fahrzeuge"}` : "Nicht gewählt"}</td><td>{s ? mixedSources ? "Nicht vergleichbar" : euro(s.finance.npv) : "Nicht berechnet"}</td><td>{busy ? "Berechnung läuft" : entry?.plan?.status === "blocked" ? "Angaben fehlen oder schließen Laden aus" : s ? "Ergebnis unter Annahmen" : entry?.error || "Datenquelle fehlt"}</td></tr>;
      })}</tbody></table></div>}
      <details className="economics-method"><summary>So entstehen die Ergebnisse</summary><p>Ausgangspunkt ist der Verkehr der gewählten Quelle. Davon werden die Anteile angesetzt, die den Standort erreichen, elektrisch fahren und hier laden. Feste Kunden kommen hinzu oder werden, wenn bereits mitgezählt, nicht doppelt angesetzt.</p><p>Die Stundenmessungen der BASt aus Juli bestimmen die Verteilung auf Tageszeiten und Wochentage. Bei berechnetem Verkehr wird das durchschnittliche Profil aller vollständigen Zählstellen verwendet und die Menge zwischen 2019 und 2030 interpoliert. Die Fahrtrichtung wählst du je Standort; ohne diese Wahl gibt es kein Ergebnis. In Fünf-Minuten-Schritten werden Ladeplätze, die gemeinsam verfügbare Netzleistung, Wartezeiten und Öffnungszeiten berücksichtigt. Offene Ladungen werden nicht am nächsten Tag fortgesetzt.</p><p>Berechnete Beispieltage werden auf das jeweilige Kalenderjahr hochgerechnet. Die Rechnung berücksichtigt den angenommenen E-Lkw-Anteil, Preis- und Kostenänderungen, Erneuerungen der Technik und den Restwert. Künftige Einnahmen und Ausgaben werden mit dem Kalkulationszins auf den Startzeitpunkt umgerechnet.</p><p>Nicht enthalten sind Steuern, Finanzierung, Fördermittel, schwankende Ladeleistung während einer Ladung, Jahreszeiten und technische Ausfälle. Der historische Chronos-2-Test verändert die Ladekundenzahl nicht. Dokumentierte Quellen und Nutzerangaben ersetzen keine unabhängige Prüfung.</p></details>
      <p className="economics-export-status" role="status">{exportStatus}</p>
    </div>
  </section>;
}

const DIRECTION_LABEL = { both: "Beide Richtungen", r1: "Nur Richtung R1", r2: "Nur Richtung R2", one_unknown: "Eine Richtung · Hälfte" } as const;

// Decision-first summary: one verdict, the NPV range across the three scenarios and the levers that move it most.
function Verdict({ site, plan, busy, choice, roadWarning }: {
  site?: PlanningSite; plan?: PlanEntry["plan"]; busy: boolean; choice?: BasisChoice; roadWarning: string | null;
}) {
  if (!site) return null;
  const steps = [
    { label: "Standort gesetzt", done: true },
    { label: "Verkehrsquelle gewählt", done: !!choice },
    { label: "Fahrtrichtung gewählt", done: !!choice?.direction },
  ];
  if (!plan || plan.status === "blocked" || !plan.scenarios.length) {
    return <div className="verdict verdict-pending" aria-live="polite">
      <p className="verdict-eyebrow">{site.label}</p>
      <p className="verdict-title">{busy ? "Ergebnis wird berechnet …" : plan?.status === "blocked" ? "Noch keine Rechnung möglich" : "Noch zwei Angaben bis zum Ergebnis"}</p>
      <ol className="verdict-steps">{steps.map((step, i) => <li key={step.label} className={step.done ? "done" : ""}><span>{step.done ? <Check size={13} /> : i + 1}</span>{step.label}</li>)}</ol>
      {!choice?.direction && !busy && <p className="verdict-hint">Wähle unten bei „Verkehrsdaten für diesen Standort“ die Quelle und die Fahrtrichtung.</p>}
    </div>;
  }
  const byId = Object.fromEntries(plan.scenarios.map((s) => [s.id, s]));
  const low = byId.low?.finance.npv ?? 0, base = byId.base?.finance.npv ?? 0, high = byId.high?.finance.npv ?? 0;
  const { tone, title } = verdictOf({ low, base, high });
  const year2030 = byId.base?.years.find((y) => y.year === 2030);
  const sessions = year2030 ? year2030.offeredSessions / year2030.calendarDays : null;
  const span = Math.max(Math.abs(low), Math.abs(high), 1);
  const pos = (v: number) => `${50 + (v / span) * 50}%`;
  const fmt = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Mio. €`;
  const traffic = plan.input.traffic;
  return <div className={`verdict verdict-${tone}`} aria-live="polite">
    <div className="verdict-main">
      <p className="verdict-eyebrow">{site.label}</p>
      <p className="verdict-title">{title}</p>
      <p className="verdict-sub">Kapitalwert 2027–2036 über die drei E-Lkw-Szenarien. {byId.base?.finance.discountedPaybackYear ? `Basis zurückverdient ${byId.base.finance.discountedPaybackYear}.` : "Basis bis 2036 nicht zurückverdient."}</p>
      <div className="verdict-range" role="img" aria-label={`Kapitalwert niedrig ${fmt(low)}, Basis ${fmt(base)}, hoch ${fmt(high)}`}>
        <div className="verdict-axis"><span className="verdict-zero" style={{ left: "50%" }} /><span className="verdict-band" style={{ left: pos(Math.min(low, high)), width: `calc(${pos(Math.max(low, high))} - ${pos(Math.min(low, high))})` }} /><span className="verdict-dot" style={{ left: pos(base) }} /></div>
        <div className="verdict-labels"><span>Niedrig<b>{fmt(low)}</b></span><span>Basis<b>{fmt(base)}</b></span><span>Hoch<b>{fmt(high)}</b></span></div>
      </div>
    </div>
    <div className="verdict-side">
      <div className="verdict-metric"><span>Ladewünsche pro Tag · 2030</span><b>{sessions === null ? "–" : sessions.toLocaleString("de-DE", { maximumFractionDigits: 1 })}</b></div>
      <p className="verdict-levers-title">Was das Ergebnis am stärksten bewegt</p>
      <ul className="verdict-levers">
        <li><span>Verkehrsquelle</span><b>{traffic.source.kind === "measured" ? "Zählstelle" : "Modell"} · {traffic.referenceYear}</b></li>
        <li><span>Fahrtrichtung</span><b>{DIRECTION_LABEL[plan.input.site.access.directions || "both"]}</b></li>
        <li className={roadWarning ? "warn" : ""}><span>Straße</span><b>{roadWarning ? "Prüfen" : "Kein Widerspruch erkannt"}</b></li>
      </ul>
    </div>
  </div>;
}
