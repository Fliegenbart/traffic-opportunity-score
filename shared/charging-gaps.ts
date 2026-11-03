import { distanceKm, type GeoPoint } from "./geo";
import { DEFAULT_SITE_INPUT } from "./charging-planning/site-input";
import type { LorryParking } from "./surroundings";

export type GapEdge = { edgeId: number; label: string; aLon: number; aLat: number; bLon: number; bLat: number; lengthKm: number; trucks2019: number; trucks2030: number };
export type GapHub = { lon: number; lat: number; status: "live" | "announced"; chargePoints?: number | null };

export const GAP_FIRST_YEAR = 2026;
export const GAP_LAST_YEAR = 2035;
// A long-haul e-truck charges about every 350 km, half of those stops at public parks on the way.
const CHARGE_INTERVAL_KM = 350;
const PUBLIC_SHARE = 0.5;
// One charge point handles ~16 charges a day (45-minute break, about half the day in use).
export const CHARGES_PER_POINT_PER_DAY = 16;
// Drivers plan their charging stop within ~50 km; a park further away does not serve the section.
export const HUB_REACH_KM = 50;
const CURRENT_SHARE = 0.01;
// Missing charges per 100 km and day at which a section is drawn fully red.
export const FULL_GAP_DENSITY = 350;

export function eTruckShare(year: number, share2030 = DEFAULT_SITE_INPUT.baseSharePercent / 100, share2036 = DEFAULT_SITE_INPUT.baseShare2036Percent / 100) {
  if (year <= 2026) return CURRENT_SHARE;
  if (year <= 2030) return CURRENT_SHARE + (share2030 - CURRENT_SHARE) * (year - 2026) / 4;
  return share2030 + (share2036 - share2030) * Math.min((year - 2030) / 6, 1);
}

// Traffic model: counted 2019, forecast 2030, continued on the same line before and after.
export const trucksPerDay = (edge: GapEdge, year: number) => Math.max(0, edge.trucks2019 + (edge.trucks2030 - edge.trucks2019) * (year - 2019) / 11) / 365;

const midpoint = (e: GapEdge): GeoPoint => ({ lon: (e.aLon + e.bLon) / 2, lat: (e.aLat + e.bLat) / 2 });

export type GapSection = { edge: GapEdge; trucks: number; eTrucks: number; demand: number; missing: number; density: number; hubKm: number | null };

export function computeGaps(edges: GapEdge[], hubs: GapHub[], year: number) {
  // Announced parks count from 2027 on.
  const open = hubs.filter((h) => h.status === "live" || year >= 2027);
  const sections = edges.map((edge) => {
    const mid = midpoint(edge);
    let hub = -1, hubKm = Infinity;
    open.forEach((h, i) => { const d = distanceKm(mid, h); if (d < hubKm) { hubKm = d; hub = i; } });
    const trucks = trucksPerDay(edge, year), eTrucks = trucks * eTruckShare(year);
    return { edge, trucks, eTrucks, demand: eTrucks * edge.lengthKm / CHARGE_INTERVAL_KM * PUBLIC_SHARE, hub: hubKm <= HUB_REACH_KM ? hub : -1, hubKm: Number.isFinite(hubKm) ? hubKm : null };
  });
  const load = new Map<number, number>();
  for (const s of sections) if (s.hub >= 0) load.set(s.hub, (load.get(s.hub) || 0) + s.demand);
  const result: GapSection[] = sections.map(({ hub, ...s }) => {
    const served = hub < 0 ? 0 : Math.min(1, (open[hub].chargePoints || 2) * CHARGES_PER_POINT_PER_DAY / load.get(hub)!);
    const missing = s.demand * (1 - served);
    return { ...s, missing, density: s.edge.lengthKm > 0 ? missing / s.edge.lengthKm * 100 : 0 };
  });
  const missingCharges = result.reduce((sum, s) => sum + s.missing, 0);
  return { year, sections: result, missingCharges, missingPoints: Math.round(missingCharges / CHARGES_PER_POINT_PER_DAY) };
}

export type GapSpot = { lon: number; lat: number; road: string | null; place: string; parkingName: string | null; eTrucks: number; missingPoints: number; hubKm: number | null };

// The largest gaps: zones of 40 km around the worst sections, at least 80 km apart, named after the nearest motorway parking.
// The distance shown is to the nearest park in operation, measured from the named place.
export function largestGaps(gaps: ReturnType<typeof computeGaps>, parking: LorryParking[], liveHubs: GeoPoint[] = [], limit = 5): GapSpot[] {
  const ranked = gaps.sections.filter((s) => s.missing > 0).map((s) => ({ s, mid: midpoint(s.edge) }));
  const centers = [...ranked].sort((x, y) => y.s.missing - x.s.missing).slice(0, 300);
  const zones = centers.map(({ s, mid }) => ({ s, mid, missing: ranked.reduce((sum, o) => sum + (distanceKm(mid, o.mid) <= 40 ? o.s.missing : 0), 0) }))
    .sort((a, b) => b.missing - a.missing);
  const picked: typeof zones = [];
  for (const z of zones) {
    if (picked.length >= limit) break;
    if (picked.every((p) => distanceKm(p.mid, z.mid) >= 80)) picked.push(z);
  }
  return picked.map(({ s, mid, missing }) => {
    const near = parking.filter((p) => !p.blocked).map((p) => ({ p, km: distanceKm(mid, p) })).sort((a, b) => a.km - b.km)[0];
    const usePark = near && near.km <= 15;
    const at = usePark ? near.p : mid;
    const [a, b] = s.edge.label.split(" - ");
    return { lon: at.lon, lat: at.lat, road: usePark ? near.p.road : null, parkingName: usePark ? near.p.name : null,
      place: usePark ? near.p.name : a === b || !b ? a : `${a} – ${b}`, eTrucks: s.eTrucks,
      missingPoints: Math.max(1, Math.round(missing / CHARGES_PER_POINT_PER_DAY)),
      hubKm: liveHubs.length ? Math.min(...liveHubs.map((h) => distanceKm(at, h))) : null };
  });
}
