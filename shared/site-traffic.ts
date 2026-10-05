import { findStationCandidates, loadPlanningData, stationProfiles } from "./charging-planning/data.js";
import { matchTrafficEdge } from "./charging-planning/traffic.js";
import { trafficSchema, type PlanningRequest, type SourceRef } from "./charging-planning/contracts.js";
import type { GeoPoint } from "./geo.js";

export type PlanningData = Awaited<ReturnType<typeof loadPlanningData>>;
export type TrafficDirection = "both" | "r1" | "r2" | "one_unknown";
// Direction is chosen per site together with the source; there is deliberately no default.
export type BasisChoice = ({ basis: "station"; stationId: string } | { basis: "model" }) & { direction?: TrafficDirection };
export const uniformSource: SourceRef = {
  id: "uniform-hourly-assumption-v1", title: "Gleichmäßiges 24-Stunden-Profil ohne Wochenendabsenkung (Annahme)",
  url: "https://github.com/Fliegenbart/traffic-opportunity-score", kind: "assumption", version: "1",
  retrievedAt: "2026-10-02T00:00:00Z", observedThrough: "2026-10-02",
  sha256: "5e4dbbf2b3110522c40261ca284b73d503f59061fdd3eb974cbc6dd5a2ab69ce",
  license: "MIT", commercialUse: "allowed",
};

export const meanProfileSource = (bast: SourceRef): SourceRef => ({ ...bast, id: `${bast.id}-mean-truck-profile`,
  title: `${bast.title}: gemitteltes Lkw-Stundenprofil aller vollständigen Zählstellen (Annahme für berechneten Verkehr)` });

// Equal-weight mean of all complete truck station profiles. Each station is normalised to its own weekly total,
// so the profile keeps realistic peaks and weekend drops without letting large stations dominate.
export function meanStationProfiles(data: PlanningData): PlanningRequest["profiles"] {
  const daytypes = ["weekday", "saturday", "sunday"] as const;
  const usable = data.bast.stations.filter((s) => s.usableAsCompleteProfile && s.vehicleClass === "truck"
    && daytypes.every((d) => s.profiles[d].every((v) => v !== null)));
  const sums = Object.fromEntries(daytypes.map((d) => [d, Array(24).fill(0) as number[]])) as Record<typeof daytypes[number], number[]>;
  for (const station of usable) {
    const week = daytypes.reduce((t, d) => t + (d === "weekday" ? 5 : 1) * station.profiles[d].reduce<number>((a, b) => a + (b ?? 0), 0), 0);
    if (week <= 0) continue;
    for (const d of daytypes) station.profiles[d].forEach((v, h) => { sums[d][h] += (v ?? 0) / week; });
  }
  if (!usable.length || sums.weekday.every((v) => v === 0)) {
    const flat = { source: uniformSource, vehicleClass: "truck" as const, matchStatus: "assumed" as const, weights: Array(24).fill(1) as number[] };
    return { weekday: flat, saturday: flat, sunday: flat };
  }
  const source = meanProfileSource(data.bast.source);
  return Object.fromEntries(daytypes.map((d) => [d, { source, vehicleClass: "truck" as const, matchStatus: "assumed" as const, weights: sums[d] }])) as PlanningRequest["profiles"];
}

// Model traffic exists for 2019 and 2030. Interpolate linearly in between and hold 2030 afterwards (no extrapolation).
export function modelTrafficMultiplier(edge: { trucks2019: number; trucks2030: number }, year: number) {
  if (edge.trucks2030 <= 0 || year >= 2030) return 1;
  const t = Math.max(0, Math.min(1, (year - 2019) / 11));
  return (edge.trucks2019 + (edge.trucks2030 - edge.trucks2019) * t) / edge.trucks2030;
}

const roadRefs = (text: string) => new Set(Array.from(text.matchAll(/\b([AB])\s?(\d{1,3})\b/g), (m) => `${m[1]}${m[2]}`));
// BASt stores the road class separately ("A" + "2"); build the same "A2" form as in place names.
const stationRoad = (s: { roadClass: string; road: string }) => roadRefs(/^[AB]/.test(s.road.trim()) ? s.road : `${s.roadClass} ${s.road}`);
// Warns when a counting station sits on a different motorway than the one named in the site label
// (typical at interchanges), or when nearby stations cover several roads.
export function stationRoadWarning(siteLabel: string, context: Pick<SiteTraffic, "candidates">, stationId?: string) {
  const station = context.candidates.find((c) => c.station.stationId === stationId)?.station;
  const siteRoads = roadRefs(siteLabel);
  const stationRoads = new Set(context.candidates.flatMap((c) => Array.from(stationRoad(c.station))));
  if (station && siteRoads.size) {
    const own = Array.from(stationRoad(station));
    if (own.length && !own.some((r) => siteRoads.has(r))) return `Achtung: Die Zählstelle liegt an der ${own.join("/")}, der Standort ist als ${Array.from(siteRoads).join("/")} benannt. Bitte prüfen, an welcher Straße das Grundstück tatsächlich angeschlossen ist.`;
  }
  if (stationRoads.size > 1) return `In der Nähe liegen Zählstellen an mehreren Straßen (${Array.from(stationRoads).join(", ")}). Wähle die Straße, an der die Zufahrt zum Grundstück liegt.`;
  return null;
}

export function resolveSiteTraffic(site: GeoPoint, data: PlanningData, choice?: BasisChoice) {
  const edge = matchTrafficEdge(site, data.network.edges, 10);
  const candidates = findStationCandidates(site, data.bast.stations, 3);
  const unavailable = (reason: string) => ({ traffic: null, profiles: null, reason, candidates, edge });
  if (!choice) return unavailable("Die Zählstellen liegen in der Nähe. Ob ihr Verkehr tatsächlich am Standort vorbeiführt, ist noch nicht geprüft.");
  const station = choice.basis === "station" ? candidates.find((c) => c.station.stationId === choice.stationId)?.station : undefined;
  if (choice.basis === "station" && !station) return unavailable("Für diese Zählstelle fehlen vollständige Stundenwerte, oder sie liegt mehr als 3 km entfernt.");
  if (station && station.meanObservedTrucksPerHour === null) return unavailable("Die Verkehrsmessungen dieser Zählstelle reichen für die Rechnung nicht aus.");
  if (choice.basis === "model" && !edge) return unavailable("Keine berechnete Strecke mit Lkw-Verkehr im Umkreis von 10 km. Ohne Verkehrsdaten gibt es kein Ergebnis.");
  const profiles: PlanningRequest["profiles"] = station ? stationProfiles(station, data.bast.source) : meanStationProfiles(data);
  const traffic = trafficSchema.parse(station ? {
    trucksPerDay: station.meanObservedTrucksPerHour! * 24, source: profiles.weekday.source,
    ...(edge ? { contextSource: data.network.source, edgeId: edge.edge.edgeId } : {}),
    referenceYear: Number(data.bast.period.end.slice(0, 4)), directionShareR1: station.directionShareR1, vehicleClass: station.vehicleClass,
    matchDistanceKm: candidates.find((c) => c.station.stationId === station.stationId)!.distanceKm,
  } : {
    trucksPerDay: edge!.edge.trucks2030 / 365, source: data.network.source, referenceYear: 2030,
    edgeId: edge!.edge.edgeId, matchDistanceKm: edge!.distanceKm, vehicleClass: "truck",
  });
  return { traffic, profiles, reason: null, candidates, edge };
}

export type SiteTraffic = ReturnType<typeof resolveSiteTraffic>;
export function validateHotspotConsistency(hotspots: { edgeId: number; trucks2019: number; trucks2030: number; aLon: number; aLat: number; bLon: number; bLat: number }[], network: PlanningData["network"]) {
  const canonical = new Map(network.edges.map((edge) => [edge.edgeId, edge]));
  for (const hotspot of hotspots) {
    const edge = canonical.get(hotspot.edgeId);
    if (!edge || hotspot.trucks2019 !== edge.trucks2019 || hotspot.trucks2030 !== edge.trucks2030
      || (["aLon", "aLat", "bLon", "bLat"] as const).some((key) => !Number.isFinite(hotspot[key]) || Math.abs(hotspot[key] - edge[key]) > 0.00001)) {
      throw new Error(`Hotspot #${hotspot.edgeId} widerspricht dem gemeinsamen Verkehrsnetz`);
    }
  }
}

export function siteTrafficEvidence(context: SiteTraffic) {
  return {
    traffic: context.traffic?.source.kind ?? "unknown",
    siteMatch: "unreviewed" as const,
    demand: "not_validated" as const,
    investmentReady: false as const,
  };
}
