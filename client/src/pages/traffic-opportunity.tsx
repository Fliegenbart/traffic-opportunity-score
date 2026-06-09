import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  ExternalLink,
  Gauge,
  MapPin,
  Route,
  Search,
  TrendingUp,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import TrafficMap from "@/components/traffic-map";
import {
  calculateTrafficOpportunityScore,
  classifyTrafficOpportunity,
  type TrafficOpportunityScore,
} from "@shared/traffic-opportunity";

interface RegionCorridorLink {
  direction: "outbound" | "inbound";
  partnerName: string;
  partnerCountry: string;
  trucks2030: number;
  distanceKm: number;
}

interface TrafficOpportunityRegion {
  id: string;
  name: string;
  country: "DE";
  lon: number;
  lat: number;
  trucks2010: number;
  trucks2019: number;
  trucks2030: number;
  tons2030: number;
  crossBorderTrucks2030: number;
  crossBorderShare: number;
  distanceFitScore: number;
  corridorRelevanceScore: number;
  originTrucks2030: number;
  destinationTrucks2030: number;
  topCorridors: RegionCorridorLink[];
}

interface TrafficOpportunityCorridor {
  originRegionId: string;
  originRegion: string;
  originCountry: string;
  destinationRegionId: string;
  destinationRegion: string;
  destinationCountry: string;
  totalDistanceKm: number;
  trucks2010: number;
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

interface EdgeFlow {
  origin: string;
  originCountry: string;
  destination: string;
  destinationCountry: string;
  trucks2030: number;
}

interface EdgeHotspot {
  edgeId: number;
  distanceKm: number;
  aLabel: string;
  bLabel: string;
  aCountry: string;
  bCountry: string;
  aLon: number;
  aLat: number;
  bLon: number;
  bLat: number;
  trucks2019: number;
  trucks2030: number;
  viaTrucks2030: number;
  topFlows: EdgeFlow[];
}

interface ValidationInfo {
  source: string;
  sourceUrl: string;
  year: number;
  stationCount: number;
  matchedEdges: number;
  spearman: number;
  pearsonLog10: number;
  methodNote: string;
}

interface TrafficOpportunityData {
  schemaVersion: number;
  metadata: {
    title: string;
    source: string;
    sourceUrl: string;
    generatedAt: string;
    rawDatasetBytes: number;
    datasetBytes: number;
    methodNote: string;
    knownCaveat: string;
    validation: ValidationInfo | null;
  };
  summary: {
    flowRows: number;
    deRegionCount: number;
    deTrucks2030: number;
    deTons2030: number;
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
  backdrop: [number, number][];
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

function edgeLabel(edge: { aLabel: string; bLabel: string }) {
  if (edge.aLabel === edge.bLabel) return `bei ${edge.aLabel}`;
  return `${edge.aLabel} – ${edge.bLabel}`;
}

function growthPercent(before: number, after: number) {
  if (before <= 0) return 0;
  return ((after - before) / before) * 100;
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

function readUrlParams() {
  if (typeof window === "undefined") {
    return { region: "", edge: null as number | null, embed: false };
  }
  const params = new URLSearchParams(window.location.search);
  const edgeRaw = params.get("strecke");
  return {
    region: params.get("region") || "",
    edge: edgeRaw && /^\d+$/.test(edgeRaw) ? Number(edgeRaw) : null,
    embed: params.get("embed") === "1",
  };
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
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0DBBC8]/12 text-[#0A99A4]">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-5 text-sm font-medium text-[#6e6e73]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[#1d1d1f]">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-[#6e6e73]">{detail}</p>
    </div>
  );
}

function ComponentBar({
  label,
  value,
  description,
  explainer,
}: {
  label: string;
  value: number;
  description: string;
  explainer: string;
}) {
  return (
    <div title={explainer}>
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
      <p className="mt-1.5 text-xs leading-relaxed text-[#9b9ba0]">{explainer}</p>
    </div>
  );
}

function TrendBars({ region }: { region: TrafficOpportunityRegion }) {
  const points = [
    { year: "2010", value: region.trucks2010 },
    { year: "2019", value: region.trucks2019 },
    { year: "2030", value: region.trucks2030 },
  ];
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div className="space-y-2">
      {points.map((point) => (
        <div key={point.year} className="flex items-center gap-3 text-sm">
          <span className="w-10 shrink-0 font-medium text-[#6e6e73]">{point.year}</span>
          <div className="h-2.5 flex-1 rounded-full bg-[#f0f0f2]">
            <div
              className="h-full rounded-full bg-[#0A99A4]"
              style={{ width: `${Math.max(3, (point.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-semibold">
            {formatCompact(point.value)}
          </span>
        </div>
      ))}
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
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Verkehrsdaten werden geladen</h1>
        <p className="mt-2 max-w-md text-[#6e6e73]">
          Die App lädt die vorberechnete Deutschland-Datei. Die Rohdaten bleiben lokal und werden
          nicht im Browser verarbeitet.
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
  const initialParams = useMemo(readUrlParams, []);
  const [data, setData] = useState<TrafficOpportunityData | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedRegionId, setSelectedRegionId] = useState(initialParams.region);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(initialParams.edge);
  const [showAllEdges, setShowAllEdges] = useState(false);
  const embed = initialParams.embed;

  useEffect(() => {
    document.title = "Traffic Opportunity Score – Truckonomics";
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
        setSelectedRegionId((current) =>
          payload.regions.some((region) => region.id === current)
            ? current
            : payload.regions[0]?.id || "",
        );
        setSelectedEdgeId((current) =>
          payload.edgeHotspots.some((edge) => edge.edgeId === current) ? current : null,
        );
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // Auswahl in die URL spiegeln, damit Regionen und Strecken teilbar sind.
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams(window.location.search);
    if (selectedRegionId && selectedRegionId !== data.regions[0]?.id) {
      params.set("region", selectedRegionId);
    } else {
      params.delete("region");
    }
    if (selectedEdgeId !== null) {
      params.set("strecke", String(selectedEdgeId));
    } else {
      params.delete("strecke");
    }
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    );
  }, [data, selectedRegionId, selectedEdgeId]);

  const scoredRegions = useMemo(() => {
    if (!data) return [];
    return data.regions
      .map((region) => ({
        region,
        score: regionScore(region, data),
      }))
      .sort((a, b) => b.score.score - a.score.score);
  }, [data]);

  const regionRank = useMemo(() => {
    const ranks = new Map<string, number>();
    scoredRegions.forEach(({ region }, index) => ranks.set(region.id, index + 1));
    return ranks;
  }, [scoredRegions]);

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

  const mapRegions = useMemo(
    () =>
      scoredRegions.slice(0, 40).map(({ region, score }) => ({
        id: region.id,
        name: region.name,
        lon: region.lon,
        lat: region.lat,
        trucks2030: region.trucks2030,
        score: score.score,
      })),
    [scoredRegions],
  );

  const mapEdges = useMemo(
    () =>
      (data?.edgeHotspots || []).map((edge) => ({
        edgeId: edge.edgeId,
        label: edgeLabel(edge),
        aLon: edge.aLon,
        aLat: edge.aLat,
        bLon: edge.bLon,
        bLat: edge.bLat,
        trucks2030: edge.trucks2030,
      })),
    [data],
  );

  if (error) return <ErrorState />;
  if (!data || !selected) return <LoadingState />;

  const selectedClassification = classifyTrafficOpportunity(selected.score.score);
  const selectedRank = regionRank.get(selected.region.id) || 0;
  const topPairs = data.countryPairs.slice(0, 8);
  const mediumDistance =
    (data.summary.distanceBuckets2030["150-300 km"] || 0) +
    (data.summary.distanceBuckets2030["300-600 km"] || 0);
  const mediumShare = mediumDistance / data.summary.deTrucks2030;
  const visibleEdges = showAllEdges ? data.edgeHotspots : data.edgeHotspots.slice(0, 12);
  const validation = data.metadata.validation;
  const datasetKb = Math.max(1, Math.round(data.metadata.datasetBytes / 1024));
  const rawGb = data.metadata.rawDatasetBytes / 1024 ** 3;

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
        <div className="relative mx-auto flex max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-12">
          {!embed && (
            <nav className="flex flex-wrap items-center justify-between gap-4">
              <DepotOneMark />
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/depot-readiness">
                  <Button
                    variant="outline"
                    className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white hover:text-[#1d1d1f]"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Readiness Check
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
          )}

          <div className="grid items-center gap-10 py-12 lg:grid-cols-[0.95fr_1.05fr] lg:py-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0DBBC8]">
                Traffic Opportunity Score
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-5xl lg:text-6xl">
                Lkw-Laden entscheidet sich an Strecken, nicht an Landkreisen.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/72 sm:text-xl">
                Wo bündelt sich der Lkw-Verkehr 2030 auf deutschen Straßen? Diese Analyse zeigt die
                stärksten Streckenabschnitte, Korridore und Quell-/Zielregionen für
                halböffentliches Lkw-Laden – auf Basis modellierter Verkehrsflüsse, gegen reale
                Zähldaten geprüft.
              </p>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-sm text-white/72">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0DBBC8]" />
                  Standortlogik für E.ON, Tankstellen und Autohöfe
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0DBBC8]" />
                  Quelle: Mendeley / ETISplus
                </span>
                {validation && (
                  <span className="inline-flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-[#0DBBC8]" />
                    Gegen {validation.stationCount} BASt-Zählstellen geprüft
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/12 bg-white/[0.08] p-4 shadow-2xl backdrop-blur sm:p-5">
              <div className="rounded-[1.5rem] bg-[#fbfbfd] p-4 text-[#1d1d1f] sm:p-5">
                <TrafficMap
                  backdrop={data.backdrop}
                  edges={mapEdges}
                  regions={mapRegions}
                  selectedRegionId={selected.region.id}
                  selectedEdgeId={selectedEdgeId}
                  onSelectRegion={(id) => setSelectedRegionId(id)}
                  onSelectEdge={(id) =>
                    setSelectedEdgeId((current) => (current === id ? null : id))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="border-y border-black/[0.06] bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-6 py-6 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:px-12">
          <MetricCard
            icon={Truck}
            label="Lkw-Fahrten mit DE-Bezug 2030"
            value={formatCompact(data.summary.deTrucks2030)}
            detail="Alle modellierten Fahrten mit Start oder Ziel in Deutschland."
          />
          <MetricCard
            icon={MapPin}
            label="Deutsche Regionen"
            value={formatNumber(data.summary.deRegionCount)}
            detail="NUTS-3-Regionen mit verwertbarem Verkehrssignal."
          />
          <MetricCard
            icon={Route}
            label="E-Lkw-Distanzfit"
            value={formatPercent(mediumShare * 100)}
            detail="Anteil der 150–600-km-Strecken: ideale Länge für öffentliches Laden."
          />
          <MetricCard
            icon={BarChart3}
            label="Browser-Datensatz"
            value={`${datasetKb} KB`}
            detail={`Aus ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(rawGb)} GB Rohdaten aufbereitet.`}
          />
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10 sm:px-8 lg:px-12">
        <section className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
              Strecken-Hotspots
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">
              Die stärksten Streckenabschnitte im deutschen Netz
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#6e6e73]">
              Hier verdichtet sich der Lkw-Verkehr – das sind die Suchräume für konkrete
              Ladestandorte. Jeder Abschnitt zeigt, welche Verbindungen ihn am stärksten nutzen.
              Klick auf eine Karte markiert die Strecke oben in der Übersicht.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {visibleEdges.map((edge) => {
              const isSelected = edge.edgeId === selectedEdgeId;
              const crossBorder = edge.aCountry !== edge.bCountry;
              return (
                <button
                  key={edge.edgeId}
                  type="button"
                  onClick={() =>
                    setSelectedEdgeId((current) =>
                      current === edge.edgeId ? null : edge.edgeId,
                    )
                  }
                  className={`rounded-2xl border p-5 text-left transition ${
                    isSelected
                      ? "border-[#0A99A4] bg-[#0A99A4]/[0.06] ring-2 ring-[#0DBBC8]/25"
                      : "border-black/[0.06] bg-[#fbfbfd] hover:border-[#0A99A4]/40"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold tracking-[-0.01em]">{edgeLabel(edge)}</p>
                    {crossBorder && (
                      <span className="rounded-full bg-[#0DBBC8]/12 px-2.5 py-1 text-xs font-semibold text-[#087f89]">
                        Grenzraum {edge.aCountry}/{edge.bCountry}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-[#6e6e73]">
                    <span className="font-semibold text-[#1d1d1f]">
                      ≈ {formatNumber(edge.trucks2030 / 365)} Lkw/Tag 2030
                    </span>
                    <span>
                      Wachstum {formatPercent(growthPercent(edge.trucks2019, edge.trucks2030))}
                    </span>
                    <span>{formatNumber(edge.distanceKm)} km Abschnitt</span>
                  </div>
                  {edge.topFlows.length > 0 && (
                    <p className="mt-3 text-xs leading-relaxed text-[#9b9ba0]">
                      Stärkste Verbindungen:{" "}
                      {edge.topFlows
                        .map(
                          (flow) =>
                            `${flow.origin}${flow.originCountry !== "DE" ? ` (${flow.originCountry})` : ""} → ${flow.destination}${flow.destinationCountry !== "DE" ? ` (${flow.destinationCountry})` : ""}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex justify-center">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setShowAllEdges((value) => !value)}
            >
              {showAllEdges
                ? "Weniger anzeigen"
                : `Alle ${data.edgeHotspots.length} Streckenabschnitte anzeigen`}
            </Button>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1fr_390px]">
          <div className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
                Top-Korridore
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">
                Verbindungen mit dem größten Ladepotenzial
              </h2>
            </div>

            <div className="space-y-3">
              {scoredCorridors.map(({ corridor, score }, index) => (
                <div
                  key={`${corridor.originRegionId}-${corridor.destinationRegionId}-${index}`}
                  className="grid gap-4 rounded-2xl border border-black/[0.06] bg-[#fbfbfd] p-4 sm:grid-cols-[64px_1fr] md:grid-cols-[64px_1fr_170px]"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-xl font-semibold text-[#0A99A4] shadow-sm">
                    {score.score}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold tracking-[-0.01em]">
                        {corridor.originRegion}
                        {corridor.originCountry !== "DE" && ` (${corridor.originCountry})`}
                        {" → "}
                        {corridor.destinationRegion}
                        {corridor.destinationCountry !== "DE" &&
                          ` (${corridor.destinationCountry})`}
                      </p>
                      {corridor.crossBorder && (
                        <span className="rounded-full bg-[#0DBBC8]/12 px-2.5 py-1 text-xs font-semibold text-[#087f89]">
                          Grenzüberschreitend
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[#6e6e73]">
                      {formatNumber(corridor.totalDistanceKm)} km ·{" "}
                      {formatCompact(corridor.trucks2030)} Lkw 2030 · Wachstum{" "}
                      {formatPercent(score.growthPercent)}
                    </p>
                  </div>
                  <div className="self-center sm:col-start-2 md:col-start-3">
                    <ComponentBar
                      label="Distanzfit"
                      value={score.components.distanceFit}
                      description="Streckenlänge"
                      explainer={`${formatNumber(corridor.totalDistanceKm)} km – Strecken zwischen 150 und 600 km passen am besten zu öffentlichem E-Lkw-Laden.`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-8">
            <div className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-[-0.02em]">
                Wichtigste Länderverbindungen
              </h2>
              <div className="mt-5 space-y-3">
                {topPairs.map((pair) => (
                  <div key={`${pair.originCountry}-${pair.destinationCountry}`}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold">
                        {pair.originCountry}
                        {" → "}
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
                    Der Score bewertet Verkehrspotenzial, keine Wirtschaftlichkeit. Er ist der
                    erste Filter, bevor Netzanschluss, Fläche, Haltezeiten, Wettbewerb und
                    Kundenverträge geprüft werden. Der E-Lkw-Hochlauf selbst ist nicht modelliert
                    – der Score zeigt, wo Verkehr ist, nicht wie schnell er elektrisch wird.
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-[#6e6e73]">
                    {data.metadata.knownCaveat}
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

            {validation && (
              <div className="rounded-[1.5rem] border border-[#0A99A4]/25 bg-[#0A99A4]/[0.05] p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-[#0A99A4]" />
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.02em]">
                      Mit realen Zähldaten geprüft
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-[#6e6e73]">
                      Die modellierten Streckenwerte korrelieren mit den Schwerverkehrsmessungen
                      von {validation.stationCount} BASt-Autobahn-Dauerzählstellen (
                      {validation.year}): Rangkorrelation{" "}
                      <strong className="text-[#1d1d1f]">
                        {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
                          validation.spearman,
                        )}
                      </strong>{" "}
                      über {validation.matchedEdges} abgeglichene Streckenabschnitte.
                    </p>
                    <p className="mt-3 text-xs leading-relaxed text-[#9b9ba0]">
                      {validation.methodNote}
                    </p>
                    <a
                      href={validation.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#0A99A4]"
                    >
                      BASt-Zählstellen ansehen
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </section>

        <section className="grid gap-8 lg:grid-cols-[370px_1fr]">
          <aside className="h-fit rounded-[1.5rem] border border-black/[0.08] bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.02em]">Region auswählen</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#6e6e73]">
                Quell- und Zielregionen zeigen, wo Verkehr entsteht – die Strecken-Hotspots oben
                zeigen, wo er sich bündelt.
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
                      Platz {regionRank.get(region.id)} · {formatCompact(region.trucks2030)} Lkw
                      2030
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
                    Region im Detail
                  </p>
                  <h2 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">
                    {selected.region.name}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-[#0A99A4]">
                    Platz {selectedRank} von {scoredRegions.length} Regionen
                  </p>
                  <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#6e6e73]">
                    {selectedClassification.description}
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
                  description="Im Vergleich zur stärksten DE-Region"
                  explainer={`${formatCompact(selected.region.trucks2030)} Lkw-Fahrten 2030; Wurzelskala, damit eine einzelne Top-Region (Hamburg) die übrigen nicht verzerrt.`}
                />
                <ComponentBar
                  label="Wachstum"
                  value={selected.score.components.growth}
                  description="2030 gegenüber 2019, gedeckelt bei 60 %"
                  explainer={`${formatPercent(selected.score.growthPercent)} mehr Lkw-Fahrten als 2019 – das ist Gesamt-Lkw-Wachstum, nicht der E-Lkw-Hochlauf.`}
                />
                <ComponentBar
                  label="E-Lkw-Distanzfit"
                  value={selected.score.components.distanceFit}
                  description="Streckenlängen mit guter Lade-Logik"
                  explainer="Verkehrsgewichteter Anteil der Strecken im 150–600-km-Fenster: lang genug für Ladebedarf unterwegs, kurz genug für Tagespendel."
                />
                <ComponentBar
                  label="Korridor-Relevanz"
                  value={selected.score.components.corridorRelevance}
                  description="Grenzüberschreitendes Verkehrssignal"
                  explainer={`${formatPercent(selected.region.crossBorderShare * 100)} des Verkehrs überquert die Grenze (${formatCompact(selected.region.crossBorderTrucks2030)} Fahrten) – internationale Flotten laden eher öffentlich.`}
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0DBBC8]/12 text-[#0A99A4]">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <p className="mt-5 text-sm font-medium text-[#6e6e73]">
                  Verkehrstrend (Lkw-Fahrten pro Jahr)
                </p>
                <div className="mt-4">
                  <TrendBars region={selected.region} />
                </div>
              </div>

              <div className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0DBBC8]/12 text-[#0A99A4]">
                  <Route className="h-5 w-5" />
                </div>
                <p className="mt-5 text-sm font-medium text-[#6e6e73]">
                  Stärkste Verbindungen dieser Region
                </p>
                <div className="mt-4 space-y-2.5">
                  {selected.region.topCorridors.map((link, index) => (
                    <div
                      key={`${link.partnerName}-${link.direction}-${index}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        {link.direction === "outbound" ? (
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#0A99A4]" />
                        ) : (
                          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-[#0A99A4]" />
                        )}
                        <span className="font-medium">
                          {link.partnerName}
                          {link.partnerCountry !== "DE" && ` (${link.partnerCountry})`}
                        </span>
                        <span className="text-xs text-[#9b9ba0]">{link.distanceKm} km</span>
                      </span>
                      <span className="shrink-0 text-[#6e6e73]">
                        {formatCompact(link.trucks2030)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </section>

        {!embed && (
          <section className="rounded-[2rem] bg-[#1d1d1f] p-8 text-white sm:p-12">
            <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
              <div>
                <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                  Region sieht gut aus? Dann prüfe als Nächstes dein Depot.
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
                  Der Traffic Opportunity Score zeigt das Verkehrspotenzial. Der DepotOne Readiness
                  Check bewertet, wie bereit ein konkreter Standort für die Elektrifizierung ist –
                  Netzanschluss, Fläche, Fuhrpark.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/depot-readiness">
                  <Button className="rounded-full bg-[#0A99A4] px-6 text-white hover:bg-[#06737b]">
                    Readiness Check starten
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/tco">
                  <Button
                    variant="outline"
                    className="rounded-full border-white/25 bg-white/10 px-6 text-white hover:bg-white hover:text-[#1d1d1f]"
                  >
                    TCO-Rechner öffnen
                  </Button>
                </Link>
              </div>
            </div>
          </section>
        )}

        <footer className="pb-6 text-center text-xs text-[#9b9ba0]">
          Datenstand:{" "}
          {new Date(data.metadata.generatedAt).toLocaleDateString("de-DE", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          · {data.metadata.source} · {formatNumber(data.summary.flowRows)} ausgewertete
          Verkehrsbeziehungen
        </footer>
      </main>
    </div>
  );
}
