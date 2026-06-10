import { corridorChargingStats, distanceKm, type GeoPoint } from "./geo";
import { getDistanceFitScore } from "./traffic-opportunity";

export interface ReportFleet {
  trucks: number;
  annualKmPerTruck: number;
}

export interface ReportRelation {
  name: string;
  originRegionId: string;
  destinationRegionId: string;
  /** Einfache Fahrten pro Woche über alle Fahrzeuge (Hin- und Rückfahrt = 2). */
  tripsPerWeek: number;
}

// Vereinfachtes Energie- und Mautkosten-Modell. Bewusst KEINE Vollkosten-TCO
// (Anschaffung, Wartung, Restwert) — dafür verweist der Report auf den
// TCO-Rechner. Alle Werte sind konfigurierbar und werden im Report ausgewiesen.
export interface ReportAssumptions {
  roadFactor: number;
  truckRangeKm: number;
  dieselPricePerL: number;
  dieselConsumptionLPer100Km: number;
  electricConsumptionKwhPer100Km: number;
  depotPowerPricePerKwh: number;
  publicPowerPricePerKwh: number;
  publicChargeShare: number;
  tollAdvantagePerKm: number;
  dieselCo2KgPerL: number;
  gridCo2KgPerKwh: number;
}

export const DEFAULT_ASSUMPTIONS: ReportAssumptions = {
  roadFactor: 1.25,
  truckRangeKm: 350,
  dieselPricePerL: 1.55,
  dieselConsumptionLPer100Km: 26,
  electricConsumptionKwhPer100Km: 110,
  depotPowerPricePerKwh: 0.22,
  publicPowerPricePerKwh: 0.45,
  publicChargeShare: 0.35,
  tollAdvantagePerKm: 0.1,
  dieselCo2KgPerL: 2.65,
  gridCo2KgPerKwh: 0.3,
};

export type RelationFeasibility = "ready" | "plannable" | "hard";

export interface EvaluatedRelation {
  relation: ReportRelation;
  originName: string;
  destinationName: string;
  distanceKm: number;
  distanceSource: "korridor" | "luftlinie";
  distanceFitScore: number;
  hubsOnRoute: number;
  maxGapKm: number;
  feasibility: RelationFeasibility;
  dieselCostPerKm: number;
  electricCostPerKm: number;
  savingPerKm: number;
  annualKm: number;
  annualSavingEur: number;
  annualCo2SavedTons: number;
}

export interface ReportTotals {
  relationCount: number;
  readyCount: number;
  plannableCount: number;
  annualKm: number;
  annualSavingEur: number;
  annualCo2SavedTons: number;
}

export function feasibilityFor(
  totalKm: number,
  maxGapKm: number,
  assumptions: ReportAssumptions,
): RelationFeasibility {
  // Annahme: Depotladung an Start und Ziel. Kürzer als die Reichweite ist
  // ohne Zwischenladung fahrbar; sonst entscheidet die größte Ladelücke.
  if (totalKm <= assumptions.truckRangeKm) return "ready";
  if (maxGapKm <= assumptions.truckRangeKm * 0.8) return "ready";
  if (maxGapKm <= assumptions.truckRangeKm * 1.15) return "plannable";
  return "hard";
}

export function dieselCostPerKm(assumptions: ReportAssumptions): number {
  return (assumptions.dieselConsumptionLPer100Km / 100) * assumptions.dieselPricePerL;
}

export function electricCostPerKm(assumptions: ReportAssumptions): number {
  const blendedPower =
    (1 - assumptions.publicChargeShare) * assumptions.depotPowerPricePerKwh +
    assumptions.publicChargeShare * assumptions.publicPowerPricePerKwh;
  return (
    (assumptions.electricConsumptionKwhPer100Km / 100) * blendedPower -
    assumptions.tollAdvantagePerKm
  );
}

export function co2SavedKgPerKm(assumptions: ReportAssumptions): number {
  const diesel = (assumptions.dieselConsumptionLPer100Km / 100) * assumptions.dieselCo2KgPerL;
  const electric =
    (assumptions.electricConsumptionKwhPer100Km / 100) * assumptions.gridCo2KgPerKwh;
  return diesel - electric;
}

export interface RegionLookup {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

export interface CorridorLookup {
  originRegionId: string;
  destinationRegionId: string;
  totalDistanceKm: number;
}

export function evaluateRelation(
  relation: ReportRelation,
  regionsById: Map<string, RegionLookup>,
  corridors: CorridorLookup[],
  liveHubs: GeoPoint[],
  assumptions: ReportAssumptions = DEFAULT_ASSUMPTIONS,
): EvaluatedRelation | null {
  const origin = regionsById.get(relation.originRegionId);
  const destination = regionsById.get(relation.destinationRegionId);
  if (!origin || !destination) return null;

  const corridorMatch = corridors.find(
    (corridor) =>
      (corridor.originRegionId === relation.originRegionId &&
        corridor.destinationRegionId === relation.destinationRegionId) ||
      (corridor.originRegionId === relation.destinationRegionId &&
        corridor.destinationRegionId === relation.originRegionId),
  );
  const straightKm = distanceKm(origin, destination);
  const routeKm = corridorMatch
    ? corridorMatch.totalDistanceKm
    : straightKm * assumptions.roadFactor;

  // Autobahnen weichen von der Luftlinie ab (die A24 liegt z. B. ~30 km
  // nördlich der Linie Hamburg–Berlin) — der Puffer wächst deshalb mit der
  // Streckenlänge.
  const bufferKm = Math.max(20, straightKm * 0.15);
  const charging = corridorChargingStats(origin, destination, liveHubs, bufferKm);
  // Die Lücken-Statistik läuft über die Luftlinie; auf Straßen-km skaliert.
  const gapRoadKm =
    charging.corridorKm > 0
      ? (charging.maxGapKm / charging.corridorKm) * routeKm
      : routeKm;

  const dieselKm = dieselCostPerKm(assumptions);
  const electricKm = electricCostPerKm(assumptions);
  const annualKm = routeKm * relation.tripsPerWeek * 52;
  const savingPerKm = dieselKm - electricKm;

  return {
    relation,
    originName: origin.name,
    destinationName: destination.name,
    distanceKm: Math.round(routeKm),
    distanceSource: corridorMatch ? "korridor" : "luftlinie",
    distanceFitScore: getDistanceFitScore(routeKm),
    hubsOnRoute: charging.hubsOnRoute,
    maxGapKm: Math.round(gapRoadKm),
    feasibility: feasibilityFor(routeKm, gapRoadKm, assumptions),
    dieselCostPerKm: dieselKm,
    electricCostPerKm: electricKm,
    savingPerKm,
    annualKm: Math.round(annualKm),
    annualSavingEur: Math.round(annualKm * savingPerKm),
    annualCo2SavedTons: Math.round((annualKm * co2SavedKgPerKm(assumptions)) / 1000),
  };
}

export function aggregateReport(relations: EvaluatedRelation[]): ReportTotals {
  return {
    relationCount: relations.length,
    readyCount: relations.filter((r) => r.feasibility === "ready").length,
    plannableCount: relations.filter((r) => r.feasibility === "plannable").length,
    annualKm: relations.reduce((sum, r) => sum + r.annualKm, 0),
    annualSavingEur: relations.reduce((sum, r) => sum + r.annualSavingEur, 0),
    annualCo2SavedTons: relations.reduce((sum, r) => sum + r.annualCo2SavedTons, 0),
  };
}

export const FEASIBILITY_LABELS: Record<
  RelationFeasibility,
  { label: string; description: string }
> = {
  ready: {
    label: "Heute elektrisch fahrbar",
    description:
      "Strecke liegt in Reichweite oder die größte Ladelücke ist mit heutiger Infrastruktur überbrückbar.",
  },
  plannable: {
    label: "Fahrbar mit Ladeplanung",
    description:
      "Machbar, wenn Ladestopps fest in die Tourenplanung eingebaut werden; Reserven sind knapp.",
  },
  hard: {
    label: "Noch schwierig",
    description:
      "Die größte Lücke zwischen Lademöglichkeiten übersteigt die Reichweitenreserve deutlich.",
  },
};
