import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building2,
  Gauge,
  PlugZap,
  Route,
  TrendingUp,
  Truck,
} from "lucide-react";
import TrafficMap, { type MapCharger, type MapRoute } from "@/components/traffic-map";
import { distanceKm, pointToSegmentKm } from "@shared/geo";
import { validateRoutingConfig } from "@shared/site-access";
import {
  DEFAULT_ASSUMPTIONS,
  FEASIBILITY_LABELS,
  aggregateReport,
  evaluateRelation,
  type EvaluatedRelation,
  type ReportAssumptions,
  type ReportRelation,
  type RouteGeometry,
} from "@shared/korridor-report";

// Only an explicitly configured, commercially permitted routing service.
// Without one, the report retains its labelled straight-line approximation.
const osrmCache = new Map<string, RouteGeometry | null>();

async function fetchRoute(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): Promise<RouteGeometry | null> {
  const key = `${a.lon},${a.lat};${b.lon},${b.lat}`;
  if (osrmCache.has(key)) return osrmCache.get(key) ?? null;
  try {
    const baseUrl = import.meta.env.VITE_CORRIDOR_ROUTING_BASE_URL;
    if (!baseUrl) return null;
    const routing = validateRoutingConfig({ baseUrl, profile: import.meta.env.VITE_CORRIDOR_ROUTING_PROFILE || "driving" });
    const response = await fetch(
      `${routing.baseUrl}/route/v1/${routing.profile}/${key}?overview=simplified&geometries=geojson`,
      { signal: AbortSignal.timeout(12000), redirect: "error" },
    );
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as {
      routes?: { distance: number; geometry: { coordinates: [number, number][] } }[];
    };
    const best = data.routes?.[0];
    const route = best
      ? {
          km: Math.round(best.distance / 1000),
          polyline: best.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })),
        }
      : null;
    osrmCache.set(key, route);
    return route;
  } catch {
    osrmCache.set(key, null);
    return null;
  }
}

interface ReportConfig {
  id: string;
  company: string;
  isDemo?: boolean;
  preparedFor?: string;
  date?: string;
  fleet: { trucks: number; annualKmPerTruck: number };
  relations: ReportRelation[];
  assumptions?: Partial<ReportAssumptions>;
}

interface TrafficRegion {
  id: string;
  name: string;
  lon: number;
  lat: number;
  trucks2030: number;
}

interface TrafficDataSlice {
  metadata: {
    source: string;
    generatedAt: string;
    validation: {
      source: string;
      year: number;
      stationCount: number;
      matchedEdges: number;
      spearman: number;
    } | null;
  };
  regions: TrafficRegion[];
  corridors: {
    originRegionId: string;
    destinationRegionId: string;
    totalDistanceKm: number;
  }[];
  edgeHotspots: {
    edgeId: number;
    aLon: number;
    aLat: number;
    bLon: number;
    bLat: number;
  }[];
  backdrop: [number, number][];
}

interface TrendStation {
  station: { zst: string; name: string; strasse: string; distanceKm: number };
  profile: Record<"werktag" | "samstag" | "sonntag", number[]> | null;
  trend: {
    trendPctP10: number;
    trendPctP50: number;
    trendPctP90: number;
    contextWeeks: number;
  } | null;
}

interface TrendSlice {
  metadata: {
    stationsBacktested: number;
    meanCoverage80: number | null;
    source: string;
  };
  edges: Record<string, TrendStation>;
}

interface ChargingSlice {
  metadata: { bnetzaDataDate: string };
  verified: {
    id: string;
    name: string;
    lon: number;
    lat: number;
    status: "live" | "announced";
    type: "mcs" | "hpc";
  }[];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("de-DE").format(Math.round(value));
}

function formatEur(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatEurPerKm(value: number) {
  return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €/km`;
}

function feasibilityBadgeClass(feasibility: EvaluatedRelation["feasibility"]) {
  if (feasibility === "ready") return "bg-[#0A99A4]/12 text-[#06737b]";
  if (feasibility === "plannable") return "bg-amber-100 text-amber-800";
  return "bg-slate-200 text-slate-700";
}

function KpiTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0A99A4]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.03em]">{value}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-[#6e6e73]">{detail}</p>
    </div>
  );
}

export default function KorridorReport() {
  const [config, setConfig] = useState<ReportConfig | null>(null);
  const [traffic, setTraffic] = useState<TrafficDataSlice | null>(null);
  const [charging, setCharging] = useState<ChargingSlice | null>(null);
  const [trendData, setTrendData] = useState<TrendSlice | null>(null);
  const [routes, setRoutes] = useState<Record<string, RouteGeometry>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Streckenanalyse · Ladepark-Check";
    const params = new URLSearchParams(window.location.search);
    const id = (params.get("id") || "demo").replace(/[^a-z0-9-]/gi, "");
    Promise.all([
      fetch(`/data/reports/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`Report-Konfiguration "${id}" nicht gefunden`);
        return r.json();
      }),
      fetch("/data/traffic-opportunity-de.json").then((r) => r.json()),
      fetch("/data/truck-charging-de.json").then((r) => r.json()),
      // Trend-Layer ist optional — der Report funktioniert auch ohne.
      fetch("/data/traffic-trend-de.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([cfg, trafficData, chargingData, trend]) => {
        setConfig(cfg);
        setTraffic(trafficData);
        setCharging(chargingData);
        if (trend) setTrendData(trend);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const assumptions = useMemo<ReportAssumptions>(
    () => ({ ...DEFAULT_ASSUMPTIONS, ...(config?.assumptions || {}) }),
    [config],
  );

  const liveHubs = useMemo(
    () => (charging?.verified || []).filter((hub) => hub.status === "live"),
    [charging],
  );

  // Echte Routen nachladen — sequenziell, um den OSRM-Demo-Server zu schonen.
  useEffect(() => {
    if (!config || !traffic) return;
    let active = true;
    const regionsLookup = new Map(traffic.regions.map((region) => [region.id, region]));
    (async () => {
      for (const relation of config.relations) {
        const origin = regionsLookup.get(relation.originRegionId);
        const destination = regionsLookup.get(relation.destinationRegionId);
        if (!origin || !destination) continue;
        const route = await fetchRoute(origin, destination);
        if (!active) return;
        if (route) {
          setRoutes((current) => ({ ...current, [relation.name]: route }));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [config, traffic]);

  const evaluated = useMemo(() => {
    if (!config || !traffic) return [];
    const regionsById = new Map(traffic.regions.map((region) => [region.id, region]));
    return config.relations
      .map((relation) =>
        evaluateRelation(
          relation,
          regionsById,
          traffic.corridors,
          liveHubs,
          assumptions,
          routes[relation.name],
        ),
      )
      .filter((value): value is EvaluatedRelation => value !== null);
  }, [config, traffic, liveHubs, assumptions, routes]);

  const totals = useMemo(() => aggregateReport(evaluated), [evaluated]);

  const regionsById = useMemo(
    () => new Map((traffic?.regions || []).map((region) => [region.id, region])),
    [traffic],
  );

  const mapRoutes = useMemo<MapRoute[]>(() => {
    if (!config) return [];
    return config.relations.flatMap((relation) => {
      const origin = regionsById.get(relation.originRegionId);
      const destination = regionsById.get(relation.destinationRegionId);
      if (!origin || !destination) return [];
      const route = routes[relation.name];
      return [
        {
          label: relation.name,
          aLabel: origin.name.split(",")[0].trim(),
          bLabel: destination.name.split(",")[0].trim(),
          aLon: origin.lon,
          aLat: origin.lat,
          bLon: destination.lon,
          bLat: destination.lat,
          path: route?.polyline.map((p): [number, number] => [p.lon, p.lat]),
        },
      ];
    });
  }, [config, regionsById, routes]);

  // Gemessene Zählstellen je Relation: Hotspot-Kanten mit Trenddaten, deren
  // Mittelpunkt im Korridor-Puffer der Relation liegt (gleiche Logik wie Ladeparks).
  const relationTrends = useMemo(() => {
    const result = new Map<string, TrendStation[]>();
    if (!config || !traffic || !trendData) return result;
    for (const relation of config.relations) {
      const origin = regionsById.get(relation.originRegionId);
      const destination = regionsById.get(relation.destinationRegionId);
      if (!origin || !destination) continue;
      const straight = distanceKm(origin, destination);
      const buffer = Math.max(20, straight * 0.15);
      const seen = new Set<string>();
      const candidates: { entry: TrendStation; lineKm: number }[] = [];
      for (const edge of traffic.edgeHotspots) {
        const entry = trendData.edges[String(edge.edgeId)];
        if (!entry || seen.has(entry.station.zst)) continue;
        const mid = { lon: (edge.aLon + edge.bLon) / 2, lat: (edge.aLat + edge.bLat) / 2 };
        const lineKm = pointToSegmentKm(mid, origin, destination);
        if (lineKm <= buffer) {
          seen.add(entry.station.zst);
          candidates.push({ entry, lineKm });
        }
      }
      // Die routennächste Zählstelle zuerst — sie repräsentiert die Relation am ehesten.
      candidates.sort((a, b) => a.lineKm - b.lineKm);
      result.set(
        relation.name,
        candidates.map((candidate) => candidate.entry),
      );
    }
    return result;
  }, [config, traffic, trendData, regionsById]);

  // Aggregiertes Werktags-Ladefenster über alle Routen-Zählstellen,
  // je Station auf ihre Tagesspitze normiert (Anteil der Spitze in %).
  const aggregatedProfile = useMemo(() => {
    const seen = new Set<string>();
    const sums = new Array(24).fill(0);
    let count = 0;
    relationTrends.forEach((stations) => {
      for (const entry of stations) {
        if (!entry.profile?.werktag || seen.has(entry.station.zst)) continue;
        seen.add(entry.station.zst);
        const max = Math.max(...entry.profile.werktag, 1);
        entry.profile.werktag.forEach((value, hour) => {
          sums[hour] += value / max;
        });
        count += 1;
      }
    });
    if (count === 0) return null;
    return { shares: sums.map((s) => s / count), stationCount: count };
  }, [relationTrends]);

  const mapChargers = useMemo<MapCharger[]>(
    () =>
      (charging?.verified || []).map((hub) => ({
        id: hub.id,
        name: hub.name,
        lon: hub.lon,
        lat: hub.lat,
        status: hub.status,
        type: hub.type,
      })),
    [charging],
  );

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfbfd] px-6 text-center">
        <div>
          <AlertTriangle className="mx-auto h-10 w-10 text-[#0A99A4]" />
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Bericht nicht verfügbar</h1>
          <p className="mt-2 text-[#6e6e73]">
            Die Daten für diesen Bericht fehlen oder konnten nicht geladen werden. Bitte prüfe den Berichtslink.
          </p>
        </div>
      </div>
    );
  }

  if (!config || !traffic || !charging) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfbfd] px-6 text-center">
        <Gauge className="h-8 w-8 animate-pulse text-[#0A99A4]" />
      </div>
    );
  }

  const validation = traffic.metadata.validation;
  const reportDate = config.date
    ? new Date(config.date)
    : new Date(traffic.metadata.generatedAt);

  return (
    <div className="report-root min-h-screen bg-[#e9e9ec] text-[#1d1d1f] print:bg-white">
      <style>{`
        @page { size: A4; margin: 0; }
        .report-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          .report-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; }
        }
        .report-page {
          width: 210mm;
          min-height: 296mm;
          padding: 14mm 16mm 12mm;
          background: white;
          margin: 0 auto;
          box-sizing: border-box;
          page-break-after: always;
          display: flex;
          flex-direction: column;
        }
        .report-card { break-inside: avoid; page-break-inside: avoid; }
        @media screen {
          .report-page { margin: 24px auto; box-shadow: 0 10px 40px rgba(0,0,0,0.12); border-radius: 6px; }
        }
      `}</style>

      {/* Seite 1: Deckblatt */}
      <section className="report-page">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1d1d1f] text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-[-0.02em]">DepotOne</p>
              <p className="text-xs text-[#6e6e73]">Truckonomics · Ladepark-Check</p>
            </div>
          </div>
          <p className="text-sm text-[#6e6e73]">
            {config.preparedFor && <>{config.preparedFor} · </>}
            {reportDate.toLocaleDateString("de-DE", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        <div className="mt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0A99A4]">
            Streckenanalyse
          </p>
          <h1 className="mt-3 text-5xl font-semibold leading-[1.04] tracking-[-0.025em]">
            {config.company}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#6e6e73]">
            Welche Strecken kommen für E-Lkw infrage? Ein erster Vergleich von Fahrtlängen,
            bekannten Ladeparks und möglichen Betriebskosten unter den angegebenen Annahmen.
            Kein Nachweis der tatsächlichen Machbarkeit oder Wirtschaftlichkeit.
          </p>
          {config.isDemo && (
            <p className="mt-4 inline-flex rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-800">
              Beispielbericht mit erfundenen Strecken
            </p>
          )}
        </div>

        <div className="mt-12 grid grid-cols-2 gap-4">
          <KpiTile
            label="Untersuchte Strecken"
            value={String(totals.relationCount)}
            detail={`Flotte: ${config.fleet.trucks} Fahrzeuge · ${formatNumber(totals.annualKm)} km/Jahr auf diesen Strecken.`}
          />
          <KpiTile
            label="Reichweite rechnerisch ausreichend"
            value={`${totals.readyCount} von ${totals.relationCount}`}
            detail={
              totals.plannableCount > 0
                ? `Weitere ${totals.plannableCount} ${totals.plannableCount === 1 ? "Strecke benötigt" : "Strecken benötigen"} eine konkrete Ladeplanung. Zufahrt und Ladezeiten sind nicht bestätigt.`
                : "Auf Basis angenommener Reichweite und bekannter Ladeparks. Kein betrieblicher Fahrbarkeitsnachweis."
            }
          />
          <KpiTile
            label="Kostenunterschied zu Diesel · angenommen"
            value={`≈ ${formatEur(totals.annualSavingEur)}/Jahr`}
            detail={`Bei veränderten Preisannahmen: ${formatEur(evaluated.reduce((sum, r) => sum + r.annualSavingLowEur, 0))} bis ${formatEur(evaluated.reduce((sum, r) => sum + r.annualSavingHighEur, 0))}. Ohne Fahrzeuganschaffung; Annahmen auf der letzten Seite.`}
          />
          <KpiTile
            label="Berechnete CO₂-Differenz"
            value={`≈ ${formatNumber(totals.annualCo2SavedTons)} t/Jahr`}
            detail="Unter den angegebenen Verbrauchs- und Emissionsannahmen. Kein gemessener oder zertifizierter Klimanachweis."
          />
        </div>

        <div className="mt-auto rounded-2xl bg-[#fbfbfd] p-5">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-[#6e6e73]">
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0A99A4]" />
            <span>
              Datenbasis: {formatNumber(1514573)} berechnete Start-Ziel-Verbindungen (
              {traffic.metadata.source})
              {validation &&
                `, verglichen mit ${validation.stationCount} Verkehrszählstellen. Ähnlichkeit der Rangfolge: ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(validation.spearman)}, kein Genauigkeitswert`}
              . Lkw-Ladeparks aus dem Register der Bundesnetzagentur (Stand{" "}
              {new Date(charging.metadata.bnetzaDataDate).toLocaleDateString("de-DE")}) und
              dokumentierten Betreiberquellen.
            </span>
          </p>
        </div>
      </section>

      {/* Seite 2: Karte */}
      <section className="report-page">
        <h2 className="text-3xl font-semibold tracking-[-0.02em]">
          Ihre Strecken und bekannte Ladeparks
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#6e6e73]">
          Die Karte zeigt die Verbindungen zwischen Start und Ziel sowie bekannte
          Lkw-Ladeparks. Je nach Datenlage ist eine Straßenroute oder nur eine Luftlinie
          hinterlegt. Angekündigte Ladeparks zählen noch nicht als Lademöglichkeit.
        </p>
        <div className="mx-auto mt-5 w-[98mm] rounded-2xl border border-black/[0.08] bg-[#fbfbfd] p-4">
          <TrafficMap
            backdrop={traffic.backdrop}
            edges={[]}
            regions={[]}
            chargers={mapChargers}
            routes={mapRoutes}
            selectedRegionId=""
            selectedEdgeId={null}
            onSelectRegion={() => undefined}
            onSelectEdge={() => undefined}
          />
        </div>
        <div className="mt-3 space-y-0.5">
          {evaluated.map((row) => (
            <p key={row.relation.name} className="text-sm text-[#6e6e73]">
              <span className="font-semibold text-[#1d1d1f]">{row.relation.name}</span> ·{" "}
              {formatNumber(row.distanceKm)} km{" "}
              {row.distanceSource === "route"
                ? "(berechnete Straßenroute)"
                : row.distanceSource === "korridor"
                  ? "(Entfernung aus dem Verkehrsmodell)"
                  : "(geschätzt: Luftlinie plus 25 %)"} ·{" "}
              {row.relation.tripsPerWeek} Fahrten/Woche
            </p>
          ))}
        </div>

        {aggregatedProfile && (
          <div className="report-card mt-4 rounded-2xl border border-black/[0.08] bg-white p-4">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-semibold tracking-[-0.01em]">
                Verkehr im Tagesverlauf nahe Ihren Strecken
              </h3>
              <p className="text-xs text-[#9b9ba0]">
                {aggregatedProfile.stationCount} Zählstellen · Montag bis Freitag · Anteil am Tageshöchstwert
              </p>
            </div>
            <div className="mt-2 flex h-10 items-end gap-[3px]">
              {aggregatedProfile.shares.map((share, hour) => (
                <div key={hour} className="flex flex-1 items-end" style={{ height: "100%" }}>
                  <div
                    className="w-full rounded-sm bg-[#0A99A4]"
                    style={{ height: `${Math.max(5, share * 100)}%`, opacity: 0.45 + 0.55 * share }}
                    title={`${hour}–${hour + 1} Uhr: ${Math.round(share * 100)} % der Spitze`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-[#9b9ba0]">
              <span>0 Uhr</span>
              <span>6 Uhr</span>
              <span>12 Uhr</span>
              <span>18 Uhr</span>
              <span>24 Uhr</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#9b9ba0]">
              Die Messungen zeigen, wann viel Verkehr unterwegs war. Daraus lassen sich
              weder die Ladezeiten Ihrer Flotte noch die Nachfrage eines Ladeparks direkt ableiten.
            </p>
          </div>
        )}
      </section>

      {/* Seite 3: Relationen im Detail */}
      <section className="report-page">
        <h2 className="text-3xl font-semibold tracking-[-0.02em]">Die einzelnen Strecken</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#6e6e73]">
          Angenommen werden {assumptions.truckRangeKm} km Reichweite sowie Laden am Start-
          und Zieldepot. Verglichen werden bekannte Ladeparks und Kosten für Energie,
          Maut und Erlöse aus der Treibhausgasquote (THG). Zufahrt, tatsächliche Ladezeiten und komplette
          Fahrzeugkosten sind damit nicht geprüft.
        </p>

        <div className="mt-4 space-y-2.5">
          {evaluated.map((row) => {
            const feasibility = FEASIBILITY_LABELS[row.feasibility];
            return (
              <div
                key={row.relation.name}
                className="report-card rounded-2xl border border-black/[0.08] bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-base font-semibold tracking-[-0.01em]">{row.relation.name}</p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${feasibilityBadgeClass(row.feasibility)}`}
                  >
                    {feasibility.label}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#9b9ba0]">
                      <Route className="mr-1 inline h-3.5 w-3.5" />
                      Strecke
                    </p>
                    <p className="mt-1 font-semibold">{formatNumber(row.distanceKm)} km</p>
                    <p className="text-xs text-[#6e6e73]">
                      Bewertung der Fahrtlänge: {row.distanceFitScore}/100
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#9b9ba0]">
                      <PlugZap className="mr-1 inline h-3.5 w-3.5" />
                      Bekannte Ladeparks
                    </p>
                    <p className="mt-1 font-semibold">
                      {row.hubsOnRoute} Ladepark{row.hubsOnRoute === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-[#6e6e73]">
                      größte Lücke ≈ {formatNumber(row.maxGapKm)} km
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#9b9ba0]">
                      <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
                      Vorteil
                    </p>
                    <p className="mt-1 font-semibold">{formatEurPerKm(row.savingPerKm)}</p>
                    <p className="text-xs text-[#6e6e73]">
                      Diesel {formatEurPerKm(row.dieselCostPerKm)} vs. E{" "}
                      {formatEurPerKm(row.electricCostPerKm)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#9b9ba0]">
                      <Truck className="mr-1 inline h-3.5 w-3.5" />
                      Pro Jahr
                    </p>
                    <p className="mt-1 font-semibold">≈ {formatEur(row.annualSavingEur)}</p>
                    <p className="text-xs text-[#6e6e73]">
                      Spanne {formatEur(row.annualSavingLowEur)}–{formatEur(row.annualSavingHighEur)} ·{" "}
                      {row.annualCo2SavedTons} t CO₂
                    </p>
                  </div>
                </div>
                {(() => {
                  const entry = (relationTrends.get(row.relation.name) || []).find(
                    (candidate) => candidate.trend,
                  );
                  if (!entry) return null;
                  return (
                    <p className="mt-1.5 text-sm text-[#6e6e73]">
                      Historischer Modelltest · 12 Monate:{" "}
                      <span className="font-semibold text-[#1d1d1f]">
                        {entry.trend!.trendPctP50 > 0 ? "+" : ""}
                        {entry.trend!.trendPctP50.toLocaleString("de-DE")} %
                      </span>{" "}
                      <span className="text-[11px]">
                        (Modellspanne {entry.trend!.trendPctP10.toLocaleString("de-DE")} % bis{" "}
                        {entry.trend!.trendPctP90 > 0 ? "+" : ""}
                        {entry.trend!.trendPctP90.toLocaleString("de-DE")} % · Zählstelle{" "}
                        {entry.station.name}, {entry.station.strasse}, Chronos-2 mit Daten bis 2023; keine aktuelle Prognose)
                      </span>
                    </p>
                  );
                })()}
                <p className="mt-1.5 text-xs leading-relaxed text-[#9b9ba0]">
                  {feasibility.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Seite 4: Annahmen, Methodik, nächste Schritte */}
      <section className="report-page">
        <h2 className="text-3xl font-semibold tracking-[-0.02em]">
          Annahmen und noch nötige Prüfungen
        </h2>

        <div className="mt-6 grid grid-cols-2 gap-6">
          <div className="rounded-2xl border border-black/[0.08] bg-white p-5">
            <h3 className="font-semibold">Kostenmodell (vereinfacht)</h3>
            <table className="mt-3 w-full text-sm">
              <tbody className="[&_td]:py-1">
                <tr>
                  <td className="text-[#6e6e73]">Diesel</td>
                  <td className="text-right">
                    {assumptions.dieselConsumptionLPer100Km} l/100 km ·{" "}
                    {formatEurPerKm(assumptions.dieselPricePerL).replace("/km", "/l")}
                  </td>
                </tr>
                <tr>
                  <td className="text-[#6e6e73]">E-Lkw-Verbrauch</td>
                  <td className="text-right">
                    {assumptions.electricConsumptionKwhPer100Km} kWh/100 km
                  </td>
                </tr>
                <tr>
                  <td className="text-[#6e6e73]">Strom Depot / öffentlich</td>
                  <td className="text-right">
                    {assumptions.depotPowerPricePerKwh.toFixed(2).replace(".", ",")} /{" "}
                    {assumptions.publicPowerPricePerKwh.toFixed(2).replace(".", ",")} €/kWh (
                    {Math.round(assumptions.publicChargeShare * 100)} % öffentlich)
                  </td>
                </tr>
                <tr>
                  <td className="text-[#6e6e73]">Mautvorteil E-Lkw</td>
                  <td className="text-right">{formatEurPerKm(assumptions.tollAdvantagePerKm)}</td>
                </tr>
                <tr>
                  <td className="text-[#6e6e73]">Erlös aus Treibhausgasquote (THG)</td>
                  <td className="text-right">
                    {assumptions.thgBonusPerKwh.toLocaleString("de-DE", { minimumFractionDigits: 2 })}{" "}
                    €/kWh (angenommen)
                  </td>
                </tr>
                <tr>
                  <td className="text-[#6e6e73]">CO₂ Diesel / Strommix</td>
                  <td className="text-right">
                    {assumptions.dieselCo2KgPerL.toLocaleString("de-DE")} kg/l ·{" "}
                    {assumptions.gridCo2KgPerKwh.toLocaleString("de-DE")} kg/kWh
                  </td>
                </tr>
                <tr>
                  <td className="text-[#6e6e73]">Reichweite E-Lkw</td>
                  <td className="text-right">{assumptions.truckRangeKm} km</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs leading-relaxed text-[#9b9ba0]">
              Energie-, Maut- und THG-Modell ohne Anschaffung, Wartung und Restwert — die
              vollständigen Fahrzeugkosten behandelt der getrennte Lkw-Kostenrechner. Der Preisvergleich variiert Diesel um ±0,15 €/l,
              öffentlicher Strom +0,10/−0,05 €/kWh, THG-Erlös 0 bis voll.
            </p>
          </div>

          <div className="rounded-2xl border border-black/[0.08] bg-white p-5">
            <h3 className="font-semibold">Was die Rechnung nicht bestätigt</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#6e6e73]">
              <li>
                Verkehr: berechnete ETISplus-Fahrten für 2010, 2019 und 2030,
                keine beobachteten Einzelfahrten
                {validation &&
                  `; mit ${validation.stationCount} Autobahn-Zählstellen aus ${validation.year} verglichen (Ähnlichkeit der Rangfolge: ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(validation.spearman)}, kein Genauigkeitswert)`}
                .
              </li>
              <li>
                Ladeparks: dokumentierte Lkw-Angebote in Betrieb aus Register und Betreiberquellen.
                Freie Plätze und Zufahrt sind nicht bestätigt.
              </li>
              <li>
                Straßenrouten: OSRM/OpenStreetMap mit Pkw-Einstellungen, kein Lkw-Nachweis.
                Ladeparksuche im Umkreis von 10 km entlang der Route. Ohne Route:
                Umfeld der Luftlinie mit 15 % der Strecke als Puffer, mindestens 20 km.
              </li>
              {trendData && (
                <li>
                  Historischer Chronos-2-Test mit Zähldaten aus 2016–2023. Der für 80 %
                  der Werte vorgesehene Modellbereich enthielt{" "}
                  {((trendData.metadata.meanCoverage80 || 0) * 100).toLocaleString("de-DE", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  % der Messwerte an {trendData.metadata.stationsBacktested} getesteten
                  Stationen. Kein durchgängiger Vorteil gegenüber dem Vorjahresvergleich,
                  keine aktuelle Prognose.
                </li>
              )}
              <li>Wie schnell der Anteil elektrischer Lkw wächst, wird in diesem Bericht nicht berechnet.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-[#1d1d1f] p-6 text-white">
          <h3 className="text-xl font-semibold tracking-[-0.02em]">Empfohlene nächste Schritte</h3>
          <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-white/80">
            <li className="flex gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#0DBBC8]" />
              Für die {totals.readyCount} rechnerisch passenden Strecken: Reichweite,
              Ladefenster und Zufahrt mit realen Touren- und Fahrzeugdaten abgleichen.
            </li>
            <li className="flex gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#0DBBC8]" />
              Laden im eigenen Depot prüfen: Netzanschluss, Fläche und Verteilung der
              Ladeleistung. Dabei unterstützt der getrennte Depot-Check.
            </li>
            <li className="flex gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#0DBBC8]" />
              Für Strecken mit großen Abständen zwischen Ladeparks: konkrete Ladestopps
              und Ausweichmöglichkeiten prüfen. Angekündigte Standorte sind noch keine
              gesicherte Ladeoption.
            </li>
          </ol>
        </div>

        <p className="mt-auto pt-6 text-center text-xs text-[#9b9ba0]">
          Streckenanalyse · Truckonomics / DepotOne · Erstellt am{" "}
          {reportDate.toLocaleDateString("de-DE")} · Alle Quellen dokumentiert und auf Anfrage
          einsehbar
        </p>
      </section>
    </div>
  );
}
