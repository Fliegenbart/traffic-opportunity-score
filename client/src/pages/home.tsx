import { useEffect, useState } from "react";
import { TruckParametersCard } from "@/components/truck-parameters-card";
import { TimeframeSelector } from "@/components/timeframe-selector";
import { TaxIncentiveSelector } from "@/components/tax-incentive-selector";
import { FleetSizeSelector } from "@/components/fleet-size-selector";
import { Button } from "@/components/ui/button";
import { SummaryMetrics } from "@/components/summary-metrics";
import { AmortizationChart } from "@/components/amortization-chart";
import { CostBreakdownChart } from "@/components/cost-breakdown-chart";
import { DetailedTCOTable } from "@/components/detailed-tco-table";
import { EnvironmentalImpactCard } from "@/components/environmental-impact-card";
import { TechnicalSpecsComparison } from "@/components/technical-specs-comparison";
import { EonDriveBenefits } from "@/components/eon-drive-benefits";
import { ConsultationCTA } from "@/components/consultation-cta";
import { PdfExportButton } from "@/components/pdf-export-button";
import { OperationProfileCard } from "@/components/operation-profile";
import { LifecycleAssumptionsCard } from "@/components/lifecycle-assumptions-card";
import { LifecycleInsightCard } from "@/components/lifecycle-insight-card";
import { Calculator, RotateCcw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  ComparisonResult,
  LifecycleAssumptions,
  TaxIncentiveRegion,
  TruckParameters,
} from "@shared/schema";
import { defaultLifecycleAssumptions } from "@shared/lifecycle";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/lib/tenant";
import { EmbedAutoResize } from "@/components/embed-auto-resize";
import type { OperationProfile } from "@/types/operation-profile";
import { Link } from "wouter";

const defaultDieselTruck: TruckParameters = {
  name: "Diesel-Sattelzug",
  type: "diesel",
  purchasePrice: 155000,
  annualMileage: 120000,
  fuelCostPerUnit: 1.65,
  maintenanceCostAnnual: 14000,
  insuranceCostAnnual: 11000,
  expectedLifespanYears: 12,
  fuelEfficiency: 32,
  technicalSpecs: {
    zulaessigesGesamtgewicht: 18000,
    zugGesamtgewicht: 40000,
    achskonfiguration: "4x2",
    nutzlast: 26000,
    leistungKW: 350,
    leistungPS: 476,
    drehmoment: 2300,
    tankKapazitaet: 400,
    reichweite: 1200,
    fahrerhaus: "Fernverkehr",
    laenge: 6200,
    hoehe: 3950,
  },
};

const defaultElectricTruck1: TruckParameters = {
  name: "Elektro-Sattelzug 1",
  type: "electric",
  purchasePrice: 170000,
  annualMileage: 120000,
  fuelCostPerUnit: 0.35,
  maintenanceCostAnnual: 7500,
  insuranceCostAnnual: 10000,
  expectedLifespanYears: 15,
  fuelEfficiency: 120,
  technicalSpecs: {
    zulaessigesGesamtgewicht: 27000,
    zugGesamtgewicht: 40000,
    achskonfiguration: "6x2",
    nutzlast: 22000,
    leistungKW: 400,
    leistungPS: 544,
    drehmoment: 2100,
    batterieKapazitaet: 600,
    reichweite: 500,
    ladeLeistungAC: 22,
    ladeLeistungDC: 400,
    fahrerhaus: "Fernverkehr",
    laenge: 6400,
    hoehe: 3950,
  },
};

const defaultElectricTruck2: TruckParameters = {
  name: "Elektro-Sattelzug 2",
  type: "electric",
  purchasePrice: 320000,
  annualMileage: 100000,
  fuelCostPerUnit: 0.35,
  maintenanceCostAnnual: 8500,
  insuranceCostAnnual: 11000,
  expectedLifespanYears: 12,
  fuelEfficiency: 130,
  technicalSpecs: {
    zulaessigesGesamtgewicht: 27000,
    zugGesamtgewicht: 44000,
    achskonfiguration: "6x4",
    nutzlast: 23000,
    leistungKW: 450,
    leistungPS: 612,
    drehmoment: 2200,
    batterieKapazitaet: 624,
    reichweite: 530,
    ladeLeistungAC: 43,
    ladeLeistungDC: 375,
    fahrerhaus: "Fernverkehr",
    laenge: 6450,
    hoehe: 4000,
  },
};

const defaultOperationProfile: OperationProfile = {
  presetId: "stueckgut",
  dailyKm: 200,
  dailyKmP90: 250,
  stopsPerDay: 12,
  stopMinutes: 20,
  workDaysPerYear: 250,
  opportunityCharging: true,
  opportunityChargeMinutes: 30,
  opportunityChargePowerKw: 150,
  publicChargeShare: 20,
  publicChargeCostPerKwh: 0.55,
  p90SharePercent: 10,
  downtimeCostPerDay: 1200,
  infrastructureCapex: 50000,
  infrastructureOpexAnnual: 1800,
  infrastructureLifetimeYears: 10,
  useP90ForCalc: false,
};

const defaultLifecycleState: LifecycleAssumptions = {
  ...defaultLifecycleAssumptions,
};

export default function Home() {
  const [dieselTruck, setDieselTruck] = useState<TruckParameters>(defaultDieselTruck);
  const [electricTruck1, setElectricTruck1] = useState<TruckParameters>(defaultElectricTruck1);
  const [electricTruck2, setElectricTruck2] = useState<TruckParameters>(defaultElectricTruck2);
  const [operationProfile, setOperationProfile] = useState<OperationProfile>(defaultOperationProfile);
  const [lifecycleAssumptions, setLifecycleAssumptions] =
    useState<LifecycleAssumptions>(defaultLifecycleState);
  const [syncMileage, setSyncMileage] = useState(true);
  const [timeframeYears, setTimeframeYears] = useState(10);
  const [taxIncentiveRegion, setTaxIncentiveRegion] = useState<TaxIncentiveRegion>("bundesfoerderung");
  const [fleetSize, setFleetSize] = useState(1);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const { toast } = useToast();
  const { tenant, embed } = useTenant();

  const baseDailyKm = operationProfile.useP90ForCalc
    ? operationProfile.dailyKmP90
    : operationProfile.dailyKm;
  const computedAnnualMileage = Math.max(
    0,
    Math.round(baseDailyKm * operationProfile.workDaysPerYear),
  );

  const publicChargeShare = operationProfile.opportunityCharging
    ? Math.min(Math.max(operationProfile.publicChargeShare, 0), 100) / 100
    : 0;
  const publicChargeCost = operationProfile.publicChargeCostPerKwh;

  const getEffectiveElectricCost = (baseCost: number) => {
    if (!operationProfile.opportunityCharging || publicChargeShare <= 0) {
      return baseCost;
    }
    return baseCost * (1 - publicChargeShare) + publicChargeCost * publicChargeShare;
  };

  const effectiveElectric1Cost = getEffectiveElectricCost(electricTruck1.fuelCostPerUnit);
  const effectiveElectric2Cost = getEffectiveElectricCost(electricTruck2.fuelCostPerUnit);
  useEffect(() => {
    if (!syncMileage) return;

    setDieselTruck((prev) =>
      prev.annualMileage === computedAnnualMileage
        ? prev
        : { ...prev, annualMileage: computedAnnualMileage },
    );
    setElectricTruck1((prev) =>
      prev.annualMileage === computedAnnualMileage
        ? prev
        : { ...prev, annualMileage: computedAnnualMileage },
    );
    setElectricTruck2((prev) =>
      prev.annualMileage === computedAnnualMileage
        ? prev
        : { ...prev, annualMileage: computedAnnualMileage },
    );
  }, [computedAnnualMileage, syncMileage]);

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/calculate-tco", {
        dieselTruck,
        electricTruck1,
        electricTruck2,
        timeframeYears,
        taxIncentiveRegion,
        lifecycleAssumptions,
        operationProfile: {
          ...operationProfile,
          publicChargeShare: operationProfile.opportunityCharging ? operationProfile.publicChargeShare : 0,
          publicChargeCostPerKwh: operationProfile.publicChargeCostPerKwh,
        },
      });
      const data = await response.json();
      return data as ComparisonResult;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: "Berechnung abgeschlossen",
        description: "Die Gesamtbetriebskosten-Analyse wurde erstellt.",
      });

      // Smooth scroll to results
      setTimeout(() => {
        document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    },
    onError: () => {
      toast({
        title: "Berechnung fehlgeschlagen",
        description: "Bitte überprüfen Sie Ihre Eingaben und versuchen Sie es erneut.",
        variant: "destructive",
      });
    },
  });

  const handleCalculate = () => {
    calculateMutation.mutate();
  };

  const handleReset = () => {
    setDieselTruck(defaultDieselTruck);
    setElectricTruck1(defaultElectricTruck1);
    setElectricTruck2(defaultElectricTruck2);
    setOperationProfile(defaultOperationProfile);
    setLifecycleAssumptions(defaultLifecycleState);
    setSyncMileage(true);
    setTimeframeYears(10);
    setTaxIncentiveRegion("bundesfoerderung");
    setFleetSize(1);
    setResult(null);
  };

  const PartnerLogo = tenant.PartnerLogo;

  return (
    <div className="min-h-screen bg-background relative">
      {/* Animated Gradient Mesh Background */}
      <div className="gradient-mesh" />
      {embed && <EmbedAutoResize />}

      {/* Header */}
      {embed ? (
        <header className="relative border-b border-border bg-background/70 backdrop-blur">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-8 sm:py-10 flex items-center justify-between gap-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {tenant.appName}
              </p>
              <h1 className="font-serif text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
                TCO-Rechner
              </h1>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {tenant.poweredByLabel}
              </span>
              <PartnerLogo className="h-7 w-auto" />
            </div>
          </div>
        </header>
      ) : (
        <header className="relative border-b border-border">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-20 sm:py-28 lg:py-32">
            {/* Powered by partner - Top Right */}
            <div className="absolute top-6 right-6 sm:right-8 lg:right-12">
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {tenant.poweredByLabel}
                </span>
                <PartnerLogo className="h-8 w-auto" />
              </div>
            </div>

            <div className="max-w-3xl">
              <p className="label-editorial mb-6">TCO-Analyse für Flottenmanager</p>
              <h1 className="font-serif text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-foreground leading-[1.1] mb-8" data-testid="text-app-title">
                {tenant.appName}
              </h1>
              <div className="h-px w-16 bg-primary mb-8" />
              <p className="text-xl sm:text-2xl text-muted-foreground font-light leading-relaxed max-w-xl">
                Der präzise Kostenvergleich zwischen Diesel- und Elektro-Sattelzügen.
                Fundierte Entscheidungen auf Basis realer Daten.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/depot-readiness">
                  <Button className="min-h-12 rounded-xl px-6">
                    Depot Readiness Check starten
                  </Button>
                </Link>
                <Link href="/traffic-opportunity">
                  <Button variant="outline" className="min-h-12 rounded-xl px-6">
                    Traffic Opportunity prüfen
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main
        className={`max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 ${
          embed ? "py-8" : "py-12"
        } space-y-12 relative`}
      >
        {/* Input Section */}
        <section className="space-y-10">
          <div>
            <p className="label-editorial mb-3">Konfiguration</p>
            <h2 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight mb-2">
              Fahrzeugspezifikationen
            </h2>
            <div className="h-px w-12 bg-primary mt-4" />
          </div>

          <OperationProfileCard
            value={operationProfile}
            onChange={setOperationProfile}
            syncMileage={syncMileage}
            onSyncMileageChange={setSyncMileage}
            computedAnnualMileage={computedAnnualMileage}
          />

          <LifecycleAssumptionsCard
            value={lifecycleAssumptions}
            onChange={setLifecycleAssumptions}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="card-hover">
              <TruckParametersCard
                truck={dieselTruck}
                onChange={setDieselTruck}
                truckIndex={0}
                lockAnnualMileage={syncMileage}
              />
            </div>
            <div className="card-hover">
              <TruckParametersCard
                truck={electricTruck1}
                onChange={setElectricTruck1}
                truckIndex={1}
                lockAnnualMileage={syncMileage}
                effectiveFuelCostPerUnit={effectiveElectric1Cost}
                publicChargeSharePercent={operationProfile.publicChargeShare}
              />
            </div>
            <div className="card-hover">
              <TruckParametersCard
                truck={electricTruck2}
                onChange={setElectricTruck2}
                truckIndex={2}
                lockAnnualMileage={syncMileage}
                effectiveFuelCostPerUnit={effectiveElectric2Cost}
                publicChargeSharePercent={operationProfile.publicChargeShare}
              />
            </div>
          </div>
        </section>

        {/* Fleet & Calculation Controls */}
        <section className="space-y-8">
          {/* Fleet Size Selector */}
          <div className="card-hover">
            <FleetSizeSelector value={fleetSize} onChange={setFleetSize} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-card border border-card-border rounded-2xl p-8 shadow-sm card-hover">
              <div>
                <h3 className="text-xl font-semibold mb-3">Analysezeitraum</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Wählen Sie den Zeitraum für die Gesamtbetriebskosten-Analyse
                </p>
                <TimeframeSelector
                  value={timeframeYears}
                  onChange={setTimeframeYears}
                />
              </div>
            </div>

            <div className="card-hover">
              <TaxIncentiveSelector
                value={taxIncentiveRegion}
                onChange={setTaxIncentiveRegion}
              />
            </div>
          </div>

          {/* E.ON Drive Benefits */}
          <div className="card-hover">
            <EonDriveBenefits />
          </div>

          <div className="bg-card border border-card-border rounded-2xl p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                onClick={handleCalculate}
                disabled={calculateMutation.isPending}
                size="lg"
                className="flex-1 min-h-14 text-lg font-medium rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:scale-[1.02]"
                data-testid="button-calculate"
              >
                <Calculator className="mr-3 h-5 w-5" />
                {calculateMutation.isPending ? "Berechnung läuft..." : "TCO berechnen"}
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                size="lg"
                className="sm:w-auto min-h-14 rounded-xl transition-all duration-300"
                data-testid="button-reset"
              >
                <RotateCcw className="mr-2 h-5 w-5" />
                Zurücksetzen
              </Button>
            </div>
          </div>
        </section>

        {/* Results Section */}
        {result && (
          <section id="results-section" className="space-y-12 scroll-mt-20 pt-8 border-t border-border">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
              <div>
                <p className="label-editorial mb-3">Ergebnisse</p>
                <h2 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight mb-2">
                  Analyseergebnisse
                </h2>
                <p className="text-muted-foreground mt-3">
                  {result.timeframeYears}-Jahres Kostenvergleich{fleetSize > 1 && ` · ${fleetSize} Fahrzeuge`}
                </p>
                <div className="h-px w-12 bg-primary mt-4" />
              </div>
              <PdfExportButton result={result} fleetSize={fleetSize} />
            </div>

            <SummaryMetrics result={result} fleetSize={fleetSize} />

            <LifecycleInsightCard
              result={result}
              lifecycleAssumptions={lifecycleAssumptions}
              fleetSize={fleetSize}
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <div className="card-hover">
                <AmortizationChart result={result} />
              </div>
              <div className="card-hover">
                <CostBreakdownChart result={result} />
              </div>
            </div>

            <div className="card-hover">
              <EnvironmentalImpactCard result={result} />
            </div>

            <div className="card-hover">
              <TechnicalSpecsComparison
                dieselAnalysis={result.dieselAnalysis}
                electric1Analysis={result.electric1Analysis}
                electric2Analysis={result.electric2Analysis}
              />
            </div>

            <DetailedTCOTable result={result} />

            {/* Consultation CTA (lead capture) */}
            <ConsultationCTA
              result={result}
              inputs={{
                dieselTruck,
                electricTruck1,
                electricTruck2,
                timeframeYears,
                taxIncentiveRegion,
                fleetSize,
                operationProfile,
                lifecycleAssumptions,
                computedAnnualMileage,
                syncMileage,
                effectiveElectricFuelCost1: effectiveElectric1Cost,
                effectiveElectricFuelCost2: effectiveElectric2Cost,
              }}
            />
          </section>
        )}

        {/* Footer */}
        {!embed && (
          <footer className="pt-20 pb-10 border-t border-border mt-24">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <span className="font-serif text-lg font-medium text-foreground">{tenant.appName}</span>
                <span className="text-muted-foreground/50">·</span>
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {tenant.poweredByLabel}
                </span>
                <PartnerLogo className="h-6 w-auto" />
              </div>
              <p className="text-sm text-muted-foreground text-center sm:text-right max-w-md">
                Alle Berechnungen sind Schätzungen basierend auf den angegebenen Parametern.
              </p>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}
