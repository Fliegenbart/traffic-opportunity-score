import { z } from "zod";
import { distanceKm, type GeoPoint } from "../geo.js";
import { sourceSchema, type SourceRef } from "./contracts.js";
import { networkSchema } from "./traffic.js";

const nullableProfile = z.array(z.number().finite().nonnegative().nullable()).length(24);
const sampleCounts = z.array(z.number().int().nonnegative()).length(24);
const profiles = z.object({ weekday: nullableProfile, saturday: nullableProfile, sunday: nullableProfile }).strict();
export const stationSchema = z.object({
  stationId: z.string().min(1), vehicleClass: z.enum(["truck", "heavy_traffic_proxy"]),
  validHours: z.number().int().nonnegative(), expectedHours: z.number().int().positive(), coverage: z.number().min(0).max(1),
  duplicates: z.number().int().nonnegative(), invalidHours: z.number().int().nonnegative(),
  observedTrucks: z.number().finite().nonnegative(), meanObservedTrucksPerHour: z.number().finite().nonnegative().nullable(),
  directionShareR1: z.number().min(0).max(1).nullable(), usableAsCompleteProfile: z.boolean(), profiles,
  samplesByHour: z.object({ weekday: sampleCounts, saturday: sampleCounts, sunday: sampleCounts }).strict(),
  location: z.object({ lon: z.number().finite().min(5).max(16), lat: z.number().finite().min(47).max(56) }).strict(),
  name: z.string(), roadClass: z.string(), road: z.string(), direction1: z.string(), direction2: z.string(),
}).strict().superRefine((s, ctx) => {
  if (s.validHours + s.invalidHours > s.expectedHours || Math.abs(s.coverage - s.validHours / s.expectedHours) > 1e-7) {
    ctx.addIssue({ code: "custom", message: "Inkonsistente Stundenabdeckung" });
  }
  if (s.usableAsCompleteProfile && (s.coverage < 0.95 || Object.values(s.profiles).some((p) => p.some((v) => v === null))
    || Object.values(s.samplesByHour).some((p) => p.some((n) => n < 3)))) ctx.addIssue({ code: "custom", message: "Vollständigkeitsstatus widerspricht Profilwerten" });
});
export type TrafficStation = z.infer<typeof stationSchema>;
export const bastDataSchema = z.object({ schemaVersion: z.literal(1), source: sourceSchema,
  period: z.object({ start: z.string(), end: z.string() }).strict(), method: z.string(), stations: z.array(stationSchema).max(10000),
  quality: z.object({ rawNotProviderValidated: z.literal(true), rejectedFiles: z.array(z.object({ file: z.string(), reason: z.string() })),
    rejectedStations: z.array(z.object({ stationId: z.string(), reason: z.string() })),
    stationCount: z.number().int(), completeProfiles: z.number().int(), licenseMetadataSha256: z.string().optional(), downloadUrl: z.string().url().optional() }).strict(),
}).strict();

export function findStationCandidates(point: GeoPoint, raw: TrafficStation[], maxDistanceKm = 3) {
  z.object({ lon: z.number().finite().min(5).max(16), lat: z.number().finite().min(47).max(56) }).parse(point);
  z.number().finite().min(0).max(10).parse(maxDistanceKm);
  return z.array(stationSchema).max(10000).parse(raw)
    .filter((s) => s.usableAsCompleteProfile && s.coverage >= 0.95
      && Object.values(s.profiles).every((values) => values.every((v) => v !== null) && values.some((v) => v! > 0))
      && Object.values(s.samplesByHour).every((values) => values.every((v) => v >= 3)))
    .map((station) => ({ station, distanceKm: distanceKm(point, station.location), matchVerified: false as const }))
    .filter((s) => s.distanceKm <= maxDistanceKm).sort((a, b) => a.distanceKm - b.distanceKm);
}

export function stationProfiles(station: TrafficStation, source: SourceRef) {
  stationSchema.parse(station);
  sourceSchema.parse(source);
  if (!station.usableAsCompleteProfile || station.coverage < 0.95) throw new Error("Station besitzt kein ausreichend vollständiges Profil");
  return Object.fromEntries((["weekday", "saturday", "sunday"] as const).map((daytype) => {
    const weights = station.profiles[daytype];
    if (weights.some((v) => v === null) || station.samplesByHour[daytype].some((n) => n < 3)) throw new Error("Stundenprofil enthält Lücken oder zu wenige Beobachtungen");
    return [daytype, { source: { ...source, id: `${source.id}-station-${station.stationId}`, title: `${source.title}: ${station.name}` }, weights: weights as number[],
      vehicleClass: station.vehicleClass, matchStatus: "candidate" as const }];
  })) as Record<"weekday" | "saturday" | "sunday", { source: SourceRef; weights: number[]; vehicleClass: TrafficStation["vehicleClass"]; matchStatus: "candidate" }>;
}

export async function loadPlanningData(fetcher: typeof fetch = fetch, baseUrl = "/data/planning") {
  const read = async (name: string) => {
    const response = await fetcher(`${baseUrl}/${name}`);
    if (!response.ok) throw new Error(`Planungsdaten nicht verfügbar: ${name} (${response.status})`);
    try { return await response.json(); }
    catch { throw new Error(`Ungültige JSON-Quelldatei: ${name}`); }
  };
  const network = networkSchema.parse(await read("network-de.json"));
  const bast = bastDataSchema.parse(await read("bast-hourly-de.json"));
  return { network, bast };
}
