import { distanceKm, pointToSegmentKm, type GeoPoint } from "./geo.js";
import type { LorryParking, OccupancyProfile } from "./surroundings.js";

type Edge = { aLon: number; aLat: number; bLon: number; bLat: number; trucks2030: number };
type Hub = GeoPoint & { name: string };

// Weights of the finder score; deliberately simple so the list can be explained line by line.
export const FINDER_WEIGHTS = { dwell: 0.4, traffic: 0.25, competition: 0.25, grid: 0.1 } as const;
const EDGE_MAX_KM = 10;
const UNMEASURED_DISCOUNT = 0.7;

export type FinderCandidate = LorryParking & {
  trucksPerNight: number | null; nightOccupancy: number | null; trucksPerDay: number | null;
  hub: { name: string; km: number } | null; substationKm: number | null;
  parts: Record<keyof typeof FINDER_WEIGHTS, number>; score: number;
};

const nearest = <T>(items: T[], km: (item: T) => number) => {
  let best: { item: T; km: number } | null = null;
  for (const item of items) { const d = km(item); if (!best || d < best.km) best = { item, km: d }; }
  return best;
};

export function finderRoads(parking: LorryParking[]) {
  const counts = new Map<string, number>();
  for (const p of parking) if (!p.blocked && /^A\d+$/.test(p.road)) counts.set(p.road, (counts.get(p.road) ?? 0) + 1);
  return Array.from(counts, ([road, sites]) => ({ road, sites })).sort((a, b) => Number(a.road.slice(1)) - Number(b.road.slice(1)));
}

// Candidates are the motorway's lorry car parks: trucks already stop there. Whether land is available is not known.
export function rankRoadSites(road: string, parking: LorryParking[], profiles: OccupancyProfile[], edges: Edge[], hubs: Hub[], substations: [number, number, number][], limit = 10): FinderCandidate[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return parking.filter((p) => p.road === road && !p.blocked).map((site) => {
    const profile = byId.get(site.id);
    const measured = profile && profile.night !== null ? Math.round((profile.spaces ?? site.truckSpaces ?? 0) * profile.night / 100) : null;
    const edge = nearest(edges.filter((e) => e.trucks2030 > 0), (e) => pointToSegmentKm(site, { lon: e.aLon, lat: e.aLat }, { lon: e.bLon, lat: e.bLat }));
    const trucksPerDay = edge && edge.km <= EDGE_MAX_KM ? Math.round(edge.item.trucks2030 / 365) : null;
    const hub = nearest(hubs, (h) => distanceKm(site, h));
    const sub = nearest(substations, (s) => distanceKm(site, { lon: s[0], lat: s[1] }));
    const parts = {
      dwell: measured !== null ? Math.min(1, measured / 100) : Math.min(1, (site.truckSpaces ?? 0) / 100) * UNMEASURED_DISCOUNT,
      traffic: trucksPerDay !== null ? Math.min(1, trucksPerDay / 20000) : 0,
      competition: hub ? Math.min(1, hub.km / 50) : 1,
      grid: sub ? 1 - Math.min(1, sub.km / 20) : 0,
    };
    const score = Math.round(100 * (Object.keys(FINDER_WEIGHTS) as (keyof typeof FINDER_WEIGHTS)[]).reduce((sum, k) => sum + FINDER_WEIGHTS[k] * parts[k], 0));
    return { ...site, trucksPerNight: measured, nightOccupancy: profile?.night ?? null, trucksPerDay,
      hub: hub ? { name: hub.item.name, km: Math.round(hub.km * 10) / 10 } : null,
      substationKm: sub ? Math.round(sub.km * 10) / 10 : null, parts, score };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
