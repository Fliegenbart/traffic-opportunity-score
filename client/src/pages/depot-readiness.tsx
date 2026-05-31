import { useMemo, useState, type ComponentType } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  BatteryCharging,
  Building2,
  Check,
  CheckCircle2,
  Download,
  FileJson,
  Gauge,
  LockKeyhole,
  PlugZap,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  calculateReadinessScore,
  consentVersion,
  type ReadinessSubmission,
  type ScoringResult,
} from "@shared/readiness";
import { readinessSteps, type ReadinessField } from "@shared/readiness-questions";

const contactConsentText =
  "Ich bin einverstanden, dass meine Angaben zur Kontaktaufnahme und fachlichen Ersteinschätzung an die DepotOne-Partner E.ON Drive, NEoT und Mitsui weitergegeben werden.";

const marketingConsentText =
  "Ich möchte weitere Informationen von DepotOne zu E-Truck-Depot-Elektrifizierung, Charging-as-a-Service und Truck-as-a-Service erhalten.";

const depotOneAccent = "#0A99A4";
const depotOneCyan = "#0DBBC8";

const defaultSubmission: ReadinessSubmission = {
  company: {
    companyName: "",
    industry: "Spedition/Transport",
    contactRole: "Fuhrparkleitung",
    postcode: "",
    country: "Deutschland",
    depotsCount: 1,
  },
  fleet: {
    totalTrucks: 10,
    heavyTrucks: 8,
    trucksToReplace12m: 0,
    trucksToReplace24m: 0,
    trucksToReplace36m: 0,
    existingElectricTrucks: 0,
    currentVehicleBrands: [],
  },
  operation: {
    averageKmPerDay: "100-200 km",
    maxKmPerDay: "200-300 km",
    depotReturnShare: "50-75 %",
    operationType: ["Regionalverkehr"],
    overnightIdleHours: "8-12 h",
    shiftOperation: "Einschichtbetrieb",
  },
  depot: {
    depotOwnership: "unbekannt",
    truckParkingSpaces: 0,
    dedicatedParking: "unbekannt",
    gridConnectionKnown: "teilweise",
    gridCapacity: "unbekannt",
    spaceForChargingInfrastructure: "unklar",
    existingCharging: "keine",
    onsiteEnergy: [],
  },
  energy: {
    simultaneousChargingNeed: "3-5 Fahrzeuge",
    chargingWindow: "vor allem nachts",
    interestLoadManagement: "vielleicht",
    interestEnergyTariff: "vielleicht",
    interestChargingAsAService: "vielleicht",
  },
  economics: {
    annualMileagePerTruck: "60.000-90.000 km",
    mainMotivation: ["Kosten senken", "CO2 reduzieren"],
    capexPreference: "offen",
    projectTiming: "12-24 Monate",
    budgetStatus: "Budget in Planung",
    managementBuyIn: "teilweise",
    wantsConsultation: false,
  },
  contact: {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    consentContact: false,
    consentMarketing: false,
    consentText: contactConsentText,
    consentVersion,
  },
  utm: {},
};

type SectionKey = keyof ReadinessSubmission;
type IconComponent = ComponentType<{ className?: string }>;

function DepotOneMark() {
  return (
    <div className="flex items-center gap-3" aria-label="DepotOne">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#1d1d1f]">
        <Building2 className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xl font-semibold tracking-[-0.02em]">DepotOne</div>
        <div className="text-xs text-white/58">by E.ON Drive · NEoT · Mitsui</div>
      </div>
    </div>
  );
}

function HeroSignal({ icon: Icon, label }: { icon: IconComponent; label: string }) {
  return (
    <div className="rounded-2xl bg-[#f5f5f7] p-3">
      <Icon className="h-5 w-5 text-[#0A99A4]" />
      <p className="mt-2 text-sm font-medium">{label}</p>
    </div>
  );
}

function ProofPoint({
  icon: Icon,
  title,
  text,
}: {
  icon: IconComponent;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-4 rounded-2xl bg-[#fbfbfd] p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0DBBC8]/12 text-[#0A99A4]">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[#6e6e73]">{text}</p>
      </div>
    </div>
  );
}

function getValue(data: ReadinessSubmission, key: string): unknown {
  const [section, field] = key.split(".") as [SectionKey, string];
  return (data[section] as Record<string, unknown>)[field];
}

function setValue(
  data: ReadinessSubmission,
  key: string,
  value: string | number | boolean | string[],
): ReadinessSubmission {
  const [section, field] = key.split(".") as [SectionKey, string];
  return {
    ...data,
    [section]: {
      ...(data[section] as Record<string, unknown>),
      [field]: value,
    },
  };
}

function collectUtm() {
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith("utm_")) utm[key] = value;
  });
  return utm;
}

function shouldShowContact(submission: ReadinessSubmission, score: number) {
  return submission.economics.wantsConsultation || score >= 50;
}

export default function DepotReadiness() {
  const [submission, setSubmission] = useState<ReadinessSubmission>(() => ({
    ...defaultSubmission,
    utm: collectUtm(),
  }));
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<ScoringResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const { toast } = useToast();

  const preview = useMemo(() => calculateReadinessScore(submission), [submission]);
  const visibleSteps = useMemo(() => {
    const steps = [...readinessSteps];
    if (shouldShowContact(submission, preview.score)) {
      steps.push({
        id: "contact",
        title: "Kontakt und Einwilligung",
        fields: [],
      });
    }
    return steps;
  }, [preview.score, submission]);
  const activeStep = visibleSteps[Math.min(stepIndex, visibleSteps.length - 1)];
  const progress = Math.round(((stepIndex + 1) / visibleSteps.length) * 100);

  const updateField = (key: string, value: string | number | boolean | string[]) => {
    setSubmission((prev) => setValue(prev, key, value));
  };

  const submit = async () => {
    if (submission.economics.wantsConsultation && !submission.contact.consentContact) {
      toast({
        title: "Einwilligung fehlt",
        description: "Für eine Kontaktaufnahme ist die aktive Freigabe erforderlich.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: ReadinessSubmission = {
        ...submission,
        contact: {
          ...submission.contact,
          consentText: contactConsentText,
          consentTimestamp: submission.contact.consentContact
            ? new Date().toISOString()
            : submission.contact.consentTimestamp,
          consentVersion,
        },
        utm: collectUtm(),
      };
      const response = await apiRequest("POST", "/api/readiness-submit", payload);
      const data = (await response.json()) as { scoringResult: ScoringResult };
      setResult(data.scoringResult);
      toast({
        title: "Readiness Check gespeichert",
        description: "Ihr Ergebnis wurde erstellt.",
      });
      setTimeout(() => {
        document.getElementById("readiness-result")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch {
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Bitte prüfen Sie die Pflichtfelder und versuchen Sie es erneut.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <header className="relative overflow-hidden bg-[#1d1d1f] text-white">
        <div
          className="absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(circle at 78% 18%, rgba(13,187,200,0.34), transparent 28%), linear-gradient(135deg, rgba(29,29,31,0.96), rgba(29,29,31,0.74))",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#fbfbfd] to-transparent" />
        <div className="relative mx-auto flex min-h-[620px] max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-12">
          <nav className="flex items-center justify-between gap-4">
            <DepotOneMark />
            <Link href="/tco">
              <Button
                variant="outline"
                className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white hover:text-[#1d1d1f]"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                TCO-Rechner
              </Button>
            </Link>
          </nav>

          <div className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[1.08fr_0.92fr]">
            <div>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/80">
                <span className="h-2 w-2 rounded-full bg-[#0DBBC8]" />
                DepotOne Lead Readiness Funnel
              </p>
              <h1 className="max-w-4xl text-5xl font-semibold leading-[1.03] tracking-[-0.02em] sm:text-6xl lg:text-7xl">
                Depot Readiness Check
              </h1>
              <p className="mt-7 max-w-2xl text-xl leading-relaxed text-white/72">
                Prüfen Sie in wenigen Minuten, ob Fuhrpark, Standort und Einsatzprofil
                für Depot Charging-as-a-Service und E-Truck-Projekte bereit sind.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={() => document.getElementById("readiness-wizard")?.scrollIntoView({ behavior: "smooth" })}
                  className="min-h-12 rounded-full border border-[#0A99A4] bg-[#0A99A4] px-7 text-base text-white hover:border-[#088a94] hover:bg-[#088a94]"
                >
                  Readiness Check starten
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => document.getElementById("readiness-result")?.scrollIntoView({ behavior: "smooth" })}
                  className="min-h-12 rounded-full px-7 text-base text-[#0DBBC8] hover:bg-white/10 hover:text-[#0DBBC8]"
                >
                  Score ansehen
                </Button>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-sm text-white/72">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0DBBC8]" />
                  E.ON Drive
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0DBBC8]" />
                  NEoT
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0DBBC8]" />
                  Mitsui
                </span>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/12 bg-white/[0.08] p-5 shadow-2xl backdrop-blur">
              <div className="rounded-[1.5rem] bg-[#fbfbfd] p-5 text-[#1d1d1f]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#6e6e73]">Live Readiness Score</p>
                    <div className="mt-3 flex items-end gap-3">
                      <span className="text-6xl font-semibold tracking-[-0.03em]">{preview.score}</span>
                      <span className="pb-2 text-sm text-[#6e6e73]">/ 100</span>
                    </div>
                  </div>
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0DBBC8]/15 text-[#0A99A4]">
                    <Gauge className="h-7 w-7" />
                  </div>
                </div>
                <div className="mt-5 rounded-full bg-[#f5f5f7] p-1">
                  <div
                    className="h-3 rounded-full bg-[#0A99A4] transition-all"
                    style={{ width: `${preview.score}%` }}
                  />
                </div>
                <p className="mt-4 text-lg font-semibold">{preview.readinessLevel}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <HeroSignal icon={Truck} label="Fuhrpark" />
                  <HeroSignal icon={PlugZap} label="Depotladung" />
                  <HeroSignal icon={Users} label="Kontaktfit" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="border-y border-black/[0.06] bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-6 py-6 sm:px-8 md:grid-cols-3 lg:px-12">
          <ProofPoint icon={BatteryCharging} title="Charging-as-a-Service" text="Ladehardware, Betrieb und Energie als strukturierter DepotOne-Prüfpfad." />
          <ProofPoint icon={Truck} title="Truck-as-a-Service" text="E-Truck-Potenzial wird mit Fuhrpark- und Timing-Daten eingeordnet." />
          <ProofPoint icon={LockKeyhole} title="Lead nur mit Consent" text="Weitergabe an Partner erfolgt nur bei aktiver Zustimmung." />
        </div>
      </section>

      <main
        id="readiness-wizard"
        className="mx-auto grid max-w-7xl gap-8 px-6 py-12 sm:px-8 lg:grid-cols-[300px_1fr] lg:px-12"
      >
        <aside className="h-fit rounded-[1.25rem] border border-black/[0.08] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="font-medium">Fortschritt</span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-[#0A99A4] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <nav className="mt-5 space-y-2">
            {visibleSteps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                onClick={() => setStepIndex(index)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                  index === stepIndex
                    ? "bg-[#0A99A4] text-white"
                    : "text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs">
                  {index < stepIndex ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                {step.title}
              </button>
            ))}
          </nav>
        </aside>

        <section className="space-y-8">
          <div className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
                Schritt {stepIndex + 1} von {visibleSteps.length}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.015em]">{activeStep.title}</h2>
            </div>

            {activeStep.id === "contact" ? (
              <ContactFields submission={submission} updateField={updateField} />
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {activeStep.fields.map((field) => (
                  <QuestionField
                    key={field.key}
                    field={field}
                    value={getValue(submission, field.key)}
                    onChange={(value) => updateField(field.key, value)}
                  />
                ))}
              </div>
            )}

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                disabled={stepIndex === 0}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zurück
              </Button>
              {stepIndex < visibleSteps.length - 1 ? (
                <Button
                  onClick={() => setStepIndex((current) => current + 1)}
                  className="rounded-full border border-[#0A99A4] bg-[#0A99A4] px-6 hover:border-[#088a94] hover:bg-[#088a94]"
                >
                  Weiter
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={submit}
                  disabled={isSubmitting}
                  className="rounded-full border border-[#0A99A4] bg-[#0A99A4] px-6 hover:border-[#088a94] hover:bg-[#088a94]"
                >
                  {isSubmitting ? "Wird gespeichert..." : "Ergebnis anzeigen"}
                </Button>
              )}
            </div>
          </div>

          {(result || preview) && (
            <ReadinessResultCard
              result={result || preview}
              submitted={Boolean(result)}
              onCta={() => {
                updateField("economics.wantsConsultation", true);
                setStepIndex(readinessSteps.length);
                setTimeout(() => {
                  document.getElementById("readiness-wizard")?.scrollIntoView({ behavior: "smooth" });
                }, 50);
              }}
            />
          )}

          <AdminExport token={adminToken} setToken={setAdminToken} />
        </section>
      </main>
    </div>
  );
}

function QuestionField({
  field,
  value,
  onChange,
}: {
  field: ReadinessField;
  value: unknown;
  onChange: (value: string | number | boolean | string[]) => void;
}) {
  if (field.type === "number") {
    return (
      <label className="space-y-2">
        <span className="text-sm font-medium text-[#1d1d1f]">{field.label}</span>
        <input
          type="number"
          min={0}
          value={typeof value === "number" ? value : 0}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-h-11 w-full rounded-xl border border-black/10 bg-[#fbfbfd] px-4 py-2 text-sm outline-none transition focus:border-[#0A99A4] focus:ring-4 focus:ring-[#0DBBC8]/15"
        />
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="space-y-2">
        <span className="text-sm font-medium text-[#1d1d1f]">{field.label}</span>
        <select
          value={String(value || field.options?.[0] || "")}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-11 w-full rounded-xl border border-black/10 bg-[#fbfbfd] px-4 py-2 text-sm outline-none transition focus:border-[#0A99A4] focus:ring-4 focus:ring-[#0DBBC8]/15"
        >
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "multiselect") {
    const values = Array.isArray(value) ? value.map(String) : [];
    return (
      <fieldset className="space-y-3 md:col-span-2">
        <legend className="text-sm font-medium text-[#1d1d1f]">{field.label}</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {field.options?.map((option) => {
            const checked = values.includes(option);
            return (
              <label
                key={option}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                  checked ? "border-[#0A99A4] bg-[#0DBBC8]/10" : "border-black/10 bg-[#fbfbfd]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    onChange(
                      event.target.checked
                        ? [...values, option]
                        : values.filter((item) => item !== option),
                    );
                  }}
                />
                {option}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (field.type === "boolean") {
    return (
      <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-[#fbfbfd] p-4 md:col-span-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1"
        />
        <span className="text-sm font-medium text-[#1d1d1f]">{field.label}</span>
      </label>
    );
  }

  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-[#1d1d1f]">{field.label}</span>
      <input
        type="text"
        value={String(value || "")}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-black/10 bg-[#fbfbfd] px-4 py-2 text-sm outline-none transition focus:border-[#0A99A4] focus:ring-4 focus:ring-[#0DBBC8]/15"
      />
    </label>
  );
}

function ContactFields({
  submission,
  updateField,
}: {
  submission: ReadinessSubmission;
  updateField: (key: string, value: string | number | boolean | string[]) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <QuestionField field={{ key: "contact.firstName", label: "Vorname", type: "text" }} value={submission.contact.firstName} onChange={(value) => updateField("contact.firstName", value)} />
        <QuestionField field={{ key: "contact.lastName", label: "Nachname", type: "text" }} value={submission.contact.lastName} onChange={(value) => updateField("contact.lastName", value)} />
        <QuestionField field={{ key: "contact.email", label: "E-Mail", type: "text" }} value={submission.contact.email} onChange={(value) => updateField("contact.email", value)} />
        <QuestionField field={{ key: "contact.phone", label: "Telefon optional", type: "text" }} value={submission.contact.phone} onChange={(value) => updateField("contact.phone", value)} />
      </div>

      <div className="rounded-2xl border border-[#0DBBC8]/20 bg-[#0DBBC8]/10 p-4 text-sm text-[#3f3f46]">
        Ihre Angaben werden zur Auswertung des Readiness Checks verarbeitet. Eine
        Weitergabe an DepotOne-Partner erfolgt nur, wenn Sie aktiv zustimmen.
      </div>

      <ConsentCheckbox
        checked={submission.contact.consentContact}
        onChange={(checked) => updateField("contact.consentContact", checked)}
        label={contactConsentText}
      />
      <ConsentCheckbox
        checked={submission.contact.consentMarketing}
        onChange={(checked) => updateField("contact.consentMarketing", checked)}
        label={marketingConsentText}
      />
    </div>
  );
}

function ConsentCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-black/10 bg-[#fbfbfd] p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function ReadinessResultCard({
  result,
  submitted,
  onCta,
}: {
  result: ScoringResult;
  submitted: boolean;
  onCta: () => void;
}) {
  return (
    <section id="readiness-result" className="rounded-[1.5rem] border border-black/[0.08] bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A99A4]">
            {submitted ? "Ergebnis" : "Live-Vorschau"}
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.015em]">{result.readinessLevel}</h2>
          <p className="mt-3 max-w-2xl text-[#6e6e73]">{result.interpretation}</p>
        </div>
        <div className="rounded-[1.25rem] border border-black/[0.08] bg-[#fbfbfd] p-5 text-center">
          <div className="text-6xl font-semibold tracking-[-0.03em]">{result.score}</div>
          <div className="text-sm text-[#6e6e73]">Readiness Score</div>
          <div className="mt-3 rounded-full bg-[#0DBBC8]/12 px-3 py-1 text-sm font-medium text-[#0A99A4]">{result.leadClass}</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {result.categories.map((category) => (
          <div key={category.key} className="rounded-2xl border border-black/[0.06] bg-[#fbfbfd] p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{category.label}</span>
              <span className="text-[#6e6e73]">
                {category.score}/{category.maxScore}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/5">
              <div
                className="h-full bg-[#0A99A4]"
                style={{ width: `${(category.score / category.maxScore) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <ResultList title="Top 3 Stärken" items={result.strengths} />
        <ResultList title="Top 3 offene Punkte" items={result.openPoints} />
        <ResultList title="Nächste Schritte" items={result.recommendations} />
      </div>

      <div className="mt-8 rounded-[1.25rem] bg-[#1d1d1f] p-5 text-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/70">
            Auf Basis Ihrer Angaben ergibt sich eine erste indikative Einschätzung.
            Eine belastbare technische und wirtschaftliche Bewertung erfordert eine
            individuelle Prüfung.
          </p>
          <Button
            onClick={onCta}
            className="shrink-0 rounded-full border border-[#0DBBC8] bg-[#0DBBC8] text-[#001417] hover:border-[#1ad6e3] hover:bg-[#1ad6e3]"
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            {result.ctaLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-semibold tracking-[-0.01em]">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-[#6e6e73]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0A99A4]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdminExport({
  token,
  setToken,
}: {
  token: string;
  setToken: (token: string) => void;
}) {
  const jsonUrl = `/api/readiness-export?format=json&token=${encodeURIComponent(token)}`;
  const csvUrl = `/api/readiness-export?format=csv&token=${encodeURIComponent(token)}`;

  return (
    <section className="rounded-[1.25rem] border border-black/[0.06] bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Download className="mt-1 h-5 w-5 text-[#0A99A4]" />
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Admin Export</h2>
          <p className="mt-2 text-sm text-[#6e6e73]">
            Export ist für den MVP über ADMIN_EXPORT_TOKEN geschützt.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Export Token"
          className="min-h-11 flex-1 rounded-xl border border-black/10 bg-[#fbfbfd] px-4 py-2 text-sm outline-none transition focus:border-[#0A99A4] focus:ring-4 focus:ring-[#0DBBC8]/15"
        />
        <a href={jsonUrl} target="_blank" rel="noreferrer">
          <Button variant="outline" disabled={!token} type="button">
            <FileJson className="mr-2 h-4 w-4" />
            JSON
          </Button>
        </a>
        <a href={csvUrl} target="_blank" rel="noreferrer">
          <Button variant="outline" disabled={!token} type="button">
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
        </a>
      </div>
    </section>
  );
}
