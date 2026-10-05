import { stationRoadWarning, type BasisChoice, type SiteTraffic, type TrafficDirection } from "@shared/site-traffic";

export default function TrafficBasisSelect({ id, context, choice, onChange, unavailable, siteLabel = "" }: {
  id: string; context?: SiteTraffic; choice?: BasisChoice; onChange: (choice?: BasisChoice) => void; unavailable?: string; siteLabel?: string;
}) {
  const value = choice?.basis === "model" ? "model" : choice?.basis === "station" ? `station:${choice.stationId}` : "";
  const station = choice?.basis === "station" ? context?.candidates.find((c) => c.station.stationId === choice.stationId)?.station : undefined;
  const roadWarning = context ? stationRoadWarning(siteLabel, context, choice?.basis === "station" ? choice.stationId : undefined) : null;
  const directionOptions: [TrafficDirection, string][] = choice?.basis === "station" && station
    ? [["r1", `Nur Richtung ${station.direction1 || "1"} (R1)`], ["r2", `Nur Richtung ${station.direction2 || "2"} (R2)`], ["both", "Aus beiden Richtungen · z. B. Autohof an der Anschlussstelle"]]
    : [["one_unknown", "Nur aus einer Richtung · Hälfte des Verkehrs angenommen"], ["both", "Aus beiden Richtungen · z. B. Autohof an der Anschlussstelle"]];
  return <div className="space-y-2">
    <label className="block text-xs font-semibold text-[#536066]" htmlFor={id}>Verkehrsdaten für diesen Standort</label>
    {/* Changing the source drops the direction: R1/R2 belong to one specific counting station. */}
    <select id={id} value={value} disabled={!context} onChange={(event) => onChange(!event.target.value ? undefined : event.target.value === "model" ? { basis: "model" } : { basis: "station", stationId: event.target.value.slice(8) })}
      className="w-full min-w-0 rounded-md border border-[#cdd2cc] bg-white px-3 py-2 text-sm text-[#0d1417] disabled:opacity-60">
      <option value="">Datenquelle auswählen</option>
      {context?.candidates.map(({ station, distanceKm }) => <option key={station.stationId} value={`station:${station.stationId}`}>Zählstelle {station.name} · {station.roadClass} {station.road} · {distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km · {station.vehicleClass === "truck" ? "Lkw" : "inkl. Busse"}</option>)}
      {context?.edge && <option value="model">Berechneter Verkehr 2019–2030 · Abschnitt #{context.edge.edge.edgeId}</option>}
    </select>
    {roadWarning && <p role="alert" className="text-xs font-semibold text-[#8b570b]">{roadWarning}</p>}
    {choice && <>
      <label className="block text-xs font-semibold text-[#536066]" htmlFor={`${id}-direction`}>Aus welcher Fahrtrichtung erreichen Lkw das Grundstück?</label>
      <select id={`${id}-direction`} value={choice.direction ?? ""} onChange={(event) => onChange({ ...choice, direction: (event.target.value || undefined) as TrafficDirection | undefined })}
        className={`w-full min-w-0 rounded-md border bg-white px-3 py-2 text-sm text-[#0d1417] ${choice.direction ? "border-[#cdd2cc]" : "border-[#b13632]"}`}>
        <option value="">Fahrtrichtung wählen · verändert die Nachfrage etwa um Faktor 2</option>
        {directionOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      {!choice.direction && <p className="text-xs text-[#8b570b]">Rastanlagen und viele Grundstücke an der Autobahn sind nur aus einer Richtung erreichbar.</p>}
    </>}
    {unavailable && <p role="status" className="text-xs text-[#8b570b]">{unavailable}</p>}
    {context?.reason && <p className="text-xs text-[#667278]">{context.reason}</p>}
  </div>;
}
