import { useEffect, useState } from "react";
import { occupancyTiles, parkingBasis, parkingOccupancy, type AutobahnServices, type EvTruckSeries, type OccupancyIndex, type OccupancyProfile } from "@shared/surroundings";
import type { GeoPoint } from "@shared/geo";

// All snapshots are refreshed by GitHub Actions; load them once per page view, occupancy tiles on demand.
export type Snapshots = [AutobahnServices | null, EvTruckSeries | null, OccupancyIndex | null];
const OCCUPANCY = "/data/truck-parking-occupancy";
const json = (url: string) => fetch(url).then((r) => r.ok ? r.json() : null).catch(() => null);
let cache: Promise<Snapshots> | null = null;
export const loadSnapshots = () => cache ??= Promise.all([json("/data/autobahn-services-de.json"), json("/data/context/ev-trucks-de.json"), json(`${OCCUPANCY}/index.json`)]);
const tileCache = new Map<string, Promise<OccupancyProfile[]>>();
export const loadTiles = (keys: string[]) => Promise.all(keys.map((k) => {
  if (!tileCache.has(k)) tileCache.set(k, json(`${OCCUPANCY}/${k}.json`).then((rows) => Array.isArray(rows) ? rows : []));
  return tileCache.get(k)!;
})).then((tiles) => tiles.flat());

export function useSnapshots() {
  const [data, setData] = useState<Snapshots>();
  useEffect(() => { let alive = true; loadSnapshots().then((d) => { if (alive) setData(d); }); return () => { alive = false; }; }, []);
  return data;
}

// Measured night parking per site, keyed by site id; sites without a measured night stay null.
export function useNearbyParking(sites: (GeoPoint & { id: string })[]) {
  const index = useSnapshots()?.[2] ?? null;
  const [result, setResult] = useState<Record<string, { occupancy: ReturnType<typeof parkingOccupancy>; basis: ReturnType<typeof parkingBasis> }>>({});
  const key = sites.map((s) => `${s.id}:${s.lat}:${s.lon}`).join("|");
  useEffect(() => {
    if (!index) return;
    let alive = true;
    Promise.all(sites.map(async (site) => {
      const occupancy = parkingOccupancy(site, await loadTiles(occupancyTiles(site, index)), index.metadata.coverage.days);
      return [site.id, { occupancy, basis: parkingBasis(occupancy, index) }] as const;
    })).then((rows) => { if (alive) setResult(Object.fromEntries(rows)); });
    return () => { alive = false; };
  }, [index, key]);
  return { index, parking: result };
}
