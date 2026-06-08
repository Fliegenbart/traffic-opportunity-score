export type TrafficOpportunityLevel =
  | "High Opportunity"
  | "Strong Candidate"
  | "Watchlist"
  | "Low Opportunity";

export interface TrafficOpportunityScoreInput {
  trucks2019: number;
  trucks2030: number;
  maxTrucks2030: number;
  distanceFitScore: number;
  corridorRelevanceScore: number;
}

export interface TrafficOpportunityComponents {
  volume: number;
  growth: number;
  distanceFit: number;
  corridorRelevance: number;
}

export interface TrafficOpportunityScore {
  score: number;
  growthPercent: number;
  components: TrafficOpportunityComponents;
}

export interface TrafficOpportunityClassification {
  level: TrafficOpportunityLevel;
  label: string;
  description: string;
}

function clamp(value: number, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeAgainstMax(value: number, maxValue: number) {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }

  return Math.round(clamp((value / maxValue) * 100));
}

export function getDistanceFitScore(distanceKm: number) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  if (distanceKm < 150) return 65;
  if (distanceKm < 300) return 100;
  if (distanceKm < 600) return 90;
  if (distanceKm < 1000) return 45;
  return 25;
}

function getGrowthComponent(trucks2019: number, trucks2030: number) {
  if (!Number.isFinite(trucks2019) || trucks2019 <= 0) return 0;

  const growthPercent = ((trucks2030 - trucks2019) / trucks2019) * 100;
  return Math.round(clamp((growthPercent / 60) * 100));
}

export function calculateTrafficOpportunityScore(
  input: TrafficOpportunityScoreInput,
): TrafficOpportunityScore {
  const volume = normalizeAgainstMax(input.trucks2030, input.maxTrucks2030);
  const growth = getGrowthComponent(input.trucks2019, input.trucks2030);
  const distanceFit = Math.round(clamp(input.distanceFitScore));
  const corridorRelevance = Math.round(clamp(input.corridorRelevanceScore));

  const score = Math.round(
    volume * 0.35 +
      growth * 0.15 +
      distanceFit * 0.35 +
      corridorRelevance * 0.15,
  );

  const growthPercent =
    input.trucks2019 > 0
      ? ((input.trucks2030 - input.trucks2019) / input.trucks2019) * 100
      : 0;

  return {
    score,
    growthPercent: Math.round(growthPercent * 10) / 10,
    components: {
      volume,
      growth,
      distanceFit,
      corridorRelevance,
    },
  };
}

export function classifyTrafficOpportunity(score: number): TrafficOpportunityClassification {
  if (score >= 75) {
    return {
      level: "High Opportunity",
      label: "Hohes Ladepunkt-Potenzial",
      description:
        "Sehr starkes Verkehrs- und Korridorsignal. Der Standort oder die Region sollte früh für halböffentliches Lkw-Laden geprüft werden.",
    };
  }

  if (score >= 55) {
    return {
      level: "Strong Candidate",
      label: "Starker Kandidat",
      description:
        "Gutes Potenzial, besonders wenn Netzanschluss, Fläche und Haltezeiten passen.",
    };
  }

  if (score >= 35) {
    return {
      level: "Watchlist",
      label: "Beobachtungsliste",
      description:
        "Ein möglicher Standort, aber die Wirtschaftlichkeit hängt stark von lokalen Zusatzdaten ab.",
    };
  }

  return {
    level: "Low Opportunity",
    label: "Niedriges Verkehrssignal",
    description:
      "Das synthetische Verkehrssignal reicht allein noch nicht für eine belastbare Ladepunkt-Priorisierung.",
  };
}
