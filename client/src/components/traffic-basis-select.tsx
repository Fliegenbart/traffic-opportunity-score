import type { BasisChoice, SiteTraffic } from "@shared/site-traffic";

export default function TrafficBasisSelect({ id, context, choice, onChange, unavailable }: {
  id: string; context?: SiteTraffic; choice?: BasisChoice; onChange: (choice?: BasisChoice) => void; unavailable?: string;
}) {
  const value = choice?.basis === "model" ? "model" : choice?.basis === "station" ? `station:${choice.stationId}` : "";
  return <div className="space-y-2">
    <label className="block text-xs font-semibold text-[#536066]" htmlFor={id}>Gemeinsame Verkehrsbasis</label>
    <select id={id} value={value} disabled={!context} onChange={(event) => onChange(!event.target.value ? undefined : event.target.value === "model" ? { basis: "model" } : { basis: "station", stationId: event.target.value.slice(8) })}
      className="w-full min-w-0 rounded-md border border-[#c5cdcf] bg-white px-3 py-2 text-sm text-[#202426] disabled:opacity-60">
      <option value="">Verkehrsbasis auswählen</option>
      {context?.candidates.map(({ station, distanceKm }) => <option key={station.stationId} value={`station:${station.stationId}`}>BASt {station.name} · {station.road} · {distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km · {station.vehicleClass === "truck" ? "Lkw" : "Schwerverkehr-Proxy"}</option>)}
      {context?.edge && <option value="model">Modellstrecke #{context.edge.edge.edgeId} · 2030 (synthetisch)</option>}
    </select>
    {unavailable && <p role="status" className="text-xs text-[#8b570b]">{unavailable}</p>}
    {context?.reason && <p className="text-xs text-[#667278]">{context.reason}</p>}
  </div>;
}
