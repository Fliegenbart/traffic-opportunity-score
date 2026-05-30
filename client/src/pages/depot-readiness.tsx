import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileJson,
  Gauge,
  ShieldCheck,
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
  "Ich bin einverstanden, dass meine Angaben zur Kontaktaufnahme und fachlichen Ersteinschaetzung an die DepotOne-Partner E.ON Drive, NEoT und Mitsui weitergegeben werden.";

const marketingConsentText =
  "Ich moechte weitere Informationen von eTruckathon / Electrified zu elektrischer Nutzfahrzeuglogistik erhalten.";

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
        description: "Fuer eine Kontaktaufnahme ist die aktive Freigabe erforderlich.",
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
        description: "Bitte pruefen Sie die Pflichtfelder und versuchen Sie es erneut.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 sm:px-8 lg:px-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                eTruckathon / Electrified
              </p>
              <h1 className="mt-3 max-w-3xl font-serif text-4xl font-semibold leading-tight sm:text-5xl">
                Wie bereit ist Ihr Depot fuer E-Trucks?
              </h1>
            </div>
            <Link href="/">
              <Button variant="outline" className="w-fit">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zum TCO-Rechner
              </Button>
            </Link>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
            <div>
              <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
                Pruefen Sie in wenigen Minuten, ob Ihr Fuhrpark, Ihr Standort und Ihr
                Einsatzprofil fuer die Elektrifizierung geeignet sind.
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                Ein Angebot von eTruckathon / Electrified. Fachliche Einordnung mit
                Unterstuetzung von DepotOne.
              </p>
            </div>
            <div className="rounded-lg border border-card-border bg-background p-5">
              <div className="flex items-center gap-3">
                <Gauge className="h-5 w-5 text-primary" />
                <span className="font-medium">Indikativer Score</span>
              </div>
              <div className="mt-4 flex items-end gap-3">
                <span className="font-serif text-5xl font-semibold">{preview.score}</span>
                <span className="pb-2 text-sm text-muted-foreground">von 100</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{preview.readinessLevel}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-6 py-10 sm:px-8 lg:grid-cols-[280px_1fr] lg:px-12">
        <aside className="h-fit rounded-lg border border-card-border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="font-medium">Fortschritt</span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <nav className="mt-5 space-y-2">
            {visibleSteps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                onClick={() => setStepIndex(index)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                  index === stepIndex
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
          <div className="rounded-lg border border-card-border bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-8">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Schritt {stepIndex + 1} von {visibleSteps.length}
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold">{activeStep.title}</h2>
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
                Zurueck
              </Button>
              {stepIndex < visibleSteps.length - 1 ? (
                <Button onClick={() => setStepIndex((current) => current + 1)}>
                  Weiter
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={submit} disabled={isSubmitting}>
                  {isSubmitting ? "Wird gespeichert..." : "Ergebnis anzeigen"}
                </Button>
              )}
            </div>
          </div>

          {(result || preview) && (
            <ReadinessResultCard result={result || preview} submitted={Boolean(result)} />
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
        <span className="text-sm font-medium">{field.label}</span>
        <input
          type="number"
          min={0}
          value={typeof value === "number" ? value : 0}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="space-y-2">
        <span className="text-sm font-medium">{field.label}</span>
        <select
          value={String(value || field.options?.[0] || "")}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
        <legend className="text-sm font-medium">{field.label}</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {field.options?.map((option) => {
            const checked = values.includes(option);
            return (
              <label
                key={option}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  checked ? "border-primary bg-primary/5" : "border-input bg-background"
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
      <label className="flex items-start gap-3 rounded-md border border-input bg-background p-4 md:col-span-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1"
        />
        <span className="text-sm font-medium">{field.label}</span>
      </label>
    );
  }

  return (
    <label className="space-y-2">
      <span className="text-sm font-medium">{field.label}</span>
      <input
        type="text"
        value={String(value || "")}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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

      <div className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
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
    <label className="flex items-start gap-3 rounded-md border border-input bg-background p-4">
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
}: {
  result: ScoringResult;
  submitted: boolean;
}) {
  return (
    <section id="readiness-result" className="rounded-lg border border-card-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {submitted ? "Ergebnis" : "Live-Vorschau"}
          </p>
          <h2 className="mt-2 font-serif text-3xl font-semibold">{result.readinessLevel}</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">{result.interpretation}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-5 text-center">
          <div className="font-serif text-6xl font-semibold">{result.score}</div>
          <div className="text-sm text-muted-foreground">Readiness Score</div>
          <div className="mt-3 rounded-full bg-muted px-3 py-1 text-sm">{result.leadClass}</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {result.categories.map((category) => (
          <div key={category.key} className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{category.label}</span>
              <span className="text-muted-foreground">
                {category.score}/{category.maxScore}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${(category.score / category.maxScore) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <ResultList title="Top 3 Staerken" items={result.strengths} />
        <ResultList title="Top 3 offene Punkte" items={result.openPoints} />
        <ResultList title="Naechste Schritte" items={result.recommendations} />
      </div>

      <div className="mt-8 rounded-md border border-border bg-background p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Auf Basis Ihrer Angaben ergibt sich eine erste indikative Einschaetzung.
            Eine belastbare technische und wirtschaftliche Bewertung erfordert eine
            individuelle Pruefung.
          </p>
          <Button className="shrink-0">
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
      <h3 className="font-medium">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
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
    <section className="rounded-lg border border-card-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-3">
        <Download className="mt-1 h-5 w-5 text-primary" />
        <div>
          <h2 className="font-serif text-2xl font-semibold">Admin Export</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Export ist fuer den MVP ueber ADMIN_EXPORT_TOKEN geschuetzt.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Export Token"
          className="min-h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
