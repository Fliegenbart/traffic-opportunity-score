import { z } from "zod";
import { DEFAULT_ROUTING_VEHICLE } from "../shared/site-access.js";

// Truck route through all stops of a tour with HERE Routing v8: one request per tour, truck profile with dimensions and weight.
const point = z.object({ lon: z.number().finite().min(5).max(16), lat: z.number().finite().min(47).max(56) }).strict();
export const tourRouteInputSchema = z.object({ places: z.array(point).min(2).max(8), vehicle: z.enum(["long", "regional", "rigid"]).optional() }).strict();
export type TourRouteInput = z.infer<typeof tourRouteInputSchema>;
export type TourRouteResult = { provider: "HERE Routing v8"; line: [number, number][]; legs: { km: number; hours: number }[]; warnings: string[] };

// Articulated 40 t truck for the tractor classes, a 26 t three-axle truck for the rigid class.
const RIGID = { heightM: 4, widthM: 2.55, lengthM: 12, weightKg: 26000, axleWeightKg: 11500 };
const responseSchema = z.object({ routes: z.array(z.object({ sections: z.array(z.object({
  polyline: z.string().min(1), summary: z.object({ duration: z.number().finite().nonnegative(), length: z.number().finite().nonnegative() }),
  notices: z.array(z.object({ code: z.string().max(200), severity: z.string().max(50).optional() })).optional(),
})).min(1).max(8) })).min(1) });

// HERE "flexible polyline": URL-safe base64 varints, zigzag deltas of lat, lon and an optional third dimension.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function decodeFlexPolyline(encoded: string): [number, number][] {
  const values: number[] = [];
  let value = 0, factor = 1;
  for (const char of encoded) {
    const bits = ALPHABET.indexOf(char);
    if (bits < 0) throw new Error("Invalid polyline");
    value += (bits & 31) * factor;
    if (bits & 32) factor *= 32; else { values.push(value); value = 0; factor = 1; }
  }
  if (factor !== 1 || values.length < 2 || values[0] !== 1) throw new Error("Invalid polyline");
  const precision = 10 ** (values[1] & 15), step = (values[1] >> 4) & 7 ? 3 : 2;
  const line: [number, number][] = [];
  let lat = 0, lon = 0;
  for (let i = 2; i + 1 < values.length; i += step) {
    const signed = (v: number) => (v % 2 ? -(v + 1) / 2 : v / 2);
    lat += signed(values[i]); lon += signed(values[i + 1]);
    line.push([lon / precision, lat / precision]);
  }
  return line;
}

export async function hereTourRoute(raw: TourRouteInput, apiKey: string, fetcher: typeof fetch = fetch): Promise<TourRouteResult> {
  const input = tourRouteInputSchema.parse(raw);
  const vehicle = input.vehicle === "rigid" ? RIGID : DEFAULT_ROUTING_VEHICLE;
  const format = (p: { lon: number; lat: number }) => `${p.lat},${p.lon}`;
  const u = new URL("https://router.hereapi.com/v8/routes");
  const params: Record<string, string> = { apiKey, transportMode: "truck", routingMode: "fast", departureTime: "any", return: "polyline,summary",
    origin: format(input.places[0]), destination: format(input.places[input.places.length - 1]),
    "vehicle[height]": String(Math.ceil(vehicle.heightM * 100)), "vehicle[width]": String(Math.ceil(vehicle.widthM * 100)), "vehicle[length]": String(Math.ceil(vehicle.lengthM * 100)),
    "vehicle[currentWeight]": String(vehicle.weightKg), "vehicle[grossWeight]": String(vehicle.weightKg), "vehicle[weightPerAxle]": String(vehicle.axleWeightKg) };
  Object.entries(params).forEach(([key, value]) => u.searchParams.set(key, value));
  input.places.slice(1, -1).forEach((p) => u.searchParams.append("via", format(p)));
  let body: unknown;
  // Upstream errors can echo the request URL including the key, so they never leave this function.
  try {
    const response = await fetcher(u, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" }, redirect: "error" });
    if (!response.ok) throw new Error();
    body = await response.json();
  } catch { throw new Error("HERE request failed"); }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new Error("Unexpected HERE response");
  const sections = parsed.data.routes[0].sections;
  if (sections.length !== input.places.length - 1) throw new Error("Incomplete waypoint route");
  const warnings = new Set<string>();
  for (const section of sections) for (const n of section.notices || []) {
    if (n.severity === "critical" || n.code.startsWith("violated")) throw new Error("Route violates a restriction");
    warnings.add(n.code);
  }
  const full = sections.flatMap((s, i) => decodeFlexPolyline(s.polyline).slice(i ? 1 : 0));
  const every = Math.max(1, Math.ceil(full.length / 4000));
  return { provider: "HERE Routing v8", warnings: Array.from(warnings).slice(0, 20),
    line: full.filter((_, i) => i % every === 0 || i === full.length - 1).map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))]),
    legs: sections.map((s) => ({ km: s.summary.length / 1000, hours: s.summary.duration / 3600 })) };
}

const cache = new Map<string, { expires: number; result: TourRouteResult }>();
// `guard` enforces the paid budget; it runs only when the route is not in the instance cache.
export async function cachedHereTourRoute(input: TourRouteInput, apiKey: string, guard: () => Promise<boolean>, fetcher: typeof fetch = fetch): Promise<TourRouteResult | null> {
  const now = Date.now(), key = JSON.stringify(tourRouteInputSchema.parse(input));
  for (const [k, v] of Array.from(cache)) if (v.expires < now) cache.delete(k);
  if (cache.has(key)) return cache.get(key)!.result;
  if (!(await guard())) return null;
  const result = await hereTourRoute(input, apiKey, fetcher);
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: now + 900000, result });
  return result;
}
