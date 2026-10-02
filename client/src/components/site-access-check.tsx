import { useEffect, useRef, useState } from "react";
import { Route } from "lucide-react";
import { siteAccessResultSchema, type SiteAccessResult } from "@shared/site-access";
import type { SiteTraffic } from "@shared/site-traffic";
import type { PlanningSite } from "@shared/charging-planning/site-input";

const number = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
export default function SiteAccessCheck({ site, context }: { site: PlanningSite; context?: SiteTraffic }) {
  const [result, setResult] = useState<SiteAccessResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController>();
  const edge = context?.edge?.edge;
  useEffect(() => () => controller.current?.abort(), []);
  const check = async () => {
    if (!edge || busy) return;
    setBusy(true); setError(""); setResult(undefined);
    controller.current = new AbortController();
    const timeout = window.setTimeout(() => controller.current?.abort(), 16000);
    try {
      const response = await fetch("/api/site-access", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.current.signal,
        body: JSON.stringify({ site: { lon: site.lon, lat: site.lat }, edge: { edgeId: edge.edgeId, aLon: edge.aLon, aLat: edge.aLat, bLon: edge.bLon, bLat: edge.bLat } }) });
      if (!response.ok) throw new Error("Straßenprüfung nicht verfügbar oder Routingdienst nicht korrekt konfiguriert.");
      const payload = siteAccessResultSchema.parse(await response.json());
      if (payload.edgeId !== edge.edgeId || payload.site.lon !== site.lon || payload.site.lat !== site.lat) throw new Error("Standortzuordnung der Antwort stimmt nicht überein.");
      setResult(payload);
    } catch { setError("Straßenprüfung derzeit nicht verfügbar. Lkw-Erreichbarkeit bleibt offen."); }
    finally { window.clearTimeout(timeout); setBusy(false); }
  };
  return <div className="mt-4 border-t border-[#dce1e1] pt-4" data-testid="site-access">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-[#202426]">Erreichbarkeit</h3>
      <button type="button" disabled={!edge || busy} onClick={() => void check()} className="inline-flex items-center gap-2 rounded-md border border-[#c5cdcf] px-3 py-2 text-xs font-semibold text-[#087782] disabled:opacity-50"><Route size={15} />{busy ? "Straßenprüfung läuft" : "Straßenwege prüfen"}</button>
    </div>
    {!result && !error && <p className="mt-2 text-xs text-[#667278]">{edge ? "Straßenwege offen · Lkw-Zufahrt nicht bestätigt" : context ? "Kein Modellsegment innerhalb von 10 km für einen Straßenvergleich." : "Keine validierten Standortdaten für einen Straßenvergleich verfügbar."}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-[#8b570b]">{error}</p>}
    {result && <div role="status" className="mt-2 space-y-2 text-xs text-[#667278]">
      <p className="font-semibold text-[#8b570b]">{result.status === "road_proxy" ? "Straßen-Proxy berechnet · Lkw-Zufahrt weiterhin ungeprüft" : result.status === "not_configured" ? "Routingdienst fehlt · Erreichbarkeit offen" : "Straßenprüfung unvollständig · Erreichbarkeit offen"}</p>
      {result.directions.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left tabular-nums"><thead><tr className="border-b border-[#dce1e1]"><th className="py-2">Richtung</th><th className="px-2">Mehrweg</th><th className="px-2">Mehrzeit</th><th className="pl-2">Straßenabstand</th></tr></thead><tbody>{result.directions.map((d) => <tr key={d.direction}><td className="py-2">{d.direction === "a_to_b" ? "A → B" : "B → A"}</td><td className="px-2">+{number(d.extraKm)} km</td><td className="px-2">+{number(d.extraMinutes)} min</td><td className="pl-2">{number(d.siteSnapMeters)} m</td></tr>)}</tbody></table></div>}
      <p>{result.message}</p>
      <p>{result.provider} · Profil {result.profile} · {new Date(result.checkedAt).toLocaleString("de-DE")}</p>
    </div>}
    <p className="mt-2 text-xs text-[#667278]">Keine automatische Änderung des erreichbaren Verkehrsanteils. Höhen- und Gewichtslimits, Fahrverbote, Einfahrt, Wendefläche und Öffnungszeiten vor Ort prüfen.</p>
  </div>;
}
