import { z } from "zod";
import { findStationCandidates, loadPlanningData, stationProfiles } from "./data";
import { matchTrafficEdge } from "./traffic";
import { planningRequestSchema, type SourceRef } from "./contracts";

const percent = z.number().finite().min(0).max(100);
const money = z.number().finite().min(0).max(100000000);
const fiveMinutes = (max: number) => z.number().int().min(0).max(max).refine((v) => v % 5 === 0, "Fünf-Minuten-Raster erforderlich");
export const siteInputSchema = z.object({
  reachablePercent: percent, capturePercent: percent, energyKwh: z.number().min(1).max(2000),
  anchorCount: z.number().int().min(0).max(1000), anchorHour: z.number().int().min(0).max(23), anchorIncluded: z.boolean(),
  ports: z.number().int().min(1).max(100), portPowerKw: z.number().min(1).max(2000),
  gridPowerKw: z.number().min(0).max(100000), gridKnown: z.boolean(),
  startHour: z.number().int().min(0).max(23), hoursOpen: z.number().int().min(0).max(24),
  lossPercent: z.number().min(0).max(30), turnaroundMinutes: fiveMinutes(120), maxWaitMinutes: fiveMinutes(240),
  access: z.enum(["assumed", "verified", "unknown", "inaccessible"]), directions: z.enum(["both", "r1", "r2"]),
  salePrice: z.number().min(0).max(5), electricityPrice: z.number().min(0).max(5), variableCost: z.number().min(0).max(5),
  capex: money, fixedCost: z.number().min(0).max(10000000), discountPercent: percent,
  priceEscalationPercent: z.number().min(-20).max(20), costEscalationPercent: z.number().min(-20).max(20),
  replacementAmount: money, replacementYear: z.number().int().min(2027).max(2036), residualValue: money,
  lowSharePercent: percent, baseSharePercent: percent, highSharePercent: percent,
}).strict().superRefine((v, ctx) => {
  if (v.startHour + v.hoursOpen > 24) ctx.addIssue({ code: "custom", path: ["hoursOpen"], message: "Das Öffnungsfenster muss vor Mitternacht enden" });
  if (v.lowSharePercent > v.baseSharePercent || v.baseSharePercent > v.highSharePercent) ctx.addIssue({ code: "custom", path: ["baseSharePercent"], message: "Anteile müssen niedrig ≤ Basis ≤ hoch sein" });
});
export type SiteInput = z.infer<typeof siteInputSchema>;
export const DEFAULT_SITE_INPUT: SiteInput = {
  reachablePercent: 50, capturePercent: 2, energyKwh: 250, anchorCount: 0, anchorHour: 8, anchorIncluded: false,
  ports: 4, portPowerKw: 250, gridPowerKw: 1000, gridKnown: true, startHour: 0, hoursOpen: 24,
  lossPercent: 8, turnaroundMinutes: 15, maxWaitMinutes: 30, access: "assumed", directions: "both",
  salePrice: 0.49, electricityPrice: 0.22, variableCost: 0.03, capex: 1500000, fixedCost: 90000,
  discountPercent: 8, priceEscalationPercent: 0, costEscalationPercent: 2,
  replacementAmount: 200000, replacementYear: 2033, residualValue: 150000,
  lowSharePercent: 4, baseSharePercent: 8, highSharePercent: 15,
};
export type PlanningData = Awaited<ReturnType<typeof loadPlanningData>>;
export type PlanningSite = { id: string; label: string; lon: number; lat: number };
export type BasisChoice = { basis: "station"; stationId: string } | { basis: "model" };
export const uniformSource: SourceRef = {
  id: "uniform-hourly-assumption-v1", title: "Gleichmäßiges 24-Stunden-Profil ohne Wochenendabsenkung (Annahme)",
  url: "https://github.com/Fliegenbart/traffic-opportunity-score", kind: "assumption", version: "1",
  retrievedAt: "2026-10-02T00:00:00Z", observedThrough: "2026-10-02",
  sha256: "5e4dbbf2b3110522c40261ca284b73d503f59061fdd3eb974cbc6dd5a2ab69ce",
  license: "MIT", commercialUse: "allowed",
};

export function buildSiteRequest(site: PlanningSite, data: PlanningData, raw: SiteInput, choice?: BasisChoice) {
  const a = siteInputSchema.parse(raw);
  const edge = matchTrafficEdge(site, data.network.edges, 10);
  const candidates = findStationCandidates(site, data.bast.stations, 3);
  const unavailable = (reason: string) => ({ request: null, reason, candidates, edge });
  if (!choice) return unavailable("Bitte eine Verkehrsbasis wählen. Messstationen werden nicht automatisch einem Standort zugeordnet.");
  const station = choice.basis === "station" ? candidates.find((c) => c.station.stationId === choice.stationId)?.station : undefined;
  if (choice.basis === "station" && !station) return unavailable("Die gewählte Station hat kein vollständiges Profil innerhalb von 3 km.");
  if (station && station.meanObservedTrucksPerHour === null) return unavailable("Die gewählte Station hat keine gültige mittlere Verkehrsmenge.");
  if (choice.basis === "model" && !edge) return unavailable("Keine Modellstrecke innerhalb von 10 km. Es wird kein Verkehr erfunden.");
  const uniformProfile = { source: uniformSource, vehicleClass: "truck" as const, matchStatus: "assumed" as const, weights: Array(24).fill(1) as number[] };
  const profiles = station ? stationProfiles(station, data.bast.source) : { weekday: uniformProfile, saturday: uniformProfile, sunday: uniformProfile };
  const traffic = station ? {
    trucksPerDay: station.meanObservedTrucksPerHour! * 24, source: profiles.weekday.source,
    ...(edge ? { contextSource: data.network.source, edgeId: edge.edge.edgeId } : {}),
    referenceYear: Number(data.bast.period.end.slice(0, 4)), directionShareR1: station.directionShareR1, vehicleClass: station.vehicleClass,
  } : {
    trucksPerDay: edge!.edge.trucks2030 / 365, source: data.network.source, referenceYear: 2030,
    edgeId: edge!.edge.edgeId, matchDistanceKm: edge!.distanceKm, vehicleClass: "truck" as const,
  };
  const request = planningRequestSchema.parse({
    schemaVersion: 1,
    site: { ...site, access: { status: a.access, directions: a.directions, note: "Standortübertragung und Zufahrt nach Nutzerannahmen; keine automatische Straßen- oder Grundstücksprüfung." },
      gridStatus: a.gridKnown ? "assumed" : "unknown", competitionStatus: "unknown" },
    traffic, profiles,
    demand: { reachableShare: a.reachablePercent / 100, captureShare: a.capturePercent / 100, energyKwh: a.energyKwh, seed: 42,
      anchors: a.anchorCount ? [{ id: "anchor", hour: a.anchorHour, count: a.anchorCount, energyKwh: a.energyKwh, includedInPassing: a.anchorIncluded, activeOn: ["weekday"] }] : [] },
    capacity: { ports: a.ports, portPowerKw: a.portPowerKw, gridPowerKw: a.gridKnown ? a.gridPowerKw : null,
      lossPercent: a.lossPercent, turnaroundMinutes: a.turnaroundMinutes, maxWaitMinutes: a.maxWaitMinutes,
      opening: a.hoursOpen ? [{ startMinute: a.startHour * 60, endMinute: (a.startHour + a.hoursOpen) * 60 }] : [] },
    finance: { capex: a.capex, fixedCostAnnual: a.fixedCost, salePricePerKwh: a.salePrice,
      electricityPricePerKwh: a.electricityPrice, variableCostPerKwh: a.variableCost, discountRate: a.discountPercent / 100,
      priceEscalation: a.priceEscalationPercent / 100, costEscalation: a.costEscalationPercent / 100,
      replacements: a.replacementAmount ? [{ year: a.replacementYear, amount: a.replacementAmount }] : [], residualValue: a.residualValue },
    scenarios: ([ ["low", "Niedrig", a.lowSharePercent], ["base", "Basis", a.baseSharePercent], ["high", "Hoch", a.highSharePercent] ] as const).map(([id, label, share]) => ({
      id, label, years: Array.from({ length: 10 }, (_, i) => ({ year: 2027 + i, evShare: share / 100 * Math.min((i + 1) / 4, 1), trafficMultiplier: 1 })),
    })),
  });
  return { request, reason: null, candidates, edge };
}
