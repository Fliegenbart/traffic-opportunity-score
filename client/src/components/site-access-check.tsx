import { useEffect, useRef, useState } from "react";
import { Route } from "lucide-react";
import { DEFAULT_ROUTING_VEHICLE, truckRoutingVehicleSchema, siteAccessResultSchema, type SiteAccessResult } from "@shared/site-access";
import type { SiteTraffic } from "@shared/site-traffic";
import type { PlanningSite } from "@shared/charging-planning/site-input";

const number = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
export default function SiteAccessCheck({ site, context }: { site: PlanningSite; context?: SiteTraffic }) {
  const [result, setResult] = useState<SiteAccessResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [vehicle, setVehicle] = useState<Record<string, string>>(Object.fromEntries(Object.entries(DEFAULT_ROUTING_VEHICLE).map(([k, v]) => [k, String(v)])));
  const parsedVehicle = truckRoutingVehicleSchema.safeParse(Object.fromEntries(Object.entries(vehicle).map(([k, v]) => [k, v.trim() ? Number(v) : NaN])));
  const controller = useRef<AbortController>();
  const edge = context?.edge?.edge;
  useEffect(() => () => controller.current?.abort(), []);
  const check = async () => {
    if (!edge || busy || !parsedVehicle.success) return;
    setBusy(true); setError(""); setResult(undefined);
    controller.current = new AbortController();
    const timeout = window.setTimeout(() => controller.current?.abort(), 16000);
    try {
      const response = await fetch("/api/site-access", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.current.signal,
        body: JSON.stringify({ site: { lon: site.lon, lat: site.lat }, vehicle: parsedVehicle.data, edge: { edgeId: edge.edgeId, aLon: edge.aLon, aLat: edge.aLat, bLon: edge.bLon, bLat: edge.bLat } }) });
      if (!response.ok) throw new Error("Straßenprüfung nicht verfügbar oder Routingdienst nicht korrekt konfiguriert.");
      const payload = siteAccessResultSchema.parse(await response.json());
      if (payload.edgeId !== edge.edgeId || payload.site.lon !== site.lon || payload.site.lat !== site.lat) throw new Error("Standortzuordnung der Antwort stimmt nicht überein.");
      setResult(payload);
    } catch { setError("Die Route konnte derzeit nicht geprüft werden. Ob Lkw den Standort erreichen können, bleibt offen."); }
    finally { window.clearTimeout(timeout); setBusy(false); }
  };
  return <div className="mt-4 border-t border-[#e3e6e1] pt-4" data-testid="site-access" data-tour="access">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-[#0d1417]">Zufahrt & Umweg</h3>
      <button type="button" disabled={!edge || busy || !parsedVehicle.success} onClick={() => void check()} className="inline-flex items-center gap-2 rounded-md border border-[#cdd2cc] px-3 py-2 text-xs font-semibold text-[#0a7c63] disabled:opacity-50"><Route size={15} />{busy ? "Route wird geprüft" : "Route prüfen"}</button>
    </div>
    <details className="mt-3 text-xs text-[#667278]"><summary>Lkw-Maße & Gewicht · angenommene Werte</summary><div className="mt-2 grid grid-cols-2 gap-3">
      {([ ["heightM", "Höhe · m", 1, 6, 0.05], ["widthM", "Breite · m", 1, 5, 0.05], ["lengthM", "Länge · m", 2, 30, 0.1], ["weightKg", "Gesamtgewicht · kg", 1000, 80000, 500], ["axleWeightKg", "Max. Achslast · kg", 1000, 20000, 500] ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}<input className="mt-1 w-full rounded border border-[#cdd2cc] p-2 text-[#0d1417]" type="number" value={vehicle[key]} min={min} max={max} step={step} disabled={busy} onChange={(e) => { setResult(undefined); setVehicle((v) => ({ ...v, [key]: e.target.value })); }} /></label>)}
    </div><p className="mt-2">Die Werte beschreiben einen Beispiel-Lkw, kein geprüftes Fahrzeug. Aktuelles Gewicht und zulässiges Gesamtgewicht werden gleich angesetzt. Gefahrgut und zeitabhängige Fahrverbote werden nicht geprüft.</p></details>
    {!parsedVehicle.success && <p role="alert" className="mt-2 text-xs text-[#8b570b]">Fahrzeugmaße und Gewichte korrigieren; Achslast darf nicht über dem Gesamtgewicht liegen.</p>}
    {!result && !error && <p className="mt-2 text-xs text-[#667278]">{edge ? "Noch keine Route geprüft. Die Zufahrt für Lkw ist nicht bestätigt." : context ? "Keine berechnete Strecke im Umkreis von 10 km für einen Routenvergleich verfügbar." : "Die Standortdaten für den Routenvergleich fehlen noch."}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-[#8b570b]">{error}</p>}
    {result && <div role="status" className="mt-2 space-y-2 text-xs text-[#667278]">
      <p className="font-semibold text-[#8b570b]">{result.status === "truck_route_proxy" ? "Lkw-Routen berechnet · Einfahrt vor Ort noch prüfen" : result.status === "road_proxy" ? "Straßenrouten berechnet · Eignung für Lkw noch offen" : result.status === "not_configured" ? "Routenprüfung noch nicht aktiviert" : "Route nicht vollständig prüfbar"}</p>
      {result.directions.length > 0 && <><div className="overflow-x-auto"><table className="w-full text-left tabular-nums"><thead><tr className="border-b border-[#e3e6e1]"><th className="py-2">Richtung</th><th className="px-2">Umweg</th><th className="px-2">Zusatzzeit</th><th className="pl-2">Abstand zur Straße</th></tr></thead><tbody>{result.directions.map((d) => <tr key={d.direction}><td className="py-2">{d.direction === "a_to_b" ? "A → B" : "B → A"}</td><td className="px-2">+{number(d.extraKm)} km</td><td className="px-2">+{number(d.extraMinutes)} min</td><td className="pl-2">{number(d.siteSnapMeters)} m</td></tr>)}</tbody></table></div><p>A und B sind die Endpunkte des berechneten Straßenabschnitts. Der Abstand zeigt, wie weit der Standort von dem Straßenpunkt entfernt liegt, den der Routendienst verwendet. Er ist keine bestätigte Zufahrt.</p></>}
      <p>{result.message}</p>
      {!!result.warnings?.length && <details><summary>Hinweise des Routenanbieters</summary>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
      {result.vehicle && <p>{number(result.vehicle.heightM)} m hoch · {number(result.vehicle.widthM)} m breit · {number(result.vehicle.lengthM)} m lang · {number(result.vehicle.weightKg / 1000)} t</p>}
      <details><summary>Details zur Routenberechnung</summary><p>{result.provider} · Fahrzeugprofil: {result.profile === "truck" ? "Lkw" : result.profile === "driving" ? "Straßenverkehr" : result.profile} · geprüft am {new Date(result.checkedAt).toLocaleString("de-DE")}</p></details>
    </div>}
    <p className="mt-2 text-xs text-[#667278]">Die Routenprüfung ändert die angenommene Kundenzahl nicht. Höhen- und Gewichtsbeschränkungen, Fahrverbote, Einfahrt, Wendefläche und Öffnungszeiten müssen zusätzlich vor Ort geprüft werden.</p>
  </div>;
}
