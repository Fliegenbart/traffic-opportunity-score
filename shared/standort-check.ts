import { distanceKm, pointToSegmentKm, type GeoPoint } from "./geo";

export type SiteSignal = "stark" | "gut" | "pruefen" | "schwach";

export interface SiteEdgeInput extends Record<string, unknown> {
  edgeId: number;
  label: string;
  aLon: number;
  aLat: number;
  bLon: number;
  bLat: number;
  trucks2030: number;
  whiteSpot?: boolean;
}

export interface SiteHubInput {
  name: string;
  lon: number;
  lat: number;
}

export interface SiteRegionInput {
  id: string;
  name: string;
  lon: number;
  lat: number;
  score: number;
  rank: number;
}

export interface SiteAssessment {
  signal: SiteSignal;
  label: string;
  reasons: string[];
  edge: { edgeId: number; label: string; km: number; trucksPerDay: number; whiteSpot: boolean } | null;
  hub: { name: string; km: number } | null;
  region: { id: string; name: string; score: number; rank: number; km: number } | null;
  substation: { km: number; kv: number } | null;
}

// E-Lkw-Hochlauf-Szenarien für die Erlös-Schätzung. Bewusst Szenarien,
// keine Prognose — der Hochlauf ist politik- und flottengetrieben.
export interface RampScenario {
  id: string;
  label: string;
  evShare: number;
}

export const RAMP_SCENARIOS: RampScenario[] = [
  { id: "konservativ", label: "Konservativ", evShare: 0.04 },
  { id: "basis", label: "Basis", evShare: 0.08 },
  { id: "ambitioniert", label: "Ambitioniert", evShare: 0.15 },
];

export const REVENUE_ASSUMPTIONS = {
  /** Anteil vorbeifahrender E-Lkw, der an diesem Standort lädt. */
  stopShare: 0.02,
  /** Durchschnittliche Energiemenge je Ladevorgang (kWh). */
  avgChargeKwh: 250,
  /** Rohmarge je verkaufter kWh (€). */
  marginPerKwh: 0.15,
} as const;

export interface RevenueEstimate {
  scenario: RampScenario;
  chargesPerDay: number;
  energyMwhPerDay: number;
  marginEurPerYear: number;
}

function marginEurPerYear(trucksPerDay: number, evShare: number): number {
  const energyKwhPerDay =
    trucksPerDay * evShare * REVENUE_ASSUMPTIONS.stopShare * REVENUE_ASSUMPTIONS.avgChargeKwh;
  return energyKwhPerDay * REVENUE_ASSUMPTIONS.marginPerKwh * 365;
}

export function estimateSiteRevenue(trucksPerDay: number): RevenueEstimate[] {
  return RAMP_SCENARIOS.map((scenario) => {
    const chargesPerDay =
      trucksPerDay * scenario.evShare * REVENUE_ASSUMPTIONS.stopShare;
    return {
      scenario,
      chargesPerDay: Math.round(chargesPerDay * 10) / 10,
      energyMwhPerDay: Math.round((chargesPerDay * REVENUE_ASSUMPTIONS.avgChargeKwh) / 100) / 10,
      marginEurPerYear: Math.round(marginEurPerYear(trucksPerDay, scenario.evShare)),
    };
  });
}

// Hochlauf-Fächer: Der E-Lkw-Anteil wächst von einem kleinen Startwert (2026)
// beschleunigend zum Szenario-Ziel (2030) und darüber hinaus. Bewusst Szenarien,
// keine Prognose — die evShare-Zielwerte sind die deklarierten Annahmen.
export interface RampPoint {
  year: number;
  konservativ: number;
  basis: number;
  ambitioniert: number;
}

const RAMP_YEARS = [2026, 2027, 2028, 2029, 2030, 2031, 2032];
const RAMP_START_FRACTION = 0.18; // Anteil des Ziels, der 2026 erreicht ist

export function estimateRampPaths(trucksPerDay: number): {
  points: RampPoint[];
  maxMargin: number;
} {
  const points = RAMP_YEARS.map((year) => {
    // 2026 → RAMP_START_FRACTION, 2030 → 1.0, danach leicht weiter bis 2032.
    const t = (year - 2026) / (2030 - 2026);
    const factor =
      t <= 1 ? RAMP_START_FRACTION + (1 - RAMP_START_FRACTION) * t * t : 1 + (t - 1) * 0.5;
    const margin = (evShare: number) =>
      Math.round(marginEurPerYear(trucksPerDay, evShare * factor));
    return {
      year,
      konservativ: margin(RAMP_SCENARIOS[0].evShare),
      basis: margin(RAMP_SCENARIOS[1].evShare),
      ambitioniert: margin(RAMP_SCENARIOS[2].evShare),
    };
  });
  return { points, maxMargin: Math.max(...points.map((p) => p.ambitioniert), 1) };
}

export const SITE_SIGNAL_LABELS: Record<SiteSignal, string> = {
  stark: "Starkes Standort-Signal",
  gut: "Gutes Standort-Signal",
  pruefen: "Lage prüfen",
  schwach: "Schwaches Verkehrssignal",
};

// Schwellen der Heuristik — bewusst einfach und im UI erklärbar.
const EDGE_NEAR_KM = 10;
const EDGE_MID_KM = 25;
const HUB_FREE_KM = 25;
const HUB_MODERATE_KM = 10;
const DAILY_HIGH = 15000;

function trafficTier(edgeKm: number | null, trucksPerDay: number): "hoch" | "mittel" | "niedrig" {
  if (edgeKm === null || edgeKm > EDGE_MID_KM) return "niedrig";
  if (edgeKm <= EDGE_NEAR_KM && trucksPerDay >= DAILY_HIGH) return "hoch";
  return "mittel";
}

function competitionTier(hubKm: number | null): "frei" | "moderat" | "dicht" {
  if (hubKm === null || hubKm > HUB_FREE_KM) return "frei";
  if (hubKm > HUB_MODERATE_KM) return "moderat";
  return "dicht";
}

export function assessSite(
  point: GeoPoint,
  edges: SiteEdgeInput[],
  liveHubs: SiteHubInput[],
  regions: SiteRegionInput[],
  substations: [number, number, number][] = [],
): SiteAssessment {
  let bestEdge: SiteEdgeInput | null = null;
  let bestEdgeKm = Infinity;
  for (const edge of edges) {
    const km = pointToSegmentKm(
      point,
      { lon: edge.aLon, lat: edge.aLat },
      { lon: edge.bLon, lat: edge.bLat },
    );
    if (km < bestEdgeKm) {
      bestEdgeKm = km;
      bestEdge = edge;
    }
  }

  let bestHub: SiteHubInput | null = null;
  let bestHubKm = Infinity;
  for (const hub of liveHubs) {
    const km = distanceKm(point, hub);
    if (km < bestHubKm) {
      bestHubKm = km;
      bestHub = hub;
    }
  }

  let bestRegion: SiteRegionInput | null = null;
  let bestRegionKm = Infinity;
  for (const region of regions) {
    const km = distanceKm(point, region);
    if (km < bestRegionKm) {
      bestRegionKm = km;
      bestRegion = region;
    }
  }

  let bestSub: [number, number, number] | null = null;
  let bestSubKm = Infinity;
  for (const sub of substations) {
    const km = distanceKm(point, { lon: sub[0], lat: sub[1] });
    if (km < bestSubKm) {
      bestSubKm = km;
      bestSub = sub;
    }
  }

  const trucksPerDay = bestEdge ? Math.round(bestEdge.trucks2030 / 365) : 0;
  const traffic = trafficTier(bestEdge ? bestEdgeKm : null, trucksPerDay);
  const competition = competitionTier(bestHub ? bestHubKm : null);

  let signal: SiteSignal;
  if (traffic === "hoch" && competition === "frei") signal = "stark";
  else if (traffic === "hoch" && competition === "moderat") signal = "gut";
  else if (traffic === "mittel" && competition === "frei") signal = "gut";
  else if (traffic === "niedrig" && competition !== "frei") signal = "schwach";
  else if (traffic === "niedrig") signal = "pruefen";
  else signal = "pruefen";

  const reasons: string[] = [];
  if (bestEdge) {
    reasons.push(
      traffic === "hoch"
        ? `Hotspot-Strecke „${bestEdge.label}" mit ≈ ${trucksPerDay.toLocaleString("de-DE")} Lkw/Tag nur ${Math.round(bestEdgeKm)} km entfernt.`
        : traffic === "mittel"
          ? `Nächste Hotspot-Strecke („${bestEdge.label}") liegt ${Math.round(bestEdgeKm)} km entfernt — solides, aber kein Spitzensignal.`
          : `Keine der 60 stärksten Lkw-Strecken im ${EDGE_MID_KM}-km-Umkreis — das Verkehrssignal trägt hier allein keine Ladeinfrastruktur.`,
    );
  }
  if (bestHub) {
    reasons.push(
      competition === "frei"
        ? `Kein Lkw-Ladepark im ${HUB_FREE_KM}-km-Umkreis (nächster: ${bestHub.name}, ${Math.round(bestHubKm)} km) — unbesetzter Suchraum.`
        : competition === "moderat"
          ? `${bestHub.name} liegt ${Math.round(bestHubKm)} km entfernt — Koexistenz möglich, Einzugsgebiete prüfen.`
          : `${bestHub.name} liegt nur ${Math.round(bestHubKm)} km entfernt — direkter Wettbewerb um dieselben Lkw.`,
    );
  }
  if (bestRegion) {
    reasons.push(
      `Region ${bestRegion.name}: Score ${bestRegion.score}, Platz ${bestRegion.rank} von 120.`,
    );
  }
  if (bestSub) {
    reasons.push(
      `Nächstes Umspannwerk (≥110 kV) in ${Math.round(bestSubKm * 10) / 10} km — Netzanschluss-Proxy, ersetzt keine Prüfung beim Netzbetreiber.`,
    );
  }

  return {
    signal,
    label: SITE_SIGNAL_LABELS[signal],
    reasons,
    edge: bestEdge
      ? {
          edgeId: bestEdge.edgeId,
          label: bestEdge.label,
          km: Math.round(bestEdgeKm * 10) / 10,
          trucksPerDay,
          whiteSpot: Boolean(bestEdge.whiteSpot),
        }
      : null,
    hub: bestHub ? { name: bestHub.name, km: Math.round(bestHubKm * 10) / 10 } : null,
    region: bestRegion
      ? {
          id: bestRegion.id,
          name: bestRegion.name,
          score: bestRegion.score,
          rank: bestRegion.rank,
          km: Math.round(bestRegionKm),
        }
      : null,
    substation: bestSub
      ? { km: Math.round(bestSubKm * 10) / 10, kv: bestSub[2] }
      : null,
  };
}
