import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, Calculator, RotateCcw } from "lucide-react";
import { RAMP_SCENARIOS } from "@shared/standort-check";
import { calculateSiteEconomics, DEFAULT_ECONOMICS, economicsCsv, economicsSchema, hasTrafficBasis, readSavedEconomics, type EconomicsAssumptions, type EconomicsSite } from "@shared/site-economics";
import "./site-economics.css";

type Key = keyof EconomicsAssumptions;
type Field = { key: Key; label: string; unit: string; min: number; max: number; step: number };
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Nachfrage", fields: [
    { key: "reachablePercent", label: "Erreichbarer Verkehrsanteil", unit: "%", min: 0, max: 100, step: 1 },
    { key: "capturePercent", label: "Anhaltequote der E-Lkw", unit: "%", min: 0, max: 100, step: 0.1 },
    { key: "contractedSessions", label: "Zusätzliche Ankerkunden", unit: "Ladungen/Tag", min: 0, max: 1000, step: 1 },
    { key: "energyPerSession", label: "Energie je Ladung", unit: "kWh", min: 1, max: 2000, step: 10 },
  ] },
  { title: "Ladepark & Kapazität", fields: [
    { key: "ports", label: "Ladeplätze", unit: "Anzahl", min: 1, max: 100, step: 1 },
    { key: "averagePowerKw", label: "Mittlere Ladeleistung je Platz", unit: "kW", min: 1, max: 2000, step: 10 },
    { key: "gridPowerKw", label: "Netzleistung für den Ladepark", unit: "kW", min: 0, max: 100000, step: 50 },
    { key: "hoursPerDay", label: "Öffnungszeit täglich", unit: "Stunden", min: 0, max: 24, step: 1 },
    { key: "availabilityPercent", label: "Technische Verfügbarkeit", unit: "%", min: 0, max: 100, step: 1 },
    { key: "turnaroundMinutes", label: "Wechselzeit je Ladung", unit: "Minuten", min: 0, max: 120, step: 5 },
  ] },
  { title: "Preise & Kosten · netto", fields: [
    { key: "salePrice", label: "Verkaufspreis", unit: "€/kWh", min: 0, max: 5, step: 0.01 },
    { key: "electricityPrice", label: "Strombezug inkl. Netzentgelten", unit: "€/kWh", min: 0, max: 5, step: 0.01 },
    { key: "lossPercent", label: "Ladeverluste", unit: "%", min: 0, max: 30, step: 1 },
    { key: "variableCost", label: "Weitere variable Kosten", unit: "€/kWh", min: 0, max: 5, step: 0.01 },
    { key: "fixedCost", label: "Fixkosten inkl. Pacht & Wartung", unit: "€/Jahr", min: 0, max: 10000000, step: 1000 },
    { key: "investment", label: "Investition inkl. Netz & Bau", unit: "€", min: 0, max: 100000000, step: 10000 },
  ] },
];
const STORAGE_KEY = "traffic-opportunity:economics:v1";
const draftOf = (a: EconomicsAssumptions) => Object.fromEntries(Object.entries(a).map(([key, value]) => [key, String(value)])) as Record<Key, string>;
const number = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
const euro = (value: number) => `${number(value)} €`;

export default function SiteEconomics({ sites, activeId, onSelect, registerDate }: {
  sites: EconomicsSite[]; activeId: string; onSelect: (id: string) => void; registerDate: string | null;
}) {
  const [draft, setDraft] = useState(() => {
    try { return draftOf(readSavedEconomics(localStorage.getItem(STORAGE_KEY)) || DEFAULT_ECONOMICS); }
    catch { return draftOf(DEFAULT_ECONOMICS); }
  });
  const [storageStatus, setStorageStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [scenarioId, setScenarioId] = useState("basis");
  const parsed = useMemo(() => economicsSchema.safeParse(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() === "" ? NaN : Number(value)]))), [draft]);
  const assumptions = parsed.success ? parsed.data : null;
  const errors = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]));
  const selectedScenario = RAMP_SCENARIOS.find((scenario) => scenario.id === scenarioId)!;
  const activeSite = sites.find((site) => site.id === activeId) || sites[0];
  const canCalculate = activeSite && hasTrafficBasis(activeSite);
  const scenarios = assumptions && canCalculate ? RAMP_SCENARIOS.map((scenario) => ({
    ...scenario, result: calculateSiteEconomics(activeSite.assessment!.edge!.trucksPerDay, scenario.evShare, assumptions),
  })) : [];
  const result = scenarios.find((scenario) => scenario.id === scenarioId)?.result;

  useEffect(() => {
    if (!parsed.success) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, assumptions: parsed.data }));
      setStorageStatus("Annahmen auf diesem Gerät gespeichert");
    } catch { setStorageStatus("Lokales Speichern nicht verfügbar"); }
  }, [parsed]);

  const download = () => {
    if (!assumptions) return;
    try {
      const url = URL.createObjectURL(new Blob([economicsCsv(sites, assumptions, registerDate)], { type: "text/csv;charset=utf-8;" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "standortvergleich-szenarien-2030.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus("CSV mit allen Standorten, Szenarien und Annahmen erstellt.");
    } catch { setExportStatus("Der Export ist fehlgeschlagen. Bitte erneut versuchen."); }
  };

  return (
    <section id="wirtschaftlichkeit" className="economics" aria-labelledby="economics-title">
      <div className="economics-inner">
        <header className="economics-header">
          <div>
            <p className="economics-eyebrow"><Calculator size={16} aria-hidden="true" /> INVESTITIONSCHECK · SZENARIO 2030</p>
            <h2 id="economics-title">Was muss der Standort leisten?</h2>
            <p className="economics-subtitle">Halböffentlicher Ladepark · {sites.length} {sites.length === 1 ? "Standort" : "Standorte"} · alle Geldwerte netto</p>
          </div>
          <div className="economics-actions">
            <button type="button" className="economics-icon" title="Beispielannahmen wiederherstellen" aria-label="Beispielannahmen wiederherstellen" onClick={() => { setDraft(draftOf(DEFAULT_ECONOMICS)); setExportStatus(""); }}><RotateCcw size={18} /></button>
            <button type="button" className="economics-export" disabled={!assumptions} onClick={download}><ArrowDownToLine size={17} /> CSV exportieren</button>
          </div>
        </header>

        <div className="economics-evidence">
          <span><i /> Synthetischer Verkehr 2030</span>
          <span>Zählbasis: BASt 2023</span>
          <span>BNetzA-Stand: {registerDate ? new Date(`${registerDate}T12:00:00`).toLocaleDateString("de-DE") : "nicht verfügbar"}</span>
          <a href="#methodik">Datengrenzen</a>
        </div>
        <p className="economics-notice"><AlertTriangle size={16} aria-hidden="true" /> Beispielannahmen, keine Marktpreise oder Ertragsprognose. Verkehrsmodell und Luftliniennähe ersetzen keine gemessene Nachfrage oder bestätigte Zufahrt.</p>

        <div className="economics-layout">
          <div className="economics-inputs">
            <div className="economics-section-heading"><h3>Annahmen</h3><span>Für alle Standorte gleich</span></div>
            {GROUPS.map((group, index) => (
              <details key={group.title} open={index === 0 || undefined} className="economics-group">
                <summary>{group.title}</summary>
                <div className="economics-fields">
                  {group.fields.map((field) => (
                    <div key={field.key} className="economics-field">
                      <label htmlFor={`eco-${field.key}`}>{field.label}</label>
                      <div className={errors.has(field.key) ? "economics-value invalid" : "economics-value"}>
                        <input id={`eco-${field.key}`} type="number" inputMode="decimal" min={field.min} max={field.max} step={field.step} value={draft[field.key]} aria-invalid={errors.has(field.key)} aria-describedby={errors.has(field.key) ? `error-${field.key}` : undefined} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                        <span>{field.unit}</span>
                      </div>
                      {errors.has(field.key) && <p id={`error-${field.key}`} className="economics-error">{field.key === "ports" ? "Ganze Zahl" : "Wert"} zwischen {number(field.min)} und {number(field.max)} erforderlich.</p>}
                    </div>
                  ))}
                </div>
              </details>
            ))}
            <p className="economics-footnote">Erreichbarkeit umfasst Fahrtrichtung, Umwege und Zufahrt. Ankerkunden sind zusätzliche Ladungen, die nicht bereits im vorbeifahrenden Verkehr erfasst sind.</p>
            <p className="economics-storage" role="status">{assumptions ? storageStatus : "Ungültige Eingaben werden nicht gespeichert."}</p>
          </div>

          <div className="economics-results">
            <div className="economics-selection">
              <label htmlFor="economics-site">Standort</label>
              <select id="economics-site" value={activeSite?.id || ""} onChange={(event) => onSelect(event.target.value)}>
                {sites.map((site, index) => <option key={site.id} value={site.id}>{index + 1} · {site.label}</option>)}
              </select>
            </div>
            <div className="economics-scenarios" role="group" aria-label="E-Lkw-Anteil 2030">
              {RAMP_SCENARIOS.map((scenario) => <button key={scenario.id} type="button" aria-pressed={scenario.id === scenarioId} onClick={() => setScenarioId(scenario.id)}><span>{scenario.label}</span><strong>{number(scenario.evShare * 100)} % E-Lkw</strong></button>)}
            </div>

            {!assumptions ? <p role="alert" className="economics-empty">Bitte korrigiere die markierten Annahmen. Bis dahin wird kein Ergebnis berechnet.</p> : !result ? <p className="economics-empty">Keine modellierte Hotspot-Strecke innerhalb von 25 km. Für diesen Standort lässt sich aus den vorhandenen Daten keine belastbare Verkehrsbasis ableiten. Es wird kein Ertrag berechnet.</p> : <>
              <div className="economics-kpis">
                <div><span>Betriebsüberschuss / Jahr</span><strong data-testid="operating-surplus" className={result.operatingSurplus > 0 ? "positive" : "negative"}>{euro(result.operatingSurplus)}</strong><small>Vor Finanzierung, Steuern und Abschreibung</small></div>
                <div><span>Einfache Amortisation</span><strong>{result.paybackYears === null ? "Nicht erreicht" : `${number(result.paybackYears, 1)} Jahre`}</strong><small>{result.paybackYears === null ? "Kein positiver Rückfluss oder keine Investition" : "Bei konstantem Betrieb wie im Szenario 2030"}</small></div>
              </div>

              <div className="economics-capacity">
                <div><h3>Nachfrage trifft Kapazität</h3><strong>{number(result.utilization * 100)} %</strong></div>
                <div className="economics-meter" role="meter" aria-label="Rechnerische Kapazitätsauslastung" aria-valuenow={Math.round(result.utilization * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${result.utilization * 100}%` }} /></div>
                <div className="economics-capacity-values">
                  <div><strong>{number(result.demand, 1)}</strong><span>Nachfrage / Tag</span></div>
                  <div><strong>{number(result.sessions, 1)}</strong><span>Ladungen / Tag</span></div>
                  <div><strong>{number(result.capacity, 1)}</strong><span>Kapazität / Tag</span></div>
                </div>
                {result.unservedSessions > 0.01 && <p className="economics-warning"><AlertTriangle size={15} /> {result.bottleneck} begrenzen den Absatz: {number(result.unservedSessions, 1)} Ladungen pro Tag bleiben rechnerisch unbedient.</p>}
                <p className="economics-footnote">Tagesmittel, keine Auslastungsprognose. Ankunftsspitzen und Warteschlangen können die nutzbare Kapazität weiter reduzieren.</p>
              </div>

              <dl className="economics-ledger">
                <div><dt>Umsatz · {number(result.annualEnergy / 1000)} MWh/Jahr</dt><dd>{euro(result.revenue)}</dd></div>
                <div><dt>Strombezug inkl. Verluste</dt><dd>− {euro(result.electricityCost)}</dd></div>
                <div><dt>Weitere variable Kosten</dt><dd>− {euro(result.variableCosts)}</dd></div>
                <div><dt>Fixkosten</dt><dd>− {euro(assumptions.fixedCost)}</dd></div>
                <div className="economics-total"><dt>Betriebsüberschuss</dt><dd>{euro(result.operatingSurplus)}</dd></div>
              </dl>
              <p className={result.breakEvenReachable ? "economics-break-even" : "economics-break-even warning"}>
                <strong>Operativer Break-even: </strong>{result.breakEvenSessions === null ? "nicht erreichbar bei diesem Deckungsbeitrag." : `${number(result.breakEvenSessions, 1)} Ladungen/Tag${result.breakEvenReachable ? "." : ", außerhalb der verfügbaren Kapazität."}`} Ohne Rückzahlung der Investition.
              </p>
              <div className="economics-table-wrap">
                <table className="economics-table"><caption>Szenarien 2030 · Annahmen, keine Wahrscheinlichkeiten</caption><thead><tr><th>Szenario</th><th>Ladungen/Tag</th><th>Überschuss/Jahr</th></tr></thead><tbody>
                  {scenarios.map(({ id, label, evShare, result: r }) => <tr key={id} className={id === scenarioId ? "selected" : ""}><th>{label}<small>{number(evShare * 100)} % E-Lkw</small></th><td>{number(r.sessions, 1)}</td><td className={r.operatingSurplus <= 0 ? "negative" : ""}>{euro(r.operatingSurplus)}</td></tr>)}
                </tbody></table>
              </div>
            </>}
          </div>
        </div>

        {sites.length > 1 && assumptions && <div className="economics-comparison economics-table-wrap"><table className="economics-table"><caption>Standortvergleich · {selectedScenario.label} · {number(selectedScenario.evShare * 100)} % E-Lkw · identische Annahmen</caption><thead><tr><th>Standort</th><th>Ladungen/Tag</th><th>Überschuss/Jahr</th><th>Amortisation</th></tr></thead><tbody>{sites.map((site, index) => {
          const r = hasTrafficBasis(site) ? calculateSiteEconomics(site.assessment!.edge!.trucksPerDay, selectedScenario.evShare, assumptions) : null;
          return <tr key={site.id} className={site.id === activeSite?.id ? "selected" : ""}><th><button type="button" onClick={() => onSelect(site.id)}>{index + 1} · {site.label}</button><small>{r ? `${number(site.assessment!.edge!.km, 1)} km zur Modellstrecke` : "Keine nahe Verkehrsbasis"}</small></th><td>{r ? number(r.sessions, 1) : "Nicht berechnet"}</td><td>{r ? euro(r.operatingSurplus) : "Nicht berechnet"}</td><td>{r?.paybackYears != null ? `${number(r.paybackYears, 1)} Jahre` : "Nicht erreicht"}</td></tr>;
        })}</tbody></table></div>}

        <details className="economics-method"><summary>Rechenweg & Grenzen</summary><p>Nachfrage = Modell-Lkw/Tag × erreichbarer Anteil × E-Lkw-Anteil × Anhaltequote + zusätzliche Ankerkunden. Die tatsächlichen Ladungen sind auf das Minimum aus Platz- und Netzkapazität begrenzt. Öffnungszeiten, Verfügbarkeit, Wechselzeiten und Ladeverluste sind berücksichtigt. Wettbewerb verändert die Nachfrage nicht automatisch; er muss in den Annahmen geprüft werden.</p><p>Der Überschuss ist Umsatz abzüglich Strombezug, variabler Kosten und Fixkosten. Einfache Amortisation = Investition ÷ positiver Jahresüberschuss, ohne Hochlauf, Abzinsung, Förderung, Finanzierung, Steuern und Ersatzinvestitionen. Chronos-2 verändert diese Szenarien nicht: Der vorhandene historische Backtest belegt keinen durchgängigen Prognosevorteil. Register und Verkehrsmodell sind keine Live-Daten.</p></details>
        <p className="economics-export-status" role="status">{exportStatus}</p>
      </div>
    </section>
  );
}
