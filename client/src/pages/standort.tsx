import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Play, Printer, Search, SlidersHorizontal } from "lucide-react";
import TrafficMap, { type MapCharger, type MapFlow } from "@/components/traffic-map";
import { WatchButton } from "@/components/watchlist";
import { verdictOf } from "@/components/charging-planner";
import { useWatchlist } from "@/lib/use-watchlist";
import { useNearbyParking, useSnapshots } from "@/lib/surroundings-data";
import type { PlanEntry, WorkerReply } from "@/lib/charging-planning.worker";
import { loadPlanningData } from "@shared/charging-planning/data";
import { buildSiteRequest, DEFAULT_SITE_INPUT, PLANNING_STORAGE_KEY, siteInputSchema } from "@shared/charging-planning/site-input";
import { resolveSiteTraffic, type BasisChoice, type PlanningData } from "@shared/site-traffic";
import { assessSite } from "@shared/standort-check";
import { computeGaps, eTruckShare, largestGaps, FULL_GAP_DENSITY, GAP_FIRST_YEAR, GAP_LAST_YEAR, type GapSpot } from "@shared/charging-gaps";
import type { LorryParking } from "@shared/surroundings";

type Site = { lon: number; lat: number; label: string };
type Hub = { id: string; name: string; operator: string; type: "mcs" | "hpc"; status: "live" | "announced"; lon: number; lat: number; chargePoints?: number | null };
type Charging = { metadata: { bnetzaDataDate: string }; verified: Hub[]; proxy: { lon: number; lat: number; chargePoints: number; maxKw: number }[] };
type Atlas = { backdrop: [number, number][] };
type Direction = "one_unknown" | "both";

const json = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
const number = (v: number, digits = 0) => v.toLocaleString("de-DE", { maximumFractionDigits: digits });
const million = (v: number) => Math.abs(v) < 50000 ? "≈ 0" : `${v < 0 ? "−" : "+"}${number(Math.abs(v) / 1e6, 1)}`;

function readSite(): Site | null {
  const params = new URLSearchParams(window.location.search);
  const [lon, lat] = (params.get("standort") || "").split(",").map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 5 || lon > 16 || lat < 47 || lat > 56) return null;
  return { lon, lat, label: params.get("name") || "" };
}

function savedAssumptions() {
  try {
    const saved = siteInputSchema.safeParse(JSON.parse(localStorage.getItem(PLANNING_STORAGE_KEY) || "null"));
    return saved.success ? saved.data : DEFAULT_SITE_INPUT;
  } catch { return DEFAULT_SITE_INPUT; }
}

// The traffic source is picked for the owner: modelled 2030 traffic where a motorway section is near, else the nearest counting station.
function autoBasis(site: Site, data: PlanningData, direction: Direction): BasisChoice | undefined {
  const { edge, candidates } = resolveSiteTraffic(site, data);
  if (edge) return { basis: "model", direction };
  const station = candidates.find((c) => c.station.meanObservedTrucksPerHour !== null);
  return station ? { basis: "station", stationId: station.station.stationId, direction } : undefined;
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="border-t border-[#e4e4e1] pt-3">
    <dt className="text-xs text-[#6b6b70]">{label}</dt>
    <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em] text-[#0a0a0b]">{value}</dd>
    {note && <dd className="mt-0.5 text-xs leading-snug text-[#6b6b70]">{note}</dd>}
  </div>;
}

function GapList({ spots, year, onPick }: { spots: GapSpot[]; year: number; onPick: (site: Site) => void }) {
  if (!spots.length) return null;
  return <div className="mt-10">
    <h2 className="text-sm font-semibold text-[#0a0a0b]">Die größten Lücken {year}</h2>
    <p className="mt-1 text-xs text-[#6b6b70]">Hier fahren viele E-Lkw, aber es gibt keinen oder zu wenig Lkw-Ladeparks. Klick öffnet die Rechnung für einen neuen Ladepark an dieser Stelle.</p>
    <ol className="mt-3 divide-y divide-[#e4e4e1] border-y border-[#e4e4e1]">
      {spots.map((spot, i) => <li key={`${spot.lon},${spot.lat}`}>
        <button type="button" onClick={() => onPick({ lon: spot.lon, lat: spot.lat, label: spot.road ? `${spot.place} (${spot.road})` : spot.place })} className="group flex w-full items-center gap-3 py-2.5 text-left">
          <span className="w-5 shrink-0 text-sm font-bold tabular-nums text-[#e3261b]">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[#0a0a0b]">{spot.road ? `${spot.road} · ` : ""}{spot.place}</span>
            <span className="block text-xs leading-snug text-[#6b6b70]">{spot.hubKm === null || spot.hubKm > 50 ? `Kein Lkw-Ladepark in ${spot.hubKm === null ? "der Nähe" : `${number(spot.hubKm)} km`}` : `Lkw-Ladepark in ${number(spot.hubKm)} km reicht nicht`} · ≈ {number(Math.round(spot.eTrucks / 10) * 10)} E-Lkw/Tag · es fehlen ≈ {number(spot.missingPoints)} Ladepunkte</span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-[#cfcfcb] group-hover:text-[#0a0a0b]" />
        </button>
      </li>)}
    </ol>
  </div>;
}

function YearControl({ year, setYear, missingPoints }: { year: number; setYear: (y: number | ((y: number) => number)) => void; missingPoints: number | null }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setYear((y) => {
      if (y >= GAP_LAST_YEAR) { setPlaying(false); return y; }
      return y + 1;
    }), 900);
    return () => window.clearInterval(timer);
  }, [playing, setYear]);
  const toggle = () => { if (!playing && year >= GAP_LAST_YEAR) setYear(GAP_FIRST_YEAR); setPlaying(!playing); };
  return <div className="mb-3">
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-4xl font-semibold tabular-nums tracking-[-0.04em]" aria-live="polite">{year}</p>
        <p className="mt-1 text-xs text-[#55555a]">{Math.round(eTruckShare(year) * 100)} % der Lkw fahren elektrisch</p>
      </div>
      {missingPoints !== null && <div className="text-right">
        <p className="text-2xl font-semibold tabular-nums tracking-[-0.03em] text-[#e3261b]">≈ {number(Math.round(missingPoints / 10) * 10)}</p>
        <p className="mt-1 text-xs text-[#55555a]">Lkw-Ladepunkte fehlen</p>
      </div>}
    </div>
    <div className="mt-3 flex items-center gap-3">
      <button type="button" onClick={toggle} aria-label={playing ? "Anhalten" : "Jahre abspielen"} className="grid h-8 w-8 shrink-0 place-items-center bg-[#0a0a0b] text-white hover:bg-[#1d3bff]">{playing ? <Pause size={14} /> : <Play size={14} />}</button>
      <input type="range" min={GAP_FIRST_YEAR} max={GAP_LAST_YEAR} step={1} value={year} onChange={(e) => { setPlaying(false); setYear(Number(e.target.value)); }} aria-label="Jahr" className="w-full accent-[#1d3bff]" />
    </div>
    <div className="mt-1 flex justify-between pl-11 text-[10px] tabular-nums text-[#8e8e93]"><span>{GAP_FIRST_YEAR}</span><span>{GAP_LAST_YEAR}</span></div>
  </div>;
}

function GridRequest({ site, peakKw, chargesPerDay }: { site: Site; peakKw: number | null; chargesPerDay: number | null }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", company: "", consent: false, website: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const send = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.consent) return;
    setStatus("sending");
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        tenant: "netzanschluss-vorpruefung", url: window.location.href, consent: true, website: form.website,
        contact: { name: form.name.trim(), email: form.email.trim(), company: form.company.trim() || undefined,
          message: `Netzanschluss vorprüfen: ${site.label || "Standort"} (${site.lat}, ${site.lon}). Berechnete Spitzenleistung ${peakKw === null ? "offen" : `${number(peakKw)} kW`}, ≈ ${chargesPerDay === null ? "?" : number(chargesPerDay, 1)} Ladungen/Tag (2030, Basis).` },
      }) });
      setStatus(response.ok ? "sent" : "error");
    } catch { setStatus("error"); }
  };
  if (status === "sent") return <p className="bg-[#e5e9ff] p-4 text-sm text-[#0a0a0b]">Danke! Wir melden uns mit einer ersten Einschätzung zum Netzanschluss.</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-between bg-[#1d3bff] px-5 py-4 text-left text-white transition hover:bg-[#0f27d6]">
    <span><span className="block text-base font-semibold">Netzanschluss vorprüfen lassen</span><span className="block text-xs text-white/75">Wie viel Leistung ist hier möglich, was kostet sie, wie lange dauert es?</span></span>
    <ArrowRight size={20} />
  </button>;
  const field = "w-full rounded-md border border-[#cfcfcb] bg-white px-3 py-2 text-sm outline-none focus:border-[#1d3bff]";
  return <div className="border border-[#1d3bff] p-4">
    <p className="text-sm font-semibold text-[#0a0a0b]">Netzanschluss vorprüfen lassen</p>
    <p className="mt-1 text-xs text-[#6b6b70]">Wir schicken deinen Standort mit {peakKw === null ? "der berechneten Leistung" : `≈ ${number(peakKw)} kW Spitzenleistung`} zur Prüfung.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" />
      <input className={field} placeholder="E-Mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="E-Mail" />
      <input className={`${field} sm:col-span-2`} placeholder="Firma (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} aria-label="Firma" />
      <input className="hidden" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} aria-hidden="true" />
    </div>
    <label className="mt-3 flex gap-2 text-xs text-[#55555a]"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5" />Meine Angaben dürfen zur Bearbeitung der Anfrage verwendet werden.</label>
    <div className="mt-3 flex items-center gap-3">
      <button type="button" onClick={() => void send()} disabled={status === "sending" || !form.name.trim() || !form.email.trim() || !form.consent} className="bg-[#1d3bff] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{status === "sending" ? "Wird gesendet …" : "Anfrage senden"}</button>
      {status === "error" && <span className="text-xs text-[#b13632]">Die Anfrage konnte gerade nicht gesendet werden.</span>}
    </div>
  </div>;
}

export default function Standort() {
  const assumptions = useMemo(savedAssumptions, []);
  const [site, setSite] = useState<Site | null>(readSite);
  const [direction, setDirection] = useState<Direction>("one_unknown");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [charging, setCharging] = useState<Charging | null>(null);
  const [substations, setSubstations] = useState<[number, number, number][]>([]);
  const [year, setYear] = useState(2030);
  const [data, setData] = useState<PlanningData>();
  const [entry, setEntry] = useState<PlanEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const watch = useWatchlist(charging);

  useEffect(() => {
    json<Atlas>("/data/traffic-opportunity-de.json").then(setAtlas);
    json<Charging>("/data/truck-charging-de.json").then((c) => setCharging(c && Array.isArray(c.verified) && Array.isArray(c.proxy) ? c : null));
    json<{ points: [number, number, number][] }>("/data/substations-de.json").then((s) => s && setSubstations(s.points));
    loadPlanningData().then(setData).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (site) { params.set("standort", `${site.lon},${site.lat}`); if (site.label) params.set("name", site.label); }
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    if (site) window.scrollTo({ top: 0 });
  }, [site]);

  const hubs = charging?.verified ?? [];
  const live = useMemo(() => hubs.filter((h) => h.status === "live"), [hubs]);
  const gaps = useMemo(() => data ? computeGaps(data.network.edges, hubs, year) : null, [data, hubs, year]);
  const flows = useMemo<MapFlow[]>(() => (gaps?.sections ?? []).map(({ edge, trucks, eTrucks, missing, density, hubKm }) => ({
    edgeId: edge.edgeId, aLon: edge.aLon, aLat: edge.aLat, bLon: edge.bLon, bLat: edge.bLat,
    weight: Math.min(1, Math.sqrt(trucks / 40000)), gap: Math.min(1, density / FULL_GAP_DENSITY),
    label: `${edge.label.replace(" - ", " – ")} · ${year}: ≈ ${number(Math.round(trucks / 100) * 100)} Lkw/Tag, davon ≈ ${number(Math.round(eTrucks / 10) * 10)} elektrisch · ${missing >= 1 ? (hubKm === null || hubKm > 50 ? "kein Lkw-Ladepark in der Nähe" : `Lkw-Ladepark in ${number(hubKm)} km reicht nicht`) : "durch Lkw-Ladeparks abgedeckt"}`,
  })), [gaps, year]);
  const snapshots = useSnapshots();
  const lorryParking = useMemo<LorryParking[]>(() => snapshots?.[0]?.parking ?? [], [snapshots]);
  const spots = useMemo(() => gaps ? largestGaps(gaps, lorryParking, live) : [], [gaps, lorryParking, live]);
  const mapChargers = useMemo<MapCharger[]>(() => hubs.map(({ id, name, lon, lat, status, type }) => ({ id, name, lon, lat, status, type })), [hubs]);

  const { parking } = useNearbyParking(site ? [{ id: "site", ...site }] : []);
  const occupancy = parking.site?.occupancy ?? null;
  const assessment = useMemo(() => site ? assessSite(site, [], live, [], substations) : null, [site, live, substations]);
  const traffic = useMemo(() => {
    if (!site || !data) return null;
    const choice = autoBasis(site, data, direction);
    return { choice, ...resolveSiteTraffic(site, data, choice) };
  }, [site, data, direction]);

  const parkingKey = JSON.stringify(parking.site?.basis ?? null);
  useEffect(() => {
    setEntry(null);
    if (!site || !data || !traffic?.choice) return;
    const built = buildSiteRequest({ id: "site", label: site.label || "Standort", lon: site.lon, lat: site.lat }, data, assumptions, traffic.choice, parking.site?.basis);
    if (!built.request) return;
    setBusy(true);
    const worker = new Worker(new URL("../lib/charging-planning.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => { setEntry(event.data.entries[0] ?? { id: "site", error: event.data.error }); setBusy(false); worker.terminate(); };
    worker.postMessage({ requests: [built.request] });
    return () => { worker.terminate(); setBusy(false); };
  }, [site, data, traffic, parkingKey]);

  const plan = entry?.plan;
  const npv = plan?.status === "scenario_only" ? Object.fromEntries(plan.scenarios.map((s) => [s.id, s.finance.npv])) as Record<"low" | "base" | "high", number> : null;
  const verdict = npv ? verdictOf(npv) : null;
  const year2030 = plan?.scenarios.find((s) => s.id === "base")?.years.find((y) => y.year === 2030);
  const chargesPerDay = year2030 ? year2030.completedSessions / year2030.calendarDays : null;
  const peakKw = year2030?.peakGridKw ?? null;
  const directionShare = direction === "both" ? 1 : 0.5;

  const search = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true); setSearchError("");
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
      const hits = (await response.json()) as { lat: string; lon: string; display_name: string }[];
      if (!hits.length) { setSearchError("Kein passender Ort gefunden. Ergänze Straße, Postleitzahl oder Ort."); return; }
      setSite({ lon: Math.round(Number(hits[0].lon) * 1e4) / 1e4, lat: Math.round(Number(hits[0].lat) * 1e4) / 1e4, label: hits[0].display_name.split(",").slice(0, 2).join(", ") });
      setQuery("");
    } catch { setSearchError("Die Ortssuche ist gerade nicht erreichbar. Klick stattdessen auf die Karte."); }
    finally { setSearching(false); }
  };

  const tone = verdict?.tone === "good" ? "bg-[#1d3bff] text-white" : verdict?.tone === "mixed" ? "bg-[#fff4d6] text-[#0a0a0b]" : "bg-[#f2f2ef] text-[#0a0a0b]";
  const analyseUrl = site ? `/analyse?tab=standort&standorte=${site.lon},${site.lat}#wirtschaftlichkeit` : "/analyse";

  return <div className="min-h-screen bg-white text-[#0a0a0b]">
    <header className="border-b border-[#e4e4e1] print:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-12">
        <button type="button" onClick={() => setSite(null)} className="flex items-center gap-3 text-left">
          <span className="h-2.5 w-2.5 bg-[#1d3bff]" aria-hidden="true" />
          <span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]">Ladepark-Check</span>
        </button>
        <nav className="flex items-center gap-1 text-[13px] font-medium text-[#6b6b70]">
          <a href="/analyse" className="whitespace-nowrap px-3 py-1.5 hover:text-[#0a0a0b]">Deutschlandkarte erkunden</a>
          <a href="https://depot-readiness-check.vercel.app/" className="hidden px-3 py-1.5 hover:text-[#0a0a0b] sm:inline">Depot-Check</a>
        </nav>
      </div>
    </header>

    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-12 lg:py-12">
      <section className="lg:col-span-5">
        {!site ? <>
          <h1 className="text-[40px] font-semibold leading-[0.98] tracking-[-0.04em] [text-wrap:balance] sm:text-6xl">Wo lohnt sich ein Lkw-Ladepark?</h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#55555a]">Die Karte zeigt, wie der Lkw-Verkehr bis {GAP_LAST_YEAR} wächst und wo Ladeparks für E-Lkw fehlen. Für einen bestimmten Ort: Adresse eingeben oder auf die Karte klicken.</p>
          <div className="mt-7 flex gap-2">
            <label className="flex min-h-12 min-w-0 flex-1 items-center gap-3 border border-[#0a0a0b] bg-white px-4 focus-within:border-[#1d3bff]">
              <Search className="h-4 w-4 shrink-0 text-[#6b6b70]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} aria-label="Adresse oder Ort" placeholder="Adresse, Ort oder Autohof" className="w-full bg-transparent text-base outline-none placeholder:text-[#8e8e93]" autoFocus />
            </label>
            <button type="button" onClick={() => void search()} disabled={searching} className="bg-[#1d3bff] px-5 text-sm font-semibold text-white hover:bg-[#0f27d6] disabled:opacity-50">{searching ? "…" : "Prüfen"}</button>
          </div>
          {searchError && <p className="mt-2 text-xs text-[#8b570b]">{searchError}</p>}
          <GapList spots={spots} year={year} onPick={setSite} />
        </> : <>
          <button type="button" onClick={() => setSite(null)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6b6b70] hover:text-[#0a0a0b] print:hidden"><ArrowLeft size={14} /> Anderen Standort prüfen</button>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] [text-wrap:balance]">{site.label || `${site.lat.toFixed(3)}, ${site.lon.toFixed(3)}`}</h1>
          {assessment && <p className="mt-2 text-sm text-[#55555a]">{assessment.hub && assessment.hub.km < 1 ? `Hier gibt es schon einen Lkw-Ladepark: ${assessment.hub.name}.` : `Hier gibt es noch keinen Lkw-Ladepark${assessment.hub ? `, der nächste ist ${number(assessment.hub.km)} km entfernt` : ""}.`} Unten steht, was ein neuer Ladepark an dieser Stelle bringen würde.</p>}

          <fieldset className="mt-5 print:hidden">
            <legend className="text-xs text-[#6b6b70]">Wie erreichen Lkw den Standort?</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-1 bg-[#f2f2ef] p-1">
              {([["one_unknown", "Aus einer Richtung", "z. B. Rastanlage"], ["both", "Aus beiden Richtungen", "z. B. Autohof an der Ausfahrt"]] as const).map(([value, label, hint]) =>
                <button key={value} type="button" aria-pressed={direction === value} onClick={() => setDirection(value)} className={`px-3 py-2 text-left transition ${direction === value ? "bg-white shadow-sm" : "text-[#6b6b70] hover:text-[#0a0a0b]"}`}>
                  <span className="block text-sm font-semibold">{label}</span><span className="block text-[11px] text-[#6b6b70]">{hint}</span>
                </button>)}
            </div>
          </fieldset>

          <div className={`mt-5 p-5 ${verdict ? tone : "bg-[#f2f2ef]"}`} data-testid="verdict">
            {verdict && npv ? <>
              <p className="text-2xl font-semibold leading-tight tracking-[-0.03em]">{verdict.title}</p>
              <p className="mt-2 font-mono text-sm tabular-nums">Kapitalwert {million(npv.low)} bis {million(npv.high)} Mio. €</p>
              <p className="mt-1 text-xs opacity-75">Basis {million(npv.base)} Mio. € bis 2036{chargesPerDay !== null ? ` · ≈ ${number(chargesPerDay, 1)} Ladungen pro Tag im Jahr 2030` : ""}</p>
            </> : <p className="text-sm text-[#55555a]">{busy || (!plan && traffic?.choice) || !data ? "Wird berechnet …" : traffic && !traffic.choice ? "Für diesen Ort gibt es keine Verkehrsdaten im Umkreis von 10 km." : entry?.error || "Wird berechnet …"}</p>}
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
            <Fact label="Lkw pro Tag vorbei" value={traffic?.traffic ? `≈ ${number(Math.round(traffic.traffic.trucksPerDay * directionShare / 10) * 10)}` : "—"}
              note={traffic?.traffic ? `${direction === "both" ? "beide Richtungen" : "eine Richtung"} · ${traffic.traffic.source.kind === "measured" ? `Zählstelle ${traffic.traffic.referenceYear}` : "Modell 2030"}` : undefined} />
            <Fact label="Lkw nachts in der Nähe" value={occupancy ? `≈ ${number(occupancy.trucksPerNight)}` : "—"}
              note={occupancy ? `auf ${occupancy.sites} Parkplätzen ≤ 10 km, ${occupancy.nightOccupancy} % belegt` : "Messung von Toll Collect läuft"} />
            <Fact label="Nächster Lkw-Ladepark" value={assessment?.hub ? `${number(assessment.hub.km)} km` : "—"} note={assessment?.hub?.name} />
            <Fact label="Nächstes Umspannwerk" value={assessment?.substation ? `${number(assessment.substation.km, 1)} km` : "—"} note={assessment?.substation ? `${assessment.substation.kv} kV` : undefined} />
          </dl>

          <div className="mt-8 print:hidden">
            <GridRequest site={site} peakKw={peakKw} chargesPerDay={chargesPerDay} />
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
              <WatchButton watch={watch} site={{ ...site, label: site.label || `${site.lat.toFixed(3)}, ${site.lon.toFixed(3)}` }} />
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1d3bff] hover:text-[#0f27d6]"><Printer size={14} /> Als PDF speichern</button>
              <a href={analyseUrl} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1d3bff] hover:text-[#0f27d6]"><SlidersHorizontal size={14} /> Annahmen anpassen</a>
            </div>
          </div>
          <p className="mt-6 text-[11px] leading-relaxed text-[#6b6b70]">Gerechnet mit {assumptions.baseSharePercent} % E-Lkw-Anteil 2030 und {assumptions.baseShare2036Percent} % 2036 (Spanne {assumptions.lowShare2036Percent}–{assumptions.highShare2036Percent} %), {assumptions.capturePercent} % der erreichbaren E-Lkw laden hier, {assumptions.ports} Ladeplätze à {number(assumptions.portPowerKw)} kW, {number(assumptions.salePrice, 2)} €/kWh Ladepreis und {number(assumptions.capex / 1e6, 2)} Mio. € Investition. Quellen: Verkehrsmodell und BASt-Zählstellen, Ladesäulenregister der Bundesnetzagentur, Autobahn GmbH, Toll Collect GmbH (Lkw-Stellplatzinformationsdienst).</p>
        </>}
      </section>

      <section className="lg:col-span-7 print:hidden">
        <div className="bg-[#f2f2ef] p-3 sm:p-5 lg:sticky lg:top-6">
          {!site && <YearControl year={year} setYear={setYear} missingPoints={gaps?.missingPoints ?? null} />}
          {atlas ? <TrafficMap backdrop={atlas.backdrop} edges={[]} flows={flows} regions={[]} chargers={mapChargers} variant="swiss" showCities pinMode
            pins={site ? [{ id: "site", lon: site.lon, lat: site.lat, index: 1, active: true }] : []}
            onMapClick={(lon, lat) => setSite({ lon: Math.round(lon * 1e4) / 1e4, lat: Math.round(lat * 1e4) / 1e4, label: "" })}
            selectedRegionId="" selectedEdgeId={null} onSelectRegion={() => undefined} onSelectEdge={() => undefined} />
            : <div className="aspect-[4/5]" />}
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#6b6b70]">
            <span className="flex items-center gap-1.5"><span className="inline-block h-1 w-4 bg-[#1d3bff] opacity-60" />Lkw-Verkehr · je dicker, desto mehr</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-1 w-4 bg-[#e3261b]" />hier fehlen Ladeparks für E-Lkw</span>
            <span>Punkte: Lkw-Ladeparks · {site ? `Stand ${year}` : "Klick auf die Karte prüft einen Standort."}</span>
          </p>
        </div>
      </section>
    </main>
  </div>;
}
