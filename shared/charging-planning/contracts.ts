import { z } from "zod";

export class PlanningLimitError extends Error {
  constructor(message: string) { super(message); this.name = "PlanningLimitError"; }
}

const nonnegative = z.number().finite().nonnegative();
const share = z.number().finite().min(0).max(1);
const shortText = z.string().trim().min(1).max(500);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const date = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, "Ungültiges Kalenderdatum");
export const sourceSchema = z.object({
  id: shortText, title: shortText, url: z.string().url().max(2000),
  kind: z.enum(["measured", "synthetic", "assumption"]), version: shortText,
  retrievedAt: z.string().datetime({ offset: true }),
  observedThrough: isoDate,
  sha256: z.string().regex(/^[a-f0-9]{64}$/), license: shortText,
  commercialUse: z.enum(["allowed", "restricted", "unknown"]),
}).strict().refine((s) => s.observedThrough <= s.retrievedAt.slice(0, 10), "Beobachtungsdatum nach Abrufdatum");
export type SourceRef = z.infer<typeof sourceSchema>;

export const profileSchema = z.object({
  source: sourceSchema,
  vehicleClass: z.enum(["truck", "heavy_traffic_proxy"]),
  matchStatus: z.enum(["reviewed", "candidate", "assumed"]),
  weights: z.array(nonnegative.max(1000000)).length(24).refine((w) => w.some((v) => v > 0), "Leeres Tagesprofil"),
}).strict();
export const anchorSchema = z.object({
  id: shortText, hour: z.number().int().min(0).max(23),
  count: z.number().int().min(0).max(5000), energyKwh: z.number().finite().min(1).max(2000),
  includedInPassing: z.boolean(),
  activeOn: z.array(z.enum(["weekday", "saturday", "sunday"])).min(1).max(3).optional(),
}).strict();
export const demandSchema = z.object({
  reachableShare: share, captureShare: share, energyKwh: z.number().finite().min(1).max(2000),
  seed: z.number().int().min(0).max(4294967295), anchors: z.array(anchorSchema).max(24),
}).strict().superRefine((d, ctx) => {
  if (new Set(d.anchors.map((a) => a.id)).size !== d.anchors.length) ctx.addIssue({ code: "custom", message: "Doppelte Ankerkunden-ID" });
  if (d.anchors.reduce((s, a) => s + a.count, 0) > 5000) ctx.addIssue({ code: "custom", message: "Zu viele Ankerkunden" });
});
export type DemandInput = z.infer<typeof demandSchema>;

const minute = z.number().int().min(0).max(1440).refine((v) => v % 5 === 0, "Fünf-Minuten-Raster erforderlich");
export const capacitySchema = z.object({
  ports: z.number().int().min(1).max(100), portPowerKw: z.number().finite().min(1).max(2000),
  gridPowerKw: nonnegative.max(100000).nullable(), lossPercent: nonnegative.max(30),
  turnaroundMinutes: minute.refine((v) => v <= 120),
  maxWaitMinutes: minute.refine((v) => v <= 240),
  opening: z.array(z.object({ startMinute: minute, endMinute: minute }).strict()).max(24),
}).strict().superRefine((v, ctx) => {
  let end = -1;
  for (const w of v.opening) {
    if (w.startMinute >= w.endMinute || w.startMinute < end) ctx.addIssue({ code: "custom", message: "Öffnungsfenster überlappen oder sind unsortiert" });
    end = w.endMinute;
  }
});
export type CapacityInput = z.infer<typeof capacitySchema>;

export const sessionSchema = z.object({
  id: shortText, arrivalMinute: minute.refine((v) => v < 1440),
  energyKwh: z.number().finite().min(1).max(2000), kind: z.enum(["passing", "anchor"]),
}).strict();
export type ChargingSession = z.infer<typeof sessionSchema>;

export const financeSchema = z.object({
  capex: nonnegative.max(100000000), fixedCostAnnual: nonnegative.max(10000000),
  salePricePerKwh: nonnegative.max(5), electricityPricePerKwh: nonnegative.max(5), variableCostPerKwh: nonnegative.max(5),
  discountRate: share, priceEscalation: z.number().finite().min(-0.2).max(0.2),
  costEscalation: z.number().finite().min(-0.2).max(0.2),
  replacements: z.array(z.object({ year: z.number().int().min(2020).max(2100), amount: nonnegative.max(100000000) }).strict()).max(30),
  residualValue: nonnegative.max(100000000),
}).strict();
export type FinanceInput = z.infer<typeof financeSchema>;

export const trafficSchema = z.object({
  trucksPerDay: nonnegative.max(1000000), source: sourceSchema,
  contextSource: sourceSchema.optional(),
  referenceYear: z.number().int().min(2000).max(2100), edgeId: z.number().int().nonnegative().optional(),
  matchDistanceKm: nonnegative.max(25).optional(),
  directionShareR1: share.nullable().optional(),
  vehicleClass: z.enum(["truck", "heavy_traffic_proxy"]),
}).strict();
export const yearSchema = z.object({ year: z.number().int().min(2020).max(2100), evShare: share, trafficMultiplier: nonnegative.max(5) }).strict();
const scenarioSchema = z.object({ id: shortText, label: shortText, years: z.array(yearSchema).min(1).max(10) }).strict();
export const planningRequestSchema = z.object({
  schemaVersion: z.literal(1),
  site: z.object({
    id: shortText, label: shortText, lon: z.number().finite().min(5).max(16), lat: z.number().finite().min(47).max(56),
    access: z.object({ status: z.enum(["verified", "assumed", "unknown", "inaccessible"]), note: shortText,
      directions: z.enum(["both", "r1", "r2"]).optional() }).strict(),
    gridStatus: z.enum(["verified", "assumed", "unknown"]), competitionStatus: z.enum(["reviewed", "unknown"]),
  }).strict(),
  traffic: trafficSchema,
  profiles: z.object({ weekday: profileSchema, saturday: profileSchema, sunday: profileSchema }).strict(),
  demand: demandSchema, capacity: capacitySchema, finance: financeSchema,
  scenarios: z.array(scenarioSchema).min(1).max(3),
}).strict().superRefine((r, ctx) => {
  const signature = r.scenarios[0].years.map((y) => y.year).join(",");
  if (new Set(r.scenarios.map((s) => s.id)).size !== r.scenarios.length) ctx.addIssue({ code: "custom", message: "Doppelte Szenario-ID" });
  for (const s of r.scenarios) {
    if (s.years.map((y) => y.year).join(",") !== signature || s.years.some((y, i) => i > 0 && y.year !== s.years[i - 1].year + 1)) {
      ctx.addIssue({ code: "custom", message: "Szenarien müssen denselben lückenlosen Jahreszeitraum abdecken" });
    }
  }
  if (r.site.gridStatus !== "unknown" && r.capacity.gridPowerKw === null) ctx.addIssue({ code: "custom", message: "Netzleistung fehlt trotz bekanntem Netzstatus" });
  const years = r.scenarios[0].years.map((y) => y.year);
  if (r.finance.replacements.some((x) => !years.includes(x.year))) ctx.addIssue({ code: "custom", message: "Ersatzinvestition außerhalb des Planzeitraums" });
});
export type PlanningRequest = z.infer<typeof planningRequestSchema>;
