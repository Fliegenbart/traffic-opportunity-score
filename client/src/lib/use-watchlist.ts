import { useEffect, useMemo, useState } from "react";
import { chargingOffers, markSeen, MAX_WATCHED, readWatchlist, watchSite, watchStatus, writeWatchlist, type OfferSources, type WatchedSite } from "@shared/watchlist";
import { useSnapshots } from "./surroundings-data";

const STORAGE_KEY = "ladepark-check:watchlist:v1";
const read = () => { try { return readWatchlist(localStorage.getItem(STORAGE_KEY)); } catch { return []; } };

// Watched sites live on this device only; news = charging offers within 25 km that were not there when last seen.
export function useWatchlist(charging: { verified: OfferSources["hubs"]; proxy: OfferSources["fastChargers"] } | null) {
  const services = useSnapshots()?.[0];
  const [sites, setSites] = useState<WatchedSite[]>(read);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, writeWatchlist(sites)); } catch { /* storage blocked: list lasts for this visit */ } }, [sites]);
  const offers = useMemo(() => charging && services ? chargingOffers({ hubs: charging.verified, fastChargers: charging.proxy, autobahn: services.charging }) : null, [charging, services]);
  const statuses = useMemo(() => new Map(offers ? sites.map((s) => [s.id, watchStatus(s, offers)]) : []), [sites, offers]);
  const idOf = (site: { lat: number; lon: number }) => `watch-${site.lat.toFixed(4)}-${site.lon.toFixed(4)}`;
  return {
    sites, statuses, ready: !!offers, full: sites.length >= MAX_WATCHED,
    freshCount: Array.from(statuses.values()).reduce((n, s) => n + s.fresh.length, 0),
    isWatched: (site: { lat: number; lon: number }) => sites.some((s) => s.id === idOf(site)),
    watch: (site: { lat: number; lon: number; label: string }) => offers && setSites((current) =>
      current.some((s) => s.id === idOf(site)) || current.length >= MAX_WATCHED ? current : [...current, watchSite(site, offers, new Date())]),
    unwatch: (id: string) => setSites((current) => current.filter((s) => s.id !== id)),
    seen: (id: string) => offers && setSites((current) => current.map((s) => (s.id === id ? markSeen(s, offers, new Date()) : s))),
  };
}
export type Watchlist = ReturnType<typeof useWatchlist>;
