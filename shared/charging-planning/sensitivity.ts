import { z } from "zod";
import { planningRequestSchema, type PlanningRequest } from "./contracts.js";
import { runChargingPlan } from "./engine.js";

const changeSchema = z.object({ id: z.string().min(1).max(100),
  field: z.enum(["captureShare", "reachableShare", "gridPowerKw", "ports", "capex", "electricityPricePerKwh", "salePricePerKwh"]),
  value: z.number().finite().nonnegative() }).strict();
export type SensitivityChange = z.infer<typeof changeSchema>;

export function runSensitivity(raw: PlanningRequest, rawChanges: SensitivityChange[]) {
  const input = planningRequestSchema.parse(raw);
  const changes = z.array(changeSchema).max(8).parse(rawChanges);
  if (new Set(changes.map((c) => c.id)).size !== changes.length) throw new Error("Doppelte Sensitivitäts-ID");
  const baseline = runChargingPlan(input);
  const results = changes.flatMap((change) => {
    const financeFields = ["capex", "electricityPricePerKwh", "salePricePerKwh"];
    const demandFields = ["captureShare", "reachableShare"];
    const next = { ...input,
      references: change.field === "electricityPricePerKwh" ? input.references?.filter((ref) => ref.field !== "electricityPrice") : input.references,
      finance: financeFields.includes(change.field) ? { ...input.finance, [change.field]: change.value } : input.finance,
      demand: demandFields.includes(change.field) ? { ...input.demand, [change.field]: change.value } : input.demand,
      capacity: ["ports", "gridPowerKw"].includes(change.field) ? { ...input.capacity, [change.field]: change.value } : input.capacity };
    const result = runChargingPlan(next);
    return result.scenarios.map((s, i) => ({ ...change, scenarioId: s.id, npv: s.finance.npv,
      npvDelta: s.finance.npv - baseline.scenarios[i].finance.npv,
      operatingCashflowLastYear: s.finance.years.at(-1)!.operatingCashflow,
      unservedSessionsLastYear: s.years.at(-1)!.unservedSessions }));
  });
  return { status: baseline.status, baseline: baseline.scenarios.map((s) => ({ scenarioId: s.id, npv: s.finance.npv })), changes: results,
    note: "Jeweils eine Annahme verändert, identischer Seed und Jahreszeitraum. Szenario-Sensitivität, keine statistische Unsicherheit." };
}

export function compareSitePlans(raw: PlanningRequest[]) {
  const inputs = z.array(planningRequestSchema).min(1).max(20).parse(raw);
  if (new Set(inputs.map((r) => r.site.id)).size !== inputs.length) throw new Error("Doppelte Standort-ID");
  const basis = inputs[0].scenarios.map((s) => [s.id, s.years.map((y) => [y.year, y.evShare])]);
  if (inputs.some((r) => JSON.stringify(r.scenarios.map((s) => [s.id, s.years.map((y) => [y.year, y.evShare])])) !== JSON.stringify(basis)
    || r.finance.discountRate !== inputs[0].finance.discountRate)) throw new Error("Standortvergleich benötigt gleiche Szenarien, Jahre und Diskontierung");
  const sourceSignature = (r: PlanningRequest) => `${r.traffic.source.kind}:${r.traffic.referenceYear}`;
  if (inputs.some((r) => sourceSignature(r) !== sourceSignature(inputs[0]))) throw new Error("Standortvergleich benötigt dieselbe Art von Verkehrsdaten (Zählstelle oder Modell) und dasselbe Bezugsjahr");
  const plans = inputs.map(runChargingPlan);
  return { modelVersion: plans[0].modelVersion,
    scenarios: inputs[0].scenarios.map((s) => ({ id: s.id, ranking: plans.flatMap((p) => {
      const scenario = p.scenarios.find((x) => x.id === s.id);
      return scenario ? [{ siteId: p.site.id, label: p.site.label, npv: scenario.finance.npv, gaps: p.evidence.gaps }] : [];
    }).sort((a, b) => b.npv - a.npv || (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0)) })),
    blockedSites: plans.filter((p) => p.status === "blocked").map((p) => ({ siteId: p.site.id, blockers: p.evidence.blockers })),
    investmentReady: false,
    note: "Rangfolge ausschließlich nach Szenario-NPV; Eingaben müssen vergleichbar sein. Kein empirisch validiertes Standort-Ranking." };
}
