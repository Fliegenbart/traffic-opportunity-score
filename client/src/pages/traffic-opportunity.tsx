import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ExternalLink,
  Gauge,
  MapPin as MapPinIcon,
  PlugZap,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import SiteEconomics, { type VerdictSummary } from "@/components/charging-planner";
import TrafficBasisSelect from "@/components/traffic-basis-select";
import SiteEvidence from "@/components/site-evidence";
import SiteSurroundings from "@/components/site-surroundings";
import SiteFinder from "@/components/site-finder";
import WatchlistPanel, { WatchButton } from "@/components/watchlist";
import { useWatchlist } from "@/lib/use-watchlist";
import SiteAccessCheck from "@/components/site-access-check";
import TrafficTutorial from "@/components/traffic-tutorial";
import { loadPlanningData } from "@shared/charging-planning/data";
import { resolveSiteTraffic, validateHotspotConsistency, type PlanningData, type BasisChoice } from "@shared/site-traffic";
import { matchesRegionSearch } from "@shared/region-search";
import TrafficMap, {
  type MapCharger,
  type MapPin,
  type MapRoute,
  type NetworkLayer,
} from "@/components/traffic-map";
import { assessSite } from "@shared/standort-check";
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

const NO_EDGES: never[] = [];

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
      ? "bg-[#e5e9ff] text-[#1d3bff]"
      : score >= 55
        ? "bg-[#e5e9ff] text-[#1d3bff]"
        : score >= 35
          ? "bg-[#faf0df] text-[#7b5117]"
          : "bg-[#f2f2ef] text-[#55555a]";

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
        background: `conic-gradient(#1d3bff ${score * 3.6}deg, #e4e4e1 0deg)`,
      }}
    >
      <div className="flex h-[5.4rem] w-[5.4rem] flex-col items-center justify-center rounded-full bg-white">
        <span className="text-3xl font-bold tracking-[-0.04em] text-[#0a0a0b]">{score}</span>
        <span className="text-[10px] font-medium text-[#6b6b70]">/ 100</span>
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
        <p className="text-sm font-semibold text-[#0a0a0b]">{label}</p>
        <span className="text-sm font-semibold text-[#1d3bff] tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#e4e4e1]">
        <div
          className="h-full rounded-full bg-[#1d3bff]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      {explainer && (
        <p className="mt-1.5 text-xs leading-relaxed text-[#6b6b70]">{explainer}</p>
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
          <span className="w-10 shrink-0 font-medium text-[#6b6b70]">{point.year}</span>
          <div className="h-2 flex-1 rounded-full bg-[#e4e4e1]">
            <div
              className="h-full rounded-full bg-[#1d3bff]"
              style={{ width: `${Math.max(3, (point.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-semibold text-[#0a0a0b] tabular-nums">
            {formatCompact(point.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ffffff] px-6 text-center text-[#0a0a0b]">
      <div>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e5e9ff] text-[#1d3bff]">
          <Gauge className="h-7 w-7 animate-pulse" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
          Verkehrsdaten werden geladen
        </h1>
        <p className="mt-2 max-w-md text-[#6b6b70]">
          Die Daten für Deutschland werden vorbereitet. Das kann einen Moment dauern.
        </p>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ffffff] px-6 text-center text-[#0a0a0b]">
      <div>
        <AlertTriangle className="mx-auto h-10 w-10 text-[#1d3bff]" />
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Daten nicht gefunden</h1>
        <p className="mt-2 max-w-md text-[#6b6b70]">
          Die Verkehrsdaten konnten nicht geladen werden. Bitte prüfe deine Verbindung und versuche es erneut.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-md bg-[#1d3bff] px-4 py-2 font-semibold text-white">Erneut laden</button>
      </div>
    </div>
  );
}

function DetailStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#6b6b70]">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-[-0.01em] text-[#0a0a0b] tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[#6b6b70]">{sub}</p>}
    </div>
  );
}

export default function TrafficOpportunity() {
  const initialParams = useMemo(readUrlParams, []);
  const [data, setData] = useState<TrafficOpportunityData | null>(null);
  const [charging, setCharging] = useState<ChargingData | null>(null);
  const [chargingUnavailable, setChargingUnavailable] = useState(false);
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [substations, setSubstations] = useState<[number, number, number][]>([]);
  const [network, setNetwork] = useState<NetworkLayer[]>([]);
  const [planningData, setPlanningData] = useState<PlanningData>();
  const [planningDataError, setPlanningDataError] = useState("");
  const [planningRetry, setPlanningRetry] = useState(0);
  const [basisChoices, setBasisChoices] = useState<Record<string, BasisChoice | undefined>>({});
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
  const [verdict, setVerdict] = useState<VerdictSummary | null>(null);
  const [lead, setLead] = useState({ name: "", email: "", company: "", consent: false, website: "" });
  const [leadStatus, setLeadStatus] = useState<"idle" | "sending" | "sent" | "error" | "limited">("idle");
  const embed = initialParams.embed;

  useEffect(() => {
    document.title = "Ladepark-Check – Truckonomics";
  }, []);

  useEffect(() => {
    let active = true;
    setPlanningData(undefined);
    setPlanningDataError("");
    loadPlanningData().then((value) => { if (active) setPlanningData(value); })
      .catch(() => { if (active) setPlanningDataError("Die Daten für die Standortrechnung konnten nicht geladen oder geprüft werden. Die Übersicht allein reicht für eine Berechnung nicht aus."); });
    return () => { active = false; };
  }, [planningRetry]);

  const consistentPlanningData = useMemo(() => {
    if (!planningData || !data) return undefined;
    try { validateHotspotConsistency(data.edgeHotspots, planningData.network); return planningData; }
    catch { return undefined; }
  }, [data, planningData]);
  const siteDataError = planningDataError || (data && planningData && !consistentPlanningData ? "Die Verkehrsdaten der Übersicht stimmen nicht mit den Planungsdaten überein. Bis zur Klärung ist keine Standortrechnung möglich." : "");

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
      .then((response) => {
        if (!response.ok) throw new Error("Charging data missing");
        return response.json() as Promise<ChargingData>;
      })
      .then((payload) => {
        if (!Array.isArray(payload?.verified) || !payload.metadata || !Array.isArray(payload.proxy)) throw new Error("Invalid charging data");
        if (active) {
          setCharging(payload);
          setChargingUnavailable(!payload.verified.some((hub) => hub.status === "live"));
        }
      })
      .catch(() => { if (active) setChargingUnavailable(true); });

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

    fetch("/data/network-de.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { layers: NetworkLayer[] } | null) => {
        if (active && payload) setNetwork(payload.layers);
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
    return scoredRegions.filter(({ region }) =>
      matchesRegionSearch(`${region.name} ${region.id}`, query),
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

  const watch = useWatchlist(charging);

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

  // Korridore-Tab: ohne Auswahl alle Top-Korridore als feine Linien,
  // mit Auswahl nur der gewählte (hervorgehoben, mit Labels).
  const mapRoutes = useMemo<MapRoute[]>(() => {
    if (activeTab !== "korridore") return [];
    if (selectedCorridor) {
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
    }
    return scoredCorridors
      .filter(({ corridor }) => corridor.originLon !== 0 && corridor.destinationLon !== 0)
      .map(({ corridor }) => ({
        label: "",
        aLon: corridor.originLon,
        aLat: corridor.originLat,
        bLon: corridor.destinationLon,
        bLat: corridor.destinationLat,
        subtle: true,
      }));
  }, [activeTab, selectedCorridor, scoredCorridors]);

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

  const siteTraffic = useMemo(() => {
    const result = new Map<string, ReturnType<typeof resolveSiteTraffic>>();
    if (consistentPlanningData) for (const pin of pins) result.set(pin.id, resolveSiteTraffic(pin, consistentPlanningData, basisChoices[pin.id]));
    return result;
  }, [pins, consistentPlanningData, basisChoices]);

  const assessments = useMemo(() => {
    const result = new Map<string, ReturnType<typeof assessSite>>();
    for (const pin of pins) {
      const edge = siteTraffic.get(pin.id)?.edge?.edge;
      result.set(pin.id, assessSite(pin, edge ? [{ ...edge }] : [], liveHubs, siteRegions, substations));
    }
    return result;
  }, [pins, siteTraffic, liveHubs, siteRegions, substations]);
  const changeBasis = (id: string, choice?: BasisChoice) => setBasisChoices((current) => ({ ...current, [id]: choice }));

  const addPin = (lon: number, lat: number, label = "") => {
    const existing = pins.find((pin) => pin.lon === lon && pin.lat === lat);
    if (existing) {
      setActivePinId(existing.id);
      return;
    }
    if (pins.length >= MAX_PINS) {
      setPlaceError("Drei Standorte sind ausgewählt. Entferne zuerst einen Standort, um einen neuen hinzuzufügen.");
      return;
    }
    const pin: SitePin = { id: `pin-${crypto.randomUUID()}`, lon, lat, label };
    setPins((current) => [...current, pin]);
    setActivePinId(pin.id);
    setPlaceError("");
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
        setPlaceError("Kein passender Ort gefunden. Bitte ergänze Straße, Postleitzahl oder Ort.");
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
      setPlaceError("Die Ortssuche ist gerade nicht verfügbar. Ein Standort lässt sich weiterhin auf der Karte auswählen.");
    } finally {
      setPlaceSearching(false);
    }
  };

  const submitLead = async () => {
    if (!lead.name.trim() || !lead.email.trim() || !lead.consent || leadStatus === "sending") return;
    setLeadStatus("sending");
    try {
      const summary = pins
        .map((pin, index) => {
          const a = assessments.get(pin.id);
          const traffic = siteTraffic.get(pin.id)?.traffic;
          return `Standort ${index + 1} (${pin.label || `${pin.lat}, ${pin.lon}`}): Verkehr ${traffic ? `${Math.round(traffic.trucksPerDay)} Fahrzeuge/Tag, ${traffic.source.kind}, Referenz ${traffic.referenceYear}, Quelle ${traffic.source.id}` : "nicht gewählt"}. Ladenachfrage nicht validiert, Lkw-Zufahrt ungeprüft, nicht investitionsreif. ${a?.reasons.join(" ") || ""}`;
        })
        .join("\n");
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: "standort-check",
          url: window.location.href,
          consent: true,
          website: lead.website,
          contact: {
            name: lead.name.trim(),
            email: lead.email.trim(),
            company: lead.company.trim() || undefined,
            message: `Standort-Check-Anfrage:\n${summary}`,
          },
          inputs: { pins, assessments: pins.map((pin) => assessments.get(pin.id)) },
        }),
      });
      setLeadStatus(response.ok ? "sent" : response.status === 429 ? "limited" : "error");
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
    { id: "korridore", label: "Verbindungen" },
    { id: "regionen", label: "Regionen" },
    { id: "standort", label: watch.freshCount ? `Standort-Check · ${watch.freshCount} neu` : "Standort-Check" },
  ];

  const activePin = pins.find((pin) => pin.id === activePinId) || pins[0] || null;
  const mapPins: MapPin[] = pins.map((pin, index) => ({
    id: pin.id,
    lon: pin.lon,
    lat: pin.lat,
    index: index + 1,
    active: pin.id === activePin?.id,
  }));
  const activeAssessment = activePin ? assessments.get(activePin.id) : undefined;
  const activeTraffic = activePin ? siteTraffic.get(activePin.id) : undefined;

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
    <div className="min-h-screen bg-white text-[#0a0a0b]">
      <header className="z-40 border-b border-[#e4e4e1] bg-white/95 text-[#0a0a0b] backdrop-blur sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-12">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
            <span className="h-2.5 w-2.5 shrink-0 bg-[#1d3bff]" aria-hidden="true" />
            <div className="min-w-0 leading-tight">
              <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Ladepark-Check</h1>
              <p className="truncate text-[11px] text-[#6b6b70]">Lkw-Ladestandorte in einer Minute vorprüfen</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TrafficTutorial hasSite={pins.length > 0} onTabChange={setActiveTab} autoStart={!embed} />
            {!embed && (
              <nav className="hidden items-center gap-1 sm:flex" aria-label="Weitere Werkzeuge">
                <a
                  href="/"
                  className="inline-flex items-center px-3 py-1.5 text-[13px] font-semibold text-[#1d3bff] transition hover:text-[#0f27d6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d3bff]"
                >
                  Eigenen Standort prüfen
                </a>
                <a
                  href="https://depot-readiness-check.vercel.app/"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[#6b6b70] transition hover:text-[#0a0a0b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d3bff]"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Depot-Check
                </a>
                <a
                  href="https://truckonomics.vercel.app/"
                  className="inline-flex items-center px-3 py-1.5 text-[13px] font-medium text-[#6b6b70] transition hover:text-[#0a0a0b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d3bff]"
                >
                  Lkw-Kostenrechner
                </a>
              </nav>
            )}
          </div>
        </div>
      </header>

      <div>
        <section className="bg-white text-[#0a0a0b]">
          <div className="mx-auto grid max-w-7xl gap-x-6 gap-y-8 px-4 pb-8 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-12 lg:items-end lg:px-12">
            <div className="lg:col-span-7">
              <p className="font-mono text-xs text-[#6b6b70]">Lkw-Laden in Deutschland</p>
              <h2 className="mt-4 max-w-3xl text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] [text-wrap:balance] sm:text-6xl xl:text-[84px]">
                Wo lohnt sich ein Lkw-Ladepark?
              </h2>
            </div>
            <div className="lg:col-span-5">
              <p className="max-w-md text-[15px] leading-relaxed text-[#55555a] sm:text-base">
                Standort setzen, Verkehrsquelle und Fahrtrichtung wählen und in einer Minute sehen, ob eine vertiefte Prüfung lohnt.
              </p>
              {activeTab !== "standort" && (
                <button
                  type="button"
                  onClick={() => setActiveTab("standort")}
                  className="mt-6 inline-flex items-center gap-2 bg-[#0a0a0b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1d3bff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d3bff]"
                >
                  Standort prüfen <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
            <dl className="grid grid-cols-1 border-t border-[#0a0a0b] sm:grid-cols-3 lg:col-span-12">
              <div className="min-w-0 border-b border-[#e4e4e1] py-5 sm:border-b-0 sm:border-r sm:pr-6 flex flex-col">
                <dt className="mt-3 order-2 text-sm text-[#0a0a0b]">Fahrten 2030 mit Bezug zu Deutschland</dt>
                <dd className="order-first whitespace-nowrap text-[44px] font-semibold leading-none tracking-[-0.045em] tabular-nums xl:text-6xl">{formatCompact(data.summary.deTrucks2030)}</dd>
                <p className="order-3 mt-1.5 inline-flex items-center gap-1.5 self-start font-mono text-xs text-[#6b6b70]"><span className="h-2 w-2 rounded-full border-[1.5px] border-[#0a0a0b] bg-[linear-gradient(90deg,#0a0a0b_50%,transparent_50%)]" aria-hidden="true" />berechnet · Verkehrsmodell</p>
              </div>
              <div className="min-w-0 border-b border-[#e4e4e1] py-5 sm:border-b-0 sm:border-r sm:px-6 flex flex-col">
                <dt className="mt-3 order-2 text-sm text-[#0a0a0b]">{charging ? `Starke Abschnitte ohne Lkw-Ladepark (${WHITE_SPOT_KM} km)` : "Deutsche Regionen"}</dt>
                <dd className="order-first whitespace-nowrap text-[44px] font-semibold leading-none tracking-[-0.045em] tabular-nums xl:text-6xl">
                  {charging ? <>{whiteSpotCount}<span className="text-[#cfcfcb]">/{data.edgeHotspots.length}</span></> : formatNumber(data.summary.deRegionCount)}
                </dd>
                <p className="order-3 mt-1.5 inline-flex items-center gap-1.5 self-start font-mono text-xs text-[#6b6b70]"><span className="h-2 w-2 rounded-full bg-[#0a0a0b]" aria-hidden="true" />Ladepunktregister + Modell</p>
              </div>
              <div className="min-w-0 py-5 sm:pl-6 flex flex-col">
                <dt className="mt-3 order-2 text-sm text-[#0a0a0b]">Fahrten mit 150–600 km, typische Ladedistanz</dt>
                <dd className="order-first whitespace-nowrap text-[44px] font-semibold leading-none tracking-[-0.045em] tabular-nums xl:text-6xl">{formatPercent(mediumShare * 100)}</dd>
                <p className="order-3 mt-1.5 inline-flex items-center gap-1.5 self-start font-mono text-xs text-[#6b6b70]"><span className="h-2 w-2 rounded-full border-[1.5px] border-[#0a0a0b] bg-[linear-gradient(90deg,#0a0a0b_50%,transparent_50%)]" aria-hidden="true" />berechnet · Verkehrsmodell</p>
              </div>
            </dl>
          </div>
        </section>
        <div className="mx-auto flex max-w-7xl flex-col px-4 sm:px-6 lg:px-12">
          {chargingUnavailable && <p role="status" className="mt-4 flex items-start gap-2 rounded-md border border-[#ecd7ad] bg-[#faf0df] px-3 py-2 text-sm text-[#7b5117]"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> Die Ladepark-Daten fehlen. Wo bereits geladen werden kann und wo Angebote fehlen, lässt sich derzeit nicht beurteilen.</p>}

          {/* Workspace: Karte bleibt stehen, der Inhalt bewegt sich. */}
          <div className="grid gap-6 pb-10 pt-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div data-tour="map" className="self-start bg-[#f2f2ef] p-3 text-[#0a0a0b] sm:p-5 lg:sticky lg:top-20">
              <TrafficMap
                backdrop={data.backdrop}
                edges={mapEdges}
                regions={activeTab === "regionen" ? mapRegions : []}
                chargers={mapChargers}
                routes={mapRoutes}
                pins={mapPins}
                network={network}
                variant="swiss"
                showCities
                textureEmphasis={activeTab === "regionen"}
                edgeDim={{ strecken: 1, korridore: 0.5, regionen: 0.4, standort: 0.85 }[activeTab]}
                chargerDim={{ strecken: 1, korridore: 0.6, regionen: 0.8, standort: 0.85 }[activeTab]}
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
              <div data-tour="tabs" className="grid grid-cols-2 border-b border-[#e4e4e1] xl:grid-cols-4">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-pressed={activeTab === tab.id}
                    className={`-mb-px truncate border-b-2 px-1 py-3 text-left text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1d3bff] ${
                      activeTab === tab.id
                        ? "border-[#1d3bff] text-[#0a0a0b]"
                        : "border-transparent text-[#6b6b70] hover:text-[#0a0a0b]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === "strecken" && (
                <div className="mt-4 space-y-4">
                  {selectedEdge ? (
                    <div className="rounded-lg border border-[#e4e4e1] bg-white p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold tracking-[-0.01em]">
                          {edgeLabel(selectedEdge)}
                        </p>
                        {selectedEdge.aCountry !== selectedEdge.bCountry && (
                          <span className="bg-[#e5e9ff] px-2 py-1 text-xs font-semibold text-[#1d3bff]">
                            Grenzraum {selectedEdge.aCountry}/{selectedEdge.bCountry}
                          </span>
                        )}
                        {selectedEdgeCharging?.whiteSpot && (
                          <span className="bg-[#faf0df] px-2 py-1 text-xs font-semibold text-[#8b570b]">
                            Kein Ladepark in der Nähe bekannt
                          </span>
                        )}
                      </div>
                      <button type="button" className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#1d3bff] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#0f27d6]" onClick={() => {
                        addPin((selectedEdge.aLon + selectedEdge.bLon) / 2, (selectedEdge.aLat + selectedEdge.bLat) / 2, `Streckenmitte: ${edgeLabel(selectedEdge)}`);
                        setActiveTab("standort");
                      }}><MapPinIcon size={16} /> Standort an dieser Strecke prüfen</button>
                      <div className="mt-4 grid grid-cols-3 gap-4">
                        <DetailStat
                          label="Lkw pro Tag · berechnet für 2030"
                          value={`≈ ${formatNumber(selectedEdge.trucks2030 / 365)}`}
                        />
                        <DetailStat
                          label="Wachstum"
                          value={formatPercent(
                            growthPercent(selectedEdge.trucks2019, selectedEdge.trucks2030),
                          )}
                          sub="im Modell gegenüber 2019"
                        />
                        <DetailStat
                          label="Abschnitt"
                          value={`${formatNumber(selectedEdge.distanceKm)} km`}
                        />
                      </div>
                      {selectedEdgeCharging && (
                        <p
                          className={`mt-4 text-sm ${selectedEdgeCharging.whiteSpot ? "text-[#8b570b]" : "text-[#55555a]"}`}
                        >
                          Nächster Lkw-Ladepark: {selectedEdgeCharging.name} ·{" "}
                          {formatNumber(selectedEdgeCharging.km)} km Luftlinie
                        </p>
                      )}
                      {selectedEdge.topFlows.length > 0 && (
                        <p className="mt-2 text-xs leading-relaxed text-[#6b6b70]">
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
                        <div className="mt-5 border-t border-[#e4e4e1] pt-4">
                          {selectedEdgeTrend.profile?.werktag && (
                            <div>
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-xs font-medium text-[#6b6b70]">
                                  Gemessene Lkw pro Stunde · Montag bis Freitag
                                </p>
                                <p className="text-xs text-[#6b6b70] tabular-nums">
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
                                      className="flex-1 rounded-sm bg-[#1d3bff]"
                                      style={{
                                        height: `${Math.max(4, (value / max) * 100)}%`,
                                        opacity: 0.4 + 0.6 * (value / max),
                                      }}
                                      title={`${hour}–${hour + 1} Uhr: ${formatNumber(value)} Lkw/h`}
                                    />
                                  );
                                })}
                              </div>
                              <div className="mt-1 flex justify-between text-[10px] text-[#6b6b70]">
                                <span>0 Uhr</span>
                                <span>12 Uhr</span>
                                <span>24 Uhr</span>
                              </div>
                            </div>
                          )}
                          {selectedEdgeTrend.trend && (
                            <p className="mt-3 text-sm text-[#55555a]">
                              Veränderung im damaligen 12-Monats-Modelltest:{" "}
                              <span
                                className={`font-semibold ${
                                  selectedEdgeTrend.trend.trendPctP50 >= 0
                                    ? "text-[#1d3bff]"
                                    : "text-[#8b570b]"
                                }`}
                              >
                                {selectedEdgeTrend.trend.trendPctP50 >= 0 ? "+" : ""}
                                {formatPercent(selectedEdgeTrend.trend.trendPctP50)}
                              </span>{" "}
                              <span className="text-[#6b6b70]">
                                (unterer Modellwert {selectedEdgeTrend.trend.trendPctP10 > 0 ? "+" : ""}
                                {formatPercent(selectedEdgeTrend.trend.trendPctP10)} · oberer Modellwert{" "}
                                {selectedEdgeTrend.trend.trendPctP90 > 0 ? "+" : ""}
                                {formatPercent(selectedEdgeTrend.trend.trendPctP90)})
                              </span>
                            </p>
                          )}
                          <p className="mt-1.5 text-xs text-[#6b6b70]">
                            Zählstelle {selectedEdgeTrend.station.name} (
                            {selectedEdgeTrend.station.strasse}),{" "}
                            {selectedEdgeTrend.station.distanceKm.toLocaleString("de-DE")} km
                            entfernt
                            {selectedEdgeTrend.station.directionShareR1 != null &&
                              ` · Verkehr je Richtung: ${Math.round(selectedEdgeTrend.station.directionShareR1 * 100)} % / ${Math.round((1 - selectedEdgeTrend.station.directionShareR1) * 100)} %`}
                            {selectedEdgeTrend.trend && " · Historischer Chronos-2-Test mit Daten bis 2023."}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-[#cfcfcb] px-5 py-4 text-sm text-[#6b6b70]">
                      Noch kein Straßenabschnitt ausgewählt.
                    </p>
                  )}

                  <div data-tour="gaps" className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#3a3a3e]">
                      Die {data.edgeHotspots.length} verkehrsstärksten Abschnitte im Modell
                    </p>
                    {liveHubs.length > 0 && (
                      <label className="flex shrink-0 items-center gap-2 text-xs text-[#3a3a3e]">
                        <input type="checkbox" checked={onlyWhiteSpots} onChange={(event) => setOnlyWhiteSpots(event.target.checked)} className="accent-[#b57612]" />
                        Ohne nahen Ladepark ({whiteSpotCount})
                      </label>
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
                            isSelected ? "bg-[#e5e9ff]" : "hover:bg-[#f2f2ef]"
                          }`}
                        >
                          <span className="w-6 shrink-0 text-xs text-[#6b6b70] tabular-nums">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#0a0a0b]">
                              {edgeLabel(edge)}
                            </span>
                            <span className="block text-xs text-[#6b6b70] tabular-nums">
                              ≈ {formatNumber(edge.trucks2030 / 365)} Lkw/Tag · Modell 2030
                            </span>
                          </span>
                          {info?.whiteSpot && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-[#ff4f00]"
                              title={`Kein dokumentierter Lkw-Ladepark im Umkreis von ${WHITE_SPOT_KM} km Luftlinie`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "korridore" && (
                <div data-tour="corridors" className="mt-4 space-y-4">
                  {selectedCorridor ? (
                    <div className="rounded-lg border border-[#e4e4e1] bg-white p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold tracking-[-0.01em]">
                          {selectedCorridor.corridor.originRegion}
                          {" → "}
                          {selectedCorridor.corridor.destinationRegion}
                        </p>
                        {selectedCorridor.corridor.crossBorder && (
                          <span className="bg-[#e5e9ff] px-2 py-1 text-xs font-semibold text-[#1d3bff]">
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
                          label="Fahrten/Jahr · Modell 2030"
                          value={formatCompact(selectedCorridor.corridor.trucks2030)}
                          sub={`Wachstum ${formatPercent(selectedCorridor.score.growthPercent)}`}
                        />
                      </div>
                      <div className="mt-4">
                        <ComponentBar
                          label="Bewertung der Fahrtlänge"
                          value={selectedCorridor.score.components.distanceFit}
                          explainer="Fahrten zwischen 150 und 600 km werden in diesem Score höher gewichtet."
                        />
                      </div>
                      {corridorStats && (
                        <p className="mt-4 text-sm text-[#55555a]">
                          {corridorStats.hubsOnRoute > 0
                            ? `${corridorStats.hubsOnRoute} bekannte Lkw-Ladepark${corridorStats.hubsOnRoute > 1 ? "s" : ""} im Umfeld der Verbindung · größter Abstand ohne erfassten Ladepark ≈ ${formatNumber(corridorStats.maxGapKm)} km. Luftlinie.`
                            : "Im Umfeld dieser Verbindung ist kein Lkw-Ladepark erfasst."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-[#cfcfcb] px-5 py-4 text-sm text-[#6b6b70]">
                      Noch keine Verbindung ausgewählt. Die Abstände zu Ladeparks werden
                      entlang der Luftlinie geschätzt, nicht entlang einer geprüften Straßenroute.
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
                            isSelected ? "bg-[#e5e9ff]" : "hover:bg-[#f2f2ef]"
                          }`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#f2f2ef] text-sm font-bold text-[#1d3bff] tabular-nums">
                            {score.score}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#0a0a0b]">
                              {shortName(corridor.originRegion)}
                              {corridor.originCountry !== "DE" && ` (${corridor.originCountry})`}
                              {" → "}
                              {shortName(corridor.destinationRegion)}
                              {corridor.destinationCountry !== "DE" &&
                                ` (${corridor.destinationCountry})`}
                            </span>
                            <span className="block text-xs text-[#6b6b70] tabular-nums">
                              {formatNumber(corridor.totalDistanceKm)} km ·{" "}
                              {formatCompact(corridor.trucks2030)} Fahrten/Jahr · Modell 2030
                            </span>
                          </span>
                          {corridor.crossBorder && (
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#1d3bff]">
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
                  <div className="rounded-lg border border-[#e4e4e1] bg-white p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-bold tracking-[-0.01em]">
                          {selected.region.name}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-[#1d3bff]">
                          Platz {selectedRank} von {scoredRegions.length} Regionen
                        </p>
                        <div className="mt-3">
                          <ScorePill score={selected.score.score} />
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-[#6b6b70]">
                          {selectedClassification.description}
                        </p>
                      </div>
                      <ScoreDial score={selected.score.score} />
                    </div>

                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <ComponentBar
                        label="Verkehrsmenge"
                        value={selected.score.components.volume}
                        explainer={`${formatCompact(selected.region.trucks2030)} berechnete Lkw-Fahrten im Jahr 2030. Verglichen mit der verkehrsstärksten Region; sehr große Unterschiede werden abgeschwächt.`}
                      />
                      <ComponentBar
                        label="Wachstum"
                        value={selected.score.components.growth}
                        explainer={`${formatPercent(selected.score.growthPercent)} Veränderung gegenüber 2019 im Modell. Gemeint sind alle Lkw, nicht nur elektrische.`}
                      />
                      <ComponentBar
                        label="Bewertung der Fahrtlängen"
                        value={selected.score.components.distanceFit}
                        explainer="Bewertet wird die Länge der Fahrten. Fahrten zwischen 150 und 600 km zählen stärker, weil unterwegs Laden eher relevant sein könnte."
                      />
                      <ComponentBar
                        label="Bedeutung der Verbindungen"
                        value={selected.score.components.corridorRelevance}
                        explainer={`${formatPercent(selected.region.crossBorderShare * 100)} grenzüberschreitend (${formatCompact(selected.region.crossBorderTrucks2030)} Fahrten).`}
                      />
                    </div>

                    <div className="mt-5 grid gap-5 border-t border-[#e4e4e1] pt-5 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium text-[#6b6b70]">
                          Berechneter Verkehr (Fahrten/Jahr)
                        </p>
                        <div className="mt-3">
                          <TrendBars region={selected.region} />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[#6b6b70]">
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
                                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#1d3bff]" />
                                ) : (
                                  <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-[#1d3bff]" />
                                )}
                                <span className="truncate font-medium text-[#0a0a0b]">
                                  {link.partnerName}
                                  {link.partnerCountry !== "DE" && ` (${link.partnerCountry})`}
                                </span>
                              </span>
                              <span className="shrink-0 text-[#6b6b70] tabular-nums">
                                {formatCompact(link.trucks2030)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <label data-tour="region-search" className="flex min-h-10 items-center gap-3 rounded-lg border border-[#e4e4e1] bg-white px-4 text-sm focus-within:border-[#1d3bff]">
                    <Search className="h-4 w-4 text-[#6b6b70]" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      aria-label="Region suchen"
                      placeholder="Hamburg, Berlin, Köln..."
                      className="w-full bg-transparent text-[#0a0a0b] placeholder:text-[#8e8e93] outline-none"
                    />
                  </label>

                  <p role="status" className="text-xs text-[#6b6b70]">
                    {filteredRegions.length === 0 ? "Keine passende Region gefunden." : `${filteredRegions.length} Regionen`}
                  </p>
                  <div className="max-h-[20rem] space-y-1.5 overflow-auto pr-1">
                    {filteredRegions.map(({ region, score }) => (
                      <button
                        key={region.id}
                        type="button"
                        onClick={() => setSelectedRegionId(region.id)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                          region.id === selected.region.id
                            ? "bg-[#e5e9ff]"
                            : "hover:bg-[#f2f2ef]"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#0a0a0b]">
                            {region.name}
                          </span>
                          <span className="block text-xs text-[#6b6b70] tabular-nums">
                            Platz {regionRank.get(region.id)} ·{" "}
                            {formatCompact(region.trucks2030)} Fahrten/Jahr · Modell 2030
                          </span>
                        </span>
                        <span className="shrink-0 text-base font-bold text-[#1d3bff] tabular-nums">
                          {score.score}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "standort" && (
                <div className="mt-4 space-y-4">
                  <div data-tour="site-search" className="flex gap-2">
                    <label className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg border border-[#e4e4e1] bg-white px-4 text-sm focus-within:border-[#1d3bff]">
                      <Search className="h-4 w-4 shrink-0 text-[#6b6b70]" />
                      <input
                        value={placeQuery}
                        onChange={(event) => setPlaceQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void searchPlace();
                        }}
                        aria-label="Adresse oder Ort"
                        placeholder="Adresse oder Ort"
                        className="w-full bg-transparent text-[#0a0a0b] placeholder:text-[#8e8e93] outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void searchPlace()}
                      disabled={placeSearching}
                      className="rounded-lg bg-[#1d3bff] px-4 text-sm font-semibold text-white transition hover:bg-[#0f27d6] disabled:opacity-50"
                    >
                      {placeSearching ? "…" : "Prüfen"}
                    </button>
                  </div>
                  {placeError && <p className="text-xs text-[#8b570b]">{placeError}</p>}
                  <WatchlistPanel watch={watch} onOpen={addPin} dataDate={charging?.metadata.bnetzaDataDate || null} />
                  <SiteFinder edges={consistentPlanningData?.network.edges ?? NO_EDGES} hubs={liveHubs} substations={substations} onPick={addPin} />

                  {pins.length === 0 && (
                    <p className="rounded-lg border border-dashed border-[#cfcfcb] px-5 py-4 text-sm leading-relaxed text-[#6b6b70]">
                      Noch kein Standort ausgewählt.
                    </p>
                  )}

                  {pins.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pins.map((pin, index) => (
                        <div
                          key={pin.id}
                          className={`group flex min-w-0 max-w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                            pin.id === (activePin?.id || "")
                              ? "bg-[#1d3bff] text-white"
                              : "bg-[#f2f2ef] text-[#3a3a3e] hover:text-[#0a0a0b]"
                          }`}
                        >
                          <button type="button" onClick={() => setActivePinId(pin.id)} className="min-w-0 break-words text-left" aria-pressed={pin.id === activePin?.id}>
                            {index + 1} · {pin.label || `${pin.lat.toFixed(3)}, ${pin.lon.toFixed(3)}`}
                          </button>
                          <button
                            type="button"
                            aria-label="Standort entfernen"
                            title="Standort entfernen"
                            onClick={() => {
                              setPins((current) => current.filter((p) => p.id !== pin.id));
                              setBasisChoices((current) => { const next = { ...current }; delete next[pin.id]; return next; });
                              setPlaceError("");
                            }}
                            className="shrink-0 p-1 opacity-60 hover:opacity-100"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {activePin && activeAssessment && (
                    <div className="border-t border-[#0a0a0b] bg-white pt-5">
                      <div data-tour="basis"><TrafficBasisSelect id="screening-basis" siteLabel={activePin.label} context={activeTraffic} choice={basisChoices[activePin.id]} onChange={(choice) => changeBasis(activePin.id, choice)} unavailable={siteDataError || (!consistentPlanningData ? "Standortdaten werden geladen" : undefined)} /></div>
                      {siteDataError && <button type="button" onClick={() => setPlanningRetry((n) => n + 1)} className="mt-2 text-xs font-semibold text-[#1d3bff]">Erneut laden</button>}
                      <div className="mt-3"><WatchButton watch={watch} site={{ ...activePin, label: activePin.label || `${activePin.lat.toFixed(3)}, ${activePin.lon.toFixed(3)}` }} /></div>
                      <SiteEvidence context={activeTraffic} networkSize={consistentPlanningData?.network.edges.length} />
                      <SiteSurroundings site={activePin} />
                      {verdict && verdict.siteId === activePin.id && (
                        <a href="#wirtschaftlichkeit" className="group mt-5 block bg-[#1d3bff] p-5 text-white transition hover:bg-[#0f27d6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a0a0b]">
                          <span className="font-mono text-[11px] text-white/70">Ergebnis</span>
                          <span className="mt-1.5 block text-2xl font-semibold leading-tight tracking-[-0.03em]">{verdict.title}</span>
                          <span className="mt-2 block font-mono text-[13px] tabular-nums text-white/85">
                            Kapitalwert {[verdict.low, verdict.base, verdict.high].map((v) => `${v < 0 ? "−" : ""}${Math.abs(v / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 2 })}`).join(" · ")} Mio. €
                          </span>
                          <span className="mt-3 block text-xs text-white/70 group-hover:text-white">Niedrig · Basis · Hoch · Details und Annahmen ansehen →</span>
                        </a>
                      )}
                      <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-[#55555a]">
                        {activeAssessment.reasons.filter((reason) => !reason.includes("Modellstrecke")).map((reason) => (
                          <li key={reason} className="flex gap-2">
                            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#1d3bff]" />
                            {reason}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[#e4e4e1] pt-4 sm:grid-cols-4">
                        <DetailStat
                          label="Berechneter Straßenabschnitt"
                          value={
                            activeAssessment.edge
                              ? `#${activeAssessment.edge.edgeId}`
                              : "—"
                          }
                          sub={
                            activeAssessment.edge
                              ? `${activeAssessment.edge.km.toLocaleString("de-DE")} km Abstand auf der Karte`
                              : consistentPlanningData ? "Keine Strecke ≤ 10 km" : "Zuordnung offen"
                          }
                        />
                        <DetailStat
                          label="Nächster bekannter Lkw-Ladepark"
                          value={
                            activeAssessment.hub
                              ? `${activeAssessment.hub.km.toLocaleString("de-DE")} km`
                              : "—"
                          }
                          sub={activeAssessment.hub ? `${activeAssessment.hub.name} · Luftlinie` : undefined}
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
                          label="Nächstes Umspannwerk"
                          value={
                            activeAssessment.substation
                              ? `${activeAssessment.substation.km.toLocaleString("de-DE")} km`
                              : "—"
                          }
                          sub={
                            activeAssessment.substation
                              ? `${activeAssessment.substation.kv} kV`
                              : undefined
                          }
                        />
                      </div>
                      <SiteAccessCheck key={`${activePin.id}:${activeTraffic?.edge?.edge.edgeId ?? "none"}`} site={{ ...activePin, label: activePin.label || "Standort" }} context={activeTraffic} />
                      {activePin && (
                        <div className="mt-4 border-t border-[#e4e4e1] pt-4">
                          <a href="#wirtschaftlichkeit" className="inline-flex items-center gap-2 text-sm font-semibold text-[#1d3bff]">Wirtschaftlichkeit berechnen <ArrowRight size={16} /></a>
                          <p className="mt-2 text-xs leading-relaxed text-[#6b6b70]">Einnahmen, Kosten und mögliche Ladungen für 2027–2036.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {pins.length >= 2 && (
                    <div className="rounded-lg border border-[#e4e4e1] bg-white p-4">
                      <p className="text-xs font-medium text-[#6b6b70]">
                        Vergleich
                      </p>
                      <table className="mt-2 w-full text-sm">
                        <tbody>
                          {pins.map((pin, index) => {
                            const a = assessments.get(pin.id);
                            const traffic = siteTraffic.get(pin.id)?.traffic;
                            return (
                              <tr key={pin.id} className="border-t border-[#e4e4e1] first:border-0">
                                <td className="py-2 pr-2 text-[#6b6b70] tabular-nums">{index + 1}</td>
                                <td className="py-2 pr-3">
                                  <span className="text-xs text-[#55555a]">{traffic?.source.kind === "measured" ? "Messung · Zuordnung offen" : traffic ? "Modell · synthetisch" : "Quelle offen"}</span>
                                </td>
                                <td className="py-2 pr-3 text-[#55555a] tabular-nums">
                                  {traffic ? `≈ ${formatNumber(traffic.trucksPerDay)} ${traffic.vehicleClass === "truck" ? "Lkw" : "SV"}/Tag · ${traffic.referenceYear}` : "—"}
                                </td>
                                <td className="py-2 text-[#55555a] tabular-nums">
                                  {a?.hub ? `Lader ${Math.round(a.hub.km)} km` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="mt-2 text-xs text-[#6b6b70]">SV = Schwerverkehr, einschließlich anderer Fahrzeuge.</p>
                    </div>
                  )}

                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeTab === "standort" && pins.length > 0 && (
        <SiteEconomics
          sites={pins.map((pin, index) => ({ ...pin, label: pin.label || `Standort ${index + 1} (${pin.lat.toFixed(3)}, ${pin.lon.toFixed(3)})`, assessment: assessments.get(pin.id) }))}
          activeId={activePin?.id || ""}
          onSelect={setActivePinId}
          registerDate={charging?.metadata.bnetzaDataDate || null}
          data={consistentPlanningData}
          dataError={siteDataError}
          onRetry={() => setPlanningRetry((n) => n + 1)}
          choices={basisChoices}
          onBasisChange={changeBasis}
          onVerdict={setVerdict}
        />
      )}
      {activeTab === "standort" && pins.length > 0 && !embed && (
        <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-12">
        <div className="rounded-lg border border-[#e4e4e1] bg-white p-5">
          {leadStatus === "sent" ? (
            <p className="text-sm leading-relaxed text-[#3a3a3e]">
              Danke für deine Anfrage! Wir melden uns, um deine Standorte und die nächsten Prüfungen zu besprechen.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-[#0a0a0b]">
                Standorte gemeinsam prüfen
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#6b6b70]">
                Lass uns besprechen, welche Kundendaten, Netzangebote und Kostenangaben
                für eine belastbare Planung deiner Standorte noch fehlen.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <input
                  value={lead.name}
                  onChange={(event) => setLead({ ...lead, name: event.target.value })}
                  placeholder="Name*"
                  className="rounded-lg border border-[#e4e4e1] bg-white px-3 py-2 text-sm text-[#0a0a0b] placeholder:text-[#8e8e93] outline-none focus:border-[#1d3bff]"
                />
                <input
                  value={lead.email}
                  onChange={(event) => setLead({ ...lead, email: event.target.value })}
                  placeholder="E-Mail*"
                  type="email"
                  className="rounded-lg border border-[#e4e4e1] bg-white px-3 py-2 text-sm text-[#0a0a0b] placeholder:text-[#8e8e93] outline-none focus:border-[#1d3bff]"
                />
                <input
                  value={lead.company}
                  onChange={(event) =>
                    setLead({ ...lead, company: event.target.value })
                  }
                  placeholder="Firma"
                  className="rounded-lg border border-[#e4e4e1] bg-white px-3 py-2 text-sm text-[#0a0a0b] placeholder:text-[#8e8e93] outline-none focus:border-[#1d3bff]"
                />
                {/* Honeypot: hidden from people and assistive tech, filled only by bots. */}
                <input
                  value={lead.website}
                  onChange={(event) => setLead({ ...lead, website: event.target.value })}
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute -left-[9999px] h-px w-px opacity-0"
                />
              </div>
              <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[#6b6b70]">
                <input
                  type="checkbox"
                  checked={lead.consent}
                  onChange={(event) => setLead({ ...lead, consent: event.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  Ich bin einverstanden, dass meine Angaben und die gewählten Standorte per E-Mail an das Truckonomics-Team
                  übermittelt und nur zur Beantwortung dieser Anfrage verwendet werden. Ich kann die Einwilligung jederzeit
                  per E-Mail widerrufen.*
                </span>
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => void submitLead()}
                  disabled={
                    leadStatus === "sending" ||
                    !lead.name.trim() ||
                    !lead.email.trim() ||
                    !lead.consent
                  }
                  className="rounded-md bg-[#1d3bff] px-5 text-white hover:bg-[#0f27d6]"
                >
                  {leadStatus === "sending" ? "Sende…" : "Anfrage senden"}
                </Button>
                <a href="https://depot-readiness-check.vercel.app/">
                  <Button
                    variant="outline"
                    className="rounded-md border-[#cfcfcb] bg-white text-[#0a0a0b] hover:bg-[#f2f2ef]"
                  >
                    Depot-Check öffnen
                  </Button>
                </a>
                {leadStatus === "limited" && (
                  <span className="text-xs text-[#8b570b]">
                    Gerade sind zu viele Anfragen eingegangen. Bitte versuche es in einer Stunde erneut.
                  </span>
                )}
                {leadStatus === "error" && (
                  <span className="text-xs text-[#8b570b]">
                    Die Anfrage konnte nicht gesendet werden. Bitte versuche es später erneut.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        </section>
      )}

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-12 sm:px-6 lg:px-12">
        <section id="methodik">
          <p className="text-xs font-semibold text-[#1d3bff]">
            Daten & Aussagekraft
          </p>
          <h2 className="mt-1.5 max-w-2xl text-2xl font-bold leading-tight">
            Was die Daten zeigen. Und was noch offen ist.
          </h2>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-[#e4e4e1] bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-[#1d3bff]" />
                <div>
                  <h3 className="text-base font-bold">Viel Verkehr heißt nicht automatisch viele Ladekunden</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#55555a]">
                    Der Score vergleicht Regionen und Verbindungen nach ihrem berechneten
                    Lkw-Verkehr. Er sagt nicht, wie viele dieser Lkw elektrisch fahren oder
                    hier laden würden. Die Werte für 2010, 2019 und 2030 stammen aus einem
                    synthetischen Datensatz: Die Fahrten sind berechnet, nicht einzeln beobachtet.
                  </p>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#55555a]">
                    Die Wirtschaftlichkeitsrechnung ist davon getrennt und verwendet deine
                    Annahmen. Netzanschluss, Fläche, Zufahrt, Haltezeiten und feste Kunden
                    müssen vor einer Investition zusätzlich geprüft werden.
                  </p>
                  <details className="mt-3 text-xs leading-relaxed text-[#6b6b70]"><summary>Bekannte Einschränkung des Verkehrsmodells</summary><p className="mt-2">Einzelne Strecken können im Ausgangsdatensatz in der falschen Fahrtrichtung aufgeführt sein. Die Richtung einer Modellstrecke ist deshalb kein gesicherter Nachweis.</p><p className="mt-2">{data.metadata.knownCaveat}</p></details>
                  <a
                    href={data.metadata.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#1d3bff]"
                  >
                    Quelle ansehen
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </div>

            {validation && (
              <div className="rounded-lg border border-[#e4e4e1] border-l-[3px] border-l-[#1d3bff] bg-white p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-[#1d3bff]" />
                  <div>
                    <h3 className="text-base font-bold">
                      Mit Verkehrszählungen verglichen
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-[#55555a]">
                      Berechnete Abschnitte mit viel Verkehr sind meist auch in den Messungen
                      stärker befahren. Der Vergleich mit {validation.stationCount}{" "}
                      Autobahn-Zählstellen aus {validation.year} ergibt eine Ähnlichkeit der Rangfolge von{" "}
                      <strong className="text-[#0a0a0b]">
                        {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
                          validation.spearman,
                        )}
                      </strong>{" "}
                      über {validation.matchedEdges} zugeordnete Abschnitte. Das ist keine
                      Aussage wie „81 % genau“ und bestätigt keine Ladekundenzahl.
                    </p>
                    <p className="mt-2.5 text-xs leading-relaxed text-[#6b6b70]">
                      Verglichen werden berechnete Werte für 2019 mit Messungen von {validation.year}.
                      Die Messungen enthalten auch Busse. Die Zuordnung erfolgt nach Nähe
                      auf der Karte, nicht nach einer geprüften Straßenverbindung.
                  </p>
                    <details className="mt-3 text-xs leading-relaxed text-[#6b6b70]"><summary>Genaue Vergleichsmethode</summary><p className="mt-2">{validation.methodNote}</p></details>
                    <a
                      href={validation.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#1d3bff]"
                    >
                      Verkehrszählstellen der BASt ansehen
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {charging && (
              <div className="rounded-lg border border-[#e4e4e1] bg-white p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <PlugZap className="mt-1 h-5 w-5 shrink-0 text-[#7c3aed]" />
                  <div>
                    <h3 className="text-base font-bold">
                      Welche Ladeparks erfasst sind
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-[#55555a]">
                      {liveHubs.length} dokumentierte Lkw-Ladeparks in Betrieb (Milence, Aral
                      pulse, Daimler TruckCharge, E.ON Drive/MAN u. a.), dazu{" "}
                      {charging.verified.length - liveHubs.length} angekündigte. Quelle:
                      Ladepunktregister der Bundesnetzagentur (Stand{" "}
                      {new Date(charging.metadata.bnetzaDataDate).toLocaleDateString("de-DE")})
                      und Betreiber-Pressemitteilungen, je Standort dokumentiert.
                    </p>
                    <p className="mt-2.5 text-xs leading-relaxed text-[#6b6b70]">
                      Als Lkw-Ladepark zählt hier ein Standort mit einem belegten Angebot
                      für Lkw. Hohe Ladeleistung allein genügt dafür nicht: Ein Sattelzug
                      muss den Platz auch erreichen und dort rangieren können.
                  </p>
                    <details className="mt-3 text-xs leading-relaxed text-[#6b6b70]"><summary>So werden die Standorte ausgewählt</summary><p className="mt-2">{charging.metadata.methodNote}</p></details>
                  </div>
                </div>
              </div>
            )}

            {trendData && (
              <div className="rounded-lg border border-[#e4e4e1] bg-white p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <Gauge className="mt-1 h-5 w-5 shrink-0 text-[#1d3bff]" />
                  <div>
                    <h3 className="text-base font-bold">
                      Was der bisherige Prognosetest gezeigt hat
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-[#55555a]">
                      Für {Object.keys(trendData.edges).length} verkehrsstarke Abschnitte
                      liegen Stundenmessungen nahe gelegener Zählstellen aus 2016–2023 vor.
                      Mit dem KI-Modell Chronos-2 wurde geprüft, wie gut sich ein damals
                      noch zurückgehaltenes Jahr vorhersagen ließ. Nur{" "}
                      {trendData.metadata.stationsBeatingNaive} von {trendData.metadata.stationsBacktested}{" "}
                      getesteten Stationen waren besser als die einfache Annahme:
                      „Diese Woche wird wie dieselbe Woche im Vorjahr.“
                    </p>
                    <p className="mt-2.5 text-xs leading-relaxed text-[#6b6b70]">
                      Das Modell war nicht durchgängig besser.
                  </p>
                    <details className="mt-3 text-xs leading-relaxed text-[#6b6b70]"><summary>Testergebnisse & Rechenmethode</summary><p className="mt-2">Typische Verbesserung gegenüber dem Vorjahresvergleich (Median): {trendData.metadata.medianSkillVsSeasonalNaive === null ? "nicht verfügbar" : formatPercent(trendData.metadata.medianSkillVsSeasonalNaive * 100)}. Ein negativer Wert bedeutet einen größeren Fehler als beim einfachen Vergleich. Der für 80 % der Werte vorgesehene Modellbereich enthielt {trendData.metadata.meanCoverage80 === null ? "einen nicht verfügbaren Anteil" : formatPercent(trendData.metadata.meanCoverage80 * 100)} der gemessenen Werte.</p><p className="mt-2">{trendData.metadata.methodNote}</p></details>
                    <a
                      href={trendData.metadata.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#1d3bff]"
                    >
                      Stündliche Verkehrsmessungen ansehen
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>

        {!embed && (
          <section className="rounded-lg border border-[#e4e4e1] bg-white p-5 sm:p-8">
            <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
              <div>
                <h2 className="max-w-2xl text-xl font-bold leading-snug">
                  Ein eigenes Depot elektrifizieren?
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#55555a]">
                  Der Ladepark-Check betrachtet Verkehr und mögliche externe
                  Ladekunden. Für die eigene Flotte geht es zusätzlich um Netzanschluss,
                  Fläche und Fahrzeuge. Dafür gibt es den getrennten Depot-Check.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="https://depot-readiness-check.vercel.app/">
                  <Button className="rounded-md bg-[#1d3bff] px-5 text-white hover:bg-[#0f27d6]">
                    Depot-Check öffnen
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </a>
                <a href="https://truckonomics.vercel.app/">
                  <Button
                    variant="outline"
                    className="rounded-md border-[#cfcfcb] bg-white px-5 text-[#0a0a0b] hover:bg-[#f2f2ef]"
                  >
                    Lkw-Kosten vergleichen
                  </Button>
                </a>
              </div>
            </div>
          </section>
        )}

        <footer className="pb-6 text-center text-xs text-[#6b6b70]">
          Verkehrsauswertung erstellt am:{" "}
          {new Date(data.metadata.generatedAt).toLocaleDateString("de-DE", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          · {data.metadata.source} · {formatNumber(data.summary.flowRows)} ausgewertete
          Verbindungen zwischen Start- und Zielregionen. Die weiteren Quellen haben jeweils ihren eigenen Datenstand.
        </footer>
      </main>
    </div>
  );
}
