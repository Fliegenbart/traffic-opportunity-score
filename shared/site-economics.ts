import { z } from "zod";
import { RAMP_SCENARIOS, type SiteAssessment } from "./standort-check";

export const economicsSchema = z.object({
  reachablePercent: z.number().finite().min(0).max(100),
  capturePercent: z.number().finite().min(0).max(100),
  contractedSessions: z.number().finite().min(0).max(1000),
  energyPerSession: z.number().finite().min(1).max(2000),
  ports: z.number().finite().int().min(1).max(100),
  averagePowerKw: z.number().finite().min(1).max(2000),
  gridPowerKw: z.number().finite().min(0).max(100000),
  hoursPerDay: z.number().finite().min(0).max(24),
  availabilityPercent: z.number().finite().min(0).max(100),
  turnaroundMinutes: z.number().finite().min(0).max(120),
  salePrice: z.number().finite().min(0).max(5),
  electricityPrice: z.number().finite().min(0).max(5),
  lossPercent: z.number().finite().min(0).max(30),
  variableCost: z.number().finite().min(0).max(5),
  fixedCost: z.number().finite().min(0).max(10000000),
  investment: z.number().finite().min(0).max(100000000),
}).strict();

export type EconomicsAssumptions = z.infer<typeof economicsSchema>;
const assumptionLabels: Record<keyof EconomicsAssumptions, string> = {
  reachablePercent: "Erreichbarer Verkehrsanteil (%)", capturePercent: "Anhaltequote der E-Lkw (%)",
  contractedSessions: "Zusätzliche Ankerkunden (Ladungen/Tag)", energyPerSession: "Energie je Ladung (kWh)",
  ports: "Ladeplätze (Anzahl)", averagePowerKw: "Mittlere Ladeleistung je Platz (kW)",
  gridPowerKw: "Netzleistung für den Ladepark (kW)", hoursPerDay: "Öffnungszeit täglich (Stunden)",
  availabilityPercent: "Technische Verfügbarkeit (%)", turnaroundMinutes: "Wechselzeit je Ladung (Minuten)",
  salePrice: "Verkaufspreis (EUR/kWh)", electricityPrice: "Strombezug inkl. Netzentgelten (EUR/kWh)",
  lossPercent: "Ladeverluste (%)", variableCost: "Weitere variable Kosten (EUR/kWh)",
  fixedCost: "Fixkosten inkl. Pacht und Wartung (EUR/Jahr)", investment: "Investition inkl. Netz und Bau (EUR)",
};
// Illustrative planning inputs, not researched market prices or a forecast.
export const DEFAULT_ECONOMICS: EconomicsAssumptions = {
  reachablePercent: 50, capturePercent: 2, contractedSessions: 0,
  energyPerSession: 250, ports: 4, averagePowerKw: 250, gridPowerKw: 1000,
  hoursPerDay: 24, availabilityPercent: 95, turnaroundMinutes: 15,
  salePrice: 0.49, electricityPrice: 0.22, lossPercent: 8, variableCost: 0.03,
  fixedCost: 90000, investment: 1500000,
};

export function calculateSiteEconomics(trucksPerDay: number, evShare: number, input: EconomicsAssumptions) {
  const a = economicsSchema.parse(input);
  if (!Number.isFinite(trucksPerDay) || trucksPerDay < 0 || !Number.isFinite(evShare) || evShare < 0 || evShare > 1) {
    throw new Error("Ungültige Verkehrsbasis");
  }
  const hours = a.hoursPerDay * a.availabilityPercent / 100;
  const efficiency = 1 - a.lossPercent / 100;
  const portCapacity = a.ports * hours / (a.energyPerSession / a.averagePowerKw + a.turnaroundMinutes / 60);
  const gridCapacity = a.gridPowerKw * hours * efficiency / a.energyPerSession;
  const capacity = Math.min(portCapacity, gridCapacity);
  const passingDemand = trucksPerDay * a.reachablePercent / 100 * evShare * a.capturePercent / 100;
  const demand = passingDemand + a.contractedSessions;
  const sessions = Math.min(demand, capacity);
  const annualEnergy = sessions * a.energyPerSession * 365;
  const revenue = annualEnergy * a.salePrice;
  const electricityCost = annualEnergy / efficiency * a.electricityPrice;
  const variableCosts = annualEnergy * a.variableCost;
  const contributionPerKwh = a.salePrice - a.electricityPrice / efficiency - a.variableCost;
  const operatingSurplus = revenue - electricityCost - variableCosts - a.fixedCost;
  const breakEvenSessions = contributionPerKwh > 0 ? a.fixedCost / (contributionPerKwh * a.energyPerSession * 365) : null;
  return {
    passingDemand, demand, sessions, capacity, portCapacity, gridCapacity,
    unservedSessions: Math.max(0, demand - sessions),
    utilization: capacity > 0 ? sessions / capacity : 0,
    bottleneck: gridCapacity < portCapacity ? "Netzanschluss" : "Ladeplätze",
    annualEnergy, revenue, electricityCost, variableCosts, contributionPerKwh, operatingSurplus,
    breakEvenSessions,
    breakEvenReachable: breakEvenSessions !== null && breakEvenSessions <= capacity && capacity > 0,
    paybackYears: operatingSurplus > 0 && a.investment > 0 ? a.investment / operatingSurplus : null,
  };
}

export function readSavedEconomics(raw: string | null): EconomicsAssumptions | null {
  try {
    const saved: unknown = JSON.parse(raw || "null");
    const result = z.object({ version: z.literal(1), assumptions: economicsSchema }).safeParse(saved);
    return result.success ? result.data.assumptions : null;
  } catch { return null; }
}

export interface EconomicsSite {
  id: string;
  label: string;
  lon: number;
  lat: number;
  assessment: SiteAssessment | undefined;
}

export function hasTrafficBasis(site: EconomicsSite): boolean {
  const edge = site.assessment?.edge;
  return !!edge && edge.km <= 25 && Number.isFinite(edge.trucksPerDay) && edge.trucksPerDay >= 0;
}

export function economicsCsv(sites: EconomicsSite[], assumptions: EconomicsAssumptions, registerDate: string | null): string {
  economicsSchema.parse(assumptions);
  const rows: (string | number)[][] = [
    ["Traffic Opportunity | Szenario 2030", "Exportzeitpunkt", new Date().toISOString()],
    ["Evidenzgrenze", "Synthetischer Streckenverkehr, keine gemessene Standortnachfrage. Alle Geldwerte netto. Keine Ertragsprognose."],
    ["Verkehrsquelle", "Mendeley v2", "https://data.mendeley.com/datasets/py2zkrb65h/2"],
    ["Zählbasis", "BASt 2023"], ["BNetzA-Registerstand", registerDate || "Nicht verfügbar"],
    ["Rechenweg", "Nachfrage = Lkw/Tag × Erreichbarkeit × E-Lkw-Anteil × Anhaltequote + Ankerkunden"],
    ["Kapazität", "Minimum aus Ladeplätzen (inkl. Wechselzeit) und Netzleistung (inkl. Verlusten), jeweils mit Öffnungszeit und Verfügbarkeit"],
    ["Grenzen", "Keine Ankunftsspitzen, Warteschlangen, Finanzierung, Steuern, Förderung, Abschreibung oder Ersatzinvestitionen. Amortisation bei konstantem Szenariojahr 2030."],
    [], ["Annahme", "Wert"],
    ...Object.entries(assumptions).map(([key, value]) => [assumptionLabels[key as keyof EconomicsAssumptions], value]), [],
    ["Standort", "Längengrad", "Breitengrad", "Datenstatus", "Strecke", "Abstand km", "Modell-Lkw/Tag", "Szenario", "E-Lkw-Anteil %", "Nachfrage/Tag", "Kapazität/Tag", "Ladungen/Tag", "Auslastung %", "Nicht bediente Nachfrage/Tag", "Energie kWh/Jahr", "Umsatz EUR/Jahr", "Stromkosten EUR/Jahr", "Variable Kosten EUR/Jahr", "Fixkosten EUR/Jahr", "Betriebsüberschuss EUR/Jahr", "Break-even Ladungen/Tag", "Einfache Amortisation Jahre"],
  ];
  for (const site of sites) {
    const edge = site.assessment?.edge;
    if (!hasTrafficBasis(site)) {
      rows.push([site.label, site.lon, site.lat, "Keine nahe Verkehrsbasis; nicht berechnet"]);
      continue;
    }
    for (const scenario of RAMP_SCENARIOS) {
      const r = calculateSiteEconomics(edge!.trucksPerDay, scenario.evShare, assumptions);
      rows.push([site.label, site.lon, site.lat, "Synthetische Verkehrsbasis", edge!.label, edge!.km, edge!.trucksPerDay, scenario.label, scenario.evShare * 100, r.demand, r.capacity, r.sessions, r.utilization * 100, r.unservedSessions, r.annualEnergy, r.revenue, r.electricityCost, r.variableCosts, assumptions.fixedCost, r.operatingSurplus, r.breakEvenSessions ?? "Nicht erreichbar", r.paybackYears ?? "Nicht berechenbar"]);
    }
  }
  const cell = (value: string | number) => {
    if (typeof value === "number") return String(Math.round(value * 100) / 100).replace(".", ",");
    const safe = /^[=+@\-\t\r\n]/.test(value.trimStart()) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}
