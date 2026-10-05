import { planningRequestSchema, PlanningLimitError, type PlanningRequest } from "./contracts.js";
import { generateArrivals } from "./demand.js";
import { simulateDay } from "./simulation.js";
import { calculateCashflows } from "./finance.js";

export const MODEL_VERSION = "charging-planning-v2";
const daytypes = ["weekday", "saturday", "sunday"] as const;
export function calendarCounts(year: number) {
  const counts = { weekday: 0, saturday: 0, sunday: 0 };
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 86400000) {
    const day = new Date(t).getUTCDay();
    counts[day === 0 ? "sunday" : day === 6 ? "saturday" : "weekday"]++;
  }
  return counts;
}

export function runChargingPlan(raw: PlanningRequest) {
  const input = planningRequestSchema.parse(raw);
  const sources = [input.traffic.source, ...(input.traffic.contextSource ? [input.traffic.contextSource] : []), ...daytypes.map((d) => input.profiles[d].source), ...(input.references || []).map((ref) => ref.source)];
  const gaps = ["charging_demand_not_validated", "local_and_depot_traffic_not_inferred", "scenario_assumptions_not_probabilities", "annual_seasonality_not_modelled", "truck_duty_cycle_and_energy_mix_assumed"];
  const blockers: string[] = [];
  const directions = input.site.access.directions || "both";
  const r1Share = input.traffic.directionShareR1;
  const directionShare = directions === "both" ? 1 : directions === "one_unknown" ? 0.5 : r1Share == null ? null : directions === "r1" ? r1Share : 1 - r1Share;
  if (directionShare === null) blockers.push("traffic_direction_split_unknown");
  if (input.capacity.gridPowerKw === null || input.site.gridStatus === "unknown") blockers.push("grid_power_unknown");
  if (input.site.access.status === "inaccessible") blockers.push("site_inaccessible");
  if (input.site.access.status !== "verified") gaps.push("truck_access_not_verified");
  if (input.site.gridStatus !== "verified") gaps.push("grid_offer_not_verified");
  if (input.site.competitionStatus === "unknown") gaps.push("competition_not_reviewed");
  if (input.traffic.vehicleClass === "heavy_traffic_proxy") gaps.push("heavy_traffic_includes_other_vehicles");
  if (directions === "r1" || directions === "r2") gaps.push("direction_split_assumed_constant_by_hour");
  if (directions === "one_unknown") gaps.push("direction_share_assumed_half");
  if (daytypes.some((d) => input.profiles[d].vehicleClass === "heavy_traffic_proxy")) gaps.push("hourly_profile_uses_heavy_traffic_proxy");
  if (daytypes.some((d) => input.profiles[d].matchStatus !== "reviewed")) gaps.push("counting_station_match_not_reviewed");
  if (sources.some((s) => s.commercialUse !== "allowed")) gaps.push("source_commercial_rights_unresolved");
  if (sources.some((s) => Number(s.observedThrough.slice(0, 4)) < input.scenarios[0].years[0].year - 2)) gaps.push("historical_source_not_current_observation");
  let simulationEvents = 0;
  const scenarios = blockers.length ? [] : input.scenarios.map((scenario) => {
    const years = scenario.years.map((year, yearIndex) => {
      const counts = calendarCounts(year.year);
      // Preserve relative day-type volumes while retaining the annual-average traffic level.
      const calendarDays = counts.weekday + counts.saturday + counts.sunday;
      const profileSums = Object.fromEntries(daytypes.map((d) => [d, input.profiles[d].weights.reduce((a, b) => a + b, 0)])) as Record<typeof daytypes[number], number>;
      const weightedProfile = daytypes.reduce((sum, d) => sum + profileSums[d] * counts[d], 0) / calendarDays;
      const days = daytypes.flatMap((d) => {
        const dailyTraffic = input.traffic.trucksPerDay * directionShare! * year.trafficMultiplier * profileSums[d] / weightedProfile;
        const dailyDemand = { ...input.demand, anchors: input.demand.anchors.filter((a) => !a.activeOn || a.activeOn.includes(d)) };
        const expected = dailyTraffic * year.evShare * dailyDemand.reachableShare * dailyDemand.captureShare;
        const fraction = expected - Math.floor(expected);
        const variants: { rounding: "floor" | "ceil"; representativeWeight: number }[] = fraction < 1e-10
          ? [{ rounding: "floor", representativeWeight: 1 }]
          : [{ rounding: "floor", representativeWeight: 1 - fraction }, { rounding: "ceil", representativeWeight: fraction }];
        return variants.map(({ rounding, representativeWeight }) => {
          const arrivals = generateArrivals(dailyTraffic, year.evShare, input.profiles[d].weights, dailyDemand, rounding);
          simulationEvents += arrivals.sessions.length;
          if (simulationEvents > 100000) throw new PlanningLimitError("Maximal 100.000 simulierte Ladungen über alle Referenztage eines Plans");
          return { daytype: d, calendarCount: counts[d], representativeWeight, annualWeightDays: counts[d] * representativeWeight,
            arrivals, simulation: simulateDay(arrivals.sessions, input.capacity) };
        });
      });
      const sum = (field: "deliveredKwh" | "gridKwh" | "completedSessions" | "unservedSessions" | "offeredSessions" | "unservedKwh") => days.reduce((s, d) => s + d.annualWeightDays * d.simulation[field], 0);
      const costFactor = (1 + input.finance.costEscalation) ** yearIndex;
      const contribution = input.finance.salePricePerKwh * (1 + input.finance.priceEscalation) ** yearIndex
        - (input.finance.variableCostPerKwh + input.finance.electricityPricePerKwh / (1 - input.capacity.lossPercent / 100)) * costFactor;
      const requiredEnergyKwhPerYear = contribution > 0 ? input.finance.fixedCostAnnual * costFactor / contribution : null;
      const hoursOpen = input.capacity.opening.reduce((s, w) => s + (w.endMinute - w.startMinute) / 60, 0);
      const capacityUpperBoundKwhPerYear = Math.min(input.capacity.ports * Math.min(input.capacity.portPowerKw, input.capacity.vehiclePowerKw ?? 2000),
        input.capacity.gridPowerKw! * (1 - input.capacity.lossPercent / 100)) * hoursOpen * calendarDays;
      return { year: year.year, evShare: year.evShare, trafficMultiplier: year.trafficMultiplier, calendarDays,
        deliveredKwh: sum("deliveredKwh"), gridKwh: sum("gridKwh"), completedSessions: sum("completedSessions"),
        offeredSessions: sum("offeredSessions"), unservedSessions: sum("unservedSessions"), unservedKwh: sum("unservedKwh"),
        peakGridKw: Math.max(...days.map((d) => d.simulation.peakGridKw)),
        servedShare: sum("offeredSessions") ? sum("completedSessions") / sum("offeredSessions") : null,
        breakEven: { requiredEnergyKwhPerYear, capacityUpperBoundKwhPerYear,
          capacityCanPossiblySupport: requiredEnergyKwhPerYear !== null && requiredEnergyKwhPerYear <= capacityUpperBoundKwhPerYear,
          achievedInScenario: requiredEnergyKwhPerYear !== null && sum("deliveredKwh") >= requiredEnergyKwhPerYear,
          requiredEquivalentSessionsPerDay: requiredEnergyKwhPerYear === null ? null : requiredEnergyKwhPerYear / calendarDays / input.demand.energyKwh,
          note: "Energie-Break-even deckt Betriebskosten, nicht Investition oder Finanzierung. Kapazitätsobergrenze ignoriert Wechselzeiten und Ankunftsspitzen." }, days };
    });
    const finance = calculateCashflows(years.map(({ year, deliveredKwh, gridKwh, completedSessions }) => ({ year, deliveredKwh, gridKwh, completedSessions })), input.finance);
    return { id: scenario.id, label: scenario.label, years, finance };
  });
  return { schemaVersion: 1 as const, modelVersion: MODEL_VERSION,
    status: blockers.length ? "blocked" as const : "scenario_only" as const,
    site: input.site, input,
    evidence: { blockers, gaps, sources,
      declaredCommercialRightsAllowed: sources.every((s) => s.commercialUse === "allowed"), investmentReady: false,
      sourceVerification: "caller_supplied_metadata" as const,
      nextChecks: ["Lkw-Zufahrt und Fahrtrichtung vor Ort prüfen", "Netzangebot mit Leistung, Kosten und Termin einholen", "Ankerkunden und beobachtete Ladevorgänge zur Validierung bereitstellen"] },
    assumptions: { timeStepMinutes: 5, queueDiscipline: "FCFS", overnightCarry: false, reachableDirectionShare: directionShare, arrivalModel: "rounded_daily_total_seeded_hourly_scenario",
      annualAggregation: "Gewichtete Floor-/Ceil-Referenztage erhalten den erwarteten Tagesbedarf; Jahresladungen sind Szenario-Erwartungswerte, keine beobachteten ganzzahligen Ereignisse.",
      waitP95Meaning: "95. Perzentil gestarteter Ladungen innerhalb eines Referenztages; nicht das gepoolte Jahresperzentil und keine Prognosegüte oder Konfidenzgrenze.",
      exclusions: ["Ladekurven", "Batteriespeicher", "Feiertagseffekte", "Jahressaisonalität", "stochastische Ausfälle", "Finanzierung", "Steuern", "Förderung", "empirisch kalibrierte Nachfrage"] },
    scenarios };
}
export type ChargingPlanResult = ReturnType<typeof runChargingPlan>;
