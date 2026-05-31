import assert from "node:assert/strict";
import {
  calculateReadinessScore,
  classifyLead,
  getReadinessLevel,
  type ReadinessSubmission,
} from "./readiness";

function baseSubmission(overrides: Partial<ReadinessSubmission> = {}): ReadinessSubmission {
  return {
    company: {
      companyName: "Muster Logistik",
      industry: "Spedition/Transport",
      contactRole: "Fuhrparkleitung",
      postcode: "30159",
      country: "Deutschland",
      depotsCount: 1,
    },
    fleet: {
      totalTrucks: 1,
      heavyTrucks: 1,
      trucksToReplace12m: 0,
      trucksToReplace24m: 0,
      trucksToReplace36m: 0,
      existingElectricTrucks: 0,
      currentVehicleBrands: ["Noch offen"],
    },
    operation: {
      averageKmPerDay: "unbekannt",
      maxKmPerDay: "unbekannt",
      depotReturnShare: "unbekannt",
      operationType: ["Sonstiges"],
      overnightIdleHours: "unbekannt",
      shiftOperation: "unbekannt",
    },
    depot: {
      depotOwnership: "unbekannt",
      truckParkingSpaces: 1,
      dedicatedParking: "unbekannt",
      gridConnectionKnown: "nein",
      gridCapacity: "unbekannt",
      spaceForChargingInfrastructure: "unklar",
      existingCharging: "keine",
      onsiteEnergy: ["unbekannt"],
    },
    energy: {
      simultaneousChargingNeed: "1-2 Fahrzeuge",
      chargingWindow: "unbekannt",
      interestLoadManagement: "nein",
      interestEnergyTariff: "nein",
      interestChargingAsAService: "nein",
    },
    economics: {
      annualMileagePerTruck: "unbekannt",
      mainMotivation: ["Sonstiges"],
      capexPreference: "unbekannt",
      projectTiming: "nur Orientierung",
      budgetStatus: "unbekannt",
      managementBuyIn: "unbekannt",
      wantsConsultation: false,
    },
    contact: {
      consentContact: false,
      consentMarketing: false,
      consentText: "",
      consentVersion: "2026-05-30",
    },
    utm: {},
    ...overrides,
  };
}

const early = calculateReadinessScore(baseSubmission());
assert.equal(getReadinessLevel(early.score), "Low Readiness");
assert.equal(classifyLead(baseSubmission(), early), "C-Lead");

const highSubmission = baseSubmission({
  fleet: {
    totalTrucks: 50,
    heavyTrucks: 45,
    trucksToReplace12m: 4,
    trucksToReplace24m: 10,
    trucksToReplace36m: 12,
    existingElectricTrucks: 2,
    currentVehicleBrands: ["Daimler Truck", "MAN"],
  },
  operation: {
    averageKmPerDay: "200-300 km",
    maxKmPerDay: "300-500 km",
    depotReturnShare: "75-100 %",
    operationType: ["Linienverkehr", "Regionalverkehr", "Verteilerverkehr"],
    overnightIdleHours: "8-12 h",
    shiftOperation: "Zweischichtbetrieb",
  },
  depot: {
    depotOwnership: "Eigentum",
    truckParkingSpaces: 60,
    dedicatedParking: "ja",
    gridConnectionKnown: "ja",
    gridCapacity: "über 3 MW",
    spaceForChargingInfrastructure: "ja",
    existingCharging: "Lkw-Ladepunkte",
    onsiteEnergy: ["PV", "Batteriespeicher", "Energiemanagement"],
  },
  economics: {
    annualMileagePerTruck: "90.000-120.000 km",
    mainMotivation: [
      "Kosten senken",
      "CO2 reduzieren",
      "Kundenanforderungen",
      "ESG/Reporting",
      "Maut/Regulierung",
    ],
    capexPreference: "lieber as-a-Service/Opex",
    projectTiming: "6-12 Monate",
    budgetStatus: "Budget vorhanden",
    managementBuyIn: "ja",
    wantsConsultation: true,
  },
  contact: {
    firstName: "Erika",
    lastName: "Muster",
    email: "erika@example.com",
    consentContact: true,
    consentMarketing: false,
    consentText: "Einwilligung",
    consentTimestamp: "2026-05-30T10:00:00.000Z",
    consentVersion: "2026-05-30",
  },
});

const high = calculateReadinessScore(highSubmission);
assert.equal(high.score, 100);
assert.equal(getReadinessLevel(high.score), "High Readiness");
assert.equal(classifyLead(highSubmission, high), "A-Lead");
assert.equal(high.planType, "Optimization Plan");
assert.equal(high.ctaLabel, "Digital-Twin-Routenanalyse anfragen");
assert.ok(high.planHighlights.includes("Ladepläne optimieren"));

const noConsent = calculateReadinessScore({
  ...highSubmission,
  contact: { ...highSubmission.contact, consentContact: false },
});
assert.equal(classifyLead({ ...highSubmission, contact: { ...highSubmission.contact, consentContact: false } }, noConsent), "C-Lead");

const mediumSubmission = baseSubmission({
  fleet: { ...highSubmission.fleet, totalTrucks: 10, trucksToReplace24m: 3 },
  operation: {
    ...highSubmission.operation,
    averageKmPerDay: "100-200 km",
    operationType: ["Regionalverkehr"],
  },
  depot: {
    ...highSubmission.depot,
    depotOwnership: "gemietet 2-5 Jahre",
    dedicatedParking: "teilweise",
    gridConnectionKnown: "teilweise",
    gridCapacity: "250-500 kW",
    spaceForChargingInfrastructure: "wahrscheinlich",
    onsiteEnergy: ["PV"],
  },
  economics: {
    ...highSubmission.economics,
    annualMileagePerTruck: "60.000-90.000 km",
    capexPreference: "offen",
    budgetStatus: "Budget in Planung",
    managementBuyIn: "teilweise",
    projectTiming: "12-24 Monate",
  },
  contact: highSubmission.contact,
});

const medium = calculateReadinessScore(mediumSubmission);
assert.equal(getReadinessLevel(medium.score), "Medium Readiness");
assert.equal(classifyLead(mediumSubmission, medium), "B-Lead");
assert.equal(medium.planType, "Feasibility Plan");
assert.equal(medium.ctaLabel, "DepotOne Plan anfragen");
assert.ok(medium.planHighlights.includes("Machbarkeit und Infrastrukturgröße prüfen"));
