import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  ExternalLink,
  Gauge,
  PlugZap,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import TrafficMap, {
  type MapCharger,
  type MapPin,
  type MapRoute,
} from "@/components/traffic-map";
import {
  REVENUE_ASSUMPTIONS,
  assessSite,
  estimateSiteRevenue,
  type SiteSignal,
} from "@shared/standort-check";
import {
  calculateTrafficOpportunityScore,
  classifyTrafficOpportunity,
  type TrafficOpportunityScore,
} from "@shared/traffic-opportunity";
import { corridorChargingStats, distanceKm } from "@shared/geo";

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
  originLon: number;
  originLat: number;
  destinationRegionId: string;
  destinationRegion: string;
  destinationCountry: string;
  destinationLon: number;
  destinationLat: number;
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

interface ChargingHub {
  id: string;
  name: string;
  operator: string;
  type: "mcs" | "hpc";
  status: "live" | "announced";
  lon: number;
  lat: number;
  chargePoints: number;
  maxKw: number;
  source: string;
  coordsApprox: boolean;
}

interface ChargingData {
  schemaVersion: number;
  metadata: {
    generatedAt: string;
    bnetzaDataDate: string;
    sources: string[];
    methodNote: string;
  };
  verified: ChargingHub[];
  proxy: { lon: number; lat: number; chargePoints: number; maxKw: number }[];
}

interface EdgeTrend {
  station: {
    zst: string;
    name: string;
    strasse: string;
    distanceKm: number;
    directionShareR1?: number | null;
  };
  profile: Record<"werktag" | "samstag" | "sonntag", number[]> | null;
  trend: {
    lastYearWeeklyAvg: number;
    trendPctP10: number;
    trendPctP50: number;
    trendPctP90: number;
    contextWeeks: number;
  } | null;
  backtest: {
    maeChronos: number;
    maeNaive: number;
    skill: number | null;
    coverage80: number;
    holdoutWeeks: number;
  } | null;
}

interface TrendData {
  schemaVersion: number;
  metadata: {
    model: string;
    horizonWeeks: number;
    stationsBacktested: number;
    medianSkillVsSeasonalNaive: number | null;
    stationsBeatingNaive: number;
    meanCoverage80: number | null;
    source: string;
    sourceUrl: string;
    methodNote: string;
  };
  edges: Record<string, EdgeTrend>;
}

const WHITE_SPOT_KM = 25;

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

type WorkspaceTab = "strecken" | "korridore" | "regionen" | "standort";

interface SitePin {
  id: string;
  lon: number;
  lat: number;
  label: string;
}

const MAX_PINS = 3;

function parsePins(raw: string): SitePin[] {
  return raw
    .split(";")
    .map((part, index) => {
      const [lon, lat] = part.split(",").map(Number);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      if (lon < 5 || lon > 16 || lat < 47 || lat > 56) return null;
      return { id: `pin-${index}`, lon, lat, label: "" };
    })
    .filter((pin): pin is SitePin => pin !== null)
    .slice(0, MAX_PINS);
}

function signalBadgeClass(signal: SiteSignal) {
  if (signal === "stark") return "bg-[#0DBBC8]/15 text-[#5fd9e2]";
  if (signal === "gut") return "bg-[#0DBBC8]/10 text-[#4fc3cd]";
  if (signal === "pruefen") return "bg-[#e8a13a]/15 text-[#e8a13a]";
  return "bg-white/10 text-white/60";
}

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

function shortName(name: string) {
  return name.split(",")[0].trim();
}

function corridorKey(corridor: TrafficOpportunityCorridor) {
  return `${corridor.originRegionId}-${corridor.destinationRegionId}`;
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
    return {
      region: "",
      edge: null as number | null,
      korridor: "",
      pins: [] as SitePin[],
      tab: "" as WorkspaceTab | "",
      embed: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const edgeRaw = params.get("strecke");
  const tabRaw = params.get("tab");
  const tab: WorkspaceTab | "" =
    tabRaw === "strecken" ||
    tabRaw === "korridore" ||
    tabRaw === "regionen" ||
    tabRaw === "standort"
      ? tabRaw
      : "";
  return {
    region: params.get("region") || "",
    edge: edgeRaw && /^\d+$/.test(edgeRaw) ? Number(edgeRaw) : null,
    korridor: params.get("korridor") || "",
    pins: parsePins(params.get("standorte") || ""),
    tab,
    embed: params.get("embed") === "1",
  };
}

function ScorePill({ score }: { score: number }) {
  const classification = classifyTrafficOpportunity(score);
  const palette =
    score >= 75
      ? "bg-[#0DBBC8]/15 text-[#5fd9e2]"
      : score >= 55
        ? "bg-[#0DBBC8]/10 text-[#4fc3cd]"
        : score >= 35
          ? "bg-[#e8a13a]/15 text-[#e8a13a]"
          : "bg-white/10 text-white/60";

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${palette}`}>
      {classification.label}
    </span>
  );
}

function ScoreDial({ score }: { score: number }) {
  return (
    <div
      className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(#0DBBC8 ${score * 3.6}deg, rgba(13,187,200,0.12) 0deg)`,
      }}
    >
      <div className="flex h-[5.4rem] w-[5.4rem] flex-col items-center justify-center rounded-full bg-[#1b1d23]">
        <span className="text-3xl font-bold tracking-[-0.04em] text-white">{score}</span>
        <span className="text-[10px] font-medium text-white/45">/ 100</span>
      </div>
    </div>
  );
}

function ComponentBar({
  label,
  value,
  explainer,
}: {
  label: string;
  value: number;
  explainer?: string;
}) {
  return (
    <div title={explainer}>
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-white">{label}</p>
        <span className="text-sm font-semibold text-[#0DBBC8] tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[#0DBBC8]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      {explainer && (
        <p className="mt-1.5 text-xs leading-relaxed text-white/40">{explainer}</p>
      )}
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
          <span className="w-10 shrink-0 font-medium text-white/45">{point.year}</span>
          <div className="h-2 flex-1 rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#0DBBC8]"
              style={{ width: `${Math.max(3, (point.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-semibold text-white tabular-nums">
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
    <div className="flex min-h-screen items-center justify-center bg-[#141519] px-6 text-center text-white">
      <div>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0DBBC8]/15 text-[#0DBBC8]">
          <Gauge className="h-7 w-7 animate-pulse" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
          Verkehrsdaten werden geladen
        </h1>
        <p className="mt-2 max-w-md text-white/55">
          Die App lädt die vorberechnete Deutschland-Datei. Die Rohdaten bleiben lokal und werden
          nicht im Browser verarbeitet.
        </p>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#141519] px-6 text-center text-white">
      <div>
        <AlertTriangle className="mx-auto h-10 w-10 text-[#0DBBC8]" />
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Daten nicht gefunden</h1>
        <p className="mt-2 max-w-md text-white/55">
          Bitte erst `python3 scripts/build_traffic_opportunity_de.py` ausführen.
        </p>
      </div>
    </div>
  );
}

function DetailStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-[-0.01em] text-white tabular-nums">{value}</p>
      {sub && <p className="text-xs text-white/45">{sub}</p>}
    </div>
  );
}

export default function TrafficOpportunity() {
  const initialParams = useMemo(readUrlParams, []);
  const [data, setData] = useState<TrafficOpportunityData | null>(null);
  const [charging, setCharging] = useState<ChargingData | null>(null);
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [substations, setSubstations] = useState<[number, number, number][]>([]);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedRegionId, setSelectedRegionId] = useState(initialParams.region);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(initialParams.edge);
  const [selectedCorridorKey, setSelectedCorridorKey] = useState(initialParams.korridor);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
    if (initialParams.tab) return initialParams.tab;
    if (initialParams.pins.length > 0) return "standort";
    if (initialParams.region) return "regionen";
    if (initialParams.korridor) return "korridore";
    return "strecken";
  });
  const [onlyWhiteSpots, setOnlyWhiteSpots] = useState(false);
  const [pins, setPins] = useState<SitePin[]>(initialParams.pins);
  const [activePinId, setActivePinId] = useState<string>(initialParams.pins[0]?.id || "");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [lead, setLead] = useState({ name: "", email: "", company: "" });
  const [leadStatus, setLeadStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
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

    // Ladepark- und Trend-Layer sind optional: Ohne die Dateien läuft die Seite ohne sie.
    fetch("/data/truck-charging-de.json")
      .then((response) => (response.ok ? (response.json() as Promise<ChargingData>) : null))
      .then((payload) => {
        if (active && payload) setCharging(payload);
      })
      .catch(() => undefined);

    fetch("/data/traffic-trend-de.json")
      .then((response) => (response.ok ? (response.json() as Promise<TrendData>) : null))
      .then((payload) => {
        if (active && payload) setTrendData(payload);
      })
      .catch(() => undefined);

    fetch("/data/substations-de.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { points: [number, number, number][] } | null) => {
        if (active && payload) setSubstations(payload.points);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  // Auswahl in die URL spiegeln, damit Tabs, Regionen und Strecken teilbar sind.
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
    if (selectedCorridorKey) {
      params.set("korridor", selectedCorridorKey);
    } else {
      params.delete("korridor");
    }
    if (pins.length > 0) {
      params.set(
        "standorte",
        pins.map((pin) => `${pin.lon},${pin.lat}`).join(";"),
      );
    } else {
      params.delete("standorte");
    }
    if (activeTab !== "strecken") {
      params.set("tab", activeTab);
    } else {
      params.delete("tab");
    }
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    );
  }, [data, selectedRegionId, selectedEdgeId, selectedCorridorKey, activeTab, pins]);

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

  const selectedCorridor = useMemo(
    () =>
      scoredCorridors.find(({ corridor }) => corridorKey(corridor) === selectedCorridorKey) ||
      null,
    [scoredCorridors, selectedCorridorKey],
  );

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

  const liveHubs = useMemo(
    () => (charging?.verified || []).filter((hub) => hub.status === "live"),
    [charging],
  );

  // Pro Hotspot-Kante: nächster Lkw-Ladepark in Betrieb (Luftlinie ab Mitte).
  const edgeCharging = useMemo(() => {
    const result = new Map<number, { name: string; km: number; whiteSpot: boolean }>();
    if (!data || liveHubs.length === 0) return result;
    for (const edge of data.edgeHotspots) {
      const mid = { lon: (edge.aLon + edge.bLon) / 2, lat: (edge.aLat + edge.bLat) / 2 };
      let bestKm = Infinity;
      let bestName = "";
      for (const hub of liveHubs) {
        const km = distanceKm(mid, hub);
        if (km < bestKm) {
          bestKm = km;
          bestName = hub.name;
        }
      }
      result.set(edge.edgeId, {
        name: bestName,
        km: Math.round(bestKm),
        whiteSpot: bestKm > WHITE_SPOT_KM,
      });
    }
    return result;
  }, [data, liveHubs]);

  const whiteSpotCount = useMemo(() => {
    let count = 0;
    edgeCharging.forEach((entry) => {
      if (entry.whiteSpot) count += 1;
    });
    return count;
  }, [edgeCharging]);

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
        whiteSpot: edgeCharging.get(edge.edgeId)?.whiteSpot ?? false,
      })),
    [data, edgeCharging],
  );

  // Der ausgewählte Korridor erscheint als gestrichelte Route auf der Karte.
  const mapRoutes = useMemo<MapRoute[]>(() => {
    if (activeTab !== "korridore" || !selectedCorridor) return [];
    const { corridor } = selectedCorridor;
    if (corridor.originLon === 0 || corridor.destinationLon === 0) return [];
    return [
      {
        label: `${corridor.originRegion} → ${corridor.destinationRegion}`,
        aLabel: shortName(corridor.originRegion),
        bLabel: shortName(corridor.destinationRegion),
        aLon: corridor.originLon,
        aLat: corridor.originLat,
        bLon: corridor.destinationLon,
        bLat: corridor.destinationLat,
      },
    ];
  }, [activeTab, selectedCorridor]);

  const selectedEdge = useMemo(
    () => data?.edgeHotspots.find((edge) => edge.edgeId === selectedEdgeId) || null,
    [data, selectedEdgeId],
  );

  const visibleEdgeList = useMemo(() => {
    const edges = data?.edgeHotspots || [];
    if (!onlyWhiteSpots) return edges;
    return edges.filter((edge) => edgeCharging.get(edge.edgeId)?.whiteSpot);
  }, [data, onlyWhiteSpots, edgeCharging]);

  const siteRegions = useMemo(
    () =>
      scoredRegions.map(({ region, score }, index) => ({
        id: region.id,
        name: region.name,
        lon: region.lon,
        lat: region.lat,
        score: score.score,
        rank: index + 1,
      })),
    [scoredRegions],
  );

  const assessments = useMemo(() => {
    const result = new Map<string, ReturnType<typeof assessSite>>();
    for (const pin of pins) {
      result.set(pin.id, assessSite(pin, mapEdges, liveHubs, siteRegions, substations));
    }
    return result;
  }, [pins, mapEdges, liveHubs, siteRegions, substations]);

  const addPin = (lon: number, lat: number, label = "") => {
    setPins((current) => {
      const pin: SitePin = { id: `pin-${Date.now()}`, lon, lat, label };
      setActivePinId(pin.id);
      return [...current, pin].slice(-MAX_PINS);
    });
    setLeadStatus("idle");
  };

  const searchPlace = async () => {
    const query = placeQuery.trim();
    if (!query || placeSearching) return;
    setPlaceSearching(true);
    setPlaceError("");
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
      );
      const results = (await response.json()) as { lat: string; lon: string; display_name: string }[];
      if (!results.length) {
        setPlaceError("Ort nicht gefunden — bitte präziser eingeben.");
        return;
      }
      const hit = results[0];
      addPin(
        Math.round(Number(hit.lon) * 10000) / 10000,
        Math.round(Number(hit.lat) * 10000) / 10000,
        hit.display_name.split(",").slice(0, 2).join(", "),
      );
      setPlaceQuery("");
    } catch {
      setPlaceError("Suche nicht erreichbar — bitte direkt auf die Karte klicken.");
    } finally {
      setPlaceSearching(false);
    }
  };

  const submitLead = async () => {
    if (!lead.name.trim() || !lead.email.trim() || leadStatus === "sending") return;
    setLeadStatus("sending");
    try {
      const summary = pins
        .map((pin, index) => {
          const a = assessments.get(pin.id);
          return `Standort ${index + 1} (${pin.label || `${pin.lat}, ${pin.lon}`}): ${a?.label || "?"} — ${a?.reasons.join(" ") || ""}`;
        })
        .join("\n");
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: "standort-check",
          url: window.location.href,
          contact: {
            name: lead.name.trim(),
            email: lead.email.trim(),
            company: lead.company.trim() || undefined,
            message: `Standort-Check-Anfrage:\n${summary}`,
          },
          inputs: { pins, assessments: pins.map((pin) => assessments.get(pin.id)) },
        }),
      });
      setLeadStatus(response.ok ? "sent" : "error");
    } catch {
      setLeadStatus("error");
    }
  };

  if (error) return <ErrorState />;
  if (!data || !selected) return <LoadingState />;

  const selectedClassification = classifyTrafficOpportunity(selected.score.score);
  const selectedRank = regionRank.get(selected.region.id) || 0;
  const mediumDistance =
    (data.summary.distanceBuckets2030["150-300 km"] || 0) +
    (data.summary.distanceBuckets2030["300-600 km"] || 0);
  const mediumShare = mediumDistance / data.summary.deTrucks2030;
  const validation = data.metadata.validation;

  const tabs: { id: WorkspaceTab; label: string }[] = [
    { id: "strecken", label: "Strecken" },
    { id: "korridore", label: "Korridore" },
    { id: "regionen", label: "Regionen" },
    { id: "standort", label: "Standort-Check" },
  ];

  const mapPins: MapPin[] = pins.map((pin, index) => ({
    id: pin.id,
    lon: pin.lon,
    lat: pin.lat,
    index: index + 1,
    active: pin.id === activePinId,
  }));
  const activePin = pins.find((pin) => pin.id === activePinId) || pins[0] || null;
  const activeAssessment = activePin ? assessments.get(activePin.id) : undefined;
  const activePinTrend = activeAssessment?.edge
    ? trendData?.edges[String(activeAssessment.edge.edgeId)]
    : undefined;

  const selectedEdgeCharging = selectedEdge ? edgeCharging.get(selectedEdge.edgeId) : undefined;
  const selectedEdgeTrend = selectedEdge
    ? trendData?.edges[String(selectedEdge.edgeId)]
    : undefined;

  const corridorStats = (() => {
    if (!selectedCorridor || liveHubs.length === 0) return null;
    const { corridor } = selectedCorridor;
    if (corridor.originLon === 0 || corridor.destinationLon === 0) return null;
    const straightKm = distanceKm(
      { lon: corridor.originLon, lat: corridor.originLat },
      { lon: corridor.destinationLon, lat: corridor.destinationLat },
    );
    if (straightKm < 150) return null;
    return corridorChargingStats(
      { lon: corridor.originLon, lat: corridor.originLat },
      { lon: corridor.destinationLon, lat: corridor.destinationLat },
      liveHubs,
      Math.max(20, straightKm * 0.15),
    );
  })();

  return (
    <div className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="relative overflow-hidden bg-[#141519] text-white">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 45% at 72% 30%, rgba(13,187,200,0.09), transparent 70%), radial-gradient(ellipse 40% 35% at 15% 85%, rgba(124,58,237,0.05), transparent 70%)",
          }}
        />
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

          {/* Hero: kompakt — die Arbeit passiert direkt darunter im Workspace. */}
          <div className="grid gap-x-12 gap-y-6 py-10 lg:grid-cols-[7fr_5fr] lg:items-end lg:py-12">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0DBBC8]">
                Traffic Opportunity Score · Deutschland
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-[1.04] tracking-[-0.025em] sm:text-5xl">
                Lkw-Laden entscheidet sich an Strecken, nicht an Landkreisen.
              </h1>
            </div>
            <p className="max-w-xl text-base leading-relaxed text-white/60 lg:pb-1">
              Die Karte zeigt, wo sich der Lkw-Verkehr 2030 bündelt – und wo entlang der
              stärksten Abschnitte noch kein Lkw-Ladepark steht. Türkis ist Verkehr.{" "}
              <span className="font-semibold text-[#e8a13a]">Amber ist Gelegenheit.</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-white/10 py-6 lg:grid-cols-4">
            <div>
              <p className="text-2xl font-bold tracking-[-0.02em] tabular-nums sm:text-3xl">
                {formatCompact(data.summary.deTrucks2030)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/45">
                Lkw-Fahrten mit DE-Bezug 2030
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-[-0.02em] tabular-nums sm:text-3xl">
                {charging ? (
                  <>
                    {whiteSpotCount}
                    <span className="text-white/40"> / {data.edgeHotspots.length}</span>
                  </>
                ) : (
                  formatNumber(data.summary.deRegionCount)
                )}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/45">
                {charging
                  ? `Hotspots ohne Lkw-Ladepark (${WHITE_SPOT_KM} km)`
                  : "Deutsche Regionen"}
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-[-0.02em] tabular-nums sm:text-3xl">
                {validation
                  ? new Intl.NumberFormat("de-DE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }).format(validation.spearman)
                  : formatNumber(data.summary.deRegionCount)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/45">
                {validation
                  ? `Korrelation mit ${validation.stationCount} BASt-Zählstellen`
                  : "Deutsche Regionen"}
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-[-0.02em] tabular-nums sm:text-3xl">
                {formatPercent(mediumShare * 100)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/45">
                Verkehr im E-Lkw-Fenster 150–600 km
              </p>
            </div>
          </div>

          {/* Workspace: Karte bleibt stehen, der Inhalt bewegt sich. */}
          <div className="grid gap-8 pb-12 pt-4 lg:grid-cols-[7fr_5fr]">
            <div className="self-start lg:sticky lg:top-6">
              <TrafficMap
                backdrop={data.backdrop}
                edges={mapEdges}
                regions={mapRegions}
                chargers={mapChargers}
                routes={mapRoutes}
                pins={mapPins}
                variant="dark"
                showCities
                pinMode={activeTab === "standort"}
                onMapClick={(lon, lat) => addPin(lon, lat)}
                selectedRegionId={selected.region.id}
                selectedEdgeId={selectedEdgeId}
                onSelectRegion={(id) => {
                  setSelectedRegionId(id);
                  setActiveTab("regionen");
                }}
                onSelectEdge={(id) => {
                  setSelectedEdgeId((current) => (current === id ? null : id));
                  setActiveTab("strecken");
                }}
              />
            </div>

            <div className="min-w-0">
              <div className="flex rounded-lg border border-white/10 bg-white/[0.04] p-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${
                      activeTab === tab.id
                        ? "bg-[#0DBBC8] text-[#10333a]"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === "strecken" && (
                <div className="mt-4 space-y-4">
                  {selectedEdge ? (
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold tracking-[-0.01em]">
                          {edgeLabel(selectedEdge)}
                        </p>
                        {selectedEdge.aCountry !== selectedEdge.bCountry && (
                          <span className="rounded-full bg-[#0DBBC8]/15 px-2.5 py-1 text-xs font-semibold text-[#5fd9e2]">
                            Grenzraum {selectedEdge.aCountry}/{selectedEdge.bCountry}
                          </span>
                        )}
                        {selectedEdgeCharging?.whiteSpot && (
                          <span className="rounded-full bg-[#e8a13a]/15 px-2.5 py-1 text-xs font-semibold text-[#e8a13a]">
                            Weißer Fleck
                          </span>
                        )}
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-4">
                        <DetailStat
                          label="Lkw pro Tag 2030"
                          value={`≈ ${formatNumber(selectedEdge.trucks2030 / 365)}`}
                        />
                        <DetailStat
                          label="Wachstum"
                          value={formatPercent(
                            growthPercent(selectedEdge.trucks2019, selectedEdge.trucks2030),
                          )}
                          sub="vs. 2019"
                        />
                        <DetailStat
                          label="Abschnitt"
                          value={`${formatNumber(selectedEdge.distanceKm)} km`}
                        />
                      </div>
                      {selectedEdgeCharging && (
                        <p
                          className={`mt-4 text-sm ${selectedEdgeCharging.whiteSpot ? "text-[#e8a13a]" : "text-white/60"}`}
                        >
                          Nächster Lkw-Ladepark: {selectedEdgeCharging.name} ·{" "}
                          {formatNumber(selectedEdgeCharging.km)} km
                        </p>
                      )}
                      {selectedEdge.topFlows.length > 0 && (
                        <p className="mt-2 text-xs leading-relaxed text-white/40">
                          Stärkste Verbindungen:{" "}
                          {selectedEdge.topFlows
                            .map(
                              (flow) =>
                                `${flow.origin}${flow.originCountry !== "DE" ? ` (${flow.originCountry})` : ""} → ${flow.destination}${flow.destinationCountry !== "DE" ? ` (${flow.destinationCountry})` : ""}`,
                            )
                            .join(" · ")}
                        </p>
                      )}

                      {selectedEdgeTrend && (
                        <div className="mt-5 border-t border-white/10 pt-4">
                          {selectedEdgeTrend.profile?.werktag && (
                            <div>
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                                  Tagesgang Werktag (Lkw/h, gemessen)
                                </p>
                                <p className="text-xs text-white/35 tabular-nums">
                                  max{" "}
                                  {formatNumber(
                                    Math.max(...selectedEdgeTrend.profile.werktag),
                                  )}
                                </p>
                              </div>
                              <div className="mt-2 flex h-12 items-end gap-[2px]">
                                {selectedEdgeTrend.profile.werktag.map((value, hour) => {
                                  const max = Math.max(
                                    ...selectedEdgeTrend.profile!.werktag,
                                    1,
                                  );
                                  return (
                                    <div
                                      key={hour}
                                      className="flex-1 rounded-sm bg-[#0DBBC8]"
                                      style={{
                                        height: `${Math.max(4, (value / max) * 100)}%`,
                                        opacity: 0.4 + 0.6 * (value / max),
                                      }}
                                      title={`${hour}–${hour + 1} Uhr: ${formatNumber(value)} Lkw/h`}
                                    />
                                  );
                                })}
                              </div>
                              <div className="mt-1 flex justify-between text-[10px] text-white/30">
                                <span>0 Uhr</span>
                                <span>12 Uhr</span>
                                <span>24 Uhr</span>
                              </div>
                            </div>
                          )}
                          {selectedEdgeTrend.trend && (
                            <p className="mt-3 text-sm text-white/60">
                              Realtrend 12 Monate:{" "}
                              <span
                                className={`font-semibold ${
                                  selectedEdgeTrend.trend.trendPctP50 >= 0
                                    ? "text-[#5fd9e2]"
                                    : "text-[#e8a13a]"
                                }`}
                              >
                                {selectedEdgeTrend.trend.trendPctP50 >= 0 ? "+" : ""}
                                {formatPercent(selectedEdgeTrend.trend.trendPctP50)}
                              </span>{" "}
                              <span className="text-white/40">
                                (p10 {selectedEdgeTrend.trend.trendPctP10 > 0 ? "+" : ""}
                                {formatPercent(selectedEdgeTrend.trend.trendPctP10)} · p90{" "}
                                {selectedEdgeTrend.trend.trendPctP90 > 0 ? "+" : ""}
                                {formatPercent(selectedEdgeTrend.trend.trendPctP90)})
                              </span>
                            </p>
                          )}
                          <p className="mt-1.5 text-xs text-white/35">
                            Zählstelle {selectedEdgeTrend.station.name} (
                            {selectedEdgeTrend.station.strasse}),{" "}
                            {selectedEdgeTrend.station.distanceKm.toLocaleString("de-DE")} km
                            entfernt
                            {selectedEdgeTrend.station.directionShareR1 != null &&
                              ` · Richtungssplit ${Math.round(selectedEdgeTrend.station.directionShareR1 * 100)} / ${Math.round((1 - selectedEdgeTrend.station.directionShareR1) * 100)}`}
                            {selectedEdgeTrend.trend && " · Chronos-2-Forecast, backtested"}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-white/15 px-5 py-4 text-sm text-white/50">
                      Wähle einen Streckenabschnitt – in der Liste oder direkt auf der Karte.
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white/70">
                      Die {data.edgeHotspots.length} stärksten Abschnitte
                    </p>
                    {charging && (
                      <button
                        type="button"
                        onClick={() => setOnlyWhiteSpots((value) => !value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          onlyWhiteSpots
                            ? "bg-[#e8a13a] text-[#3a2a08]"
                            : "bg-white/[0.06] text-white/60 hover:text-white"
                        }`}
                      >
                        Nur Lade-Lücken ({whiteSpotCount})
                      </button>
                    )}
                  </div>

                  <div className="max-h-[26rem] space-y-1.5 overflow-auto pr-1">
                    {visibleEdgeList.map((edge, index) => {
                      const info = edgeCharging.get(edge.edgeId);
                      const isSelected = edge.edgeId === selectedEdgeId;
                      return (
                        <button
                          key={edge.edgeId}
                          type="button"
                          onClick={() =>
                            setSelectedEdgeId((current) =>
                              current === edge.edgeId ? null : edge.edgeId,
                            )
                          }
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                            isSelected ? "bg-[#0DBBC8]/15" : "hover:bg-white/[0.05]"
                          }`}
                        >
                          <span className="w-6 shrink-0 text-xs text-white/35 tabular-nums">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-white">
                              {edgeLabel(edge)}
                            </span>
                            <span className="block text-xs text-white/45 tabular-nums">
                              ≈ {formatNumber(edge.trucks2030 / 365)} Lkw/Tag
                            </span>
                          </span>
                          {info?.whiteSpot && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-[#e8a13a]"
                              title={`Kein Lkw-Ladepark im ${WHITE_SPOT_KM}-km-Umkreis`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "korridore" && (
                <div className="mt-4 space-y-4">
                  {selectedCorridor ? (
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold tracking-[-0.01em]">
                          {selectedCorridor.corridor.originRegion}
                          {" → "}
                          {selectedCorridor.corridor.destinationRegion}
                        </p>
                        {selectedCorridor.corridor.crossBorder && (
                          <span className="rounded-full bg-[#0DBBC8]/15 px-2.5 py-1 text-xs font-semibold text-[#5fd9e2]">
                            Grenzüberschreitend
                          </span>
                        )}
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-4">
                        <DetailStat
                          label="Score"
                          value={String(selectedCorridor.score.score)}
                          sub="/ 100"
                        />
                        <DetailStat
                          label="Strecke"
                          value={`${formatNumber(selectedCorridor.corridor.totalDistanceKm)} km`}
                        />
                        <DetailStat
                          label="Lkw 2030"
                          value={formatCompact(selectedCorridor.corridor.trucks2030)}
                          sub={`Wachstum ${formatPercent(selectedCorridor.score.growthPercent)}`}
                        />
                      </div>
                      <div className="mt-4">
                        <ComponentBar
                          label="Distanzfit"
                          value={selectedCorridor.score.components.distanceFit}
                          explainer="Strecken zwischen 150 und 600 km passen am besten zu öffentlichem E-Lkw-Laden."
                        />
                      </div>
                      {corridorStats && (
                        <p className="mt-4 text-sm text-white/60">
                          {corridorStats.hubsOnRoute > 0
                            ? `${corridorStats.hubsOnRoute} Lkw-Ladepark${corridorStats.hubsOnRoute > 1 ? "s" : ""} im Korridor · größte Ladelücke ≈ ${formatNumber(corridorStats.maxGapKm)} km`
                            : "Noch kein Lkw-Ladepark im Korridor"}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-white/15 px-5 py-4 text-sm text-white/50">
                      Wähle einen Korridor – er erscheint als Route auf der Karte. Ladelücken
                      werden über den Luftlinien-Korridor (±15 % Puffer) berechnet.
                    </p>
                  )}

                  <div className="max-h-[28rem] space-y-1.5 overflow-auto pr-1">
                    {scoredCorridors.map(({ corridor, score }) => {
                      const key = corridorKey(corridor);
                      const isSelected = key === selectedCorridorKey;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSelectedCorridorKey(isSelected ? "" : key)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                            isSelected ? "bg-[#0DBBC8]/15" : "hover:bg-white/[0.05]"
                          }`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-sm font-bold text-[#5fd9e2] tabular-nums">
                            {score.score}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-white">
                              {shortName(corridor.originRegion)}
                              {corridor.originCountry !== "DE" && ` (${corridor.originCountry})`}
                              {" → "}
                              {shortName(corridor.destinationRegion)}
                              {corridor.destinationCountry !== "DE" &&
                                ` (${corridor.destinationCountry})`}
                            </span>
                            <span className="block text-xs text-white/45 tabular-nums">
                              {formatNumber(corridor.totalDistanceKm)} km ·{" "}
                              {formatCompact(corridor.trucks2030)} Lkw 2030
                            </span>
                          </span>
                          {corridor.crossBorder && (
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#5fd9e2]">
                              {corridor.originCountry !== "DE"
                                ? corridor.originCountry
                                : corridor.destinationCountry}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "regionen" && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-bold tracking-[-0.01em]">
                          {selected.region.name}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-[#5fd9e2]">
                          Platz {selectedRank} von {scoredRegions.length} Regionen
                        </p>
                        <div className="mt-3">
                          <ScorePill score={selected.score.score} />
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-white/55">
                          {selectedClassification.description}
                        </p>
                      </div>
                      <ScoreDial score={selected.score.score} />
                    </div>

                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <ComponentBar
                        label="Verkehrsmenge"
                        value={selected.score.components.volume}
                        explainer={`${formatCompact(selected.region.trucks2030)} Lkw-Fahrten 2030, Wurzelskala gegen die stärkste Region.`}
                      />
                      <ComponentBar
                        label="Wachstum"
                        value={selected.score.components.growth}
                        explainer={`${formatPercent(selected.score.growthPercent)} mehr als 2019 – Gesamt-Lkw, nicht E-Lkw-Hochlauf.`}
                      />
                      <ComponentBar
                        label="E-Lkw-Distanzfit"
                        value={selected.score.components.distanceFit}
                        explainer="Verkehrsgewichteter Anteil im 150–600-km-Fenster."
                      />
                      <ComponentBar
                        label="Korridor-Relevanz"
                        value={selected.score.components.corridorRelevance}
                        explainer={`${formatPercent(selected.region.crossBorderShare * 100)} grenzüberschreitend (${formatCompact(selected.region.crossBorderTrucks2030)} Fahrten).`}
                      />
                    </div>

                    <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                          Verkehrstrend (Fahrten/Jahr)
                        </p>
                        <div className="mt-3">
                          <TrendBars region={selected.region} />
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                          Stärkste Verbindungen
                        </p>
                        <div className="mt-3 space-y-2">
                          {selected.region.topCorridors.slice(0, 5).map((link, index) => (
                            <div
                              key={`${link.partnerName}-${link.direction}-${index}`}
                              className="flex items-center justify-between gap-3 text-sm"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                {link.direction === "outbound" ? (
                                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#0DBBC8]" />
                                ) : (
                                  <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-[#0DBBC8]" />
                                )}
                                <span className="truncate font-medium text-white">
                                  {link.partnerName}
                                  {link.partnerCountry !== "DE" && ` (${link.partnerCountry})`}
                                </span>
                              </span>
                              <span className="shrink-0 text-white/45 tabular-nums">
                                {formatCompact(link.trucks2030)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <label className="flex min-h-10 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm focus-within:border-[#0DBBC8]/60">
                    <Search className="h-4 w-4 text-white/40" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Hamburg, Berlin, Köln..."
                      className="w-full bg-transparent text-white placeholder:text-white/35 outline-none"
                    />
                  </label>

                  <div className="max-h-[20rem] space-y-1.5 overflow-auto pr-1">
                    {filteredRegions.slice(0, 35).map(({ region, score }) => (
                      <button
                        key={region.id}
                        type="button"
                        onClick={() => setSelectedRegionId(region.id)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                          region.id === selected.region.id
                            ? "bg-[#0DBBC8]/15"
                            : "hover:bg-white/[0.05]"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">
                            {region.name}
                          </span>
                          <span className="block text-xs text-white/45 tabular-nums">
                            Platz {regionRank.get(region.id)} ·{" "}
                            {formatCompact(region.trucks2030)} Lkw 2030
                          </span>
                        </span>
                        <span className="shrink-0 text-base font-bold text-[#5fd9e2] tabular-nums">
                          {score.score}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "standort" && (
                <div className="mt-4 space-y-4">
                  <div className="flex gap-2">
                    <label className="flex min-h-10 flex-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm focus-within:border-[#0DBBC8]/60">
                      <Search className="h-4 w-4 shrink-0 text-white/40" />
                      <input
                        value={placeQuery}
                        onChange={(event) => setPlaceQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void searchPlace();
                        }}
                        placeholder="Adresse oder Ort — oder direkt auf die Karte klicken"
                        className="w-full bg-transparent text-white placeholder:text-white/35 outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void searchPlace()}
                      disabled={placeSearching}
                      className="rounded-lg bg-[#0DBBC8] px-4 text-sm font-semibold text-[#10333a] transition hover:bg-[#5fd9e2] disabled:opacity-50"
                    >
                      {placeSearching ? "…" : "Prüfen"}
                    </button>
                  </div>
                  {placeError && <p className="text-xs text-[#e8a13a]">{placeError}</p>}

                  {pins.length === 0 && (
                    <p className="rounded-lg border border-dashed border-white/15 px-5 py-4 text-sm leading-relaxed text-white/50">
                      Wo planst du Ladeinfrastruktur? Setze bis zu {MAX_PINS} Standorte per
                      Karten-Klick oder Ortssuche — du bekommst sofort das Standort-Signal aus
                      Verkehr, Lade-Lücke und Regions-Score.
                    </p>
                  )}

                  {pins.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pins.map((pin, index) => (
                        <button
                          key={pin.id}
                          type="button"
                          onClick={() => setActivePinId(pin.id)}
                          className={`group flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                            pin.id === (activePin?.id || "")
                              ? "bg-[#e8a13a] text-[#3a2a08]"
                              : "bg-white/[0.06] text-white/70 hover:text-white"
                          }`}
                        >
                          <span>
                            {index + 1} · {pin.label || `${pin.lat.toFixed(3)}, ${pin.lon.toFixed(3)}`}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Standort entfernen"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPins((current) => current.filter((p) => p.id !== pin.id));
                            }}
                            className="opacity-60 hover:opacity-100"
                          >
                            ×
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {activePin && activeAssessment && (
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${signalBadgeClass(activeAssessment.signal)}`}
                        >
                          {activeAssessment.label}
                        </span>
                        {activeAssessment.edge?.whiteSpot && (
                          <span className="rounded-full bg-[#e8a13a]/15 px-2.5 py-1 text-xs font-semibold text-[#e8a13a]">
                            Weißer Fleck
                          </span>
                        )}
                      </div>
                      <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-white/60">
                        {activeAssessment.reasons.map((reason) => (
                          <li key={reason} className="flex gap-2">
                            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#0DBBC8]" />
                            {reason}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-4">
                        <DetailStat
                          label="Verkehr nebenan"
                          value={
                            activeAssessment.edge
                              ? `≈ ${formatNumber(activeAssessment.edge.trucksPerDay)}/Tag`
                              : "—"
                          }
                          sub={
                            activeAssessment.edge
                              ? `${activeAssessment.edge.km.toLocaleString("de-DE")} km zur Strecke`
                              : undefined
                          }
                        />
                        <DetailStat
                          label="Nächster Lkw-Lader"
                          value={
                            activeAssessment.hub
                              ? `${activeAssessment.hub.km.toLocaleString("de-DE")} km`
                              : "—"
                          }
                          sub={activeAssessment.hub?.name}
                        />
                        <DetailStat
                          label="Region"
                          value={activeAssessment.region ? `Score ${activeAssessment.region.score}` : "—"}
                          sub={
                            activeAssessment.region
                              ? `Platz ${activeAssessment.region.rank} · ${activeAssessment.region.name}`
                              : undefined
                          }
                        />
                        <DetailStat
                          label="Netz-Proxy"
                          value={
                            activeAssessment.substation
                              ? `${activeAssessment.substation.km.toLocaleString("de-DE")} km`
                              : "—"
                          }
                          sub={
                            activeAssessment.substation
                              ? `Umspannwerk ${activeAssessment.substation.kv} kV`
                              : undefined
                          }
                        />
                      </div>
                      {activePinTrend?.profile?.werktag && (
                        <div className="mt-4 border-t border-white/10 pt-4">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                            Tagesgang an der nächsten Strecke (Werktag, gemessen)
                          </p>
                          <div className="mt-2 flex h-9 items-end gap-[2px]">
                            {activePinTrend.profile.werktag.map((value, hour) => {
                              const max = Math.max(...activePinTrend.profile!.werktag, 1);
                              return (
                                <div
                                  key={hour}
                                  className="flex-1 rounded-sm bg-[#0DBBC8]"
                                  style={{
                                    height: `${Math.max(5, (value / max) * 100)}%`,
                                    opacity: 0.4 + 0.6 * (value / max),
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {activeAssessment.edge && activeAssessment.edge.km <= 25 && (
                        <div className="mt-4 border-t border-white/10 pt-4">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                            Erlöspotenzial halböffentlicher Ladepark (Modellrechnung)
                          </p>
                          <table className="mt-2 w-full text-sm">
                            <tbody>
                              {estimateSiteRevenue(activeAssessment.edge.trucksPerDay).map(
                                (row) => (
                                  <tr
                                    key={row.scenario.id}
                                    className="border-t border-white/5 first:border-0"
                                  >
                                    <td className="py-1.5 pr-3 text-white/60">
                                      {row.scenario.label}{" "}
                                      <span className="text-white/35">
                                        ({Math.round(row.scenario.evShare * 100)} % E-Lkw)
                                      </span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-white/60 tabular-nums">
                                      {row.chargesPerDay.toLocaleString("de-DE")} Ladungen/Tag
                                    </td>
                                    <td className="py-1.5 text-right font-semibold text-white tabular-nums">
                                      ≈ {formatCompact(row.marginEurPerYear)} €/Jahr
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                          <p className="mt-2 text-xs leading-relaxed text-white/35">
                            Szenarien für den E-Lkw-Anteil am Verkehr (keine Prognose);
                            Annahmen: {Math.round(REVENUE_ASSUMPTIONS.stopShare * 100)} %
                            Anhaltequote, {REVENUE_ASSUMPTIONS.avgChargeKwh} kWh/Ladung,{" "}
                            {REVENUE_ASSUMPTIONS.marginPerKwh.toLocaleString("de-DE")} €/kWh
                            Marge.
                          </p>
                        </div>
                      )}
                      <p className="mt-3 text-xs leading-relaxed text-white/35">
                        Standort-Signal aus Verkehrsdaten, Ladepark-Register und Regions-Score —
                        keine Bau-Empfehlung. Netzanschluss, Fläche und Genehmigung prüft der
                        Readiness Check.
                      </p>
                    </div>
                  )}

                  {pins.length >= 2 && (
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                        Vergleich
                      </p>
                      <table className="mt-2 w-full text-sm">
                        <tbody>
                          {pins.map((pin, index) => {
                            const a = assessments.get(pin.id);
                            return (
                              <tr key={pin.id} className="border-t border-white/5 first:border-0">
                                <td className="py-2 pr-2 text-white/45 tabular-nums">{index + 1}</td>
                                <td className="py-2 pr-3">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${signalBadgeClass(a?.signal || "schwach")}`}
                                  >
                                    {a?.label}
                                  </span>
                                </td>
                                <td className="py-2 pr-3 text-white/60 tabular-nums">
                                  {a?.edge ? `≈ ${formatCompact(a.edge.trucksPerDay)}/Tag` : "—"}
                                </td>
                                <td className="py-2 text-white/60 tabular-nums">
                                  {a?.hub ? `Lader ${Math.round(a.hub.km)} km` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {pins.length > 0 && !embed && (
                    <div className="rounded-lg border border-[#0DBBC8]/25 bg-[#0DBBC8]/[0.06] p-5">
                      {leadStatus === "sent" ? (
                        <p className="text-sm leading-relaxed text-white/70">
                          Danke! Wir melden uns mit der Detail-Analyse zu deinen Standorten.
                        </p>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-white">
                            Detail-Analyse anfordern
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-white/50">
                            Wir prüfen deine Standorte vertieft — inklusive Netzanschluss-Frage
                            und Wirtschaftlichkeit über DepotOne.
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <input
                              value={lead.name}
                              onChange={(event) => setLead({ ...lead, name: event.target.value })}
                              placeholder="Name*"
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-[#0DBBC8]/60"
                            />
                            <input
                              value={lead.email}
                              onChange={(event) => setLead({ ...lead, email: event.target.value })}
                              placeholder="E-Mail*"
                              type="email"
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-[#0DBBC8]/60"
                            />
                            <input
                              value={lead.company}
                              onChange={(event) =>
                                setLead({ ...lead, company: event.target.value })
                              }
                              placeholder="Firma"
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-[#0DBBC8]/60"
                            />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <Button
                              onClick={() => void submitLead()}
                              disabled={
                                leadStatus === "sending" ||
                                !lead.name.trim() ||
                                !lead.email.trim()
                              }
                              className="rounded-full bg-[#0DBBC8] px-5 text-[#10333a] hover:bg-[#5fd9e2]"
                            >
                              {leadStatus === "sending" ? "Sende…" : "Anfrage senden"}
                            </Button>
                            <Link href="/depot-readiness">
                              <Button
                                variant="outline"
                                className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white hover:text-[#1d1d1f]"
                              >
                                Readiness Check starten
                              </Button>
                            </Link>
                            {leadStatus === "error" && (
                              <span className="text-xs text-[#e8a13a]">
                                Senden fehlgeschlagen — bitte später erneut versuchen.
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-12 sm:px-8 lg:px-12">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
            Methodik & Quellen
          </p>
          <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-[-0.02em]">
            Synthetische Flüsse, reale Zähldaten, dokumentierte Ladeparks
          </h2>

          <div className="mt-7 grid gap-5 md:grid-cols-2">
            <div className="rounded-lg border border-black/[0.08] bg-white p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-[#0A99A4]" />
                <div>
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">Evidenzgrenze</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#6e6e73]">
                    Der Score bewertet Verkehrspotenzial, keine Wirtschaftlichkeit. Er ist der
                    erste Filter, bevor Netzanschluss, Fläche, Haltezeiten, Wettbewerb und
                    Kundenverträge geprüft werden. Der E-Lkw-Hochlauf selbst ist nicht
                    modelliert – der Score zeigt, wo Verkehr ist, nicht wie schnell er
                    elektrisch wird.
                  </p>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#6e6e73]">
                    {data.metadata.knownCaveat}
                  </p>
                  <a
                    href={data.metadata.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#0A99A4]"
                  >
                    Quelle ansehen
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </div>

            {validation && (
              <div className="rounded-lg border border-[#0A99A4]/25 bg-[#0A99A4]/[0.05] p-6">
                <div className="flex items-start gap-3">
                  <BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-[#0A99A4]" />
                  <div>
                    <h3 className="text-lg font-semibold tracking-[-0.02em]">
                      Mit realen Zähldaten geprüft
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-[#6e6e73]">
                      Die modellierten Streckenwerte korrelieren mit den
                      Schwerverkehrsmessungen von {validation.stationCount}{" "}
                      BASt-Autobahn-Dauerzählstellen ({validation.year}): Rangkorrelation{" "}
                      <strong className="text-[#1d1d1f]">
                        {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
                          validation.spearman,
                        )}
                      </strong>{" "}
                      über {validation.matchedEdges} abgeglichene Streckenabschnitte.
                    </p>
                    <p className="mt-2.5 text-xs leading-relaxed text-[#9b9ba0]">
                      {validation.methodNote}
                    </p>
                    <a
                      href={validation.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#0A99A4]"
                    >
                      BASt-Zählstellen ansehen
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {charging && (
              <div className="rounded-lg border border-black/[0.08] bg-white p-6">
                <div className="flex items-start gap-3">
                  <PlugZap className="mt-1 h-5 w-5 shrink-0 text-[#7c3aed]" />
                  <div>
                    <h3 className="text-lg font-semibold tracking-[-0.02em]">
                      Lkw-Ladepark-Datenbasis
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-[#6e6e73]">
                      {liveHubs.length} verifizierte Lkw-Ladeparks in Betrieb (Milence, Aral
                      pulse, Daimler TruckCharge, E.ON Drive/MAN u. a.), dazu{" "}
                      {charging.verified.length - liveHubs.length} angekündigte. Quelle:
                      BNetzA-Ladesäulenregister (Stand{" "}
                      {new Date(charging.metadata.bnetzaDataDate).toLocaleDateString("de-DE")})
                      und Betreiber-Pressemitteilungen, je Standort dokumentiert.
                    </p>
                    <p className="mt-2.5 text-xs leading-relaxed text-[#9b9ba0]">
                      {charging.metadata.methodNote}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {trendData && (
              <div className="rounded-lg border border-black/[0.08] bg-white p-6">
                <div className="flex items-start gap-3">
                  <Gauge className="mt-1 h-5 w-5 shrink-0 text-[#0A99A4]" />
                  <div>
                    <h3 className="text-lg font-semibold tracking-[-0.02em]">
                      Realtrend & Tagesgang (Chronos-2)
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-[#6e6e73]">
                      {Object.keys(trendData.edges).length} Hotspot-Strecken sind mit realen
                      Stundenmessungen der nächstgelegenen BASt-Dauerzählstelle (2016–2023)
                      hinterlegt. Den 12-Monats-Trend prognostiziert Amazon Chronos-2 –
                      backtested gegen das zurückgehaltene letzte Jahr: Das 80-%-Band deckte{" "}
                      {formatPercent((trendData.metadata.meanCoverage80 || 0) * 100)} der
                      Realität ab ({trendData.metadata.stationsBacktested} Stationen).
                    </p>
                    <p className="mt-2.5 text-xs leading-relaxed text-[#9b9ba0]">
                      Ehrlichkeitshinweis: Die Punktprognose ist auf dem Niveau der einfachen
                      Saisonfigur (Median-Skill ≈ 0) – der Mehrwert liegt im kalibrierten
                      Unsicherheitsband und in den gemessenen Tagesgang-Profilen, nicht in
                      einer „besseren Zahl". {trendData.metadata.methodNote}
                    </p>
                    <a
                      href={trendData.metadata.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#0A99A4]"
                    >
                      BASt-Stundenwerte ansehen
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>

        {!embed && (
          <section className="rounded-lg bg-[#141519] p-8 text-white sm:p-12">
            <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
              <div>
                <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                  Region sieht gut aus? Dann prüfe als Nächstes dein Depot.
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70">
                  Der Traffic Opportunity Score zeigt das Verkehrspotenzial. Der DepotOne
                  Readiness Check bewertet, wie bereit ein konkreter Standort für die
                  Elektrifizierung ist – Netzanschluss, Fläche, Fuhrpark.
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
