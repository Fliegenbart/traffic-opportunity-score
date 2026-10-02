import { findStationCandidates, loadPlanningData, stationProfiles } from "./charging-planning/data.js";
import { matchTrafficEdge } from "./charging-planning/traffic.js";
import { trafficSchema, type PlanningRequest, type SourceRef } from "./charging-planning/contracts.js";
import type { GeoPoint } from "./geo.js";

export type PlanningData = Awaited<ReturnType<typeof loadPlanningData>>;
export type BasisChoice = { basis: "station"; stationId: string } | { basis: "model" };
export const uniformSource: SourceRef = {
  id: "uniform-hourly-assumption-v1", title: "Gleichmäßiges 24-Stunden-Profil ohne Wochenendabsenkung (Annahme)",
  url: "https://github.com/Fliegenbart/traffic-opportunity-score", kind: "assumption", version: "1",
  retrievedAt: "2026-10-02T00:00:00Z", observedThrough: "2026-10-02",
  sha256: "5e4dbbf2b3110522c40261ca284b73d503f59061fdd3eb974cbc6dd5a2ab69ce",
  license: "MIT", commercialUse: "allowed",
};

export function resolveSiteTraffic(site: GeoPoint, data: PlanningData, choice?: BasisChoice) {
  const edge = matchTrafficEdge(site, data.network.edges, 10);
  const candidates = findStationCandidates(site, data.bast.stations, 3);
  const unavailable = (reason: string) => ({ traffic: null, profiles: null, reason, candidates, edge });
  if (!choice) return unavailable("Verkehrsbasis auswählen. Messstationen werden nicht automatisch dem Standort zugeordnet.");
  const station = choice.basis === "station" ? candidates.find((c) => c.station.stationId === choice.stationId)?.station : undefined;
  if (choice.basis === "station" && !station) return unavailable("Die gewählte Station hat kein vollständiges Profil innerhalb von 3 km.");
  if (station && station.meanObservedTrucksPerHour === null) return unavailable("Die gewählte Station hat keine gültige mittlere Verkehrsmenge.");
  if (choice.basis === "model" && !edge) return unavailable("Keine Modellstrecke innerhalb von 10 km. Es wird kein Verkehr erfunden.");
  const uniformProfile = { source: uniformSource, vehicleClass: "truck" as const, matchStatus: "assumed" as const, weights: Array(24).fill(1) as number[] };
  const profiles: PlanningRequest["profiles"] = station ? stationProfiles(station, data.bast.source)
    : { weekday: uniformProfile, saturday: uniformProfile, sunday: uniformProfile };
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
