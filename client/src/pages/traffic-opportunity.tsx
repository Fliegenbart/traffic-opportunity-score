import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Building2,
  ExternalLink,
  Gauge,
  MapPin,
  PlugZap,
  Route,
  Search,
  ShieldCheck,
  TrendingUp,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  calculateTrafficOpportunityScore,
  classifyTrafficOpportunity,
  type TrafficOpportunityScore,
} from "@shared/traffic-opportunity";

interface TrafficOpportunityRegion {
  id: string;
  name: string;
  country: "DE";
  trucks2019: number;
  trucks2030: number;
  tons2030: number;
  crossBorderTrucks2030: number;
  crossBorderShare: number;
  distanceFitScore: number;
  corridorRelevanceScore: number;
  originTrucks2030: number;
  destinationTrucks2030: number;
}

interface TrafficOpportunityCorridor {
  originRegionId: string;
  originRegion: string;
  originCountry: string;
  destinationRegionId: string;
  destinationRegion: string;
  destinationCountry: string;
  totalDistanceKm: number;
  trucks2019: number;
  trucks2030: number;
  tons2030: number;
  distanceFitScore: number;
  corridorRelevanceScore: number;
  crossBorder: boolean;
}

interface CountryPair {
  originCountry: string;
  destinationCountry: string;
  trucks2019: number;
  trucks2030: number;
}

interface EdgeHotspot {
  edgeId: number;
  distanceKm: number;
  aCountry: string;
  bCountry: string;
  aLon: number;
  aLat: number;
  bLon: number;
  bLat: number;
  trucks2019: number;
  trucks2030: number;
}

interface TrafficOpportunityData {
  metadata: {
    title: string;
    source: string;
    sourceUrl: string;
    generatedAt: string;
    methodNote: string;
    knownCaveat: string;
  };
  summary: {
    flowRows: number;
    deRegionCount: number;
    deTouchTrucks2030: number;
    deTouchTons2030: number;
    distanceBuckets2030: Record<string, number>;
  };
  maxima: {
    regionTrucks2030: number;
    corridorTrucks2030: number;
    edgeTrucks2030: number;
  };
  regions: TrafficOpportunityRegion[];
  corridors: TrafficOpportunityCorridor[];
  countryPairs: CountryPair[];
  edgeHotspots: EdgeHotspot[];
}

type IconComponent = ComponentType<{ className?: string }>;

function formatNumber(value: number) {
  return new Intl.NumberFormat("de-DE").format(Math.round(value));
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("de-DE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)} %`;
}

function toSearchText(value: string) {
  const lower = value.toLowerCase();
  const umlautExpanded = lower
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
  const umlautStripped = lower
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");

  return `${lower} ${umlautExpanded} ${umlautStripped}`;
}

function growthPercent(trucks2019: number, trucks2030: number) {
  if (trucks2019 <= 0) return 0;
  return ((trucks2030 - trucks2019) / trucks2019) * 100;
}

function regionScore(
  region: TrafficOpportunityRegion,
  data: TrafficOpportunityData,
): TrafficOpportunityScore {
  return calculateTrafficOpportunityScore({
    trucks2019: region.trucks2019,
    trucks2030: region.trucks2030,
    maxTrucks2030: data.maxima.regionTrucks2030,
    distanceFitScore: region.distanceFitScore,
    corridorRelevanceScore: region.corridorRelevanceScore,
  });
}

function corridorScore(
  corridor: TrafficOpportunityCorridor,
  data: TrafficOpportunityData,
): TrafficOpportunityScore {
  return calculateTrafficOpportunityScore({
    trucks2019: corridor.trucks2019,
    trucks2030: corridor.trucks2030,
    maxTrucks2030: data.maxima.corridorTrucks2030,
    distanceFitScore: corridor.distanceFitScore,
    corridorRelevanceScore: corridor.corridorRelevanceScore,
  });
}

function ScorePill({ score }: { score: number }) {
  const classification = classifyTrafficOpportunity(score);
  const palette =
    score >= 75
      ? "bg-[#0A99A4]/12 text-[#06737b]"
      : score >= 55
        ? "bg-[#0DBBC8]/12 text-[#087f89]"
        : score >= 35
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${palette}`}>
      {classification.label}
    </span>
  );
}

function ScoreDial({ score }: { score: number }) {
  return (
    <div
      className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(#0A99A4 ${score * 3.6}deg, rgba(10,153,164,0.13) 0deg)`,
      }}
    >
      <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white shadow-sm">
        <span className="text-4xl font-semibold tracking-[-0.04em] text-[#1d1d1f]">{score}</span>
        <span className="text-xs font-medium text-[#6e6e73]">/ 100</span>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0DBBC8]/12 text-[#0A99A4]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-5 text-sm font-medium text-[#6e6e73]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[#1d1d1f]">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-[#6e6e73]">{detail}</p>
    </div>
  );
}

function ComponentBar({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f]">{label}</p>
          <p className="text-xs text-[#6e6e73]">{description}</p>
        </div>
        <span className="text-sm font-semibold text-[#0A99A4]">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[#f0f0f2]">
        <div
          className="h-full rounded-full bg-[#0A99A4]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function DepotOneMark() {
  return (
    <div className="flex items-center gap-3" aria-label="DepotOne">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#1d1d1f]">
        <Building2 className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xl font-semibold tracking-[-0.02em]">DepotOne</div>
        <div className="text-xs text-white/58">Traffic Opportunity</div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfd] px-6 text-center">
      <div>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0DBBC8]/12 text-[#0A99A4]">
          <Gauge className="h-7 w-7 animate-pulse" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Traffic-Daten werden geladen</h1>
        <p className="mt-2 max-w-md text-[#6e6e73]">
          Die App lädt die vorberechnete Deutschland-Datei. Die Rohdaten bleiben lokal und werden nicht im Browser verarbeitet.
        </p>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfd] px-6 text-center">
      <div>
        <AlertTriangle className="mx-auto h-10 w-10 text-[#0A99A4]" />
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Daten nicht gefunden</h1>
        <p className="mt-2 max-w-md text-[#6e6e73]">
          Bitte erst `python3 scripts/build_traffic_opportunity_de.py` ausführen.
        </p>
      </div>
    </div>
  );
}

export default function TrafficOpportunity() {
  const [data, setData] = useState<TrafficOpportunityData | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedRegionId, setSelectedRegionId] = useState("");

  useEffect(() => {
    document.title = "Traffic Opportunity Score - Truckonomics";
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/data/traffic-opportunity-de.json")
      .then((response) => {
        if (!response.ok) throw new Error("Traffic data missing");
        return response.json() as Promise<TrafficOpportunityData>;
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setSelectedRegionId(payload.regions[0]?.id || "");
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const scoredRegions = useMemo(() => {
    if (!data) return [];
    return data.regions
      .map((region) => ({
        region,
        score: regionScore(region, data),
      }))
      .sort((a, b) => b.score.score - a.score.score);
  }, [data]);

  const filteredRegions = useMemo(() => {
    const normalizedQuery = toSearchText(query.trim());
    if (!normalizedQuery) return scoredRegions;
    return scoredRegions.filter(({ region }) =>
      toSearchText(`${region.name} ${region.id}`).includes(normalizedQuery),
    );
  }, [query, scoredRegions]);

  const selected = useMemo(() => {
    if (!data) return null;
    return (
      scoredRegions.find(({ region }) => region.id === selectedRegionId) ||
      scoredRegions[0] ||
      null
    );
  }, [data, scoredRegions, selectedRegionId]);

  const scoredCorridors = useMemo(() => {
    if (!data) return [];
    return data.corridors
      .map((corridor) => ({ corridor, score: corridorScore(corridor, data) }))
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, 14);
  }, [data]);

  if (error) return <ErrorState />;
  if (!data || !selected) return <LoadingState />;

  const selectedClassification = classifyTrafficOpportunity(selected.score.score);
  const topPairs = data.countryPairs.slice(0, 8);
  const mediumDistance =
    (data.summary.distanceBuckets2030["150-300 km"] || 0) +
    (data.summary.distanceBuckets2030["300-600 km"] || 0);
  const mediumShare = mediumDistance / data.summary.deTouchTrucks2030;

  return (
    <div className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <header className="relative overflow-hidden bg-[#1d1d1f] text-white">
        <div
          className="absolute inset-0 opacity-80"
          style={{
            background:
              "radial-gradient(circle at 80% 16%, rgba(13,187,200,0.30), transparent 30%), radial-gradient(circle at 18% 82%, rgba(10,153,164,0.22), transparent 26%), linear-gradient(135deg, rgba(29,29,31,0.98), rgba(29,29,31,0.78))",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#fbfbfd] to-transparent" />
        <div className="relative mx-auto flex min-h-[560px] max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-12">
          <nav className="flex flex-wrap items-center justify-between gap-4">
            <DepotOneMark />
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/depot-readiness">
                <Button
                  variant="outline"
                  className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white hover:text-[#1d1d1f]"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Readiness
                </Button>
              </Link>
              <Link href="/tco">
                <Button
                  variant="outline"
                  className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white hover:text-[#1d1d1f]"
                >
                  TCO-Rechner
                </Button>
              </Link>
            </div>
          </nav>

          <div className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.02fr_0.98fr]">
            <div>
              <h1 className="max-w-4xl text-5xl font-semibold leading-[1.03] tracking-[-0.02em] sm:text-6xl lg:text-7xl">
                Traffic Opportunity Score
              </h1>
              <p className="mt-7 max-w-2xl text-xl leading-relaxed text-white/72">
                Ein erster Deutschland-Score für halböffentliches Lkw-Laden: Wo sprechen synthetische Verkehrsflüsse, Wachstum und Streckenprofile für attraktive Ladeinfrastruktur-Standorte?
              </p>
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-sm text-white/72">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0DBBC8]" />
                  Standortlogik für E.ON, Tankstellen und Autohöfe
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0DBBC8]" />
                  Quelle: Mendeley / ETISplus
                </span>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/12 bg-white/[0.08] p-5 shadow-2xl backdrop-blur">
              <div className="rounded-[1.5rem] bg-[#fbfbfd] p-5 text-[#1d1d1f]">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                  <ScoreDial score={selected.score.score} />
                  <div>
                    <ScorePill score={selected.score.score} />
                    <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
                      {selected.region.name}
                    </h2>
                    <p className="mt-3 max-w-md text-sm leading-relaxed text-[#6e6e73]">
                      {selectedClassification.description}
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-xs text-[#6e6e73]">2030 Verkehr</p>
                    <p className="mt-1 text-xl font-semibold">{formatCompact(selected.region.trucks2030)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-xs text-[#6e6e73]">Wachstum</p>
                    <p className="mt-1 text-xl font-semibold">
                      {formatPercent(selected.score.growthPercent)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-xs text-[#6e6e73]">Cross-Border-Anteil</p>
                    <p className="mt-1 text-xl font-semibold">
                      {formatPercent(selected.region.crossBorderShare * 100)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="border-y border-black/[0.06] bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-6 py-6 sm:px-8 md:grid-cols-4 lg:px-12">
          <MetricCard
            icon={Truck}
            label="DE-Touch-Verkehr 2030"
            value={formatCompact(data.summary.deTouchTrucks2030)}
            detail="Alle Flüsse mit Ursprung oder Ziel Deutschland."
          />
          <MetricCard
            icon={MapPin}
            label="Deutsche Regionen"
            value={formatNumber(data.summary.deRegionCount)}
            detail="NUTS-/ETISplus-Regionen mit verwertbarem Signal."
          />
          <MetricCard
            icon={Route}
            label="E-Lkw-Distanzfit"
            value={formatPercent(mediumShare * 100)}
            detail="Anteil 150-600 km am DE-Touch-Verkehr."
          />
          <MetricCard
            icon={BarChart3}
            label="Browser-Datensatz"
            value="106 KB"
            detail="Aus 2.8 GB Rohdaten aufbereitet."
          />
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10 sm:px-8 lg:px-12">
        <section className="grid gap-8 lg:grid-cols-[370px_1fr]">
          <aside className="h-fit rounded-[1.5rem] border border-black/[0.08] bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.02em]">Region auswählen</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#6e6e73]">
                Suche eine deutsche Region und prüfe das synthetische Ladepunkt-Potenzial.
              </p>
            </div>
            <label className="mt-5 flex min-h-11 items-center gap-3 rounded-xl border border-black/10 bg-[#fbfbfd] px-4 text-sm focus-within:border-[#0A99A4] focus-within:ring-4 focus-within:ring-[#0DBBC8]/15">
              <Search className="h-4 w-4 text-[#6e6e73]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Hamburg, Berlin, Köln..."
                className="w-full bg-transparent outline-none"
              />
            </label>
            <div className="mt-5 max-h-[520px] space-y-2 overflow-auto pr-1">
              {filteredRegions.slice(0, 35).map(({ region, score }) => (
                <button
                  key={region.id}
                  type="button"
                  onClick={() => setSelectedRegionId(region.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition ${
                    region.id === selected.region.id
                      ? "bg-[#0A99A4] text-white"
                      : "hover:bg-[#f5f5f7]"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-semibold">{region.name}</span>
                    <span
                      className={`mt-0.5 block text-xs ${
                        region.id === selected.region.id ? "text-white/70" : "text-[#6e6e73]"
                      }`}
                    >
                      {formatCompact(region.trucks2030)} Lkw 2030
                    </span>
                  </span>
                  <span className="text-lg font-semibold">{score.score}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-8">
            <div className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
                    Region-Score
                  </p>
                  <h2 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">
                    {selected.region.name}
                  </h2>
                  <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#6e6e73]">
                    Der Score bewertet nur die Verkehrschance. Für eine echte Investitionsentscheidung fehlen noch Netzanschluss, Fläche, Haltezeiten, Wettbewerb und Kundenbindung.
                  </p>
                </div>
                <div className="flex items-center gap-5">
                  <ScoreDial score={selected.score.score} />
                  <div>
                    <ScorePill score={selected.score.score} />
                    <p className="mt-3 text-sm leading-relaxed text-[#6e6e73]">
                      {selectedClassification.label}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <ComponentBar
                  label="Verkehrsmenge"
                  value={selected.score.components.volume}
                  description="Region im Vergleich zur stärksten DE-Region"
                />
                <ComponentBar
                  label="Wachstum"
                  value={selected.score.components.growth}
                  description="2030 gegen 2019, gedeckelt bei 60 %"
                />
                <ComponentBar
                  label="E-Lkw-Distanzfit"
                  value={selected.score.components.distanceFit}
                  description="Streckenlängen mit guter Lade-Logik"
                />
                <ComponentBar
                  label="Korridor-Relevanz"
                  value={selected.score.components.corridorRelevance}
                  description="Cross-Border- und Korridorsignal"
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <MetricCard
                icon={TrendingUp}
                label="Region-Wachstum"
                value={formatPercent(growthPercent(selected.region.trucks2019, selected.region.trucks2030))}
                detail={`${formatCompact(selected.region.trucks2019)} auf ${formatCompact(selected.region.trucks2030)} Lkw`}
              />
              <MetricCard
                icon={PlugZap}
                label="Cross-Border-Signal"
                value={formatCompact(selected.region.crossBorderTrucks2030)}
                detail="Berührte grenzüberschreitende Lkw-Flüsse."
              />
              <MetricCard
                icon={ShieldCheck}
                label="Methodenstatus"
                value="MVP"
                detail="Synthetisch, noch nicht mit realen Zähldaten kalibriert."
              />
            </div>
          </section>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1fr_390px]">
          <div className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
                  Top-Korridore
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">
                  Wo halböffentliches Laden zuerst interessant wirkt
                </h2>
              </div>
            </div>

            <div className="space-y-3">
              {scoredCorridors.map(({ corridor, score }, index) => (
                <div
                  key={`${corridor.originRegionId}-${corridor.destinationRegionId}-${index}`}
                  className="grid gap-4 rounded-2xl border border-black/[0.06] bg-[#fbfbfd] p-4 md:grid-cols-[64px_1fr_170px]"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-xl font-semibold text-[#0A99A4] shadow-sm">
                    {score.score}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold tracking-[-0.01em]">
                        {corridor.originRegion} ({corridor.originCountry}){" -> "}
                        {corridor.destinationRegion} ({corridor.destinationCountry})
                      </p>
                      {corridor.crossBorder && (
                        <span className="rounded-full bg-[#0DBBC8]/12 px-2.5 py-1 text-xs font-semibold text-[#087f89]">
                          Cross-Border
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[#6e6e73]">
                      {formatNumber(corridor.totalDistanceKm)} km · {formatCompact(corridor.trucks2030)} Lkw 2030 · Wachstum {formatPercent(score.growthPercent)}
                    </p>
                  </div>
                  <div className="self-center">
                    <ComponentBar
                      label="Distanzfit"
                      value={score.components.distanceFit}
                      description="Route"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-8">
            <div className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-[-0.02em]">Wichtigste DE-Länderpaare</h2>
              <div className="mt-5 space-y-3">
                {topPairs.map((pair) => (
                  <div key={`${pair.originCountry}-${pair.destinationCountry}`}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold">
                        {pair.originCountry}
                        {" -> "}
                        {pair.destinationCountry}
                      </span>
                      <span className="text-[#6e6e73]">{formatCompact(pair.trucks2030)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#f0f0f2]">
                      <div
                        className="h-full rounded-full bg-[#0A99A4]"
                        style={{
                          width: `${Math.max(
                            8,
                            Math.min(100, (pair.trucks2030 / topPairs[0].trucks2030) * 100),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-[#0A99A4]" />
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">Evidenzgrenze</h2>
                  <p className="mt-3 text-sm leading-relaxed text-[#6e6e73]">
                    Der Score ist ein Verkehrs-Potenzialscore. Er ersetzt keine Wirtschaftlichkeitsrechnung für Ladepunkte. Er ist der erste Filter, bevor Netz, Fläche, Preis, Wettbewerb und Kundenvertrag geprüft werden.
                  </p>
                  <a
                    href={data.metadata.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#0A99A4]"
                  >
                    Quelle ansehen
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
              Straßenabschnitte
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">
              Starke Hotspot-Kanten im deutschen Netz
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#6e6e73]">
              Diese Kanten sind keine fertigen Standortvorschläge. Sie zeigen, wo der modellierte Lkw-Verkehr auf Netzabschnitten besonders hoch ist.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.12em] text-[#6e6e73]">
                <tr className="border-b border-black/[0.08]">
                  <th className="py-3 pr-4">Edge</th>
                  <th className="py-3 pr-4">Länder</th>
                  <th className="py-3 pr-4">Lkw 2030</th>
                  <th className="py-3 pr-4">Wachstum</th>
                  <th className="py-3 pr-4">Koordinaten</th>
                </tr>
              </thead>
              <tbody>
                {data.edgeHotspots.slice(0, 14).map((edge) => (
                  <tr key={edge.edgeId} className="border-b border-black/[0.06] last:border-0">
                    <td className="py-4 pr-4 font-semibold">{edge.edgeId}</td>
                    <td className="py-4 pr-4">
                      {edge.aCountry}
                      {" -> "}
                      {edge.bCountry}
                    </td>
                    <td className="py-4 pr-4">{formatNumber(edge.trucks2030)}</td>
                    <td className="py-4 pr-4">
                      {formatPercent(growthPercent(edge.trucks2019, edge.trucks2030))}
                    </td>
                    <td className="py-4 pr-4 text-[#6e6e73]">
                      {edge.aLat.toFixed(3)}, {edge.aLon.toFixed(3)}
                      {" -> "}
                      {edge.bLat.toFixed(3)}, {edge.bLon.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
