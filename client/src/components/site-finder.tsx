import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { FINDER_WEIGHTS, finderRoads, rankRoadSites } from "@shared/site-finder";
import type { OccupancyProfile } from "@shared/surroundings";
import type { NetworkEdge } from "@shared/charging-planning/traffic";
import { loadTiles, useSnapshots } from "@/lib/surroundings-data";

const number = (v: number, digits = 0) => v.toLocaleString("de-DE", { maximumFractionDigits: digits });

// Reverse search: instead of checking one address, rank the lorry car parks along a motorway.
export default function SiteFinder({ edges, hubs, substations, onPick }: {
  edges: NetworkEdge[]; hubs: { name: string; lon: number; lat: number }[]; substations: [number, number, number][];
  onPick: (lon: number, lat: number, label: string) => void;
}) {
  const data = useSnapshots();
  const services = data?.[0] ?? null, index = data?.[2] ?? null;
  const [road, setRoad] = useState("A7");
  const [profiles, setProfiles] = useState<OccupancyProfile[]>([]);
  const roads = useMemo(() => services ? finderRoads(services.parking) : [], [services]);
  useEffect(() => {
    if (!services || !index) return;
    let alive = true;
    const keys = new Set(services.parking.filter((p) => p.road === road).map((p) => `${Math.floor(p.lat)}_${Math.floor(p.lon)}`));
    loadTiles(Array.from(keys).filter((k) => index.tiles.includes(k))).then((rows) => { if (alive) setProfiles(rows); });
    return () => { alive = false; };
  }, [services, index, road]);
  const ranked = useMemo(() => services ? rankRoadSites(road, services.parking, profiles, edges, hubs, substations) : [], [services, road, profiles, edges, hubs, substations]);
  if (!services) return null;
  return <details className="rounded-lg border border-[#e4e4e1] bg-white p-4" data-testid="site-finder">
    <summary className="cursor-pointer text-sm font-semibold text-[#0a0a0b]">Oder: die besten Standorte an einer Autobahn finden</summary>
    <div className="mt-3 flex items-center gap-3">
      <label className="text-xs text-[#6b6b70]" htmlFor="finder-road">Autobahn</label>
      <select id="finder-road" value={road} onChange={(e) => setRoad(e.target.value)} className="min-h-9 rounded-md border border-[#e4e4e1] bg-white px-2 text-sm">
        {roads.map((r) => <option key={r.road} value={r.road}>{r.road} · {r.sites} Lkw-Parkplätze</option>)}
      </select>
    </div>
    <ol className="mt-3 divide-y divide-[#e4e4e1]">
      {ranked.map((c, i) => <li key={c.id} className="flex items-start gap-3 py-2.5">
        <span className="w-5 shrink-0 pt-0.5 text-right text-xs tabular-nums text-[#6b6b70]">{i + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-semibold text-[#0a0a0b]">{c.name}</span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-[#1d3bff]" title="Punkte von 100">{c.score}</span>
          </div>
          <div className="mt-1 h-1 bg-[#f1f1ef]"><div className="h-1 bg-[#1d3bff]" style={{ width: `${c.score}%` }} /></div>
          <p className="mt-1.5 text-xs leading-relaxed text-[#55555a]">
            {c.trucksPerNight !== null ? `nachts ≈ ${number(c.trucksPerNight)} Lkw (gemessen, ${c.nightOccupancy} % belegt)` : `${c.truckSpaces ?? "?"} Stellplätze, Nachtbelegung noch nicht gemessen`}
            {" · "}{c.trucksPerDay !== null ? `≈ ${number(c.trucksPerDay)} Lkw/Tag (Modell 2030)` : "keine Modellstrecke ≤ 10 km"}
            {" · "}{c.hub ? `Lkw-Ladepark ${number(c.hub.km)} km` : "kein Lkw-Ladepark bekannt"}
            {c.substationKm !== null && ` · Umspannwerk ${number(c.substationKm, 1)} km`}
          </p>
        </div>
        <button type="button" onClick={() => onPick(c.lon, c.lat, `${c.name} (${c.road})`)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#1d3bff] hover:text-[#0f27d6]">
          Prüfen <ArrowRight size={14} />
        </button>
      </li>)}
    </ol>
    <p className="mt-2 text-[11px] leading-relaxed text-[#6b6b70]">
      Kandidaten sind die Lkw-Parkplätze der Autobahn GmbH an dieser Strecke, weil Lkw dort ohnehin stehen.
      Punkte: {number(FINDER_WEIGHTS.dwell * 100)} % Standzeit (Lkw nachts, ohne Messung nur Stellplätze mit Abschlag), {number(FINDER_WEIGHTS.traffic * 100)} % Verkehr, {number(FINDER_WEIGHTS.competition * 100)} % Abstand zum nächsten Lkw-Ladepark, {number(FINDER_WEIGHTS.grid * 100)} % Nähe zum Umspannwerk.
    </p>
  </details>;
}
