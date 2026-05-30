export type ReadinessFieldType = "text" | "number" | "select" | "multiselect" | "boolean";

export interface ReadinessField {
  key: string;
  label: string;
  type: ReadinessFieldType;
  required?: boolean;
  options?: string[];
  defaultValue?: string | number | boolean | string[];
}

export interface ReadinessStep {
  id: string;
  title: string;
  fields: ReadinessField[];
}

export const readinessSteps: ReadinessStep[] = [
  {
    id: "company",
    title: "Unternehmen",
    fields: [
      { key: "company.companyName", label: "Unternehmensname", type: "text", required: true },
      {
        key: "company.industry",
        label: "Branche",
        type: "select",
        required: true,
        options: [
          "Spedition/Transport",
          "Kontraktlogistik",
          "Handel/Retail",
          "Industrie/Produktion",
          "Automotive",
          "Lebensmittel/Frische",
          "Bau/Entsorgung",
          "Sonstiges",
        ],
      },
      {
        key: "company.contactRole",
        label: "Rolle",
        type: "select",
        required: true,
        options: [
          "Geschäftsführung",
          "Fuhrparkleitung",
          "Logistikleitung",
          "Einkauf",
          "Nachhaltigkeit/ESG",
          "Technik/Infrastruktur",
          "Beratung",
          "Sonstiges",
        ],
      },
      { key: "company.postcode", label: "Postleitzahl", type: "text", required: true },
      { key: "company.country", label: "Land", type: "select", required: true, options: ["Deutschland", "Österreich", "Schweiz", "Andere"], defaultValue: "Deutschland" },
      { key: "company.depotsCount", label: "Anzahl Depots", type: "number", required: true, defaultValue: 1 },
    ],
  },
  {
    id: "fleet",
    title: "Fuhrpark",
    fields: [
      { key: "fleet.totalTrucks", label: "Lkw gesamt", type: "number", required: true, defaultValue: 1 },
      { key: "fleet.heavyTrucks", label: "Schwere Lkw", type: "number", required: true, defaultValue: 1 },
      { key: "fleet.trucksToReplace12m", label: "Ersatz in 12 Monaten", type: "number", defaultValue: 0 },
      { key: "fleet.trucksToReplace24m", label: "Ersatz in 24 Monaten", type: "number", defaultValue: 0 },
      { key: "fleet.trucksToReplace36m", label: "Ersatz in 36 Monaten", type: "number", defaultValue: 0 },
      { key: "fleet.existingElectricTrucks", label: "Bestehende E-Lkw", type: "number", defaultValue: 0 },
      {
        key: "fleet.currentVehicleBrands",
        label: "Aktuelle Fahrzeugmarken",
        type: "multiselect",
        options: ["Daimler Truck", "MAN", "Volvo Trucks", "Scania", "DAF", "Renault Trucks", "Iveco", "Hyundai", "Andere", "Noch offen"],
      },
    ],
  },
  {
    id: "operation",
    title: "Einsatzprofil",
    fields: [
      { key: "operation.averageKmPerDay", label: "Durchschnittliche km pro Tag", type: "select", options: ["unter 100 km", "100-200 km", "200-300 km", "300-500 km", "über 500 km", "unbekannt"] },
      { key: "operation.maxKmPerDay", label: "Maximale km pro Tag", type: "select", options: ["unter 200 km", "200-300 km", "300-500 km", "500-700 km", "über 700 km", "unbekannt"] },
      { key: "operation.depotReturnShare", label: "Depot-Rückkehrquote", type: "select", options: ["0-25 %", "25-50 %", "50-75 %", "75-100 %", "unbekannt"] },
      { key: "operation.operationType", label: "Betriebsarten", type: "multiselect", options: ["Regionalverkehr", "Verteilerverkehr", "Linienverkehr", "Fernverkehr", "Baustellenverkehr", "Kühltransport", "Werksverkehr", "Sonstiges"] },
      { key: "operation.overnightIdleHours", label: "Standzeit über Nacht", type: "select", options: ["unter 4 h", "4-6 h", "6-8 h", "8-12 h", "über 12 h", "unbekannt"] },
      { key: "operation.shiftOperation", label: "Schichtbetrieb", type: "select", options: ["Einschichtbetrieb", "Zweischichtbetrieb", "Dreischichtbetrieb", "unterschiedlich", "unbekannt"] },
    ],
  },
  {
    id: "depot",
    title: "Depot und Infrastruktur",
    fields: [
      { key: "depot.depotOwnership", label: "Depotstatus", type: "select", options: ["Eigentum", "gemietet > 5 Jahre", "gemietet 2-5 Jahre", "gemietet < 2 Jahre", "unbekannt"] },
      { key: "depot.truckParkingSpaces", label: "Lkw-Stellplätze", type: "number", defaultValue: 0 },
      { key: "depot.dedicatedParking", label: "Feste Stellplätze", type: "select", options: ["ja", "teilweise", "nein", "unbekannt"] },
      { key: "depot.gridConnectionKnown", label: "Netzanschluss bekannt", type: "select", options: ["ja", "nein", "teilweise"] },
      { key: "depot.gridCapacity", label: "Netzkapazität", type: "select", options: ["unter 250 kW", "250-500 kW", "500 kW-1 MW", "1-3 MW", "über 3 MW", "unbekannt"] },
      { key: "depot.spaceForChargingInfrastructure", label: "Platz für Ladeinfrastruktur", type: "select", options: ["ja", "wahrscheinlich", "unklar", "nein"] },
      { key: "depot.existingCharging", label: "Bestehende Ladeinfrastruktur", type: "select", options: ["keine", "Pkw-Ladepunkte", "leichte Nutzfahrzeuge", "Lkw-Ladepunkte", "unbekannt"] },
      { key: "depot.onsiteEnergy", label: "Energie am Standort", type: "multiselect", options: ["PV", "Batteriespeicher", "Energiemanagement", "eigener Trafo", "keines davon", "unbekannt"] },
    ],
  },
  {
    id: "energy",
    title: "Laden und Energie",
    fields: [
      { key: "energy.simultaneousChargingNeed", label: "Gleichzeitiger Ladebedarf", type: "select", options: ["1-2 Fahrzeuge", "3-5 Fahrzeuge", "6-10 Fahrzeuge", "11-20 Fahrzeuge", "über 20 Fahrzeuge", "unbekannt"] },
      { key: "energy.chargingWindow", label: "Ladefenster", type: "select", options: ["vor allem nachts", "tagsüber zwischen Touren", "gemischt", "kaum Standzeit", "unbekannt"] },
      { key: "energy.interestLoadManagement", label: "Interesse Lastmanagement", type: "select", options: ["ja", "vielleicht", "nein"] },
      { key: "energy.interestEnergyTariff", label: "Interesse Energietarif", type: "select", options: ["ja", "vielleicht", "nein"] },
      { key: "energy.interestChargingAsAService", label: "Interesse Charging-as-a-Service", type: "select", options: ["ja", "vielleicht", "nein"] },
    ],
  },
  {
    id: "economics",
    title: "Wirtschaftlichkeit und Timing",
    fields: [
      { key: "economics.annualMileagePerTruck", label: "Jahreskilometer je Lkw", type: "select", options: ["unter 30.000 km", "30.000-60.000 km", "60.000-90.000 km", "90.000-120.000 km", "über 120.000 km", "unbekannt"] },
      { key: "economics.mainMotivation", label: "Hauptmotivation", type: "multiselect", options: ["Kosten senken", "CO2 reduzieren", "Kundenanforderungen", "ESG/Reporting", "Maut/Regulierung", "Image/Innovation", "Fahrermotivation", "Fördermittel", "Sonstiges"] },
      { key: "economics.capexPreference", label: "Investitionspräferenz", type: "select", options: ["Kauf/Capex möglich", "lieber Leasing", "lieber as-a-Service/Opex", "offen", "unbekannt"] },
      { key: "economics.projectTiming", label: "Projektzeitpunkt", type: "select", options: ["0-6 Monate", "6-12 Monate", "12-24 Monate", "24+ Monate", "nur Orientierung"] },
      { key: "economics.budgetStatus", label: "Budgetstatus", type: "select", options: ["Budget vorhanden", "Budget in Planung", "noch kein Budget", "unbekannt"] },
      { key: "economics.managementBuyIn", label: "Management Buy-in", type: "select", options: ["ja", "teilweise", "nein", "unbekannt"] },
      { key: "economics.wantsConsultation", label: "Ich möchte eine unverbindliche Ersteinschätzung zu meinem Depot erhalten.", type: "boolean", defaultValue: false },
    ],
  },
];
