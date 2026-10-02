import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, Calculator, RotateCcw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { stroke: "#c5cdcf" };
const TICK = { fontSize: 10, fill: "#667278" };
const TOOLTIP_STYLE = { borderRadius: 6, border: "1px solid #dce1e1", fontSize: 12, boxShadow: "0 2px 8px rgba(32,36,38,0.08)" };
import { canonicalJson } from "@shared/charging-planning";
import TrafficBasisSelect from "./traffic-basis-select";
import { buildSiteRequest, DEFAULT_SITE_INPUT, siteInputSchema, type BasisChoice, type PlanningData, type PlanningSite, type SiteInput } from "@shared/charging-planning/site-input";
import type { PlanEntry, WorkerReply } from "@/lib/charging-planning.worker";
import "./site-economics.css";
import "./charging-planner.css";

type NumericKey = { [K in keyof SiteInput]: SiteInput[K] extends number ? K : never }[keyof SiteInput];
type Field = [NumericKey, string, string, number, number, number];
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Nachfrage & Ankerkunden", fields: [
    ["reachablePercent", "Erreichbarer Verkehrsanteil", "%", 0, 100, 1], ["capturePercent", "Anhaltequote der E-Lkw", "%", 0, 100, 0.1],
    ["energyKwh", "Energie je Ladung", "kWh", 1, 2000, 10], ["anchorCount", "Ankerkunden · Montag bis Freitag", "Ladungen/Tag", 0, 1000, 1], ["anchorHour", "Ankunft der Ankerkunden", "Uhr", 0, 23, 1],
  ] },
  { title: "Ladepark & Öffnungszeiten", fields: [
    ["ports", "Ladeplätze", "Anzahl", 1, 100, 1], ["portPowerKw", "Leistung je Ladeplatz · DC", "kW", 1, 2000, 10],
    ["gridPowerKw", "Angenommene Netzleistung · AC", "kW", 0, 100000, 50], ["lossPercent", "Ladeverluste", "%", 0, 30, 1],
    ["startHour", "Öffnung ab", "Uhr", 0, 23, 1], ["hoursOpen", "Öffnungsdauer · bis spätestens 24 Uhr", "Stunden", 0, 24, 1],
    ["turnaroundMinutes", "Wechselzeit", "Minuten", 0, 120, 5], ["maxWaitMinutes", "Maximale Wartezeit", "Minuten", 0, 240, 5],
  ] },
  { title: "Preise & Kosten · netto", fields: [
    ["salePrice", "Verkaufspreis", "€/kWh", 0, 5, 0.01], ["electricityPrice", "Strombezug inkl. Netzentgelten", "€/kWh", 0, 5, 0.01],
    ["variableCost", "Weitere variable Kosten", "€/kWh", 0, 5, 0.01], ["fixedCost", "Fixkosten inkl. Pacht & Wartung", "€/Jahr", 0, 10000000, 1000],
    ["capex", "Investition inkl. Netz & Bau", "€", 0, 100000000, 10000], ["discountPercent", "Diskontsatz", "%", 0, 100, 0.5],
    ["priceEscalationPercent", "Preisänderung pro Jahr", "%", -20, 20, 0.5], ["costEscalationPercent", "Kostenänderung pro Jahr", "%", -20, 20, 0.5],
    ["replacementAmount", "Ersatzinvestition", "€", 0, 100000000, 10000], ["replacementYear", "Jahr der Ersatzinvestition", "Jahr", 2027, 2036, 1],
    ["residualValue", "Restwert am Ende 2036", "€", 0, 100000000, 10000],
  ] },
  { title: "E-Lkw-Hochlauf · Zielanteile 2030", fields: [
    ["lowSharePercent", "Niedrig", "%", 0, 100, 1], ["baseSharePercent", "Basis", "%", 0, 100, 1], ["highSharePercent", "Hoch", "%", 0, 100, 1],
  ] },
];
const STORAGE_KEY = "traffic-opportunity:planning:v1";
const draftOf = (input: SiteInput) => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === "number" ? String(value) : value]));
const number = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
const euro = (value: number) => `${number(value)} €`;
const BLOCKERS: Record<string, string> = {
  grid_power_unknown: "Netzleistung unbekannt. Ohne eine explizite Leistungsannahme werden keine Erträge berechnet.",
  site_inaccessible: "Standort für Lkw nicht zugänglich.", traffic_direction_split_unknown: "Fahrtrichtungsanteil unbekannt. Die Modellstrecke liefert keinen belastbaren Richtungssplit.",
};
const GAPS: Record<string, string> = {
  charging_demand_not_validated: "Ladenachfrage und Anhaltequote nicht empirisch validiert",
  local_and_depot_traffic_not_inferred: "Lokaler Verkehr und Depotnachfrage nicht abgeleitet",
  scenario_assumptions_not_probabilities: "Szenarien sind Annahmen, keine Wahrscheinlichkeiten",
  annual_seasonality_not_modelled: "Keine Jahressaisonalität oder Feiertagseffekte",
  truck_duty_cycle_and_energy_mix_assumed: "Energiebedarf und Fahrzyklen angenommen",
  truck_access_not_verified: "Lkw-Zufahrt nicht bestätigt", grid_offer_not_verified: "Kein verbindliches Netzangebot",
  competition_not_reviewed: "Wettbewerb nicht geprüft", heavy_traffic_includes_other_vehicles: "Schwerverkehr enthält auch andere Fahrzeuge",
  hourly_profile_uses_heavy_traffic_proxy: "Stundenprofil auf Schwerverkehrsbasis",
  counting_station_match_not_reviewed: "Profil- und Standortzuordnung ungeprüft",
  source_commercial_rights_unresolved: "Kommerzielle Nutzungsrechte ungeklärt",
  historical_source_not_current_observation: "Historische Quelle, keine aktuelle Verkehrsmessung",
  direction_split_assumed_constant_by_hour: "Richtungsanteil über alle Stunden konstant angenommen",
};

export default function ChargingPlanner({ sites, activeId, onSelect, registerDate, data, dataError, onRetry, choices, onBasisChange }: {
  sites: PlanningSite[]; activeId: string; onSelect: (id: string) => void; registerDate: string | null;
  data?: PlanningData; dataError: string; onRetry: () => void;
  choices: Record<string, BasisChoice | undefined>; onBasisChange: (id: string, choice?: BasisChoice) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => {
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
        worker.onerror = () => { setCalculationError("Simulation konnte nicht ausgeführt werden."); setBusy(false); worker?.terminate(); };
        worker.postMessage({ requests });
      } catch { setCalculationError("Simulation konnte nicht gestartet werden."); setBusy(false); }
    }, 400);
    return () => { window.clearTimeout(timer); worker?.terminate(); };
  }, [built]);
  useEffect(() => {
    setServerStatus("");
    if (!plan || plan.status === "blocked") return;
    if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") { setServerStatus("Lokale Berechnung · identische Engine wie im Server"); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => { setServerStatus("Server-Abgleich hat das Zeitlimit überschritten · lokale Szenariorechnung"); controller.abort(); }, 20000);
    setServerStatus("Server-Abgleich läuft …");
    fetch("/api/charging-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.input), signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error("Serverberechnung nicht verfügbar"); return r.json(); })
      .then(({ fingerprint: _fingerprint, ...remote }) => {
        if (!controller.signal.aborted) setServerStatus(canonicalJson(remote) === canonicalJson(plan) ? "Server-Abgleich bestätigt · identische Ergebnisse" : "Server-Abweichung: Ergebnisse vor Verwendung prüfen");
      }).catch(() => { if (!controller.signal.aborted) setServerStatus("Server-Abgleich nicht verfügbar · lokale Szenariorechnung"); })
      .finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [plan]);
  useEffect(() => {
    setSensitivity(undefined);
    if (!sensitivityRun || !plan || plan.status === "blocked") { setSensitivityBusy(false); return; }
    setSensitivityBusy(true);
    const worker = new Worker(new URL("../lib/charging-planning.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => { setSensitivity(event.data.sensitivity); setSensitivityBusy(false); if (event.data.error) setCalculationError(event.data.error); worker.terminate(); };
    worker.onerror = () => { setSensitivityBusy(false); setCalculationError("Sensitivitätsrechnung fehlgeschlagen"); worker.terminate(); };
    worker.postMessage({ requests: [plan.input], changes: [
      { id: "Anhaltequote −50 %", field: "captureShare", value: plan.input.demand.captureShare * 0.5 },
      { id: "Anhaltequote +50 %", field: "captureShare", value: Math.min(1, plan.input.demand.captureShare * 1.5) },
      { id: "Strompreis +20 %", field: "electricityPricePerKwh", value: Math.min(5, plan.input.finance.electricityPricePerKwh * 1.2) },
      { id: "Investition +20 %", field: "capex", value: Math.min(100000000, plan.input.finance.capex * 1.2) },
    ] });
    return () => worker.terminate();
  }, [sensitivityRun, plan]);

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

  return <section id="wirtschaftlichkeit" className="economics" aria-labelledby="economics-title">
    <div className="economics-inner">
      <header className="economics-header"><div>
        <p className="economics-eyebrow"><Calculator size={16} /> LADEPARK-PLANUNG · 2027–2036</p>
        <h2 id="economics-title">Was muss der Standort leisten?</h2>
        <p className="economics-subtitle">Halböffentlicher Ladepark · {sites.length} {sites.length === 1 ? "Standort" : "Standorte"} · alle Geldwerte netto</p>
      </div><div className="economics-actions">
        <button className="economics-icon" title="Beispielannahmen wiederherstellen" aria-label="Beispielannahmen wiederherstellen" onClick={() => setDraft(draftOf(DEFAULT_SITE_INPUT))}><RotateCcw size={18} /></button>
        <button className="economics-export" disabled={busy || !assumptions || !entries.some((e) => e.plan)} onClick={() => download("csv")}><ArrowDownToLine size={17} /> CSV</button>
        <button className="economics-export" disabled={busy || !assumptions || !entries.some((e) => e.plan)} onClick={() => download("json")}><ArrowDownToLine size={17} /> JSON</button>
      </div></header>
      <div className="economics-evidence"><span>{data ? `${number(data.network.edges.length)} Modellstrecken` : "Planungsdaten laden …"}</span><span>BASt-Rohdaten: {data?.bast.period.end || "…"}</span><span>BNetzA: {registerDate || "nicht verfügbar"}</span><a href="#methodik">Datengrenzen</a></div>
      <p className="economics-notice"><AlertTriangle size={16} /> Szenariorechnung, keine validierte Nachfrage- oder Rentabilitätsprognose. Nahe Zählstellen bestätigen weder dieselbe Straße noch die Lkw-Zufahrt. Preise, Anhaltequote und Hochlauf sind Annahmen.</p>
      {dataError && <p role="alert" className="economics-empty">{dataError} <button onClick={onRetry}>Erneut laden</button></p>}
      <div className="economics-layout">
        <div className="economics-inputs">
          <div className="economics-section-heading"><h3>Annahmen</h3><span>Für alle Standorte gleich</span></div>
          {GROUPS.map((group, index) => <details className="economics-group" key={group.title} open={index === 0 || (!parsed.success && group.fields.some(([key]) => parsed.error.issues.some((i) => i.path[0] === key))) || undefined}><summary>{group.title}</summary><div className="economics-fields">
            {group.fields.map(([key, label, unit, min, max, step]) => {
              const issue = parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === key);
              return <div className="economics-field" key={key}><label htmlFor={`plan-${key}`}>{label}</label><div className={`economics-value${issue ? " invalid" : ""}`}><input id={`plan-${key}`} type="number" min={min} max={max} step={step} value={String(draft[key])} disabled={key === "gridPowerKw" && !draft.gridKnown} aria-invalid={!!issue} aria-describedby={issue ? `plan-error-${key}` : undefined} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} /><span>{unit}</span></div>{issue && <p className="economics-error" id={`plan-error-${key}`}>{issue.code === "custom" ? issue.message : `Wert zwischen ${number(min)} und ${number(max)} erforderlich.`}</p>}</div>;
            })}
          </div>{index === 0 && <label className="planning-checkbox"><input type="checkbox" checked={!!draft.anchorIncluded} onChange={(e) => setDraft((d) => ({ ...d, anchorIncluded: e.target.checked }))} /> Ankerkunden bereits im vorbeifahrenden Verkehr enthalten</label>}
          {index === 1 && <label className="planning-checkbox"><input type="checkbox" checked={!!draft.gridKnown} onChange={(e) => setDraft((d) => ({ ...d, gridKnown: e.target.checked }))} /> Netzleistung als Szenarioannahme festlegen</label>}
          {index === 3 && <p className="economics-footnote">2027 startet bei 25 % des Zielanteils, linearer Hochlauf bis 2030; danach konstant. Verkehrsmenge bleibt auf dem gewählten Referenzniveau.</p>}</details>)}
          <label className="planning-select">Lkw-Zufahrt<select value={String(draft.access)} onChange={(e) => setDraft((d) => ({ ...d, access: e.target.value }))}><option value="assumed">Angenommen, nicht bestätigt</option><option value="unknown">Unbekannt</option><option value="verified">Vom Nutzer geprüft</option><option value="inaccessible">Nicht zugänglich</option></select></label>
          <label className="planning-select">Erreichbare Fahrtrichtungen<select value={String(draft.directions)} onChange={(e) => setDraft((d) => ({ ...d, directions: e.target.value }))}><option value="both">Beide Richtungen (Annahme)</option><option value="r1">Nur R1 der Zählstation</option><option value="r2">Nur R2 der Zählstation</option></select></label>
          <p className="economics-footnote">Ankerkunden kommen zur gewählten Uhrzeit, nur Montag bis Freitag. Keine automatische Nachfrageminderung durch Wettbewerb. Kein technischer Verfügbarkeitsfaktor; Ausfälle und Ladekurven sind nicht modelliert.</p>
          <p className="economics-storage" role="status">{assumptions ? storageStatus : "Ungültige Eingaben werden nicht gespeichert."}</p>
        </div>
        <div className="economics-results" aria-busy={busy}>
          <div className="economics-selection"><label htmlFor="planning-site">Standort</label><select id="planning-site" value={activeSite?.id || ""} onChange={(e) => onSelect(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          <TrafficBasisSelect id="planning-basis" context={activeBasis} choice={choices[activeSite?.id]} onChange={(choice) => onBasisChange(activeSite.id, choice)} />
          {choices[activeSite?.id]?.basis === "model" && <p className="economics-warning"><AlertTriangle size={15} /> Synthetische Verkehrsmenge, gleichmäßige Ankünfte an allen Wochentagen. Kein gemessenes Stundenprofil und keine Wochenendabsenkung.</p>}
          {plan && <div className="planning-source"><strong>{plan.input.traffic.source.kind === "measured" ? "Messung an Zählstation · Übertragung ungeprüft" : "Synthetisches Verkehrsmodell"}</strong><span>{number(plan.input.traffic.trucksPerDay)} {plan.input.traffic.vehicleClass === "truck" ? "Lkw" : "Schwerverkehr-Fahrzeuge"}/Tag · Referenz {plan.input.traffic.referenceYear}</span><a href={plan.input.traffic.source.url} target="_blank" rel="noreferrer">{plan.input.traffic.source.title}</a></div>}
          <div className="economics-scenarios" role="group" aria-label="Hochlaufszenario">{[["low", "Niedrig", draft.lowSharePercent], ["base", "Basis", draft.baseSharePercent], ["high", "Hoch", draft.highSharePercent]].map(([id, label, share]) => <button key={String(id)} aria-pressed={id === scenarioId} onClick={() => setScenarioId(String(id))}><span>{label}</span><strong>{share} % ab 2030</strong></button>)}</div>
          {!assumptions ? <p role="alert" className="economics-empty">Bitte korrigiere die markierten Annahmen. Es wird kein Ergebnis berechnet.</p> : busy ? <p role="status" className="economics-empty">Referenztage und Cashflows werden berechnet …</p> : activeEntry?.error || calculationError ? <p role="alert" className="economics-empty">{activeEntry?.error || calculationError}</p> : !plan ? <p className="economics-empty">{activeBasis?.reason || "Planungsdaten werden geladen …"}</p> : plan.status === "blocked" ? <div role="alert" className="economics-empty">Berechnung gesperrt.{plan.evidence.blockers.map((b) => <p key={b}>{BLOCKERS[b] || b}</p>)}</div> : scenario && year && finance && <>
            <div className="economics-kpis"><div><span>Kapitalwert · 2027–2036</span><strong data-testid="planning-npv" className={scenario.finance.npv >= 0 ? "positive" : "negative"}>{euro(scenario.finance.npv)}</strong><small>Diskontiert, inkl. Investition, Ersatz und Restwert</small></div><div><span>Diskontierte Amortisation</span><strong>{scenario.finance.discountedPaybackYear ?? "Nicht erreicht"}</strong><small>{scenario.finance.discountedPaybackYear ? scenario.finance.discountedRecoverySustained ? "Im restlichen Zeitraum erhalten" : "Spätere Rückflüsse wieder negativ" : "Innerhalb des Planzeitraums"}</small></div></div>
            <label className="planning-select">Betriebsjahr<select value={yearIndex} onChange={(e) => setYearIndex(Number(e.target.value))}>{scenario.years.map((y, i) => <option value={i} key={y.year}>{y.year} · {number(y.evShare * 100, 1)} % E-Lkw</option>)}</select></label>
            <div className="economics-capacity"><div><h3>Nachfrage & Bedienung · {year.year}</h3><strong>{year.servedShare === null ? "Keine Nachfrage" : `${number(year.servedShare * 100)} % bedient`}</strong></div><div className="economics-meter" role="meter" aria-label="Vollständig bedienter Anteil" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((year.servedShare || 0) * 100)}><span style={{ width: `${(year.servedShare || 0) * 100}%` }} /></div><div className="economics-capacity-values"><div><strong>{number(year.offeredSessions / year.calendarDays, 1)}</strong><span>Anfragen/Tag</span></div><div><strong>{number(year.completedSessions / year.calendarDays, 1)}</strong><span>Abgeschlossene/Tag</span></div><div><strong>{number(year.unservedSessions / year.calendarDays, 1)}</strong><span>Nicht vollständig/Tag</span></div></div><p className="economics-footnote">Gewichtete Jahresmittel; teilweise geladene Energie zählt zum Absatz, nicht zu abgeschlossenen Ladungen.</p></div>
            <dl className="economics-ledger"><div><dt>Umsatz · {number(year.deliveredKwh / 1000)} MWh</dt><dd>{euro(finance.revenue)}</dd></div><div><dt>Strombezug inkl. Verluste</dt><dd>− {euro(finance.electricityCost)}</dd></div><div><dt>Variable Kosten</dt><dd>− {euro(finance.variableCost)}</dd></div><div><dt>Fixkosten</dt><dd>− {euro(finance.fixedCost)}</dd></div><div className="economics-total"><dt>Betriebs-Cashflow · {year.year}</dt><dd data-testid="operating-surplus">{euro(finance.operatingCashflow)}</dd></div></dl>
            <p className={`economics-break-even${year.breakEven.achievedInScenario ? "" : " warning"}`}><strong>Operativer Break-even: </strong>{year.breakEven.requiredEquivalentSessionsPerDay === null ? "Bei diesem Deckungsbeitrag nicht erreichbar." : `${number(year.breakEven.requiredEquivalentSessionsPerDay, 1)} äquivalente Vollladungen/Tag. ${year.breakEven.achievedInScenario ? "Im Szenario erreicht." : "Im Szenario nicht erreicht."}`} Ohne Rückzahlung der Investition.</p>
            <label className="planning-select">Stundenprofil · {year.year}<select value={daytype} onChange={(e) => setDaytype(e.target.value as typeof daytype)}><option value="weekday">Montag bis Freitag</option><option value="saturday">Samstag</option><option value="sunday">Sonntag</option></select></label>
            <div className="planning-chart" role="img" aria-label="Mittlere Netzleistung pro Stunde im simulierten Referenztag"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourly}><CartesianGrid stroke="#e4e8e8" vertical={false} /><XAxis dataKey="hour" interval={3} tick={TICK} axisLine={AXIS} tickLine={AXIS} /><YAxis tick={TICK} axisLine={false} tickLine={false} width={48} /><Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#e7f1f0" }} formatter={(value: number) => [`${number(value, 1)} kW`, "Mittlere Netzleistung"]} /><Bar dataKey="gridKw" fill="#087782" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
            <p className="economics-footnote">Spitzen-Netzleistung: {number(year.peakGridKw)} kW · größte Warteschlange dieser Referenztage: {number(Math.max(0, ...hourly.map((h) => h.queue)))} Lkw. Leistung stündlich gewichtetes Mittel, Warteschlange Maximum; keine Prognoseintervalle.</p>
            <p className="planning-chart-title" aria-hidden="true">Kumulierte diskontierte Projekt-Cashflows von 2027 bis 2036</p><div className="planning-chart" role="img" aria-label="Kumulierte diskontierte Projekt-Cashflows von 2027 bis 2036"><ResponsiveContainer width="100%" height="100%"><LineChart data={[{ year: 2026, cumulativeDiscountedCashflow: scenario.finance.initialCashflow }, ...scenario.finance.years]}><CartesianGrid stroke="#e4e8e8" vertical={false} /><XAxis dataKey="year" tick={TICK} axisLine={AXIS} tickLine={AXIS} /><YAxis width={76} tick={TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${number(v / 1000)} T€`} /><ReferenceLine y={0} stroke="#8a969a" strokeDasharray="4 3" ifOverflow="extendDomain" /><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [euro(v), "Kumuliert diskontiert"]} /><Line dataKey="cumulativeDiscountedCashflow" stroke={scenario.finance.npv >= 0 ? "#087782" : "#b13632"} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
            <details className="economics-method"><summary>Jährliche Cashflows & Kapazität</summary><div className="economics-table-wrap"><table className="economics-table"><thead><tr><th>Jahr</th><th>MWh</th><th>Nicht bedient/Tag</th><th>Betriebs-Cashflow</th><th>Kumuliert diskontiert</th></tr></thead><tbody>{scenario.years.map((y, i) => <tr key={y.year}><th>{y.year}</th><td>{number(y.deliveredKwh / 1000)}</td><td>{number(y.unservedSessions / y.calendarDays, 1)}</td><td>{euro(scenario.finance.years[i].operatingCashflow)}</td><td>{euro(scenario.finance.years[i].cumulativeDiscountedCashflow)}</td></tr>)}</tbody></table></div></details>
            <div className="planning-sensitivity"><button className="economics-export" disabled={sensitivityBusy} onClick={() => setSensitivityRun((n) => n + 1)}><Calculator size={16} /> {sensitivityBusy ? "Sensitivität läuft …" : "Sensitivität berechnen"}</button>{sensitivity && <div className="economics-table-wrap"><table className="economics-table"><caption>Sensitivität · {scenario.label} · jeweils eine Annahme geändert</caption><thead><tr><th>Änderung</th><th>Kapitalwert</th><th>Differenz</th></tr></thead><tbody>{sensitivity.changes.filter((c) => c.scenarioId === scenarioId).map((c) => <tr key={c.id}><th>{c.id}</th><td>{euro(c.npv)}</td><td>{euro(c.npvDelta)}</td></tr>)}</tbody></table><p className="economics-footnote">Identischer Seed, kein statistisches Unsicherheitsintervall.</p></div>}</div>
          </>}
          <p className="economics-storage" role="status">{serverStatus}</p>
          {plan && <details className="economics-method"><summary>Offene Evidenz & Quellen</summary><ul className="planning-gaps">{plan.evidence.gaps.map((gap) => <li key={gap}>{GAPS[gap] || gap}</li>)}</ul>{Array.from(new Map(plan.evidence.sources.map((source) => [source.id, source])).values()).map((source) => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · {source.license} · Stand {source.observedThrough}<br /><small>SHA-256: {source.sha256}</small></p>)}<p>Keine Investitionsfreigabe. Nächste Prüfungen: Zufahrt und Richtung, verbindliches Netzangebot, Ankerkunden und reale Ladevorgänge.</p></details>}
        </div>
      </div>
      {sites.length > 1 && <div className="economics-comparison economics-table-wrap"><table className="economics-table"><caption>Standortvergleich · {scenarioId === "base" ? "Basis" : scenarioId === "low" ? "Niedrig" : "Hoch"} · identische Betriebsannahmen, unterschiedliche Verkehrsbasis</caption><thead><tr><th>Standort</th><th>Quelle</th><th>Kapitalwert 2027–2036</th><th>Status</th></tr></thead><tbody>{sites.map((site) => {
        const entry = entries.find((e) => e.id === site.id); const s = entry?.plan?.scenarios.find((s) => s.id === scenarioId);
        const traffic = entry?.plan?.input.traffic;
        return <tr key={site.id} className={site.id === activeSite?.id ? "selected" : ""}><th><button onClick={() => onSelect(site.id)}>{site.label}</button></th><td>{traffic ? `${traffic.source.kind === "measured" ? "Zählstation" : "Modell"} · ${traffic.referenceYear} · ${traffic.vehicleClass === "truck" ? "Lkw" : "Schwerverkehr"}` : "Nicht gewählt"}</td><td>{s ? euro(s.finance.npv) : "Nicht berechnet"}</td><td>{busy ? "Berechnung läuft" : entry?.plan?.status === "blocked" ? "Gesperrt" : s ? "Szenario, ungeprüft" : entry?.error || "Verkehrsbasis fehlt"}</td></tr>;
      })}</tbody></table></div>}
      <details className="economics-method"><summary>Rechenweg & Grenzen</summary><p>Verkehr × erreichbarer Anteil × E-Lkw-Anteil × Anhaltequote, ergänzt um Ankerkunden. BASt-Juli-Profile bestimmen die relativen Stunden- und Wochentagsanteile. Bei Modellwahl ist das Profil ausdrücklich gleichmäßig angenommen. Fünf-Minuten-Simulation mit gemeinsamer Netzgrenze, Wartezeit, Wechselzeit und Öffnungsfenstern; nicht abgeschlossene Ladungen werden nicht über Mitternacht übertragen.</p><p>Gewichtete Referenztage erhalten auch niedrige erwartete Nachfragemengen. Jahreswerte enthalten Hochlauf, echte Kalenderlängen, Preise, Kosten, Ersatzinvestition, Restwert und Abzinsung. Keine Steuern, Finanzierung, Förderung, Ladekurven, Jahreszeiteneffekte oder stochastischen Ausfälle. Chronos-2 wird ohne validierten Mehrwert nicht als Nachfragekorrektur eingesetzt. Quelldaten und Nutzungsrechte werden dokumentiert; Nutzerangaben sind keine externe Prüfung.</p></details>
      <p className="economics-export-status" role="status">{exportStatus}</p>
    </div>
  </section>;
}
