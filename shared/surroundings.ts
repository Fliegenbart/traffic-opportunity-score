import { distanceKm, type GeoPoint } from "./geo.js";

export type LorryParking = { id: string; road: string; name: string; lat: number; lon: number; truckSpaces: number | null; blocked: boolean };
export type FastCharger = { id: string; road: string; name: string; lat: number; lon: number; chargePoints: number | null; maxPowerKw: number | null; powerIsMinimum?: boolean; deutschlandnetz: boolean; operator: string | null };
export type AutobahnServices = { metadata: { retrievedAt: string; source: { title: string; url: string; license: string; attribution: string } }; parking: LorryParking[]; charging: FastCharger[] };
export type EvTruckSeries = { metadata: { dataMonth: string; source: { title: string; url: string; license: string } }; series: { month: string; class: string; bev: number; all: number; bevShare: number }[] };

export type OccupancyProfile = { id: string; name: string; lat: number; lon: number; spaces: number | null; night: number | null; full: number; veh: number | null; wd: (number | null)[]; we: (number | null)[] };
export type OccupancyIndex = { metadata: { generatedAt: string; coverage: { days: number; samples: number; from: string | null; to: string | null }; nightHours: string; source: { title: string; url: string; attribution: string; notice: string } }; tiles: string[] };

export const PARKING_RADIUS_KM = 10;
export const CHARGING_RADIUS_KM = 25;

const withDistance = <T extends { lat: number; lon: number }>(site: GeoPoint, items: T[], radius: number) =>
  items.map((item) => ({ item, km: distanceKm(site, { lon: item.lon, lat: item.lat }) }))
    .filter((x) => x.km <= radius).sort((a, b) => a.km - b.km);

// Lorry parking along the motorway is where trucks already pause; it is context, not a demand estimate.
export function surroundings(site: GeoPoint, services: AutobahnServices) {
  const parking = withDistance(site, services.parking.filter((p) => !p.blocked), PARKING_RADIUS_KM);
  const charging = withDistance(site, services.charging, CHARGING_RADIUS_KM);
  return {
    parkingSites: parking.length,
    truckSpaces: parking.reduce((sum, p) => sum + (p.item.truckSpaces ?? 0), 0),
    nearestParking: parking[0] ? { ...parking[0].item, km: parking[0].km } : null,
    chargingSites: charging.length,
    deutschlandnetzSites: charging.filter((c) => c.item.deutschlandnetz).length,
    nearestCharging: charging[0] ? { ...charging[0].item, km: charging[0].km } : null,
  };
}

// Occupancy profiles are stored in 1° tiles; these are the tiles a radius around the site can touch.
export function occupancyTiles(site: GeoPoint, index: OccupancyIndex, radiusKm = PARKING_RADIUS_KM) {
  const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos((site.lat * Math.PI) / 180));
  const keys = new Set<string>();
  for (const lat of [site.lat - dLat, site.lat + dLat]) for (const lon of [site.lon - dLon, site.lon + dLon]) keys.add(`${Math.floor(lat)}_${Math.floor(lon)}`);
  return Array.from(keys).filter((k) => index.tiles.includes(k));
}

// Mean over sites, weighted by truck spaces when known; null hours stay null.
function weightedMean(rows: { w: number; v: number | null }[]) {
  const known = rows.filter((r) => r.v !== null);
  const weight = known.reduce((sum, r) => sum + r.w, 0);
  return weight ? Math.round(known.reduce((sum, r) => sum + r.v! * r.w, 0) / weight) : null;
}

// Measured occupancy of the SID lorry parking nearby: full car parks at night mean long stops, i.e. time to charge.
export function parkingOccupancy(site: GeoPoint, profiles: OccupancyProfile[], days: number) {
  const near = withDistance(site, profiles.filter((p) => p.night !== null), PARKING_RADIUS_KM);
  if (!near.length) return null;
  const weightOf = (p: OccupancyProfile) => p.spaces ?? 1;
  const curve = (key: "wd" | "we") => Array.from({ length: 24 }, (_, h) => weightedMean(near.map((p) => ({ w: weightOf(p.item), v: p.item[key][h] ?? null }))));
  return {
    sites: near.length, days,
    nightOccupancy: weightedMean(near.map((p) => ({ w: weightOf(p.item), v: p.item.night })))!,
    weighted: near.some((p) => p.item.spaces !== null),
    nearest: { ...near[0].item, km: near[0].km },
    ids: new Set(near.map((p) => p.item.id)),
    weekday: curve("wd"), weekend: curve("we"),
  };
}

export function latestEvShare(data: EvTruckSeries, cls: string) {
  const entries = data.series.filter((s) => s.class === cls).sort((a, b) => a.month.localeCompare(b.month));
  const latest = entries.at(-1);
  if (!latest) return null;
  const yearAgo = entries.find((e) => e.month === `${Number(latest.month.slice(0, 4)) - 1}${latest.month.slice(4)}`);
  return { month: latest.month, share: latest.bevShare, bev: latest.bev, all: latest.all, shareYearAgo: yearAgo?.bevShare ?? null };
}
