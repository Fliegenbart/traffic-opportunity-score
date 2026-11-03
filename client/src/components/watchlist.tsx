import { Bell, BellOff, X } from "lucide-react";
import { WATCH_RADIUS_KM } from "@shared/watchlist";
import type { Watchlist } from "@/lib/use-watchlist";

const date = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });

export function WatchButton({ watch, site }: { watch: Watchlist; site: { lat: number; lon: number; label: string } }) {
  const watched = watch.isWatched(site);
  if (watched) return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6b6b70]"><Bell size={14} /> Wird beobachtet</span>;
  return <button type="button" disabled={!watch.ready || watch.full} onClick={() => watch.watch(site)}
    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1d3bff] hover:text-[#0f27d6] disabled:opacity-50"
    title={watch.full ? "Höchstens 20 Standorte" : undefined}>
    <Bell size={14} /> Standort beobachten
  </button>;
}

// Watched sites with the charging offers that appeared nearby since they were last seen.
export default function WatchlistPanel({ watch, onOpen, dataDate }: { watch: Watchlist; onOpen: (lon: number, lat: number, label: string) => void; dataDate: string | null }) {
  if (!watch.sites.length) return null;
  return <div className="rounded-lg border border-[#e4e4e1] bg-white p-4" data-testid="watchlist">
    <p className="text-sm font-semibold text-[#0a0a0b]">Beobachtete Standorte</p>
    <ul className="mt-2 divide-y divide-[#e4e4e1]">
      {watch.sites.map((site) => {
        const status = watch.statuses.get(site.id);
        return <li key={site.id} className="py-2.5 text-sm">
          <div className="flex items-start justify-between gap-3">
            <button type="button" onClick={() => onOpen(site.lon, site.lat, site.label)} className="min-w-0 text-left font-medium text-[#0a0a0b] hover:text-[#1d3bff]">{site.label || `${site.lat.toFixed(3)}, ${site.lon.toFixed(3)}`}</button>
            <button type="button" onClick={() => watch.unwatch(site.id)} aria-label="Nicht mehr beobachten" title="Nicht mehr beobachten" className="shrink-0 p-1 text-[#6b6b70] hover:text-[#0a0a0b]"><X size={14} /></button>
          </div>
          {!status ? <p className="text-xs text-[#6b6b70]">Daten werden geladen …</p>
            : status.fresh.length ? <div className="mt-1 bg-[#e5e9ff] px-3 py-2 text-xs text-[#0a0a0b]">
              <p className="font-semibold">{status.fresh.length === 1 ? "Neu im Umkreis" : `${status.fresh.length} neue Ladeangebote im Umkreis`} seit {date(site.seenAt)}</p>
              <ul className="mt-1 space-y-0.5">{status.fresh.slice(0, 5).map((o) => <li key={o.key}>{o.label}</li>)}</ul>
              {status.fresh.length > 5 && <p>und {status.fresh.length - 5} weitere</p>}
              <button type="button" onClick={() => watch.seen(site.id)} className="mt-1.5 inline-flex items-center gap-1 font-semibold text-[#1d3bff]"><BellOff size={12} /> Als gesehen markieren</button>
            </div>
            : <p className="text-xs text-[#6b6b70]">Nichts Neues seit {date(site.seenAt)} · {status.total} Ladeangebote im Umkreis von {WATCH_RADIUS_KM} km</p>}
        </li>;
      })}
    </ul>
    <p className="mt-2 text-[11px] leading-relaxed text-[#6b6b70]">Gemerkt auf diesem Gerät. Neue Lkw-Ladeparks, Inbetriebnahmen und Schnelllader ab 300 kW im Umkreis von {WATCH_RADIUS_KM} km erscheinen hier, sobald sie im Ladesäulenregister{dataDate ? ` (Stand ${date(dataDate)})` : ""} oder bei der Autobahn GmbH auftauchen.</p>
  </div>;
}
