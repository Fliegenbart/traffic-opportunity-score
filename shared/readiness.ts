import { z } from "zod";

export const consentVersion = "2026-05-30";

const stringArray = z.array(z.string()).default([]);

export const companyDataSchema = z.object({
  companyName: z.string().min(1),
  industry: z.string().min(1),
  contactRole: z.string().min(1),
  postcode: z.string().min(1),
  country: z.string().min(1).default("Deutschland"),
  depotsCount: z.number().min(1),
});

export const fleetDataSchema = z.object({
  totalTrucks: z.number().min(0),
  heavyTrucks: z.number().min(0),
  trucksToReplace12m: z.number().min(0).default(0),
  trucksToReplace24m: z.number().min(0).default(0),
  trucksToReplace36m: z.number().min(0).default(0),
  existingElectricTrucks: z.number().min(0).default(0),
  currentVehicleBrands: stringArray,
});

export const operationDataSchema = z.object({
  averageKmPerDay: z.string().min(1),
  maxKmPerDay: z.string().min(1),
  depotReturnShare: z.string().min(1),
  operationType: stringArray,
  overnightIdleHours: z.string().min(1),
  shiftOperation: z.string().min(1),
});

export const depotDataSchema = z.object({
  depotOwnership: z.string().min(1),
  truckParkingSpaces: z.number().min(0).default(0),
  dedicatedParking: z.string().min(1),
  gridConnectionKnown: z.string().min(1),
  gridCapacity: z.string().min(1),
  spaceForChargingInfrastructure: z.string().min(1),
  existingCharging: z.string().min(1),
  onsiteEnergy: stringArray,
});

export const energyDataSchema = z.object({
  simultaneousChargingNeed: z.string().min(1),
  chargingWindow: z.string().min(1),
  interestLoadManagement: z.string().min(1),
  interestEnergyTariff: z.string().min(1),
  interestChargingAsAService: z.string().min(1),
});

export const economicsDataSchema = z.object({
  annualMileagePerTruck: z.string().min(1),
  mainMotivation: stringArray,
  capexPreference: z.string().min(1),
  projectTiming: z.string().min(1),
  budgetStatus: z.string().min(1),
  managementBuyIn: z.string().min(1),
  wantsConsultation: z.boolean().default(false),
});

export const contactDataSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  consentContact: z.boolean().default(false),
  consentMarketing: z.boolean().default(false),
  consentText: z.string().default(""),
  consentTimestamp: z.string().optional(),
  consentVersion: z.string().default(consentVersion),
});

export const readinessSubmissionSchema = z.object({
  company: companyDataSchema,
  fleet: fleetDataSchema,
  operation: operationDataSchema,
  depot: depotDataSchema,
  energy: energyDataSchema,
  economics: economicsDataSchema,
  contact: contactDataSchema,
  utm: z.record(z.string()).default({}),
});

export type CompanyData = z.infer<typeof companyDataSchema>;
export type FleetData = z.infer<typeof fleetDataSchema>;
export type OperationData = z.infer<typeof operationDataSchema>;
export type DepotData = z.infer<typeof depotDataSchema>;
export type EnergyData = z.infer<typeof energyDataSchema>;
export type EconomicsData = z.infer<typeof economicsDataSchema>;
export type ContactData = z.infer<typeof contactDataSchema>;
export type ReadinessSubmission = z.infer<typeof readinessSubmissionSchema>;
export type ReadinessLevel =
  | "High Readiness"
  | "Medium Readiness"
  | "Early Stage"
  | "Low Readiness";
export type LeadClassification = "A-Lead" | "B-Lead" | "C-Lead";

export interface ScoringCategory {
  key: string;
  label: string;
  score: number;
  maxScore: number;
}

export interface ScoringResult {
  score: number;
  readinessLevel: ReadinessLevel;
  leadClass: LeadClassification;
  categories: ScoringCategory[];
  interpretation: string;
  strengths: string[];
  openPoints: string[];
  recommendations: string[];
  ctaLabel: string;
}

function points(value: string | undefined, map: Record<string, number>, fallback = 0) {
  return value ? map[value] ?? fallback : fallback;
}

function rangePoints(value: number, ranges: Array<[number, number, number]>) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const match = ranges.find(([min, max]) => safeValue >= min && safeValue <= max);
  return match ? match[2] : 0;
}

function countMatching(values: string[] = [], allowed: string[], max: number) {
  return Math.min(
    max,
    values.filter((value) => allowed.includes(value)).length,
  );
}

export function getReadinessLevel(score: number): ReadinessLevel {
  if (score >= 75) return "High Readiness";
  if (score >= 50) return "Medium Readiness";
  if (score >= 25) return "Early Stage";
  return "Low Readiness";
}

export function classifyLead(
  submission: ReadinessSubmission,
  result: Pick<ScoringResult, "score">,
): LeadClassification {
  const hasConsent = submission.contact.consentContact === true;
  const wantsContact = submission.economics.wantsConsultation === true;
  const inTimeframe = ["0-6 Monate", "6-12 Monate", "12-24 Monate"].includes(
    submission.economics.projectTiming,
  );
  const fleetQualified =
    submission.fleet.totalTrucks >= 10 || submission.fleet.trucksToReplace24m >= 3;

  if (
    result.score >= 75 &&
    wantsContact &&
    hasConsent &&
    fleetQualified &&
    inTimeframe
  ) {
    return "A-Lead";
  }

  if (result.score >= 50 && wantsContact && hasConsent) return "B-Lead";
  return "C-Lead";
}

export function calculateReadinessScore(submission: ReadinessSubmission): ScoringResult {
  const fleetPotential =
    rangePoints(submission.fleet.totalTrucks, [
      [1, 4, 2],
      [5, 9, 5],
      [10, 24, 9],
      [25, 49, 12],
      [50, Number.POSITIVE_INFINITY, 15],
    ]) +
    rangePoints(submission.fleet.trucksToReplace24m, [
      [1, 2, 2],
      [3, 5, 3],
      [6, Number.POSITIVE_INFINITY, 5],
    ]);

  const operationalFit =
    points(submission.operation.averageKmPerDay, {
      "unter 100 km": 5,
      "100-200 km": 8,
      "200-300 km": 9,
      "300-500 km": 5,
      "über 500 km": 1,
      unbekannt: 2,
    }) +
    points(submission.operation.depotReturnShare, {
      "75-100 %": 8,
      "50-75 %": 5,
      "25-50 %": 2,
      "0-25 %": 0,
      unbekannt: 1,
    }) +
    points(submission.operation.overnightIdleHours, {
      "über 12 h": 5,
      "8-12 h": 5,
      "6-8 h": 3,
      "4-6 h": 2,
      "unter 4 h": 0,
      unbekannt: 1,
    }) +
    countMatching(
      submission.operation.operationType,
      ["Linienverkehr", "Regionalverkehr", "Verteilerverkehr", "Werksverkehr"],
      3,
    );

  const depotInfrastructure =
    points(submission.depot.depotOwnership, {
      Eigentum: 6,
      "gemietet > 5 Jahre": 5,
      "gemietet 2-5 Jahre": 3,
      "gemietet < 2 Jahre": 1,
      unbekannt: 1,
    }) +
    points(submission.depot.dedicatedParking, {
      ja: 4,
      teilweise: 2,
      nein: 0,
      unbekannt: 1,
    }) +
    points(submission.depot.gridConnectionKnown, {
      ja: 4,
      teilweise: 2,
      nein: 0,
    }) +
    points(submission.depot.gridCapacity, {
      "über 3 MW": 5,
      "1-3 MW": 4,
      "500 kW-1 MW": 3,
      "250-500 kW": 2,
      "unter 250 kW": 1,
      unbekannt: 1,
    }) +
    points(submission.depot.spaceForChargingInfrastructure, {
      ja: 4,
      wahrscheinlich: 3,
      unklar: 1,
      nein: 0,
    }) +
    countMatching(
      submission.depot.onsiteEnergy,
      ["PV", "Batteriespeicher", "Energiemanagement", "eigener Trafo"],
      2,
    );

  const commercialFit =
    points(submission.economics.annualMileagePerTruck, {
      "unter 30.000 km": 1,
      "30.000-60.000 km": 3,
      "60.000-90.000 km": 5,
      "90.000-120.000 km": 5,
      "über 120.000 km": 3,
      unbekannt: 1,
    }) +
    countMatching(
      submission.economics.mainMotivation,
      ["Kosten senken", "Kundenanforderungen", "CO2 reduzieren", "ESG/Reporting", "Maut/Regulierung"],
      5,
    ) +
    points(submission.economics.capexPreference, {
      "lieber as-a-Service/Opex": 5,
      "lieber Leasing": 4,
      offen: 3,
      "Kauf/Capex möglich": 2,
      unbekannt: 1,
    }) +
    points(submission.economics.budgetStatus, {
      "Budget vorhanden": 3,
      "Budget in Planung": 2,
      "noch kein Budget": 0,
      unbekannt: 1,
    }) +
    points(submission.economics.managementBuyIn, {
      ja: 2,
      teilweise: 1,
      nein: 0,
      unbekannt: 0,
    });

  const timingIntent =
    points(submission.economics.projectTiming, {
      "0-6 Monate": 5,
      "6-12 Monate": 5,
      "12-24 Monate": 4,
      "24+ Monate": 2,
      "nur Orientierung": 1,
    }) + (submission.economics.wantsConsultation ? 5 : 0);

  const categories: ScoringCategory[] = [
    { key: "fleet", label: "Fleet Potential", score: fleetPotential, maxScore: 20 },
    { key: "operation", label: "Operational Fit", score: operationalFit, maxScore: 25 },
    { key: "depot", label: "Depot Infrastructure", score: depotInfrastructure, maxScore: 25 },
    { key: "commercial", label: "Economic & Commercial Fit", score: commercialFit, maxScore: 20 },
    { key: "timing", label: "Timing & Intent", score: timingIntent, maxScore: 10 },
  ];

  const score = Math.min(
    100,
    categories.reduce((sum, category) => sum + category.score, 0),
  );
  const readinessLevel = getReadinessLevel(score);
  const resultWithoutLead = {
    score,
    readinessLevel,
    leadClass: "C-Lead" as LeadClassification,
    categories,
    interpretation: getInterpretation(readinessLevel),
    strengths: buildStrengths(submission, categories),
    openPoints: buildOpenPoints(submission, categories),
    recommendations: buildRecommendations(readinessLevel, submission),
    ctaLabel: getCtaLabel(readinessLevel),
  };

  return {
    ...resultWithoutLead,
    leadClass: classifyLead(submission, resultWithoutLead),
  };
}

function getInterpretation(level: ReadinessLevel) {
  switch (level) {
    case "High Readiness":
      return "Ihr Depot wirkt auf Basis der Angaben bereits gut geeignet fuer eine konkrete E-Truck-Pruefung.";
    case "Medium Readiness":
      return "Es gibt klare Anknuepfungspunkte, einige technische oder organisatorische Fragen sollten aber vor dem naechsten Schritt geklaert werden.";
    case "Early Stage":
      return "Die Elektrifizierung ist grundsaetzlich denkbar, braucht aber zuerst mehr Klarheit zu Einsatzprofil, Standort und Wirtschaftlichkeit.";
    case "Low Readiness":
      return "Aktuell fehlen noch wichtige Voraussetzungen oder Informationen fuer eine belastbare Depot-Elektrifizierung.";
  }
}

function getCtaLabel(level: ReadinessLevel) {
  switch (level) {
    case "High Readiness":
      return "Jetzt DepotOne-Ersteinschaetzung anfragen";
    case "Medium Readiness":
      return "Depot-Potenzial pruefen lassen";
    case "Early Stage":
      return "E-Truck-Depot-Guide herunterladen";
    case "Low Readiness":
      return "Grundlagen zur Depot-Elektrifizierung ansehen";
  }
}

function buildStrengths(submission: ReadinessSubmission, categories: ScoringCategory[]) {
  const strengths: string[] = [];
  const strongCategories = categories
    .filter((category) => category.score / category.maxScore >= 0.7)
    .map((category) => `${category.label} ist bereits stark ausgepraegt.`);

  strengths.push(...strongCategories);
  if (submission.operation.depotReturnShare === "75-100 %") {
    strengths.push("Viele Fahrzeuge kehren regelmaessig ins Depot zurueck.");
  }
  if (submission.economics.wantsConsultation) {
    strengths.push("Es gibt ein klares Interesse an einer fachlichen Ersteinschaetzung.");
  }
  if (submission.depot.gridConnectionKnown === "ja") {
    strengths.push("Der Netzanschluss ist bereits bekannt.");
  }

  return fillToThree(strengths, [
    "Die Angaben reichen fuer eine erste indikative Bewertung.",
    "Der Check liefert eine gute Grundlage fuer ein strukturiertes Folgegespraech.",
    "Fuhrpark- und Depotdaten koennen im naechsten Schritt konkretisiert werden.",
  ]);
}

function buildOpenPoints(submission: ReadinessSubmission, categories: ScoringCategory[]) {
  const openPoints: string[] = [];
  const weakCategories = categories
    .filter((category) => category.score / category.maxScore < 0.45)
    .map((category) => `${category.label} sollte genauer geprueft werden.`);

  openPoints.push(...weakCategories);
  if (submission.depot.gridConnectionKnown !== "ja") {
    openPoints.push("Netzanschluss und verfuegbare Leistung sind noch nicht ausreichend geklaert.");
  }
  if (submission.operation.averageKmPerDay === "unbekannt") {
    openPoints.push("Die durchschnittliche Tagesfahrleistung sollte nachgeschaerft werden.");
  }
  if (submission.economics.budgetStatus === "noch kein Budget") {
    openPoints.push("Budget und interne Entscheidungsgrundlage sind noch offen.");
  }

  return fillToThree(openPoints, [
    "Ladefenster und Standzeiten sollten mit realen Tourdaten abgeglichen werden.",
    "Parkflaechen, Kabelwege und Bauzeiten sollten am Standort geprueft werden.",
    "Eine belastbare Bewertung braucht technische und wirtschaftliche Detaildaten.",
  ]);
}

function buildRecommendations(level: ReadinessLevel, submission: ReadinessSubmission) {
  const recommendations = [
    "Tourdaten, Standzeiten und Rueckkehrquoten fuer die wichtigsten Fahrzeuggruppen sammeln.",
    "Netzanschluss, verfuegbare Leistung und Flaechen am Depot technisch vorpruefen.",
    "TCO-Annahmen, Capex/Opex-Praeferenz und Projektzeitplan gemeinsam bewerten.",
  ];

  if (level === "High Readiness" || level === "Medium Readiness") {
    recommendations.unshift("Eine unverbindliche DepotOne-Ersteinschaetzung mit Standortdaten vorbereiten.");
  }

  if (!submission.contact.consentContact) {
    recommendations.push("Kontaktfreigabe aktiv erteilen, wenn eine DepotOne-Rueckmeldung gewuenscht ist.");
  }

  return recommendations.slice(0, 4);
}

function fillToThree(values: string[], fallback: string[]) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  for (const item of fallback) {
    if (unique.length >= 3) break;
    unique.push(item);
  }
  return unique.slice(0, 3);
}
