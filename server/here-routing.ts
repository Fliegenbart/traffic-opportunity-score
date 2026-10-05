import { z } from "zod";
import { distanceKm } from "../shared/geo.js";
import { DEFAULT_ROUTING_VEHICLE, siteAccessInputSchema, siteAccessResultSchema, type SiteAccessInput, type SiteAccessResult } from "../shared/site-access.js";

const location = z.object({ lat: z.number().finite(), lng: z.number().finite() });
const place = z.object({ location });
const responseSchema = z.object({ routes: z.array(z.object({ sections: z.array(z.object({
  summary: z.object({ duration: z.number().finite().nonnegative(), length: z.number().finite().nonnegative() }),
  departure: z.object({ place }), arrival: z.object({ place }),
  notices: z.array(z.object({ code: z.string().max(200), severity: z.string().max(50).optional() })).optional(),
})).min(1).max(2) })).min(1) });

export async function checkHereSiteAccess(raw: SiteAccessInput, apiKey: string, fetcher: typeof fetch = fetch): Promise<SiteAccessResult> {
  const input = siteAccessInputSchema.parse(raw);
  const vehicle = input.vehicle || DEFAULT_ROUTING_VEHICLE;
  const base = { provider: "HERE Routing v8" as const, profile: "truck", vehicle, truckAccessVerified: false as const,
    site: input.site, edgeId: input.edge.edgeId, checkedAt: new Date().toISOString() };
  const warnings = new Set<string>();
  const signal = AbortSignal.timeout(12000);
  const route = async (coordinates: { lon: number; lat: number }[]) => {
    const u = new URL("https://router.hereapi.com/v8/routes");
    const format = (p: { lon: number; lat: number }) => `${p.lat},${p.lon}`;
    const params: Record<string, string> = { apiKey, transportMode: "truck", routingMode: "fast", departureTime: "any", return: "summary", origin: format(coordinates[0]), destination: format(coordinates[coordinates.length - 1]),
      "vehicle[height]": String(Math.ceil(vehicle.heightM * 100)), "vehicle[width]": String(Math.ceil(vehicle.widthM * 100)), "vehicle[length]": String(Math.ceil(vehicle.lengthM * 100)),
      "vehicle[currentWeight]": String(vehicle.weightKg), "vehicle[grossWeight]": String(vehicle.weightKg), "vehicle[weightPerAxle]": String(vehicle.axleWeightKg) };
    Object.entries(params).forEach(([key, value]) => u.searchParams.set(key, value));
    if (coordinates.length === 3) u.searchParams.set("via", format(coordinates[1]));
    const response = await fetcher(u, { signal, headers: { Accept: "application/json" }, redirect: "error" });
    if (!response.ok) throw new Error("HERE request failed");
    const sections = responseSchema.parse(await response.json()).routes[0].sections;
    if (sections.length !== coordinates.length - 1) throw new Error("Incomplete waypoint route");
    for (const section of sections) for (const n of section.notices || []) {
      warnings.add(`${n.severity || "unknown"}: ${n.code}`);
      if (n.severity === "critical" || n.code.startsWith("violated")) throw new Error("Route violates a restriction");
    }
    const matched = [sections[0].departure.place.location, ...sections.map((s) => s.arrival.place.location)];
    const snaps = matched.map((p, i) => distanceKm(coordinates[i], { lat: p.lat, lon: p.lng }) * 1000);
    if (snaps.some((m, i) => m > (coordinates.length === 3 && i === 1 ? 100 : 500))) throw new Error("Excessive road snapping");
    if (sections.length === 2 && distanceKm({ lon: sections[0].arrival.place.location.lng, lat: sections[0].arrival.place.location.lat },
      { lon: sections[1].departure.place.location.lng, lat: sections[1].departure.place.location.lat }) > 0.01) throw new Error("Discontinuous route");
    return { duration: sections.reduce((s, v) => s + v.summary.duration, 0), distance: sections.reduce((s, v) => s + v.summary.length, 0), snap: coordinates.length === 3 ? snaps[1] : 0 };
  };
  try {
    const a = { lon: input.edge.aLon, lat: input.edge.aLat }, b = { lon: input.edge.bLon, lat: input.edge.bLat };
    const directions: SiteAccessResult["directions"] = [];
    for (const [direction, start, end] of [["a_to_b", a, b], ["b_to_a", b, a]] as const) {
      const baseline = await route([start, end]), via = await route([start, input.site, end]);
      if (via.duration < baseline.duration - 30 || via.distance < baseline.distance - 50) throw new Error("Contradictory route");
      directions.push({ direction, baselineKm: baseline.distance / 1000, baselineMinutes: baseline.duration / 60,
        viaSiteKm: via.distance / 1000, viaSiteMinutes: via.duration / 60, extraKm: Math.max(0, via.distance - baseline.distance) / 1000,
        extraMinutes: Math.max(0, via.duration - baseline.duration) / 60, siteSnapMeters: via.snap });
    }
    return siteAccessResultSchema.parse({ ...base, status: "truck_route_proxy", directions, warnings: Array.from(warnings).slice(0, 40),
      message: "Die Route berücksichtigt die angegebenen Lkw-Maße und Gewichte. Die Start- und Endpunkte sowie die Einfahrt auf das Grundstück sind nicht vor Ort geprüft. Private Zufahrten, Gefahrgut, Öffnungszeiten und zeitabhängige Verbote sind damit nicht freigegeben. Aktuelle Staus und die Dauer des Ladens sind nicht berücksichtigt." });
  } catch {
    return { ...base, status: "unavailable", directions: [], warnings: Array.from(warnings).slice(0, 40),
      message: "HERE konnte keine vollständige, widerspruchsfreie Lkw-Route liefern. Mögliche Gründe sind Einschränkungen der Route, ein nicht freigeschalteter Dienst, eine zu lange Antwortzeit oder ungeeignete Start- und Endpunkte. Das beweist nicht, dass der Standort unzugänglich ist." };
  }
}

const cache = new Map<string, { expires: number; result: SiteAccessResult }>();
const limits = new Map<string, { expires: number; count: number }>();
let instanceBudget = { expires: 0, count: 0 };
// `guard` enforces the global (cross-instance) budget; it runs only on a cache miss, after the cheap local checks.
export async function cachedHereSiteAccess(input: SiteAccessInput, apiKey: string, caller: string, fetcher: typeof fetch = fetch,
  guard: () => Promise<boolean> = async () => true): Promise<SiteAccessResult | null> {
  const now = Date.now(), key = JSON.stringify(input);
  for (const [k, v] of Array.from(cache)) if (v.expires < now) cache.delete(k);
  for (const [k, v] of Array.from(limits)) if (v.expires < now) limits.delete(k);
  if (cache.has(key)) return cache.get(key)!.result;
  const budget = limits.get(caller) || { expires: now + 3600000, count: 0 };
  if (instanceBudget.expires < now) instanceBudget = { expires: now + 3600000, count: 0 };
  if (budget.count >= 8 || instanceBudget.count >= 32) return null;
  // A full table evicts the oldest caller instead of locking out every new caller.
  if (!limits.has(caller) && limits.size >= 1000) limits.delete(limits.keys().next().value!);
  if (!(await guard())) return null;
  budget.count++; limits.set(caller, budget);
  instanceBudget.count++;
  const result = await checkHereSiteAccess(input, apiKey, fetcher);
  if (result.status === "truck_route_proxy") { if (cache.size >= 100) cache.delete(cache.keys().next().value!); cache.set(key, { expires: now + 900000, result }); }
  return result;
}
