import { useEffect, useMemo, useRef, useState } from "react";
import { chargersAlong, fetchRoute, geocode, type Charging, type Network, type Place } from "@/lib/tour-routing";
import { encodeSheet, sheetSteps } from "@/lib/tour-sheet";
import { addDays, planNight, smallestGridKw, tourLight, weekdayIndex, type DepotCharger, type Light, type NightSession } from "@shared/day-plan";
import { FLEET_EXAMPLE, parseTours } from "@shared/fleet-plan";
import { DEFAULT_TOUR_ASSUMPTIONS, planTour, TOUR_VEHICLES, type TourCharger, type TourPlan, type TourVehicle } from "@shared/tour-plan";

type Truck = { id: string; name: string; classId: string; batteryKwh: number; maxChargeKw: number };
type Line = { id: string; name: string; departure: string; stops: string; payloadT: number; dwellMin: number; days: boolean[]; truckId: string };
type Betrieb = { depot: string; gridKw: number; chargers: Record<string, number>; trucks: Truck[]; lines: Line[]; network: Network };
type CachedRoute = { legs: { km: number; hours: number }[]; labels: string[]; sets: Record<Network, TourCharger[]>; truckRouting: boolean };
type Row = { line: Line; truck?: Truck; vehicle?: TourVehicle; plan?: TourPlan; dep: number; light: Light; reason: string; missing?: boolean };

const STORE = "traffic-opportunity:betrieb:v1", ROUTES = "traffic-opportunity:betrieb-routes:v1", GEO_CACHE = "traffic-opportunity:geocode:v1";
const CHARGER_KW = [50, 150, 400];
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], WORKDAYS = [true, true, true, true, true, false, false];
const NETWORKS: { id: Network; label: string }[] = [
  { id: "live", label: "nur bestätigte Lkw-Ladeparks in Betrieb" },
  { id: "announced", label: "auch angekündigte Lkw-Ladeparks" },
  { id: "proxy", label: "auch Schnelllader ab 300 kW (Lkw-Zufahrt unbestätigt)" },
];
const LIGHTS: Record<Light, string> = { green: "bg-[#1a9d4b]", yellow: "bg-[#f0a81c]", red: "bg-[#e3261b]" };
const EMPTY: Betrieb = { depot: "", gridKw: 0, chargers: { 50: 0, 150: 0, 400: 0 }, trucks: [], lines: [], network: "live" };
const a = DEFAULT_TOUR_ASSUMPTIONS;

const uid = () => Math.random().toString(36).slice(2, 9);
const number = (v: number, digits = 0) => v.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const clock = (min: number) => { const t = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const later = (min: number) => `${clock(min)}${min >= 2880 ? " übermorgen" : min >= 1440 ? " morgen" : ""}`;
const minutesOf = (time: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(time); return m ? Number(m[1]) * 60 + Number(m[2]) : 360; };
const stopsOf = (line: Line) => line.stops.split(/>|→/).map((s) => s.trim()).filter(Boolean);
const classOf = (id: string) => TOUR_VEHICLES.find((v) => v.id === id) ?? TOUR_VEHICLES[0];
const newTruck = (name: string, classId = "long"): Truck => ({ id: uid(), name, classId, batteryKwh: classOf(classId).batteryKwh, maxChargeKw: classOf(classId).maxChargeKw });
// Tractor units share one route; the rigid truck is routed with its own size and weight.
const routeKey = (depot: string, line: Line, truck: Truck) => `${depot.trim().toLowerCase()}|${stopsOf(line).join(">").toLowerCase()}|${truck.classId === "rigid" ? "rigid" : "tractor"}`;
const load = <T,>(key: string, fallback: T): T => { try { return (JSON.parse(localStorage.getItem(key) || "null") as T) ?? fallback; } catch { return fallback; } };
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

function exampleBetrieb(): Betrieb {
  const tours = parseTours(FLEET_EXAMPLE).tours;
  const trucks = tours.map((_, i) => newTruck(`Lkw ${i + 1}`, i === tours.length - 1 ? "rigid" : "long"));
  return { depot: "Hannover", gridKw: 300, chargers: { 50: 6, 150: 2, 400: 0 }, network: "live", trucks,
    lines: tours.map((t, i) => ({ id: uid(), name: t.name, departure: clock(t.departureMin), stops: t.stops.join(" > "), payloadT: t.payloadT, dwellMin: t.dwellMin, days: [...WORKDAYS], truckId: trucks[i].id })) };
}

// The next day from tomorrow on which at least one tour runs.
const nextRunDay = (lines: Line[], from = new Date().toLocaleDateString("sv-SE")) => {
  for (let i = 1; i <= 7; i++) if (lines.some((l) => l.days[weekdayIndex(addDays(from, i))])) return addDays(from, i);
  return addDays(from, 1);
};

const field = "w-full border border-[#d4d4d0] bg-white px-2 py-1.5 text-sm text-[#0a0a0b] outline-none focus:border-[#1d3bff]";
const link = "text-xs font-semibold text-[#1d3bff] hover:text-[#0f27d6]";

export default function Tagesplan() {
  const [b, setB] = useState<Betrieb>(() => ({ ...EMPTY, ...load<Partial<Betrieb>>(STORE, {}) }));
  const [routes, setRoutes] = useState<Record<string, CachedRoute>>(() => load(ROUTES, {}));
  const [tab, setTab] = useState<"plan" | "betrieb">(() => (load<Partial<Betrieb>>(STORE, {}).lines?.length ? "plan" : "betrieb"));
  const [date, setDate] = useState(() => nextRunDay(load<Partial<Betrieb>>(STORE, {}).lines ?? []));
  const [forecast, setForecast] = useState<number | null>(null);
  const [manualTemp, setManualTemp] = useState("");
  const [charging, setCharging] = useState<Charging | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { document.title = "Tagesplan · Prototyp"; fetch("/data/truck-charging-de.json").then((r) => r.json()).then(setCharging).catch(() => setCharging(null)); }, []);
  useEffect(() => save(STORE, b), [b]);
  useEffect(() => save(ROUTES, routes), [routes]);

  // Coldest hour of the planned day at the depot (free forecast, up to two weeks ahead); cold costs range.
  useEffect(() => {
    setForecast(null);
    const place = load<Record<string, Place | null>>(GEO_CACHE, {})[b.depot.trim()];
    if (!place) return;
    let off = false;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(2)}&longitude=${place.lon.toFixed(2)}&daily=temperature_2m_min&timezone=Europe%2FBerlin&start_date=${date}&end_date=${date}`)
      .then((r) => r.json()).then((body: { daily?: { temperature_2m_min?: (number | null)[] } }) => { const t = body.daily?.temperature_2m_min?.[0]; if (!off && typeof t === "number") setForecast(Math.round(t)); })
      .catch(() => undefined);
    return () => { off = true; };
  }, [b.depot, date, routes]);

  const temperature = manualTemp.trim() !== "" && Number.isFinite(Number(manualTemp.replace(",", "."))) ? Number(manualTemp.replace(",", ".")) : forecast ?? a.temperatureC;
  const patch = (p: Partial<Betrieb>) => setB((old) => ({ ...old, ...p }));
  const patchTruck = (id: string, p: Partial<Truck>) => patch({ trucks: b.trucks.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  const patchLine = (id: string, p: Partial<Line>) => patch({ lines: b.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const truckOf = (line: Line) => b.trucks.find((t) => t.id === line.truckId);
  const missing = b.lines.filter((l) => { const t = truckOf(l); return t && stopsOf(l).length && !routes[routeKey(b.depot, l, t)]; });

  const calcRoutes = async () => {
    if (progress || !charging) return;
    if (!b.depot.trim()) { setError("Bitte zuerst das Depot eintragen."); setTab("betrieb"); return; }
    setError("");
    try {
      // Places are looked up once and remembered; the free search allows one request per second.
      const cache = load<Record<string, Place | null>>(GEO_CACHE, {});
      const names = Array.from(new Set([b.depot.trim(), ...missing.flatMap(stopsOf)]));
      let asked = 0;
      for (let i = 0; i < names.length; i++) {
        setProgress(`Orte werden gesucht … ${i + 1} von ${names.length}`);
        if (cache[names[i]]) continue;
        if (asked++) await new Promise((r) => setTimeout(r, 1100));
        cache[names[i]] = await geocode(names[i]);
      }
      save(GEO_CACHE, cache);
      const home = cache[b.depot.trim()];
      if (!home) { setError(`Das Depot „${b.depot}“ wurde nicht gefunden. Ergänze Straße, Postleitzahl oder Ort.`); return; }
      const added: Record<string, CachedRoute> = {}, notFound: string[] = [];
      for (let i = 0; i < missing.length; i++) {
        const line = missing[i], truck = truckOf(line)!, key = routeKey(b.depot, line, truck), stops = stopsOf(line);
        setProgress(`Strecken werden berechnet … ${i + 1} von ${missing.length}`);
        if (added[key]) continue;
        const unknown = stops.find((s) => !cache[s]);
        if (unknown) { notFound.push(`„${unknown}“ (${line.name})`); continue; }
        try {
          const route = await fetchRoute([home, ...stops.map((s) => cache[s]!), home], truck.classId);
          added[key] = { legs: route.legs, labels: [b.depot.trim(), ...stops, b.depot.trim()], sets: chargersAlong(route, charging), truckRouting: route.truckRouting };
        } catch { notFound.push(`Strecke für ${line.name}`); }
      }
      setRoutes((old) => ({ ...old, ...added }));
      if (notFound.length) setError(`Nicht gefunden: ${notFound.join(", ")}. Bitte den Ort genauer angeben.`);
    } catch { setError("Die Orts- oder Routensuche ist gerade nicht erreichbar. Bitte in einer Minute erneut versuchen."); }
    finally { setProgress(""); }
  };

  const day = useMemo(() => {
    const today = weekdayIndex(date), tomorrow = weekdayIndex(addDays(date, 1));
    const active = b.lines.filter((l) => l.days[today]);
    const rows = active.map((line): Row => {
      const truck = b.trucks.find((t) => t.id === line.truckId), dep = minutesOf(line.departure);
      if (!truck) return { line, dep, light: "red", reason: "Dieser Tour ist kein Lkw zugeordnet." };
      if (active.some((o) => o !== line && o.truckId === truck.id)) return { line, truck, dep, light: "red", reason: `${truck.name} ist an diesem Tag für mehrere Touren eingeplant.` };
      const route = routes[routeKey(b.depot, line, truck)];
      if (!route) return { line, truck, dep, light: "red", reason: "Die Strecke ist noch nicht berechnet.", missing: true };
      const vehicle = { ...classOf(truck.classId), batteryKwh: truck.batteryKwh, maxChargeKw: truck.maxChargeKw };
      const legs = route.legs.map((l) => ({ ...l, payloadT: Math.min(vehicle.maxPayloadT, line.payloadT) }));
      const stops = route.labels.slice(1).map((label, i, all) => ({ label, dwellMin: i === all.length - 1 ? 0 : line.dwellMin }));
      const plan = planTour(vehicle, legs, stops, route.sets[b.network], { ...a, temperatureC: temperature }, route.labels[0]);
      const verdict = tourLight(plan, a.reservePercent);
      // A red tour may work with charge points the company has not switched on.
      const rescue = plan.feasible ? undefined : NETWORKS.find((n) => planTour(vehicle, legs, stops, route.sets[n.id], { ...a, temperatureC: temperature }, route.labels[0]).feasible);
      return { line, truck, vehicle, plan, dep, light: verdict.light, reason: rescue ? `${verdict.reason} Machbar wäre sie, wenn unterwegs ${rescue.label} zählen (unter „Mein Betrieb“).` : verdict.reason };
    }).sort((x, y) => x.dep - y.dep);
    const sessions: NightSession[] = rows.filter((r) => r.plan?.feasible).map((r) => {
      const arriveMin = r.dep + r.plan!.minutes, next = b.lines.find((l) => l.truckId === r.truck!.id && l.days[tomorrow]);
      let departMin = 1440 + minutesOf((next ?? r.line).departure);
      while (departMin <= arriveMin) departMin += 1440;
      return { id: r.line.id, name: r.truck!.name, arriveMin, departMin, kwh: r.vehicle!.batteryKwh * (100 - r.plan!.arrivalSoc) / 100, maxChargeKw: r.vehicle!.maxChargeKw, batteryKwh: r.vehicle!.batteryKwh };
    });
    const chargers: DepotCharger[] = CHARGER_KW.flatMap((kw) => Array.from({ length: b.chargers[kw] || 0 }, (_, i) => ({ id: `${kw} kW · Nr. ${i + 1}`, kw })));
    const night = planNight(sessions, chargers, b.gridKw > 0 ? b.gridKw : null);
    const count = (l: Light) => rows.filter((r) => r.light === l).length;
    return { rows, night, chargers: chargers.length, neededKw: smallestGridKw(sessions, chargers), green: count("green"), yellow: count("yellow"), red: count("red"),
      truckRouting: rows.some((r) => r.truck && routes[routeKey(b.depot, r.line, r.truck)]?.truckRouting) };
  }, [b, routes, date, temperature]);

  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const notFull = day.night.sessions.filter((s) => !s.full);
  const addPasted = () => {
    const parsed = parseTours(paste);
    if (!parsed.tours.length) { setError(parsed.errors[0] || "In der Liste wurde keine Tour erkannt."); return; }
    const trucks = [...b.trucks], used = new Set(b.lines.map((l) => l.truckId));
    const lines = parsed.tours.map((t) => {
      let truck = trucks.find((tr) => !used.has(tr.id));
      if (!truck) { truck = newTruck(`Lkw ${trucks.length + 1}`); trucks.push(truck); }
      used.add(truck.id);
      return { id: uid(), name: t.name, departure: clock(t.departureMin), stops: t.stops.join(" > "), payloadT: t.payloadT, dwellMin: t.dwellMin, days: [...WORKDAYS], truckId: truck.id };
    });
    patch({ trucks, lines: [...b.lines, ...lines] }); setPaste(""); setError(parsed.errors.join(" "));
  };

  return <div className="min-h-screen bg-white text-[#0a0a0b]">
    <header className="border-b border-[#e4e4e1]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-12">
        <span className="flex items-center gap-3"><span className="h-2.5 w-2.5 bg-[#1d3bff]" aria-hidden="true" /><span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]">Tagesplan</span></span>
        <span className="flex items-center gap-4 text-xs text-[#6b6b70]"><a href="/flotte" className="font-semibold text-[#1d3bff] hover:text-[#0f27d6]">Flotten-Check</a><span className="hidden sm:inline">Prototyp</span></span>
      </div>
    </header>

    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-12 lg:py-10">
      <div className="inline-grid grid-cols-2 gap-1 bg-[#f2f2ef] p-1">
        {([["plan", "Tagesplan"], ["betrieb", "Mein Betrieb"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-semibold ${tab === id ? "bg-white shadow-sm" : "text-[#6b6b70] hover:text-[#0a0a0b]"}`}>{label}</button>)}
      </div>
      {error && <p className="mt-3 text-sm text-[#8b570b]" role="alert">{error}</p>}

      {tab === "plan" ? <section className="mt-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="block text-xs text-[#6b6b70]">Tag
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${field} mt-1 block w-auto`} />
          </label>
          <label className="block text-xs text-[#6b6b70]">Temperatur °C
            <input value={manualTemp} onChange={(e) => setManualTemp(e.target.value)} placeholder={String(forecast ?? a.temperatureC)} inputMode="decimal" className={`${field} mt-1 block w-24 tabular-nums`} />
          </label>
          <p className="pb-2 text-xs text-[#6b6b70]">{manualTemp.trim() ? "eigener Wert" : forecast != null ? `Vorhersage: Tagestief ${forecast} °C am Depot` : `keine Vorhersage für diesen Tag, gerechnet mit ${a.temperatureC} °C`}</p>
        </div>

        {!b.lines.length ? <div className="mt-6 bg-[#f7f7f5] p-6 text-sm leading-relaxed text-[#55555a]">
          <p className="font-semibold text-[#0a0a0b]">Noch kein Betrieb angelegt</p>
          <p className="mt-1">Unter „Mein Betrieb“ einmal Depot, Ladepunkte, Lkw und die festen Touren eintragen. Danach zeigt diese Seite für jeden Tag, ob alle Touren elektrisch aufgehen.</p>
          <button type="button" onClick={() => { const example = exampleBetrieb(); setB(example); setDate(nextRunDay(example.lines)); setError(""); }} className="mt-4 bg-[#1d3bff] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0f27d6]">Beispielbetrieb laden</button>
        </div> : <>
          {missing.length > 0 && <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#fff6e0] p-4 text-sm">
            <span>{missing.length === 1 ? "Für eine Tour fehlt" : `Für ${missing.length} Touren fehlt`} noch die Strecke.</span>
            <button type="button" onClick={() => void calcRoutes()} disabled={!!progress || !charging} className="bg-[#1d3bff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f27d6] disabled:opacity-50">{progress || "Strecken berechnen"}</button>
          </div>}

          <div className={`mt-5 p-5 ${!day.rows.length ? "bg-[#f7f7f5]" : day.red ? "bg-[#fde8e6]" : day.yellow ? "bg-[#fff6e0]" : "bg-[#1d3bff] text-white"}`} data-testid="day-verdict">
            <p className="text-2xl font-semibold leading-tight tracking-[-0.03em]">{!day.rows.length ? `Am ${dateLabel} fährt keine Tour.` : day.red ? `${day.red} von ${day.rows.length} Touren ${day.red === 1 ? "geht" : "gehen"} am ${dateLabel} so nicht.` : day.yellow ? `Alle ${day.rows.length} Touren gehen am ${dateLabel}, ${day.yellow} mit Hinweis.` : `Alle ${day.rows.length} Touren gehen am ${dateLabel} mit der Depotladung.`}</p>
            {!day.rows.length && <button type="button" onClick={() => setDate(nextRunDay(b.lines, date))} className={`${link} mt-2`}>Nächsten Tag mit Touren zeigen</button>}
            {day.rows.length > 0 && <p className="mt-2 text-sm opacity-90">{day.green} ohne Einschränkung · {day.yellow} mit Hinweis · {day.red} nicht machbar · gerechnet mit {number(temperature)} °C</p>}
          </div>

          <ul className="mt-4 divide-y divide-[#e4e4e1] border-y border-[#e4e4e1]">
            {day.rows.map((r) => <li key={r.line.id} className="py-3" data-testid="day-tour">
              <div className="grid grid-cols-[1rem_1fr] gap-x-3 sm:grid-cols-[1rem_1fr_auto]">
                <span className={`mt-1.5 h-3 w-3 rounded-full ${LIGHTS[r.light]}`} role="img" aria-label={r.light === "green" ? "grün" : r.light === "yellow" ? "gelb" : "rot"} />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug">{r.line.name} <span className="font-normal text-[#6b6b70]">· {r.truck?.name ?? "kein Lkw"}</span></p>
                  <p className="text-xs text-[#6b6b70]">ab {clock(r.dep)} · {stopsOf(r.line).join(" → ")}</p>
                  <p className={`mt-1 text-sm ${r.light === "red" ? "text-[#b3180f]" : "text-[#3a3a3e]"}`}>{r.reason}</p>
                </div>
                {r.plan && <dl className="col-start-2 mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-[#6b6b70] sm:col-start-3 sm:mt-0 sm:block sm:text-right">
                  <div><dt className="inline">Strecke </dt><dd className="inline font-semibold text-[#0a0a0b]">{number(r.plan.km)} km</dd></div>
                  {r.plan.feasible && <div><dt className="inline">zurück </dt><dd className="inline font-semibold text-[#0a0a0b]">{later(r.dep + r.plan.minutes)}</dd></div>}
                  {r.plan.feasible && <div><dt className="inline">Akku bei Rückkehr </dt><dd className="inline font-semibold text-[#0a0a0b]">{r.plan.arrivalSoc} %</dd></div>}
                </dl>}
              </div>
              {r.plan && r.truck && <details className="ml-7 mt-2">
                <summary className={`${link} cursor-pointer`}>Ablauf anzeigen</summary>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {sheetSteps(r.plan, r.dep).map((s, i) => <li key={i} className="grid grid-cols-[3rem_1fr] gap-x-2"><span className="tabular-nums text-[#6b6b70]">{s.time}</span><span><span className={`font-semibold ${s.kind === "charge" ? "text-[#1d3bff]" : s.kind === "stranded" ? "text-[#b3180f]" : ""}`}>{s.title}</span><span className="block text-xs text-[#6b6b70]">{s.detail}</span></span></li>)}
                </ol>
                {r.plan.feasible && <a href={`/fahrt#${encodeSheet({ tour: r.line.name, date, truck: r.truck.name, km: r.plan.km, steps: sheetSteps(r.plan, r.dep) })}`} target="_blank" rel="noreferrer" className={`${link} mt-3 inline-block`}>Fahrer-Zettel öffnen (Link fürs Handy, druckbar)</a>}
              </details>}
            </li>)}
          </ul>

          {day.night.sessions.length > 0 && <>
            <h2 className="mt-8 text-sm font-semibold">Laden im Depot nach der Rückkehr</h2>
            <p className={`mt-1 text-sm ${notFull.length ? "text-[#b3180f]" : "text-[#3a3a3e]"}`} data-testid="night-verdict">
              {!day.chargers ? "Im Betrieb sind noch keine Ladepunkte eingetragen." : notFull.length ? `${notFull.length === 1 ? "Ein Lkw ist" : `${notFull.length} Lkw sind`} bei der nächsten Abfahrt nicht voll${notFull.some((x) => !x.chargerId) ? ", weil rechtzeitig kein Ladepunkt frei wird" : ""}.` : "Alle Lkw sind bei der nächsten Abfahrt voll."}
              {day.chargers > 0 && (b.gridKw <= 0 ? ` Dafür sind mindestens ${number(day.neededKw)} kW Netzanschluss nötig.` : day.neededKw > b.gridKw ? ` Der Netzanschluss von ${number(b.gridKw)} kW reicht nicht, für volle Akkus wären ${number(day.neededKw)} kW nötig.` : ` Der Netzanschluss von ${number(b.gridKw)} kW reicht, nötig wären mindestens ${number(day.neededKw)} kW.`)}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm tabular-nums">
                <thead><tr className="text-left text-xs text-[#6b6b70]">{["Lkw", "kommt", "Ladepunkt", "lädt", "Strom", "nächste Abfahrt", "Akku dann"].map((h) => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}</tr></thead>
                <tbody>{[...day.night.sessions].sort((x, y) => x.arriveMin - y.arriveMin).map((s) => <tr key={s.id} className="border-t border-[#e4e4e1]">
                  <td className="py-2 pr-3 font-semibold">{s.name}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{later(s.arriveMin)}</td>
                  <td className={`whitespace-nowrap py-2 pr-3 ${s.chargerId ? "" : "text-[#b3180f]"}`}>{s.chargerId ?? "kein Ladepunkt frei"}{s.after && s.plugMin != null ? ` · umstecken ${later(s.plugMin)} von ${s.after}` : ""}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{s.startMin != null && s.endMin != null ? `${clock(s.startMin)}–${later(s.endMin)}` : "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{number(s.chargedKwh)} kWh</td>
                  <td className="whitespace-nowrap py-2 pr-3">{later(s.departMin)}</td>
                  <td className={`whitespace-nowrap py-2 pr-3 font-semibold ${s.full ? "" : "text-[#b3180f]"}`}>{s.departSoc} %</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>}
        </>}

        <p className="mt-8 text-[11px] leading-relaxed text-[#6b6b70]">Planwerte, keine Fahranweisung. Jeder Lkw startet mit vollem Akku; Akkustände sind berechnet, nicht gemessen. Verbrauch: Modellwert je Fahrzeugklasse aus Ladung und Temperatur, ohne Höhenprofil und Wind, mit {number(a.reservePercent)} % Reserve. {day.truckRouting ? "Strecken: Lkw-Routen (HERE) mit Maßen und Gewicht des Fahrzeugs." : "Strecken: Straßenrouten (OpenStreetMap) mit höchstens 80 km/h, ohne Lkw-Verbote."} Lenkzeiten vereinfacht: 45 Minuten Pause nach 4,5 Stunden, eine Standzeit ab 45 Minuten zählt als Pause. Gelb heißt: machbar, aber mit Ladestopp unterwegs oder knapper Reserve; ob ein Ladeplatz frei ist, wird nicht geprüft. Depot: Ein Lkw behält seinen Ladepunkt, bis er abfährt; nur wenn ein anderer wartet, wird ein voller Lkw umgesteckt (dafür muss jemand vor Ort sein). Der Lkw mit der frühesten Abfahrt lädt zuerst, Gebäude, Photovoltaik und Speicher sind nicht eingerechnet. Temperatur: Vorhersage von Open-Meteo. Alle Angaben bleiben in diesem Browser gespeichert.</p>
      </section> : <section className="mt-6 space-y-8">
        <div>
          <h2 className="text-sm font-semibold">Depot</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
            <label className="block text-xs text-[#6b6b70]">Adresse oder Ort
              <input value={b.depot} onChange={(e) => patch({ depot: e.target.value })} placeholder="z. B. Hannover, Am Brinker Hafen" className={`${field} mt-1`} />
            </label>
            <label className="block text-xs text-[#6b6b70]">Netzanschluss kW
              <input type="number" min={0} value={b.gridKw} onChange={(e) => patch({ gridKw: Math.max(0, Number(e.target.value) || 0) })} className={`${field} mt-1 tabular-nums`} />
            </label>
            {CHARGER_KW.map((kw) => <label key={kw} className="block text-xs text-[#6b6b70]">Ladepunkte {kw} kW
              <input type="number" min={0} max={40} value={b.chargers[kw] || 0} onChange={(e) => patch({ chargers: { ...b.chargers, [kw]: Math.min(40, Math.max(0, Math.round(Number(e.target.value) || 0))) } })} className={`${field} mt-1 tabular-nums`} />
            </label>)}
          </div>
          <p className="mt-1 text-xs text-[#8e8e93]">Netzanschluss 0 = noch unbekannt; der Tagesplan nennt dann die nötige Leistung.</p>
          <label className="mt-3 block max-w-xl text-xs text-[#6b6b70]">Ladepunkte unterwegs einplanen
            <select value={b.network} onChange={(e) => patch({ network: e.target.value as Network })} className={`${field} mt-1`}>{NETWORKS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
          </label>
        </div>

        <div>
          <h2 className="text-sm font-semibold">Lkw</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-[#6b6b70]">{["Name oder Kennzeichen", "Fahrzeugklasse", "Akku kWh", "Laden bis kW", ""].map((h) => <th key={h} className="py-1 pr-2 font-normal">{h}</th>)}</tr></thead>
              <tbody>{b.trucks.map((t) => <tr key={t.id}>
                <td className="py-1 pr-2"><input value={t.name} onChange={(e) => patchTruck(t.id, { name: e.target.value })} className={field} aria-label="Name" /></td>
                <td className="py-1 pr-2"><select value={t.classId} onChange={(e) => patchTruck(t.id, { classId: e.target.value, batteryKwh: classOf(e.target.value).batteryKwh, maxChargeKw: classOf(e.target.value).maxChargeKw })} className={field} aria-label="Fahrzeugklasse">{TOUR_VEHICLES.map((v) => <option key={v.id} value={v.id}>{v.label.split(" · ")[0]}</option>)}</select></td>
                <td className="w-28 py-1 pr-2"><input type="number" min={50} max={1200} value={t.batteryKwh} onChange={(e) => patchTruck(t.id, { batteryKwh: Math.max(50, Number(e.target.value) || 50) })} className={`${field} tabular-nums`} aria-label="Akku kWh" /></td>
                <td className="w-28 py-1 pr-2"><input type="number" min={20} max={1000} value={t.maxChargeKw} onChange={(e) => patchTruck(t.id, { maxChargeKw: Math.max(20, Number(e.target.value) || 20) })} className={`${field} tabular-nums`} aria-label="Laden bis kW" /></td>
                <td className="py-1"><button type="button" onClick={() => patch({ trucks: b.trucks.filter((x) => x.id !== t.id) })} className="px-2 text-[#6b6b70] hover:text-[#b3180f]" aria-label={`${t.name} entfernen`}>✕</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <button type="button" onClick={() => patch({ trucks: [...b.trucks, newTruck(`Lkw ${b.trucks.length + 1}`)] })} className={`${link} mt-2`}>+ Lkw hinzufügen</button>
        </div>

        <div>
          <h2 className="text-sm font-semibold">Feste Touren</h2>
          <p className="mt-1 text-xs text-[#6b6b70]">Jede Tour startet und endet am Depot. Mehrere Stopps mit &gt; trennen, z. B. Kassel &gt; Göttingen.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="text-left text-xs text-[#6b6b70]">{["Tour", "Abfahrt", "Stopps", "Ladung t", "Standzeit min", "Fährt am", "Lkw", ""].map((h) => <th key={h} className="py-1 pr-2 font-normal">{h}</th>)}</tr></thead>
              <tbody>{b.lines.map((l) => <tr key={l.id} className="align-top">
                <td className="w-40 py-1 pr-2"><input value={l.name} onChange={(e) => patchLine(l.id, { name: e.target.value })} className={field} aria-label="Tour" /></td>
                <td className="w-28 py-1 pr-2"><input type="time" value={l.departure} onChange={(e) => patchLine(l.id, { departure: e.target.value || "06:00" })} className={`${field} tabular-nums`} aria-label="Abfahrt" /></td>
                <td className="py-1 pr-2"><input value={l.stops} onChange={(e) => patchLine(l.id, { stops: e.target.value })} placeholder="Ort > Ort" className={field} aria-label="Stopps" /></td>
                <td className="w-20 py-1 pr-2"><input type="number" min={0} max={30} value={l.payloadT} onChange={(e) => patchLine(l.id, { payloadT: Math.max(0, Number(e.target.value) || 0) })} className={`${field} tabular-nums`} aria-label="Ladung t" /></td>
                <td className="w-24 py-1 pr-2"><input type="number" min={0} max={600} value={l.dwellMin} onChange={(e) => patchLine(l.id, { dwellMin: Math.max(0, Number(e.target.value) || 0) })} className={`${field} tabular-nums`} aria-label="Standzeit min" /></td>
                <td className="py-1 pr-2"><span className="flex gap-0.5">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={l.days[i]} onClick={() => patchLine(l.id, { days: l.days.map((v, j) => (j === i ? !v : v)) })} className={`h-8 w-8 text-xs font-semibold ${l.days[i] ? "bg-[#0a0a0b] text-white" : "bg-[#f2f2ef] text-[#8e8e93]"}`}>{d}</button>)}</span></td>
                <td className="w-36 py-1 pr-2"><select value={l.truckId} onChange={(e) => patchLine(l.id, { truckId: e.target.value })} className={field} aria-label="Lkw"><option value="">– wählen –</option>{b.trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                <td className="py-1"><button type="button" onClick={() => patch({ lines: b.lines.filter((x) => x.id !== l.id) })} className="px-2 py-1.5 text-[#6b6b70] hover:text-[#b3180f]" aria-label={`${l.name} entfernen`}>✕</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <button type="button" onClick={() => patch({ lines: [...b.lines, { id: uid(), name: `Tour ${b.lines.length + 1}`, departure: "06:00", stops: "", payloadT: 15, dwellMin: 60, days: [...WORKDAYS], truckId: b.trucks.find((t) => !b.lines.some((x) => x.truckId === t.id))?.id ?? "" }] })} className={`${link} mt-2`}>+ Tour hinzufügen</button>
          <details className="mt-3">
            <summary className={`${link} cursor-pointer`}>Touren aus Excel einfügen</summary>
            <p className="mt-2 text-xs text-[#6b6b70]">Eine Tour pro Zeile: Name; Abfahrt; Stopps (mit &gt; getrennt); Ladung t; Standzeit min. Fehlende Lkw werden angelegt.</p>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} spellCheck={false} placeholder={FLEET_EXAMPLE.split("\n").slice(1, 3).join("\n")} className={`${field} mt-1 font-mono text-xs`} />
            <button type="button" onClick={addPasted} className="mt-1 bg-[#0a0a0b] px-3 py-2 text-xs font-semibold text-white">Touren übernehmen</button>
          </details>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#e4e4e1] pt-5">
          <button type="button" onClick={() => { setTab("plan"); if (missing.length) void calcRoutes(); }} disabled={!!progress || !b.lines.length} className="bg-[#1d3bff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0f27d6] disabled:opacity-50">{progress || "Zum Tagesplan"}</button>
          <button type="button" onClick={() => { if (!b.lines.length || window.confirm("Den eingetragenen Betrieb durch das Beispiel ersetzen?")) { const example = exampleBetrieb(); setB(example); setDate(nextRunDay(example.lines)); } }} className={link}>Beispielbetrieb laden</button>
          <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: "application/json" })); const el = document.createElement("a"); el.href = url; el.download = "betrieb.json"; el.click(); URL.revokeObjectURL(url); }} className={link}>Als Datei sichern</button>
          <button type="button" onClick={() => file.current?.click()} className={link}>Aus Datei laden</button>
          <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void f.text().then((text) => { try { const data = JSON.parse(text) as Partial<Betrieb>; if (!Array.isArray(data.lines) || !Array.isArray(data.trucks)) throw new Error(); setB({ ...EMPTY, ...data }); setError(""); } catch { setError("Die Datei enthält keinen gesicherten Betrieb."); } }); }} />
          <button type="button" onClick={() => { if (window.confirm("Alle Angaben in diesem Browser löschen?")) { setB(EMPTY); setRoutes({}); } }} className="text-xs font-semibold text-[#6b6b70] hover:text-[#b3180f]">Alles löschen</button>
          <span className="text-xs text-[#6b6b70]">Die Angaben werden nur in diesem Browser gespeichert.</span>
        </div>
      </section>}
    </main>
  </div>;
}
