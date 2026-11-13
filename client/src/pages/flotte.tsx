import { useEffect, useMemo, useRef, useState } from "react";
import { Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Upload } from "lucide-react";
import { chargersAlong, fetchRoute, geocode, type Charging, type Network, type Place, type Route } from "@/lib/tour-routing";
import { FLEET_EXAMPLE, parseTours, planDepot, type FleetTour } from "@shared/fleet-plan";
import { DEFAULT_TOUR_ASSUMPTIONS, planTour, TOUR_VEHICLES, type TourCharger, type TourPlan } from "@shared/tour-plan";

type Routed = { tour: FleetTour; route?: Route; sets?: Record<Network, TourCharger[]>; error?: string };

const NETWORKS: { id: Network; label: string; hint: string }[] = [
  { id: "live", label: "Lkw-Ladeparks in Betrieb", hint: "bestätigt für Lkw" },
  { id: "announced", label: "+ angekündigte", hint: "geplant ab 2027" },
  { id: "proxy", label: "+ Schnelllader ab 300 kW", hint: "Lkw-Zufahrt unbestätigt" },
];
const GEO_CACHE = "traffic-opportunity:geocode:v1";
const a = DEFAULT_TOUR_ASSUMPTIONS;
const number = (v: number, digits = 0) => v.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const euro = (v: number) => `${number(Math.round(v))} €`;
const duration = (min: number) => { const m = Math.round(min); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const clock = (min: number) => { const t = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
// Round up to a size a grid operator would quote.
const roundKw = (kw: number) => Math.ceil(kw / 10) * 10;

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="border-t border-[#e4e4e1] pt-3">
    <dt className="text-xs text-[#6b6b70]">{label}</dt>
    <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em] text-[#0a0a0b]">{value}</dd>
    {note && <dd className="mt-0.5 text-xs leading-snug text-[#6b6b70]">{note}</dd>}
  </div>;
}

export default function Flotte() {
  const [depot, setDepot] = useState("Hannover");
  const [text, setText] = useState(FLEET_EXAMPLE);
  const [vehicleId, setVehicleId] = useState(TOUR_VEHICLES[0].id);
  const [days, setDays] = useState(250);
  const [network, setNetwork] = useState<Network>("live");
  const [charging, setCharging] = useState<Charging | null>(null);
  const [routed, setRouted] = useState<Routed[] | null>(null);
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { document.title = "Flotten-Check · Prototyp"; fetch("/data/truck-charging-de.json").then((r) => r.json()).then(setCharging).catch(() => setCharging(null)); }, []);

  const vehicle = TOUR_VEHICLES.find((v) => v.id === vehicleId) ?? TOUR_VEHICLES[0];

  const check = async () => {
    if (progress || !charging) return;
    const parsed = parseTours(text);
    if (!depot.trim() || !parsed.tours.length) { setErrors(["Bitte Depot und mindestens eine Tour angeben.", ...parsed.errors]); return; }
    setErrors(parsed.errors); setRouted(null);
    try {
      // Places are looked up once and remembered; Nominatim allows one request per second.
      let cache: Record<string, Place | null> = {};
      try { cache = JSON.parse(localStorage.getItem(GEO_CACHE) || "{}"); } catch { /* empty cache */ }
      const names = Array.from(new Set([depot.trim(), ...parsed.tours.flatMap((t) => t.stops)]));
      let asked = 0;
      for (let i = 0; i < names.length; i++) {
        setProgress(`Orte werden gesucht … ${i + 1} von ${names.length}`);
        if (cache[names[i]]) continue;
        if (asked++) await new Promise((r) => setTimeout(r, 1100));
        cache[names[i]] = await geocode(names[i]);
      }
      try { localStorage.setItem(GEO_CACHE, JSON.stringify(cache)); } catch { /* storage unavailable */ }
      const home = cache[depot.trim()];
      if (!home) { setErrors([`Das Depot „${depot}“ wurde nicht gefunden. Ergänze Straße, Postleitzahl oder Ort.`]); return; }
      const result: Routed[] = [];
      for (let i = 0; i < parsed.tours.length; i++) {
        const tour = parsed.tours[i], missing = tour.stops.find((s) => !cache[s]);
        setProgress(`Routen werden berechnet … ${i + 1} von ${parsed.tours.length}`);
        if (missing) { result.push({ tour, error: `„${missing}“ nicht gefunden` }); continue; }
        try {
          const route = await fetchRoute([home, ...tour.stops.map((s) => cache[s]!), home]);
          result.push({ tour, route, sets: chargersAlong(route, charging) });
        } catch { result.push({ tour, error: "Route nicht berechenbar" }); }
      }
      setRouted(result);
    } catch { setErrors(["Die Orts- oder Routensuche ist gerade nicht erreichbar. Bitte in einer Minute erneut versuchen."]); }
    finally { setProgress(""); }
  };

  // Every tour is planned for all three charger levels; vehicle and level can then be switched without new requests.
  const rows = useMemo(() => routed?.map((r) => {
    if (!r.route || !r.sets) return { ...r, plans: null as Record<Network, TourPlan> | null };
    const legs = r.route.legs.map((l) => ({ ...l, payloadT: Math.min(vehicle.maxPayloadT, r.tour.payloadT) }));
    const stops = r.route.places.slice(1).map((p, i, all) => ({ label: p.label, dwellMin: i === all.length - 1 ? 0 : r.tour.dwellMin }));
    const run = (n: Network) => planTour(vehicle, legs, stops, r.sets![n], a, r.route!.places[0].label);
    return { ...r, plans: { live: run("live"), announced: run("announced"), proxy: run("proxy") } };
  }) ?? null, [routed, vehicle]);

  const fleet = useMemo(() => {
    if (!rows) return null;
    const ok = rows.filter((r) => r.plans?.[network].feasible).map((r) => ({ tour: r.tour, plan: r.plans![network] }));
    const depotOnly = ok.filter((r) => r.plan.chargeStops === 0).length;
    const depotPlan = planDepot(ok.map((r) => ({ name: r.tour.name, arriveMin: r.tour.departureMin + r.plan.minutes, departMin: r.tour.departureMin, kwh: r.plan.kwh - r.plan.publicKwh, maxChargeKw: vehicle.maxChargeKw })));
    const electric = ok.reduce((sum, r) => sum + r.plan.cost.electric.total, 0), diesel = ok.reduce((sum, r) => sum + r.plan.cost.diesel.total, 0);
    const km = ok.reduce((sum, r) => sum + r.plan.km, 0);
    const curve = depotPlan.managed.map((kw, i) => ({ time: clock(i * 15), managed: Math.round(kw), unmanaged: Math.round(depotPlan.unmanaged[i]) }));
    return { total: rows.length, ok: ok.length, depotOnly, depotPlan, electric, diesel, km, curve };
  }, [rows, network, vehicle]);

  const status = (plans: Record<Network, TourPlan> | null, error?: string) => {
    if (!plans) return { label: error || "nicht geprüft", tone: "text-[#8b570b]" };
    const plan = plans[network];
    if (plan.feasible) return plan.chargeStops === 0 ? { label: "Depotladung reicht", tone: "text-[#1d3bff]" } : { label: `${plan.chargeStops} ${plan.chargeStops === 1 ? "Ladestopp" : "Ladestopps"} unterwegs`, tone: "text-[#1d3bff]" };
    const rescue = NETWORKS.find((n) => plans[n.id].feasible);
    return { label: rescue ? `noch nicht · machbar mit „${rescue.label.replace("+ ", "")}“` : "noch nicht elektrisch", tone: "text-[#b3180f]" };
  };

  return <div className="min-h-screen bg-white text-[#0a0a0b]">
    <header className="border-b border-[#e4e4e1]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-12">
        <span className="flex items-center gap-3"><span className="h-2.5 w-2.5 bg-[#1d3bff]" aria-hidden="true" /><span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]">Flotten-Check</span></span>
        <span className="flex items-center gap-4 text-xs text-[#6b6b70]"><a href="/tour" className="font-semibold text-[#1d3bff] hover:text-[#0f27d6]">Einzelne Tour prüfen</a><span className="hidden sm:inline">Prototyp</span></span>
      </div>
    </header>

    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-12 lg:py-12">
      <section className="lg:col-span-4">
        <h1 className="text-[40px] font-semibold leading-[0.98] tracking-[-0.04em] [text-wrap:balance] sm:text-5xl">Welche Touren fahren elektrisch?</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#55555a]">Tourenliste einfügen. Der Check zeigt, welche Touren der E-Lkw schafft, was das Depot dafür braucht und was die Flotte im Vergleich zum Diesel kostet.</p>

        <div className="mt-7 space-y-3">
          <label className="block text-xs text-[#6b6b70]">Depot
            <input value={depot} onChange={(e) => setDepot(e.target.value)} placeholder="Adresse oder Ort" className="mt-1 w-full border border-[#0a0a0b] bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-[#1d3bff]" />
          </label>
          <label className="block text-xs text-[#6b6b70]">Touren · eine pro Zeile: Name; Abfahrt; Stopps (mit &gt; getrennt); Ladung t; Standzeit min
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} spellCheck={false} className="mt-1 w-full border border-[#d4d4d0] bg-white px-3 py-2 font-mono text-xs leading-relaxed text-[#0a0a0b] outline-none focus:border-[#1d3bff]" />
          </label>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button type="button" onClick={() => file.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1d3bff] hover:text-[#0f27d6]"><Upload size={14} /> CSV-Datei laden</button>
            <input ref={file} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setText); e.target.value = ""; }} />
            <span className="text-xs text-[#6b6b70]">oder Zeilen aus Excel einfügen</span>
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <label className="block text-xs text-[#6b6b70]">Fahrzeug
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="mt-1 w-full border border-[#d4d4d0] bg-white px-2 py-2 text-sm text-[#0a0a0b] outline-none focus:border-[#1d3bff]">
                {TOUR_VEHICLES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[#6b6b70]">Einsatztage / Jahr
              <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))} className="mt-1 w-full border border-[#d4d4d0] bg-white px-2 py-2 text-sm tabular-nums text-[#0a0a0b] outline-none focus:border-[#1d3bff]" />
            </label>
          </div>
          <button type="button" onClick={() => void check()} disabled={!!progress || !charging} className="w-full bg-[#1d3bff] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0f27d6] disabled:opacity-50">{progress || "Flotte prüfen"}</button>
          {errors.map((e) => <p key={e} className="text-xs text-[#8b570b]">{e}</p>)}
        </div>
      </section>

      <section className="min-w-0 lg:col-span-8">
        {rows && fleet ? <>
          <div className={`p-5 ${fleet.ok ? "bg-[#1d3bff] text-white" : "bg-[#fde8e6] text-[#0a0a0b]"}`} data-testid="fleet-verdict">
            <p className="text-2xl font-semibold leading-tight tracking-[-0.03em]">{fleet.ok} von {fleet.total} Touren fahren elektrisch.</p>
            <p className="mt-2 text-sm opacity-90">{fleet.ok ? `${fleet.depotOnly} nur mit der Depotladung${fleet.ok - fleet.depotOnly ? `, ${fleet.ok - fleet.depotOnly} mit Ladestopp unterwegs` : ""}.` : ""}{fleet.total - fleet.ok ? ` ${fleet.total - fleet.ok} ${fleet.total - fleet.ok === 1 ? "Tour scheitert" : "Touren scheitern"} an fehlenden Ladepunkten auf der Strecke.` : ""}</p>
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs text-[#6b6b70]">Welche Ladepunkte unterwegs zählen?</legend>
            <div className="mt-1.5 grid grid-cols-3 gap-1 bg-[#f2f2ef] p-1">
              {NETWORKS.map((n) => <button key={n.id} type="button" aria-pressed={network === n.id} onClick={() => setNetwork(n.id)} className={`px-2.5 py-2 text-left transition ${network === n.id ? "bg-white shadow-sm" : "text-[#6b6b70] hover:text-[#0a0a0b]"}`}>
                <span className="block text-[13px] font-semibold leading-tight">{n.label}</span><span className="block text-[11px] text-[#6b6b70]">{n.hint}</span>
              </button>)}
            </div>
          </fieldset>

          {fleet.ok > 0 && <>
            <h2 className="mt-8 text-sm font-semibold">Das braucht das Depot für diese {fleet.ok} Touren</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Fact label="Ladepunkte" value={number(fleet.depotPlan.points)} note={fleet.depotPlan.chargers.map((c) => `${fleet.depotPlan.points === fleet.ok ? `${c.count} × ` : ""}${c.kw} kW`).join(", ")} />
              <Fact label="Netzanschluss" value={`≈ ${number(roundKw(fleet.depotPlan.managedPeakKw))} kW`} note={`mit Lastmanagement, sonst ≈ ${number(roundKw(fleet.depotPlan.unmanagedPeakKw))} kW`} />
              <Fact label="Strom pro Tag" value={`${number(fleet.depotPlan.kwhPerDay)} kWh`} note={`≈ ${number(fleet.depotPlan.kwhPerDay * days / 1000)} MWh im Jahr`} />
              <Fact label={fleet.diesel >= fleet.electric ? "Ersparnis pro Jahr" : "Mehrkosten pro Jahr"} value={euro(Math.abs(fleet.diesel - fleet.electric) * days)} note={`gegenüber Diesel, ${number(fleet.km * days)} km`} />
            </dl>

            <div className="mt-6">
              <p className="text-xs text-[#6b6b70]">Ladeleistung im Depot über den Tag (kW)</p>
              <div className="mt-2 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={fleet.curve} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="#eeeeeb" vertical={false} />
                    <XAxis dataKey="time" interval={15} tick={{ fontSize: 11, fill: "#6b6b70" }} tickLine={false} axisLine={{ stroke: "#d4d4d0" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b6b70" }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number, key: string) => [`${number(v)} kW`, key === "managed" ? "mit Lastmanagement" : "ohne Lastmanagement"]} contentStyle={{ fontSize: 12, borderRadius: 0 }} />
                    <Area type="stepAfter" dataKey="managed" stroke="#1d3bff" fill="#1d3bff" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="unmanaged" stroke="#8e8e93" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 flex flex-wrap gap-x-5 text-[11px] text-[#6b6b70]"><span><span className="mr-1.5 inline-block h-2 w-3 bg-[#1d3bff]/40 align-middle" />mit Lastmanagement: Laden über die Standzeit verteilt</span><span><span className="mr-1.5 inline-block w-3 border-t border-dashed border-[#8e8e93] align-middle" />ohne: jeder Lkw lädt sofort mit voller Leistung</span></p>
            </div>
          </>}

          <h2 className="mt-8 text-sm font-semibold">Alle Touren</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm tabular-nums">
              <thead><tr className="text-left text-xs text-[#6b6b70]">{["Tour", "Ergebnis", "Strecke", "Zurück im Depot", "Strom", "Akku bei Ankunft", "gegenüber Diesel"].map((h, i) => <th key={h} className={`py-1.5 font-normal ${i > 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => {
                const s = status(r.plans, r.error), plan = r.plans?.[network], diff = plan ? plan.cost.diesel.total - plan.cost.electric.total : 0;
                return <tr key={i} className="border-t border-[#e4e4e1] align-top">
                  <td className="py-2 pr-3 font-semibold">{r.tour.name}<span className="block text-xs font-normal text-[#6b6b70]">ab {clock(r.tour.departureMin)} · {r.tour.stops.join(" → ")}</span></td>
                  <td className={`py-2 pr-3 ${s.tone}`}>{s.label}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right">{plan ? `${number(plan.km)} km` : "—"}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right">{plan?.feasible ? `${clock(r.tour.departureMin + plan.minutes)}${plan.minutes >= 1440 ? " +1 T." : ""}` : "—"}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right">{plan ? `${number(plan.kwh)} kWh` : "—"}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right">{plan?.feasible ? `${plan.arrivalSoc} %` : "—"}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right">{plan?.feasible ? `${diff >= 0 ? "−" : "+"}${euro(Math.abs(diff))}` : "—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </> : <div className="bg-[#f7f7f5] p-6 text-sm leading-relaxed text-[#55555a]">
          <p className="font-semibold text-[#0a0a0b]">So funktioniert es</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Depot eintragen und die Touren eines typischen Tages einfügen. Links steht ein Beispiel mit acht Touren.</li>
            <li>Der Check rechnet jede Tour einzeln: Reichweite, Pausen, Ladestopps unterwegs.</li>
            <li>Aus den Rückkehrzeiten und dem Strombedarf ergibt sich, wie viele Ladepunkte und welchen Netzanschluss das Depot braucht.</li>
          </ol>
        </div>}

        <p className="mt-8 text-[11px] leading-relaxed text-[#6b6b70]">Erste Einschätzung, kein Angebot. Jede Tour fährt ein eigener Lkw, kehrt zum Depot zurück und startet am nächsten Tag zur selben Zeit; die Ladung gilt für die ganze Tour. Ladepunkte: höchste Zahl gleichzeitig stehender Lkw. Ladergröße: kleinste Klasse (50, 150 oder 400 kW), die den Lkw in 90 % seiner Standzeit lädt. Netzanschluss: höchste Ladeleistung im Tagesverlauf, ohne Gebäude, Photovoltaik und Speicher. Kosten: {number(a.depotPrice, 2)} €/kWh im Depot und {number(a.truckPerKm, 2)} €/km für den E-Lkw (Einstiegspreise des Komplettpakets), {number(a.publicPrice, 2)} €/kWh unterwegs, Diesel {number(a.dieselPrice, 2)} €/l, Diesel-Lkw {number(a.dieselTruckPerKm, 2)} €/km, Maut {number(a.dieselTollPerKm, 2)} €/km, Fahrer {number(a.driverPerHour)} €/h, {number(a.temperatureC)} °C, {number(a.reservePercent)} % Akku-Reserve. Verbrauch, Fahrzeiten und Lenkzeiten wie im Touren-Check.</p>
      </section>
    </main>
  </div>;
}
