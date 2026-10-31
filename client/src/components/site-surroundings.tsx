import { useEffect, useState } from "react";
import { CHARGING_RADIUS_KM, latestEvShare, PARKING_RADIUS_KM, surroundings, type AutobahnServices, type EvTruckSeries } from "@shared/surroundings";

// Both snapshots are refreshed by GitHub Actions; load them once per page view.
let cache: Promise<[AutobahnServices | null, EvTruckSeries | null]> | null = null;
const load = () => cache ??= Promise.all([
  fetch("/data/autobahn-services-de.json").then((r) => r.ok ? r.json() : null).catch(() => null),
  fetch("/data/context/ev-trucks-de.json").then((r) => r.ok ? r.json() : null).catch(() => null),
]);
const number = (v: number, digits = 0) => v.toLocaleString("de-DE", { maximumFractionDigits: digits });
const percent = (v: number) => `${number(v * 100, 1)} %`;
const month = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

export default function SiteSurroundings({ site }: { site: { lat: number; lon: number } }) {
  const [data, setData] = useState<[AutobahnServices | null, EvTruckSeries | null]>();
  useEffect(() => { let alive = true; load().then((d) => { if (alive) setData(d); }); return () => { alive = false; }; }, []);
  if (!data) return null;
  const [services, ev] = data;
  const s = services ? surroundings(site, services) : null;
  const semi = ev ? latestEvShare(ev, "sattelzug") : null;
  const trucks = ev ? latestEvShare(ev, "lkw_total") : null;
  if (!s && !semi) return null;
  return <div className="mt-4 border-t border-[#e4e4e1] pt-4 text-sm" data-testid="site-surroundings">
    <p className="font-mono text-xs text-[#6b6b70]">Umfeld an der Autobahn</p>
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
      {s && <div><dt className="text-xs text-[#6b6b70]">Lkw-Parkplätze ≤ {PARKING_RADIUS_KM} km</dt>
        <dd className="mt-0.5 font-semibold tabular-nums text-[#0a0a0b]">{s.parkingSites ? `${s.parkingSites} · ${number(s.truckSpaces)} Stellplätze` : "keine"}</dd>
        {s.nearestParking && <dd className="text-xs text-[#6b6b70]">nächster: {s.nearestParking.name} ({s.nearestParking.road}), {number(s.nearestParking.km, 1)} km</dd>}</div>}
      {s && <div><dt className="text-xs text-[#6b6b70]">Schnelllader an der Autobahn ≤ {CHARGING_RADIUS_KM} km</dt>
        <dd className="mt-0.5 font-semibold tabular-nums text-[#0a0a0b]">{s.chargingSites ? `${s.chargingSites} Standorte` : "keine"}</dd>
        {s.chargingSites > 0 && <dd className="text-xs text-[#6b6b70]">davon {s.deutschlandnetzSites} im Deutschlandnetz{s.nearestCharging ? `; nächster ${number(s.nearestCharging.km, 1)} km` : ""}</dd>}</div>}
      {semi && <div className="col-span-2"><dt className="text-xs text-[#6b6b70]">Elektrischer Anteil an Neuzulassungen · {month(semi.month)}</dt>
        <dd className="mt-0.5 text-[#0a0a0b]"><span className="font-semibold tabular-nums">{percent(semi.share)}</span> der Sattelzugmaschinen{semi.shareYearAgo !== null ? <span className="text-xs text-[#6b6b70]"> (Vorjahresmonat {percent(semi.shareYearAgo)})</span> : null}
          {trucks && <span className="block text-xs text-[#6b6b70]">{percent(trucks.share)} aller Lkw, einschließlich leichter Transporter</span>}</dd>
        <dd className="text-xs text-[#6b6b70]">Zum Vergleich mit deinem angenommenen E-Lkw-Anteil. Neuzulassungen sind nicht der Bestand auf der Straße.</dd></div>}
    </dl>
    <p className="mt-3 text-[11px] leading-relaxed text-[#6b6b70]">
      Parkplätze zeigen, wo Lkw heute schon Pause machen; das ist kein Nachweis für Ladekunden. Quellen: {services && <>Autobahn GmbH des Bundes (Stand {new Date(services.metadata.retrievedAt).toLocaleDateString("de-DE")}, Lizenz ungeklärt)</>}{services && ev ? " · " : ""}{ev && "Kraftfahrt-Bundesamt, FZ 28"}.
    </p>
  </div>;
}
