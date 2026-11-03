import { distanceKm, type GeoPoint } from "./geo.js";

export type LorryParking = { id: string; road: string; name: string; lat: number; lon: number; truckSpaces: number | null; blocked: boolean };
export type FastCharger = { id: string; road: string; name: string; lat: number; lon: number; chargePoints: number | null; maxPowerKw: number | null; powerIsMinimum?: boolean; deutschlandnetz: boolean; operator: string | null };
export type AutobahnServices = { metadata: { retrievedAt: string; source: { title: string; url: string; license: string; attribution: string } }; parking: LorryParking[]; charging: FastCharger[] };
export type EvTruckSeries = { metadata: { dataMonth: string; source: { title: string; url: string; license: string } }; series: { month: string; class: string; bev: number; all: number; bevShare: number }[] };

export type OccupancyProfile = { id: string; name: string; lat: number; lon: number; spaces: number | null; detection: string | null; samples: number; nightOccupancy: number | null; meanVehicles: number | null; fullShare: number; weekday: (number | null)[]; weekend: (number | null)[] };
export type OccupancyProfiles = { metadata: { generatedAt: string; coverage: { days: number; samples: number; from: string | null; to: string | null }; nightHours: string; source: { title: string; url: string; attribution: string; notice: string } }; sites: OccupancyProfile[] };

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

// Measured occupancy of the SID lorry parking nearby: full car parks at night mean long stops, i.e. time to charge.
export function parkingOccupancy(site: GeoPoint, data: OccupancyProfiles) {
  const near = withDistance(site, data.sites.filter((p) => p.nightOccupancy !== null), PARKING_RADIUS_KM);
  if (!near.length) return null;
  const weighted = near.filter((p) => p.item.spaces);
  const weight = weighted.reduce((sum, p) => sum + p.item.spaces!, 0);
  const night = weight ? weighted.reduce((sum, p) => sum + p.item.nightOccupancy! * p.item.spaces!, 0) / weight
    : near.reduce((sum, p) => sum + p.item.nightOccupancy!, 0) / near.length;
  return { sites: near.length, nightOccupancy: Math.round(night), nearest: { ...near[0].item, km: near[0].km }, days: data.metadata.coverage.days };
}

export function latestEvShare(data: EvTruckSeries, cls: string) {
  const entries = data.series.filter((s) => s.class === cls).sort((a, b) => a.month.localeCompare(b.month));
  const latest = entries.at(-1);
  if (!latest) return null;
  const yearAgo = entries.find((e) => e.month === `${Number(latest.month.slice(0, 4)) - 1}${latest.month.slice(4)}`);
  return { month: latest.month, share: latest.bevShare, bev: latest.bev, all: latest.all, shareYearAgo: yearAgo?.bevShare ?? null };
}
