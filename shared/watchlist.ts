import { z } from "zod";
import { distanceKm, type GeoPoint } from "./geo.js";

export const WATCH_RADIUS_KM = 25;
export const MAX_WATCHED = 20;

export type ChargingOffer = GeoPoint & { key: string; label: string };
export type OfferSources = {
  hubs: { name: string; status: "live" | "announced"; lon: number; lat: number }[];
  fastChargers: { lon: number; lat: number; chargePoints: number; maxKw: number }[];
  autobahn: { id: string; road: string; name: string; lon: number; lat: number }[];
};

const watchedSchema = z.object({
  id: z.string().min(1).max(100), label: z.string().max(200), lon: z.number().finite(), lat: z.number().finite(),
  addedAt: z.string().max(40), seenAt: z.string().max(40), known: z.array(z.string().max(300)).max(2000),
}).strict();
export type WatchedSite = z.infer<typeof watchedSchema>;

// Keys are content-based: register rows have no stable ids, and a truck hub going live counts as news.
export function chargingOffers({ hubs, fastChargers, autobahn }: OfferSources): ChargingOffer[] {
  return [
    ...hubs.map((h) => ({ lon: h.lon, lat: h.lat, key: `hub|${h.name}|${h.status}`, label: `Lkw-Ladepark ${h.name}${h.status === "announced" ? " (angekündigt)" : " (in Betrieb)"}` })),
    ...fastChargers.map((c) => ({ lon: c.lon, lat: c.lat, key: `hpc|${c.lat.toFixed(3)}|${c.lon.toFixed(3)}|${c.maxKw}`, label: `Schnelllader ab ${c.maxKw} kW mit ${c.chargePoints} Ladepunkten` })),
    ...autobahn.map((c) => ({ lon: c.lon, lat: c.lat, key: `ab|${c.id}`, label: `${c.name} (${c.road}), Schnelllader an der Autobahn` })),
  ];
}

export const offersNear = (site: GeoPoint, offers: ChargingOffer[]) => offers.filter((o) => distanceKm(site, o) <= WATCH_RADIUS_KM);

export function watchSite(site: GeoPoint & { label: string }, offers: ChargingOffer[], now: Date): WatchedSite {
  const stamp = now.toISOString();
  return { id: `watch-${site.lat.toFixed(4)}-${site.lon.toFixed(4)}`, label: site.label, lon: site.lon, lat: site.lat,
    addedAt: stamp, seenAt: stamp, known: offersNear(site, offers).map((o) => o.key) };
}

export function watchStatus(site: WatchedSite, offers: ChargingOffer[]) {
  const near = offersNear(site, offers);
  const known = new Set(site.known);
  return { total: near.length, fresh: near.filter((o) => !known.has(o.key)) };
}

export const markSeen = (site: WatchedSite, offers: ChargingOffer[], now: Date): WatchedSite =>
  ({ ...site, seenAt: now.toISOString(), known: offersNear(site, offers).map((o) => o.key) });

export function readWatchlist(raw: string | null): WatchedSite[] {
  try {
    const parsed = z.object({ version: z.literal(1), sites: z.array(watchedSchema).max(MAX_WATCHED) }).safeParse(JSON.parse(raw || "null"));
    return parsed.success ? parsed.data.sites : [];
  } catch { return []; }
}
export const writeWatchlist = (sites: WatchedSite[]) => JSON.stringify({ version: 1, sites });
