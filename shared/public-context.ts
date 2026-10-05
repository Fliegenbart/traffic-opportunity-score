import { z } from "zod";
import { sourceSchema } from "./charging-planning/contracts";
import { distanceKm } from "./geo";

const year = z.number().int().min(2020).max(2100);
const count = z.number().int().nonnegative().max(10000);
const coverage = z.number().finite().min(0).max(1);
const monthly = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).length(12).refine(
  (rows) => new Set(rows.map((r) => r.month)).size === 12, "Doppelte Referenzmonate",
);
const month = z.number().int().min(1).max(12);
const price = z.number().finite().min(-5000).max(5000);
const temperature = z.number().finite().min(-80).max(60);
const calendarHours = (y: number) => (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 3600000;
export const electricityReferenceSchema = z.object({
  schemaVersion: z.literal(1), year, validHours: count, expectedHours: count, coverage: coverage.min(0.99),
  meanEurMwh: price, p10EurMwh: price, p90EurMwh: price, negativeHours: count,
  monthly: monthly(z.object({ month, validHours: count, meanEurMwh: price }).strict()),
  source: sourceSchema, method: z.string().min(1).max(2000),
  manifest: z.array(z.object({ url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(60),
}).strict().refine((v) => v.expectedHours === calendarHours(v.year) && v.validHours <= v.expectedHours && v.negativeHours <= v.validHours
  && v.monthly.reduce((sum, m) => sum + m.validHours, 0) === v.validHours
  && Math.abs(v.validHours / v.expectedHours - v.coverage) < 1e-9 && v.p10EurMwh <= v.p90EurMwh,
"Unplausible Preisabdeckung");
export const weatherStationSchema = z.object({
  stationId: z.string().min(1), name: z.string().min(1), lon: z.number().finite().min(5).max(16), lat: z.number().finite().min(47).max(56),
  elevationM: z.number().finite().min(-100).max(600), year, validHours: count, expectedHours: count,
  coverage: coverage.min(0.95), rejectedHours: z.number().int().nonnegative(), meanC: temperature, p10C: temperature, hoursBelowZero: count,
  monthly: monthly(z.object({ month, meanC: temperature, validHours: count }).strict()), source: sourceSchema,
}).strict().refine((v) => v.expectedHours === calendarHours(v.year) && v.validHours <= v.expectedHours && v.hoursBelowZero <= v.validHours
  && v.monthly.reduce((sum, m) => sum + m.validHours, 0) === v.validHours
  && Math.abs(v.validHours / v.expectedHours - v.coverage) < 1e-9, "Unplausible Temperaturabdeckung");
export const weatherReferenceSchema = z.object({
  schemaVersion: z.literal(1), year, stations: z.array(weatherStationSchema).min(1).max(1000),
  rejected: z.array(z.object({ stationId: z.string(), reason: z.string() }).strict()), method: z.string().min(1).max(2000),
}).strict().refine((v) => v.stations.every((s) => s.year === v.year)
  && new Set(v.stations.map((s) => s.stationId)).size === v.stations.length, "Inkonsistente Stationsliste");
export type ElectricityReference = z.infer<typeof electricityReferenceSchema>;
export type WeatherReference = z.infer<typeof weatherReferenceSchema>;
export const catalogSchema = z.object({
  schemaVersion: z.literal(1), method: z.string().min(1),
  vehicles: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), maxChargingKw: z.number().finite().min(1).max(2000), source: sourceSchema }).strict()).min(1).max(20),
  dhl: z.object({ source: sourceSchema, names: z.array(z.string().min(1)).length(38) }).strict(),
}).strict();
const daily = z.object({ weekday: z.number().finite().nonnegative(), saturday: z.number().finite().nonnegative(), sunday: z.number().finite().nonnegative() }).strict();
const period = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
export const trafficComparisonSchema = z.object({
  schemaVersion: z.literal(1), firstPeriod: period, secondPeriod: period,
  sources: z.array(sourceSchema).length(2), method: z.string().min(1),
  stations: z.array(z.object({ stationId: z.string().min(1), vehicleClass: z.enum(["truck", "heavy_traffic_proxy"]),
    roadClass: z.string(), road: z.string(), first: daily, second: daily }).strict()).max(10000),
}).strict().refine((v) => new Set(v.stations.map((s) => s.stationId)).size === v.stations.length, "Doppelte Vergleichsstation");
export type PublicCatalog = z.infer<typeof catalogSchema>;
export type TrafficComparison = z.infer<typeof trafficComparisonSchema>;

export function referenceElectricityPrice(eurMwh: number, surcharge: number) {
  price.parse(eurMwh);
  z.number().finite().min(0).max(5).parse(surcharge);
  return z.number().finite().min(0).max(5).parse(eurMwh / 1000 + surcharge);
}
export function stressEnergyKwh(base: number, percent: number) {
  z.number().finite().min(1).max(2000).parse(base);
  z.number().finite().min(0).max(100).parse(percent);
  return z.number().finite().min(1).max(2000).parse(base * (1 + percent / 100));
}
export function nearestWeather<T extends { lon: number; lat: number }>(site: { lon: number; lat: number }, stations: T[]) {
  const nearby = stations.map((station) => ({ ...station, distanceKm: distanceKm(site, station) }))
    .filter((station) => Number.isFinite(station.distanceKm) && station.distanceKm <= 100)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return nearby[0] || null;
}
