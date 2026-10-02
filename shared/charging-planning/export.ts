import type { ChargingPlanResult } from "./engine.js";

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function exportPlanCsv(result: ChargingPlanResult): string {
  const rows: (string | number | null)[][] = [
    ["Ladepark-Planungsengine", result.modelVersion, result.status], ["Standort", result.site.label],
    ["Grenze", "Szenariorechnung, keine validierte Nachfrage- oder Rentabilitätsprognose. Projektwerte netto vor Steuern und Finanzierung."],
    ["Seed", result.input.demand.seed], ["Evidenzlücken", result.evidence.gaps.join(", ")], ["Sperren", result.evidence.blockers.join(", ")],
    ["Reproduzierbare Eingaben (JSON)", canonicalJson(result.input)],
    ["Szenario", "Jahr", "Ladungen angeboten", "Ladungen abgeschlossen", "Ladungen nicht vollständig bedient", "Energie abgegeben kWh", "Energie bezogen kWh", "Spitzenleistung kW", "Umsatz EUR", "Betriebs-Cashflow EUR", "Projekt-Cashflow EUR", "Kumuliert diskontiert EUR"],
  ];
  for (const s of result.scenarios) for (let i = 0; i < s.years.length; i++) {
    const y = s.years[i], f = s.finance.years[i];
    rows.push([s.label, y.year, y.offeredSessions, y.completedSessions, y.unservedSessions, y.deliveredKwh, y.gridKwh,
      y.peakGridKw, f.revenue, f.operatingCashflow, f.projectCashflow, f.cumulativeDiscountedCashflow]);
  }
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    if (typeof v === "number") return String(Math.round(v * 100) / 100).replace(".", ",");
    const safe = /^[=+@\-\t\r\n]/.test(v.trimStart()) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

export function summarizePlan(result: ChargingPlanResult) {
  return { ...result, scenarios: result.scenarios.map((scenario) => ({ ...scenario, years: scenario.years.map((year) => ({ ...year,
    days: year.days.map(({ daytype, calendarCount, representativeWeight, annualWeightDays, arrivals, simulation }) => {
      const { sessions: _sessions, slots, ...metrics } = simulation;
      const { sessions: _arrivals, ...demand } = arrivals;
      return { daytype, calendarCount, representativeWeight, annualWeightDays, demand, metrics,
        hourly: Array.from({ length: 24 }, (_, hour) => {
          const values = slots.slice(hour * 12, (hour + 1) * 12);
          return { hour, meanGridKw: values.reduce((s, v) => s + v.gridKw, 0) / 12,
            deliveredKwh: values.reduce((s, v) => s + v.deliveredKwh, 0),
            peakQueue: Math.max(...values.map((v) => v.queue)), meanOccupiedPorts: values.reduce((s, v) => s + v.occupiedPorts, 0) / 12 };
        }) };
    }) })) })) };
}
