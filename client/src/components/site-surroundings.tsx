import { useEffect, useState } from "react";
import { CHARGING_RADIUS_KM, latestEvShare, occupancyTiles, parkingOccupancy, PARKING_RADIUS_KM, surroundings, type AutobahnServices, type EvTruckSeries, type OccupancyIndex, type OccupancyProfile } from "@shared/surroundings";

// All snapshots are refreshed by GitHub Actions; load them once per page view, occupancy tiles on demand.
type Snapshots = [AutobahnServices | null, EvTruckSeries | null, OccupancyIndex | null];
const OCCUPANCY = "/data/truck-parking-occupancy";
const json = (url: string) => fetch(url).then((r) => r.ok ? r.json() : null).catch(() => null);
let cache: Promise<Snapshots> | null = null;
const load = () => cache ??= Promise.all([json("/data/autobahn-services-de.json"), json("/data/context/ev-trucks-de.json"), json(`${OCCUPANCY}/index.json`)]);
const tileCache = new Map<string, Promise<OccupancyProfile[]>>();
const loadTiles = (keys: string[]) => Promise.all(keys.map((k) => {
  if (!tileCache.has(k)) tileCache.set(k, json(`${OCCUPANCY}/${k}.json`).then((rows) => Array.isArray(rows) ? rows : []));
  return tileCache.get(k)!;
})).then((tiles) => tiles.flat());

const number = (v: number, digits = 0) => v.toLocaleString("de-DE", { maximumFractionDigits: digits });
const percent = (v: number) => `${number(v * 100, 1)} %`;
const month = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

// 24-hour occupancy curve; gaps where an hour has no measurement yet. Night hours are shaded.
function DayCurve({ weekday, weekend }: { weekday: (number | null)[]; weekend: (number | null)[] }) {
  // viewBox ≈ rendered width in the side column, so 1 unit ≈ 1 px and the labels stay legible.
  const L = 30, W = 300, H = 70, T = 6, x = (h: number) => L + (h / 23) * (W - L), y = (v: number) => T + H - (v / 100) * H;
  const path = (values: (number | null)[]) => values.reduce((d, v, h) => v === null ? d : `${d}${h > 0 && values[h - 1] !== null ? "L" : "M"}${x(h).toFixed(1)},${y(v).toFixed(1)}`, "");
  const hasWeekend = weekend.some((v) => v !== null);
  return <figure className="mt-2 max-w-[340px]">
    <svg viewBox={`0 0 ${W} ${T + H + 16}`} className="h-auto w-full" role="img" aria-label="Belegung über den Tag, werktags und am Wochenende">
      <rect x={L} y={T} width={x(6) - L} height={H} fill="#f1f1ef" />
      <rect x={x(20)} y={T} width={W - x(20)} height={H} fill="#f1f1ef" />
      {[0, 50, 100].map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#e4e4e1" strokeWidth={0.75} />
        <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#6b6b70">{v} %</text></g>)}
      {hasWeekend && <path d={path(weekend)} fill="none" stroke="#6b6b70" strokeWidth={1.25} strokeDasharray="3 2" />}
      <path d={path(weekday)} fill="none" stroke="#0a0a0b" strokeWidth={1.75} />
      {[0, 6, 12, 18, 23].map((h) => <text key={h} x={x(h)} y={T + H + 12} textAnchor={h === 0 ? "start" : h === 23 ? "end" : "middle"} fontSize={9} fill="#6b6b70">{h === 23 ? "23 Uhr" : h}</text>)}
    </svg>
    <figcaption className="mt-1 flex gap-3 text-[11px] text-[#6b6b70]">
      <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[#0a0a0b]" />Mo–Fr</span>
      {hasWeekend && <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-[#6b6b70]" />Sa–So</span>}
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 bg-[#f1f1ef]" />Nacht</span>
    </figcaption>
  </figure>;
}

export default function SiteSurroundings({ site }: { site: { lat: number; lon: number } }) {
  const [data, setData] = useState<Snapshots>();
  const [profiles, setProfiles] = useState<OccupancyProfile[]>([]);
  useEffect(() => { let alive = true; load().then((d) => { if (alive) setData(d); }); return () => { alive = false; }; }, []);
  const index = data?.[2] ?? null;
  useEffect(() => {
    if (!index) return;
    let alive = true;
    loadTiles(occupancyTiles(site, index)).then((rows) => { if (alive) setProfiles(rows); });
    return () => { alive = false; };
  }, [index, site.lat, site.lon]);
  if (!data) return null;
  const [services, ev] = data;
  const s = services ? surroundings(site, services) : null;
  const o = index ? parkingOccupancy(site, profiles, index.metadata.coverage.days) : null;
  const semi = ev ? latestEvShare(ev, "sattelzug") : null;
  const trucks = ev ? latestEvShare(ev, "lkw_total") : null;
  // The Autobahn list and Toll Collect do not cover the same car parks; say which one the figures refer to.
  const nearestMeasured = o && s?.nearestParking?.id === o.nearest.id ? o.nearest : null;
  const otherMeasured = o && !nearestMeasured ? o.nearest : null;
  const detail = (p: NonNullable<typeof o>["nearest"]) => `nachts ${p.night} % belegt, ${p.full} % der Zeit voll${p.veh !== null ? `, im Schnitt ${number(p.veh)} Lkw` : ""}`;
  if (!s && !semi) return null;
  return <div className="mt-4 border-t border-[#e4e4e1] pt-4 text-sm" data-testid="site-surroundings">
    <p className="font-mono text-xs text-[#6b6b70]">Umfeld an der Autobahn</p>
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
      {s && <div><dt className="text-xs text-[#6b6b70]">Lkw-Parkplätze ≤ {PARKING_RADIUS_KM} km</dt>
        <dd className="mt-0.5 font-semibold tabular-nums text-[#0a0a0b]">{s.parkingSites ? `${s.parkingSites} · ${number(s.truckSpaces)} Stellplätze` : "keine"}</dd>
        {s.nearestParking && <dd className="text-xs text-[#6b6b70]">nächster: {s.nearestParking.name} ({s.nearestParking.road}), {number(s.nearestParking.km, 1)} km{nearestMeasured ? `; ${detail(nearestMeasured)}` : ""}</dd>}</div>}
      {s && <div><dt className="text-xs text-[#6b6b70]">Schnelllader an der Autobahn ≤ {CHARGING_RADIUS_KM} km</dt>
        <dd className="mt-0.5 font-semibold tabular-nums text-[#0a0a0b]">{s.chargingSites ? `${s.chargingSites} Standorte` : "keine"}</dd>
        {s.chargingSites > 0 && <dd className="text-xs text-[#6b6b70]">davon {s.deutschlandnetzSites} im Deutschlandnetz{s.nearestCharging ? `; nächster ${number(s.nearestCharging.km, 1)} km` : ""}</dd>}</div>}
      {o && <div className="col-span-2"><dt className="text-xs text-[#6b6b70]">Gemessene Belegung der Lkw-Parkplätze ≤ {PARKING_RADIUS_KM} km · nachts {index!.metadata.nightHours}</dt>
        <dd className="mt-0.5 text-[#0a0a0b]"><span className="font-semibold tabular-nums">Ø {o.nightOccupancy} %</span> belegt{o.sites > 1 ? ` · ${o.sites} gemessene Parkplätze${o.weighted ? ", nach Stellplätzen gewichtet" : ""}` : ""}</dd>
        {otherMeasured && <dd className="text-xs text-[#6b6b70]">nächster gemessener: {otherMeasured.name}, {number(otherMeasured.km, 1)} km; {detail(otherMeasured)}</dd>}
        <dd><DayCurve weekday={o.weekday} weekend={o.weekend} /></dd>
        <dd className="text-xs text-[#6b6b70]">Volle Parkplätze nachts heißen lange Standzeiten, also Zeit zum Laden. Messung seit {o.days} {o.days === 1 ? "Tag" : "Tagen"}{o.days < 14 ? ", noch wenig belastbar" : ""}.</dd></div>}
      {semi && <div className="col-span-2"><dt className="text-xs text-[#6b6b70]">Elektrischer Anteil an Neuzulassungen · {month(semi.month)}</dt>
        <dd className="mt-0.5 text-[#0a0a0b]"><span className="font-semibold tabular-nums">{percent(semi.share)}</span> der Sattelzugmaschinen{semi.shareYearAgo !== null ? <span className="text-xs text-[#6b6b70]"> (Vorjahresmonat {percent(semi.shareYearAgo)})</span> : null}
          {trucks && <span className="block text-xs text-[#6b6b70]">{percent(trucks.share)} aller Lkw, einschließlich leichter Transporter</span>}</dd>
        <dd className="text-xs text-[#6b6b70]">Zum Vergleich mit deinem angenommenen E-Lkw-Anteil. Neuzulassungen sind nicht der Bestand auf der Straße.</dd></div>}
    </dl>
    <p className="mt-3 text-[11px] leading-relaxed text-[#6b6b70]">
      Parkplätze zeigen, wo Lkw heute schon Pause machen; das ist kein Nachweis für Ladekunden. Quellen: {services && <>Autobahn GmbH des Bundes (Stand {new Date(services.metadata.retrievedAt).toLocaleDateString("de-DE")}, Lizenz ungeklärt)</>}{services && ev ? " · " : ""}{ev && "Kraftfahrt-Bundesamt, FZ 28"}{o && <> · {index!.metadata.source.attribution} (Näherungswerte, teils modellbasiert)</>}.
    </p>
  </div>;
}
