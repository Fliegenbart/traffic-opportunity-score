import { useEffect, useMemo, useState } from "react";
import { BatteryCharging, Coffee, MapPin, Plus, Trash2, TriangleAlert, Truck } from "lucide-react";
import { GERMANY_PATH } from "@/components/germany-outline";
import { MAP_HEIGHT, MAP_WIDTH, project } from "@/components/traffic-map";
import { alongRoute, DEFAULT_TOUR_ASSUMPTIONS, planTour, TOUR_VEHICLES, type TourAssumptions, type TourCharger, type TourEvent, type TourPlan } from "@shared/tour-plan";

type Hub = { id: string; name: string; operator: string; status: "live" | "announced"; lon: number; lat: number; maxKw?: number | null };
type Charging = { verified: Hub[]; proxy: { lon: number; lat: number; chargePoints: number; maxKw: number }[] };
type Network = "live" | "announced" | "proxy";
type StopInput = { address: string; dwellMin: number; payloadT: number };
type Place = { lon: number; lat: number; label: string };
type Route = { places: Place[]; line: [number, number][]; legs: { km: number; hours: number }[] };

const NETWORKS: { id: Network; label: string; hint: string }[] = [
  { id: "live", label: "Lkw-Ladeparks in Betrieb", hint: "bestätigt für Lkw" },
  { id: "announced", label: "+ angekündigte", hint: "geplant ab 2027" },
  { id: "proxy", label: "+ Schnelllader ab 300 kW", hint: "Lkw-Zufahrt unbestätigt" },
];
// A truck is limited to 80 km/h; the car route time is the lower bound in towns and on slow roads.
const TRUCK_KMH = 80;
const number = (v: number, digits = 0) => v.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const euro = (v: number) => `${number(Math.round(v))} €`;
const duration = (min: number) => { const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };

async function geocode(q: string): Promise<Place | null> {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
  const hits = (await response.json()) as { lat: string; lon: string; display_name: string }[];
  return hits.length ? { lon: Number(hits[0].lon), lat: Number(hits[0].lat), label: hits[0].display_name.split(",").slice(0, 2).join(", ") } : null;
}

// Prototype routing: public OSRM demo server (car profile), time scaled to truck speed. Not for production load.
async function fetchRoute(places: Place[]): Promise<Route> {
  const coords = places.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  const body = (await response.json()) as { code: string; routes?: { geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[] };
  if (body.code !== "Ok" || !body.routes?.length) throw new Error("route");
  const route = body.routes[0], every = Math.max(1, Math.ceil(route.geometry.coordinates.length / 4000));
  return {
    places, line: route.geometry.coordinates.filter((_, i, all) => i % every === 0 || i === all.length - 1),
    legs: route.legs.map((l) => ({ km: l.distance / 1000, hours: Math.max(l.duration / 3600 * 1.1, l.distance / 1000 / TRUCK_KMH) })),
  };
}

function NumberField({ label, value, onChange, step = 1, unit }: { label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string }) {
  return <label className="block text-xs text-[#6b6b70]">{label}
    <span className="mt-1 flex items-center border border-[#d4d4d0] bg-white focus-within:border-[#1d3bff]">
      <input type="number" step={step} min={0} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm tabular-nums text-[#0a0a0b] outline-none" />
      {unit && <span className="pr-2 text-xs text-[#8e8e93]">{unit}</span>}
    </span>
  </label>;
}

function Timeline({ plan, startMinute }: { plan: TourPlan; startMinute: number }) {
  const clock = (minute: number) => { const t = Math.round(startMinute + minute), d = Math.floor(t / 1440); return `${String(Math.floor(t % 1440 / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}${d ? ` +${d} T.` : ""}`; };
  const row = (e: TourEvent, i: number) => {
    if (e.type === "drive") return <li key={i} className="ml-[15px] border-l border-dashed border-[#c9c9c4] py-2 pl-7 text-xs tabular-nums text-[#6b6b70]">{number(e.km)} km · {duration(e.minutes)} · {number(e.kwh)} kWh</li>;
    const icon = e.type === "charge" ? <BatteryCharging size={15} /> : e.type === "pause" ? <Coffee size={15} /> : e.type === "stranded" ? <TriangleAlert size={15} /> : e.type === "stop" ? <MapPin size={15} /> : <Truck size={15} />;
    const tone = e.type === "charge" ? "bg-[#1d3bff] text-white" : e.type === "stranded" ? "bg-[#e3261b] text-white" : "bg-[#f2f2ef] text-[#0a0a0b]";
    return <li key={i} className="flex gap-3 py-1">
      <span className={`flex h-[31px] w-[31px] shrink-0 items-center justify-center ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        {(e.type === "start" || e.type === "arrive" || e.type === "stop") && <>
          <p className="text-sm font-semibold">{e.type === "start" ? "Abfahrt" : e.type === "arrive" ? "Ankunft" : "Stopp"} · {e.label}</p>
          <p className="text-xs tabular-nums text-[#6b6b70]">{clock(e.minute)} · Akku {e.soc} %{e.type === "stop" ? ` · ${duration(e.dwellMin)} Standzeit` : ""}</p>
        </>}
        {e.type === "charge" && <>
          <p className="text-sm font-semibold">Laden · {e.charger.name}</p>
          <p className="text-xs tabular-nums text-[#6b6b70]">{clock(e.minute)} · {duration(e.minutes)} · Akku {e.socFrom} → {e.socTo} % · {number(e.kwh)} kWh mit {number(e.kw)} kW · {euro(e.cost)}</p>
          <p className="text-xs text-[#6b6b70]">{e.pause === "rest" ? "in der Tagesruhezeit" : e.extraMin > 1 ? `in der Pflichtpause, plus ${duration(e.extraMin)} Ladezeit` : "in der Pflichtpause, ohne Extrazeit"}</p>
        </>}
        {e.type === "pause" && <>
          <p className="text-sm font-semibold">{e.pause === "rest" ? "Tagesruhezeit" : "Pflichtpause"} ohne Laden</p>
          <p className="text-xs tabular-nums text-[#6b6b70]">{clock(e.minute)} · {duration(e.minutes)} · Akku {e.soc} %</p>
        </>}
        {e.type === "stranded" && <>
          <p className="text-sm font-semibold text-[#b3180f]">Akku an der Reserve · nach {number(e.atKm)} km</p>
          <p className="text-xs text-[#6b6b70]">Seit km {number(e.fromKm)} liegt kein nutzbarer Ladepark an der Strecke.</p>
        </>}
      </div>
    </li>;
  };
  return <ol className="mt-3">{plan.events.map(row)}</ol>;
}

function TourMap({ route, plan, hubs }: { route: Route | null; plan: TourPlan | null; hubs: Hub[] }) {
  const pts = route ? route.line.map(([lon, lat]) => project(lon, lat)) : [];
  let box = [0, 0, MAP_WIDTH, MAP_HEIGHT];
  if (pts.length) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const w = Math.max(120, Math.max(...xs) - Math.min(...xs) + 50), h = Math.max(120, Math.max(...ys) - Math.min(...ys) + 50);
    box = [(Math.min(...xs) + Math.max(...xs)) / 2 - w / 2, (Math.min(...ys) + Math.max(...ys)) / 2 - h / 2, w, h];
  }
  const u = box[2] / 300;
  const stranded = plan?.events.find((e) => e.type === "stranded");
  const charges = plan ? plan.events.filter((e): e is Extract<TourEvent, { type: "charge" }> => e.type === "charge") : [];
  return <svg viewBox={box.join(" ")} className="h-auto w-full bg-[#f7f7f5]" role="img" aria-label="Karte der Tour mit Ladestopps">
    <path d={GERMANY_PATH} fill="#ffffff" stroke="#c9c9c4" strokeWidth={0.8 * u} />
    {hubs.map((h) => { const [x, y] = project(h.lon, h.lat); return <circle key={h.id} cx={x} cy={y} r={1.6 * u} fill={h.status === "live" ? "#8a97ff" : "none"} stroke="#8a97ff" strokeWidth={0.5 * u}><title>{h.name}</title></circle>; })}
    {pts.length > 1 && <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#1d3bff" strokeWidth={2.2 * u} strokeLinejoin="round" strokeLinecap="round" />}
    {charges.map((e, i) => { const [x, y] = project(e.charger.lon, e.charger.lat); return <g key={i}><circle cx={x} cy={y} r={5.5 * u} fill="#0a0a0b" stroke="#fff" strokeWidth={1.2 * u} /><text x={x} y={y + 2.4 * u} textAnchor="middle" fontSize={6.5 * u} fontWeight={700} fill="#fff">⚡</text><title>{e.charger.name}</title></g>; })}
    {route?.places.slice(0, route.places.length > 1 && route.places[0] === route.places[route.places.length - 1] ? -1 : undefined).map((p, i) => { const [x, y] = project(p.lon, p.lat); return <g key={i}><rect x={x - 5 * u} y={y - 5 * u} width={10 * u} height={10 * u} fill={i === 0 ? "#1d3bff" : "#fff"} stroke="#1d3bff" strokeWidth={1.2 * u} /><text x={x} y={y + 2.6 * u} textAnchor="middle" fontSize={7 * u} fontWeight={700} fill={i === 0 ? "#fff" : "#1d3bff"}>{i === 0 ? "D" : i}</text></g>; })}
    {stranded && route && (() => { const { pointAt, lengthKm } = alongRoute(route.line, [], 0); const p = pointAt(stranded.atKm * lengthKm / (plan!.km || 1)); const [x, y] = project(p.lon, p.lat); return <g><circle cx={x} cy={y} r={6.5 * u} fill="#e3261b" stroke="#fff" strokeWidth={1.2 * u} /><text x={x} y={y + 2.6 * u} textAnchor="middle" fontSize={8 * u} fontWeight={700} fill="#fff">!</text></g>; })()}
  </svg>;
}

export default function Tour() {
  const [depot, setDepot] = useState("Hannover");
  const [depotPayload, setDepotPayload] = useState(18);
  const [stops, setStops] = useState<StopInput[]>([{ address: "Frankfurt am Main", dwellMin: 60, payloadT: 10 }]);
  const [roundTrip, setRoundTrip] = useState(true);
  const [departure, setDeparture] = useState("06:00");
  const [vehicleId, setVehicleId] = useState(TOUR_VEHICLES[0].id);
  const [network, setNetwork] = useState<Network>("live");
  const [a, setA] = useState<TourAssumptions>(DEFAULT_TOUR_ASSUMPTIONS);
  const [charging, setCharging] = useState<Charging | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [payloads, setPayloads] = useState<number[]>([]);
  const [dwells, setDwells] = useState<{ label: string; dwellMin: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { document.title = "Touren-Check · DepotOne Prototyp"; fetch("/data/truck-charging-de.json").then((r) => r.json()).then(setCharging).catch(() => setCharging(null)); }, []);

  const vehicle = TOUR_VEHICLES.find((v) => v.id === vehicleId) ?? TOUR_VEHICLES[0];
  const setStop = (i: number, patch: Partial<StopInput>) => setStops((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const check = async () => {
    if (busy) return;
    const addresses = [depot, ...stops.map((s) => s.address)].map((s) => s.trim());
    if (addresses.some((s) => !s)) { setError("Bitte Depot und alle Stopps ausfüllen."); return; }
    setBusy(true); setError("");
    try {
      const places: Place[] = [];
      for (let i = 0; i < addresses.length; i++) {
        const q = addresses[i];
        if (i) await new Promise((r) => setTimeout(r, 1100)); // Nominatim allows one request per second.
        const place = await geocode(q);
        if (!place) { setError(`„${q}“ wurde nicht gefunden. Ergänze Straße, Postleitzahl oder Ort.`); return; }
        places.push(place);
      }
      if (roundTrip) places.push(places[0]);
      setRoute(await fetchRoute(places));
      setPayloads([depotPayload, ...stops.map((s) => s.payloadT)].slice(0, places.length - 1));
      setDwells(places.slice(1).map((p, i) => ({ label: p.label, dwellMin: stops[i]?.dwellMin ?? 0 })));
    } catch { setError("Die Routenberechnung ist gerade nicht erreichbar. Bitte in einer Minute erneut versuchen."); }
    finally { setBusy(false); }
  };

  // Chargers along the route for each network level; the plan reruns instantly when vehicle or assumptions change.
  const plans = useMemo(() => {
    if (!route || !charging) return null;
    const total = route.legs.reduce((sum, l) => sum + l.km, 0);
    const live = charging.verified.filter((h) => h.status === "live"), announced = charging.verified.filter((h) => h.status === "announced");
    const along = (points: { lon: number; lat: number }[], maxOff: number, make: (i: number) => Omit<TourCharger, "atKm">) => {
      const { hits, lengthKm } = alongRoute(route.line, points, maxOff);
      return hits.map((h) => ({ ...make(h.index), atKm: h.atKm * total / (lengthKm || 1) }));
    };
    const hub = (list: Hub[]) => along(list, 5, (i) => ({ id: list[i].id, name: list[i].name, operator: list[i].operator, maxKw: list[i].maxKw || 300, lon: list[i].lon, lat: list[i].lat }));
    const sets: Record<Network, TourCharger[]> = { live: hub(live), announced: [], proxy: [] };
    sets.announced = [...sets.live, ...hub(announced)];
    sets.proxy = [...sets.announced, ...along(charging.proxy, 2, (i) => ({ id: `p${i}`, name: `Schnelllader ${number(charging.proxy[i].maxKw)} kW (Lkw-Zufahrt unbestätigt)`, maxKw: charging.proxy[i].maxKw, lon: charging.proxy[i].lon, lat: charging.proxy[i].lat }))];
    const legs = route.legs.map((l, i) => ({ ...l, payloadT: Math.min(vehicle.maxPayloadT, payloads[i] ?? 0) }));
    const run = (n: Network) => planTour(vehicle, legs, dwells, sets[n], a, route.places[0].label);
    return { live: run("live"), announced: run("announced"), proxy: run("proxy") };
  }, [route, charging, vehicle, a, payloads, dwells]);

  const plan = plans?.[network] ?? null;
  const [h, m] = departure.split(":").map(Number);
  const rescue = plan && !plan.feasible && plans ? NETWORKS.find((n) => plans[n.id].feasible) : null;
  const saving = plan ? plan.cost.diesel.total - plan.cost.electric.total : 0;
  const shownHubs = (charging?.verified ?? []).filter((x) => network !== "live" || x.status === "live");

  return <div className="min-h-screen bg-white text-[#0a0a0b]">
    <header className="border-b border-[#e4e4e1]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-12">
        <span className="flex items-center gap-3"><span className="h-2.5 w-2.5 bg-[#1d3bff]" aria-hidden="true" /><span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]">Touren-Check</span></span>
        <span className="text-xs text-[#6b6b70]">Prototyp für DepotOne</span>
      </div>
    </header>

    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-12 lg:py-12">
      <section className="lg:col-span-5">
        <h1 className="text-[40px] font-semibold leading-[0.98] tracking-[-0.04em] [text-wrap:balance] sm:text-5xl">Fährt diese Tour elektrisch?</h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#55555a]">Tour eingeben. Der Check zeigt, ob der E-Lkw sie mit der Depotladung schafft, wo er sonst in der Pflichtpause lädt und was sie im Vergleich zum Diesel kostet.</p>

        <div className="mt-7 space-y-3">
          <div className="grid grid-cols-[1fr_5.5rem] gap-2">
            <label className="block text-xs text-[#6b6b70]">Depot (Start)
              <input value={depot} onChange={(e) => setDepot(e.target.value)} placeholder="Adresse oder Ort" className="mt-1 w-full border border-[#0a0a0b] bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-[#1d3bff]" />
            </label>
            <NumberField label="Ladung" unit="t" value={depotPayload} onChange={setDepotPayload} />
          </div>
          {stops.map((s, i) => <div key={i} className="grid grid-cols-[1fr_5.5rem_5.5rem_2rem] items-end gap-2">
            <label className="block text-xs text-[#6b6b70]">Stopp {i + 1}
              <input value={s.address} onChange={(e) => setStop(i, { address: e.target.value })} placeholder="Adresse oder Ort" className="mt-1 w-full border border-[#d4d4d0] bg-white px-3 py-2 text-sm text-[#0a0a0b] outline-none focus:border-[#1d3bff]" />
            </label>
            <NumberField label="Standzeit" unit="min" step={15} value={s.dwellMin} onChange={(v) => setStop(i, { dwellMin: v })} />
            <NumberField label="Ladung danach" unit="t" value={s.payloadT} onChange={(v) => setStop(i, { payloadT: v })} />
            <button type="button" aria-label={`Stopp ${i + 1} entfernen`} disabled={stops.length < 2} onClick={() => setStops((list) => list.filter((_, j) => j !== i))} className="flex h-[34px] items-center justify-center text-[#6b6b70] hover:text-[#0a0a0b] disabled:opacity-30"><Trash2 size={15} /></button>
          </div>)}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {stops.length < 6 && <button type="button" onClick={() => setStops((list) => [...list, { address: "", dwellMin: 60, payloadT: 0 }])} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1d3bff] hover:text-[#0f27d6]"><Plus size={14} /> Stopp hinzufügen</button>}
            <label className="inline-flex items-center gap-2 text-xs text-[#55555a]"><input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} className="accent-[#1d3bff]" /> zurück zum Depot</label>
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <label className="block text-xs text-[#6b6b70]">Fahrzeug
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="mt-1 w-full border border-[#d4d4d0] bg-white px-2 py-2 text-sm text-[#0a0a0b] outline-none focus:border-[#1d3bff]">
                {TOUR_VEHICLES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[#6b6b70]">Abfahrt
              <input type="time" value={departure} onChange={(e) => setDeparture(e.target.value || "06:00")} className="mt-1 w-full border border-[#d4d4d0] bg-white px-2 py-[7px] text-sm text-[#0a0a0b] outline-none focus:border-[#1d3bff]" />
            </label>
          </div>
          <button type="button" onClick={() => void check()} disabled={busy} className="w-full bg-[#1d3bff] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0f27d6] disabled:opacity-50">{busy ? "Route wird berechnet …" : "Tour prüfen"}</button>
          {error && <p className="text-xs text-[#8b570b]">{error}</p>}
        </div>

        <details className="mt-6 border-t border-[#e4e4e1] pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[#1d3bff]">Annahmen anpassen</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField label="Außentemperatur" unit="°C" value={a.temperatureC} onChange={(v) => setA({ ...a, temperatureC: v })} />
            <NumberField label="Akku-Reserve" unit="%" value={a.reservePercent} onChange={(v) => setA({ ...a, reservePercent: Math.min(50, v) })} />
            <NumberField label="Fahrerkosten" unit="€/h" value={a.driverPerHour} onChange={(v) => setA({ ...a, driverPerHour: v })} />
            <NumberField label="Strom im Depot" unit="€/kWh" step={0.01} value={a.depotPrice} onChange={(v) => setA({ ...a, depotPrice: v })} />
            <NumberField label="Strom unterwegs" unit="€/kWh" step={0.01} value={a.publicPrice} onChange={(v) => setA({ ...a, publicPrice: v })} />
            <NumberField label="E-Lkw" unit="€/km" step={0.01} value={a.truckPerKm} onChange={(v) => setA({ ...a, truckPerKm: v })} />
            <NumberField label="Dieselpreis" unit="€/l" step={0.01} value={a.dieselPrice} onChange={(v) => setA({ ...a, dieselPrice: v })} />
            <NumberField label="Diesel-Lkw" unit="€/km" step={0.01} value={a.dieselTruckPerKm} onChange={(v) => setA({ ...a, dieselTruckPerKm: v })} />
            <NumberField label="Maut Diesel" unit="€/km" step={0.01} value={a.dieselTollPerKm} onChange={(v) => setA({ ...a, dieselTollPerKm: v })} />
          </div>
        </details>
      </section>

      <section className="lg:col-span-7">
        {plan && route ? <>
          <div className={`p-5 ${plan.feasible ? "bg-[#1d3bff] text-white" : "bg-[#fde8e6] text-[#0a0a0b]"}`} data-testid="tour-verdict">
            <p className="text-2xl font-semibold leading-tight tracking-[-0.03em]">{!plan.feasible ? "Diese Tour fährt so noch nicht elektrisch." : plan.chargeStops === 0 ? "Ja. Die Depotladung reicht." : `Ja, mit ${plan.chargeStops} ${plan.chargeStops === 1 ? "Ladestopp" : "Ladestopps"} unterwegs.`}</p>
            <p className="mt-2 text-sm opacity-90">{!plan.feasible && plan.gap ? `Nach ${number(plan.gap.toKm)} km ist der Akku an der Reserve. Auf den ${number(plan.gap.toKm - plan.gap.fromKm)} km davor liegt kein nutzbarer Ladepark an der Strecke.${rescue ? ` Mit „${rescue.label.replace("+ ", "")}“ wäre die Tour machbar.` : ""}`
              : plan.chargeStops === 0 ? `Ankunft mit ${plan.arrivalSoc} % Akku. Geladen wird nur im Depot für ${number(a.depotPrice, 2)} €/kWh.`
              : plan.extraChargeMin > 1 ? `Geladen wird in den Pflichtpausen. Das Laden kostet ${duration(plan.extraChargeMin)} zusätzlich.` : "Geladen wird in den Pflichtpausen. Das Laden kostet keine zusätzliche Zeit."}</p>
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs text-[#6b6b70]">Welche Ladepunkte unterwegs zählen?</legend>
            <div className="mt-1.5 grid grid-cols-3 gap-1 bg-[#f2f2ef] p-1">
              {NETWORKS.map((n) => <button key={n.id} type="button" aria-pressed={network === n.id} onClick={() => setNetwork(n.id)} className={`px-2.5 py-2 text-left transition ${network === n.id ? "bg-white shadow-sm" : "text-[#6b6b70] hover:text-[#0a0a0b]"}`}>
                <span className="block text-[13px] font-semibold leading-tight">{n.label}</span><span className="block text-[11px] text-[#6b6b70]">{n.hint}</span>
              </button>)}
            </div>
          </fieldset>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {[["Strecke", `${number(plan.km)} km`], ["Dauer", plan.feasible ? duration(plan.minutes) : "—"], ["Strom", `${number(plan.kwh)} kWh`], ["Ankunft Akku", plan.feasible ? `${plan.arrivalSoc} %` : "—"]].map(([label, value]) =>
              <div key={label} className="border-t border-[#e4e4e1] pt-3"><dt className="text-xs text-[#6b6b70]">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em]">{value}</dd></div>)}
          </dl>

          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold">Ablauf</h2>
              <Timeline plan={plan} startMinute={(h || 0) * 60 + (m || 0)} />
            </div>
            <div>
              <TourMap route={route} plan={plan} hubs={shownHubs} />
              {plan.feasible && <div className="mt-5">
                <h2 className="text-sm font-semibold">Kosten dieser Tour</h2>
                <table className="mt-2 w-full text-sm tabular-nums">
                  <thead><tr className="text-left text-xs text-[#6b6b70]"><th className="py-1 font-normal"></th><th className="py-1 text-right font-normal">E-Lkw mit DepotOne</th><th className="py-1 text-right font-normal">Diesel</th></tr></thead>
                  <tbody>
                    {([["Fahrzeug", plan.cost.electric.truck, plan.cost.diesel.truck], ["Energie", plan.cost.electric.energy, plan.cost.diesel.fuel], ["Maut", 0, plan.cost.diesel.toll], ["Fahrer", plan.cost.electric.driver, plan.cost.diesel.driver]] as const).map(([label, e, d]) =>
                      <tr key={label} className="border-t border-[#e4e4e1]"><td className="py-1.5 text-[#55555a]">{label}</td><td className="py-1.5 text-right">{euro(e)}</td><td className="py-1.5 text-right">{euro(d)}</td></tr>)}
                    <tr className="border-t border-[#0a0a0b] font-semibold"><td className="py-1.5">Summe</td><td className="py-1.5 text-right">{euro(plan.cost.electric.total)}</td><td className="py-1.5 text-right">{euro(plan.cost.diesel.total)}</td></tr>
                  </tbody>
                </table>
                <p className="mt-2 text-sm font-semibold" data-testid="tour-saving">{Math.abs(saving) < 1 ? "Gleich teuer wie Diesel." : saving > 0 ? `${euro(saving)} günstiger als Diesel (${number(saving / plan.km, 2)} €/km).` : `${euro(-saving)} teurer als Diesel (${number(-saving / plan.km, 2)} €/km).`}</p>
                <p className="mt-1 text-xs text-[#6b6b70]">Die Diesel-Tour dauert {duration(plan.cost.diesel.minutes)}.</p>
              </div>}
            </div>
          </div>
        </> : <>
          <TourMap route={null} plan={null} hubs={shownHubs} />
          <p className="mt-2 text-xs text-[#6b6b70]">Punkte: bestätigte Lkw-Ladeparks in Betrieb.</p>
        </>}

        <p className="mt-8 text-[11px] leading-relaxed text-[#6b6b70]">Erste Einschätzung, keine Fahranweisung. Verbrauch: Modellwert je Fahrzeugklasse aus Ladung und Temperatur, ohne Höhenprofil und Wind. Fahrzeit: Straßenroute (OpenStreetMap) mit höchstens 80 km/h. Lenkzeiten vereinfacht: 45 Minuten Pause nach 4,5 Stunden, 11 Stunden Ruhezeit nach 9 Stunden Fahrt. Eine Standzeit ab 45 Minuten zählt als Pause. Unterwegs wird bis 90 % geladen, die Ladeleistung ist über den Stopp gemittelt. Ladeparks: Ladesäulenregister der Bundesnetzagentur und Betreiberangaben; ob ein Ladeplatz frei ist, wird nicht geprüft. E-Lkw sind in Deutschland derzeit von der Maut befreit. Depotstrom und Fahrzeugrate sind die DepotOne-Einstiegspreise, alle anderen Werte sind Annahmen.</p>
      </section>
    </main>
  </div>;
}
