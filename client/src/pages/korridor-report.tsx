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
import {
  DEFAULT_ASSUMPTIONS,
  FEASIBILITY_LABELS,
  aggregateReport,
  evaluateRelation,
  type EvaluatedRelation,
  type ReportAssumptions,
  type ReportRelation,
} from "@shared/korridor-report";

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
  backdrop: [number, number][];
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
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Korridor-Report – Truckonomics";
    const params = new URLSearchParams(window.location.search);
    const id = (params.get("id") || "demo").replace(/[^a-z0-9-]/gi, "");
    Promise.all([
      fetch(`/data/reports/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`Report-Konfiguration "${id}" nicht gefunden`);
        return r.json();
      }),
      fetch("/data/traffic-opportunity-de.json").then((r) => r.json()),
      fetch("/data/truck-charging-de.json").then((r) => r.json()),
    ])
      .then(([cfg, trafficData, chargingData]) => {
        setConfig(cfg);
        setTraffic(trafficData);
        setCharging(chargingData);
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

  const evaluated = useMemo(() => {
    if (!config || !traffic) return [];
    const regionsById = new Map(traffic.regions.map((region) => [region.id, region]));
    return config.relations
      .map((relation) =>
        evaluateRelation(relation, regionsById, traffic.corridors, liveHubs, assumptions),
      )
      .filter((value): value is EvaluatedRelation => value !== null);
  }, [config, traffic, liveHubs, assumptions]);

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
      return [
        {
          label: relation.name,
          aLon: origin.lon,
          aLat: origin.lat,
          bLon: destination.lon,
          bLat: destination.lat,
        },
      ];
    });
  }, [config, regionsById]);

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
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">{error}</h1>
          <p className="mt-2 text-[#6e6e73]">
            Konfigurationen liegen unter client/public/data/reports/&lt;id&gt;.json
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
              <p className="text-xs text-[#6e6e73]">Truckonomics · Traffic Opportunity</p>
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
            Korridor-Report
          </p>
          <h1 className="mt-3 text-5xl font-semibold leading-[1.04] tracking-[-0.025em]">
            {config.company}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#6e6e73]">
            Welche Ihrer Strecken sind heute schon elektrisch wirtschaftlich – und wo entsteht
            Ladeinfrastruktur entlang Ihrer Korridore? Kein Prospekt. Ihre Zahlen.
          </p>
          {config.isDemo && (
            <p className="mt-4 inline-flex rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-800">
              Demo-Exemplar mit fiktiven Relationen
            </p>
          )}
        </div>

        <div className="mt-12 grid grid-cols-2 gap-4">
          <KpiTile
            label="Relationen analysiert"
            value={String(totals.relationCount)}
            detail={`Flotte: ${config.fleet.trucks} Fahrzeuge · ${formatNumber(totals.annualKm)} km/Jahr auf diesen Strecken.`}
          />
          <KpiTile
            label="Heute elektrisch fahrbar"
            value={`${totals.readyCount} von ${totals.relationCount}`}
            detail={
              totals.plannableCount > 0
                ? `Plus ${totals.plannableCount} mit fester Ladeplanung machbar.`
                : "Auf Basis verifizierter Lkw-Ladeparks und Reichweite."
            }
          />
          <KpiTile
            label="Energie- & Mautvorteil"
            value={`≈ ${formatEur(totals.annualSavingEur)}/Jahr`}
            detail="Vereinfachtes Modell, Annahmen auf der letzten Seite."
          />
          <KpiTile
            label="CO₂-Einsparung"
            value={`≈ ${formatNumber(totals.annualCo2SavedTons)} t/Jahr`}
            detail="Für Ihre Kundenkommunikation und Scope-3-Berichte."
          />
        </div>

        <div className="mt-auto rounded-2xl bg-[#fbfbfd] p-5">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-[#6e6e73]">
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0A99A4]" />
            <span>
              Datenbasis: {formatNumber(1514573)} modellierte Verkehrsbeziehungen (
              {traffic.metadata.source})
              {validation &&
                `, validiert gegen ${validation.stationCount} BASt-Zählstellen (Rangkorrelation ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(validation.spearman)})`}
              ; Lkw-Ladeparks aus dem BNetzA-Ladesäulenregister (Stand{" "}
              {new Date(charging.metadata.bnetzaDataDate).toLocaleDateString("de-DE")}) und
              dokumentierten Betreiberquellen.
            </span>
          </p>
        </div>
      </section>

      {/* Seite 2: Karte */}
      <section className="report-page">
        <h2 className="text-3xl font-semibold tracking-[-0.02em]">
          Ihre Korridore im Verkehrs- und Ladebild
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#6e6e73]">
          Gestrichelte Linien: Ihre Relationen (Luftlinie). Türkis: die stärksten
          Lkw-Verkehrsabschnitte Deutschlands 2030. Violette Rauten: verifizierte Lkw-Ladeparks
          (Umriss = angekündigt).
        </p>
        <div className="mx-auto mt-5 w-[136mm] rounded-2xl border border-black/[0.08] bg-[#fbfbfd] p-4">
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
        <div className="mt-4 space-y-1">
          {evaluated.map((row) => (
            <p key={row.relation.name} className="text-sm text-[#6e6e73]">
              <span className="font-semibold text-[#1d1d1f]">{row.relation.name}</span> ·{" "}
              {formatNumber(row.distanceKm)} km{" "}
              {row.distanceSource === "korridor" ? "(Straßenroute)" : "(Luftlinie × 1,25)"} ·{" "}
              {row.relation.tripsPerWeek} Fahrten/Woche
            </p>
          ))}
        </div>
      </section>

      {/* Seite 3: Relationen im Detail */}
      <section className="report-page">
        <h2 className="text-3xl font-semibold tracking-[-0.02em]">Relationen im Detail</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#6e6e73]">
          Bewertung je Strecke: Machbarkeit heute (Reichweite {assumptions.truckRangeKm} km,
          Depotladung an Start und Ziel), Lade-Realität entlang der Route und der jährliche
          Energie- und Mautvorteil gegenüber Diesel.
        </p>

        <div className="mt-5 space-y-3">
          {evaluated.map((row) => {
            const feasibility = FEASIBILITY_LABELS[row.feasibility];
            return (
              <div
                key={row.relation.name}
                className="report-card rounded-2xl border border-black/[0.08] bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-base font-semibold tracking-[-0.01em]">{row.relation.name}</p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${feasibilityBadgeClass(row.feasibility)}`}
                  >
                    {feasibility.label}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#9b9ba0]">
                      <Route className="mr-1 inline h-3.5 w-3.5" />
                      Strecke
                    </p>
                    <p className="mt-1 font-semibold">{formatNumber(row.distanceKm)} km</p>
                    <p className="text-xs text-[#6e6e73]">
                      Distanzfit {row.distanceFitScore}/100
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#9b9ba0]">
                      <PlugZap className="mr-1 inline h-3.5 w-3.5" />
                      Lade-Realität
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
                      {formatNumber(row.annualKm)} km · {row.annualCo2SavedTons} t CO₂
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#9b9ba0]">
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
          Annahmen, Methodik und nächste Schritte
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
              Reines Energie- und Mautkosten-Modell, ohne Anschaffung, Wartung und Restwert. Die
              Vollkostenrechnung je Fahrzeugprofil liefert der Truckonomics TCO-Rechner.
            </p>
          </div>

          <div className="rounded-2xl border border-black/[0.08] bg-white p-5">
            <h3 className="font-semibold">Methodik und Grenzen</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#6e6e73]">
              <li>
                Verkehrsdaten: synthetische ETISplus-Lkw-Flüsse (2010/2019/2030)
                {validation &&
                  `, gegen ${validation.stationCount} BASt-Autobahn-Zählstellen ${validation.year} geprüft (Spearman ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(validation.spearman)})`}
                .
              </li>
              <li>
                Lkw-Ladeparks: BNetzA-Ladesäulenregister plus dokumentierte Betreiberquellen;
                nur verifizierte Parks zählen in die Lücken-Berechnung.
              </li>
              <li>
                Ladelücken werden über die Luftlinie berechnet (Korridor-Puffer ±15 % der
                Strecke, mindestens 20 km) und auf Straßen-km skaliert – eine Näherung, keine
                Routenführung.
              </li>
              <li>Der E-Lkw-Hochlauf selbst ist nicht modelliert.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-[#1d1d1f] p-6 text-white">
          <h3 className="text-xl font-semibold tracking-[-0.02em]">Empfohlene nächste Schritte</h3>
          <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-white/80">
            <li className="flex gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#0DBBC8]" />
              Die {totals.readyCount} heute fahrbaren Relationen mit 2–3 Fahrzeugen pilotieren –
              dort entsteht der Business Case mit den wenigsten Annahmen.
            </li>
            <li className="flex gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#0DBBC8]" />
              Depot-Ladefähigkeit prüfen (Netzanschluss, Fläche, Lastmanagement) – der DepotOne
              Readiness Check liefert die strukturierte Bewertung.
            </li>
            <li className="flex gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#0DBBC8]" />
              Für Relationen mit Ladelücken: Ladestopps heute planen, denn entlang Ihrer
              Korridore sind weitere Parks angekündigt – die Lücken schließen sich.
            </li>
          </ol>
        </div>

        <p className="mt-auto pt-6 text-center text-xs text-[#9b9ba0]">
          Korridor-Report · Truckonomics / DepotOne · Erstellt am{" "}
          {reportDate.toLocaleDateString("de-DE")} · Alle Quellen dokumentiert und auf Anfrage
          einsehbar
        </p>
      </section>
    </div>
  );
}
