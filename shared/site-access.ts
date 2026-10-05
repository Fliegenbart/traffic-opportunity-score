import { z } from "zod";

const point = z.object({ lon: z.number().finite().min(5).max(16), lat: z.number().finite().min(47).max(56) }).strict();
export const truckRoutingVehicleSchema = z.object({
  heightM: z.number().finite().min(1).max(6), widthM: z.number().finite().min(1).max(5),
  lengthM: z.number().finite().min(2).max(30), weightKg: z.number().int().min(1000).max(80000),
  axleWeightKg: z.number().int().min(1000).max(20000),
}).strict().refine((v) => v.axleWeightKg <= v.weightKg, "Achslast über Gesamtgewicht");
export const DEFAULT_ROUTING_VEHICLE = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500 };
export const siteAccessInputSchema = z.object({
  site: point,
  vehicle: truckRoutingVehicleSchema.optional(),
  edge: z.object({ edgeId: z.number().int().nonnegative(), aLon: point.shape.lon, aLat: point.shape.lat,
    bLon: point.shape.lon, bLat: point.shape.lat }).strict(),
}).strict();
export type SiteAccessInput = z.infer<typeof siteAccessInputSchema>;
export type RoutingConfig = { baseUrl: string; profile: string };
const directionSchema = z.object({ direction: z.enum(["a_to_b", "b_to_a"]),
  baselineKm: z.number().finite().nonnegative(), baselineMinutes: z.number().finite().nonnegative(),
  viaSiteKm: z.number().finite().nonnegative(), viaSiteMinutes: z.number().finite().nonnegative(),
  extraKm: z.number().finite().nonnegative(), extraMinutes: z.number().finite().nonnegative(),
  siteSnapMeters: z.number().finite().nonnegative(),
}).strict();
export const siteAccessResultSchema = z.object({
  status: z.enum(["not_configured", "unavailable", "road_proxy", "truck_route_proxy"]),
  truckAccessVerified: z.literal(false), edgeId: z.number().int().nonnegative(), site: point,
  checkedAt: z.string().datetime(), provider: z.enum(["OSRM-kompatibler Dienst", "HERE Routing v8"]),
  vehicle: truckRoutingVehicleSchema.optional(), warnings: z.array(z.string().max(500)).max(40).optional(),
  profile: z.string(), message: z.string(), directions: z.array(directionSchema).max(2),
}).strict().superRefine((value, ctx) => {
  if (["road_proxy", "truck_route_proxy"].includes(value.status) ? value.directions.length !== 2 || new Set(value.directions.map((d) => d.direction)).size !== 2 : value.directions.length !== 0) {
    ctx.addIssue({ code: "custom", message: "Unvollständige Richtungsprüfung" });
  }
  if (value.status === "truck_route_proxy" && (value.provider !== "HERE Routing v8" || !value.vehicle)) ctx.addIssue({ code: "custom", message: "Lkw-Profil fehlt" });
});
export type SiteAccessResult = z.infer<typeof siteAccessResultSchema>;
const routeSchema = z.object({ code: z.literal("Ok"), routes: z.array(z.object({
  duration: z.number().finite().nonnegative(), distance: z.number().finite().nonnegative(),
})).min(1), waypoints: z.array(z.object({ distance: z.number().finite().nonnegative() })) });

export function validateRoutingConfig(raw: RoutingConfig): RoutingConfig {
  const base = new URL(raw.baseUrl);
  if (["router.project-osrm.org", "routing.openstreetmap.de"].includes(base.hostname.toLowerCase())) {
    throw new Error("Öffentliche Demo-Routingdienste sind für diese kommerzielle Anwendung nicht zulässig");
  }
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
    || base.username || base.password || base.search || base.hash || !/^[a-zA-Z0-9_-]{1,40}$/.test(raw.profile)) {
    throw new Error("Ungültige Routingkonfiguration");
  }
  return { baseUrl: base.toString().replace(/\/$/, ""), profile: raw.profile };
}

export async function checkSiteAccess(raw: SiteAccessInput, rawConfig?: RoutingConfig, fetcher: typeof fetch = fetch): Promise<SiteAccessResult> {
  const input = siteAccessInputSchema.parse(raw);
  const base = { truckAccessVerified: false as const, edgeId: input.edge.edgeId, site: input.site,
    checkedAt: new Date().toISOString(), provider: "OSRM-kompatibler Dienst" as const, profile: rawConfig?.profile || "driving" };
  if (!rawConfig) return { ...base, status: "not_configured", directions: [], message: "Der Routenanbieter ist für diese Website noch nicht freigeschaltet. Deshalb können Umweg und Fahrzeit derzeit nicht berechnet werden. Die Zufahrt für Lkw bleibt ungeprüft." };
  const config = validateRoutingConfig(rawConfig);
  const signal = AbortSignal.timeout(12000);
  const route = async (coordinates: { lon: number; lat: number }[], via: boolean) => {
    const radiuses = via ? "500;100;500" : "500;500";
    const url = `${config.baseUrl}/route/v1/${config.profile}/${coordinates.map((p) => `${p.lon},${p.lat}`).join(";")}?overview=false&alternatives=false&steps=false&continue_straight=true&radiuses=${radiuses}`;
    const response = await fetcher(url, { signal, headers: { Accept: "application/json" }, redirect: "error" });
    if (!response.ok) throw new Error("Routingdienst nicht verfügbar");
    const parsed = routeSchema.parse(await response.json());
    if (parsed.waypoints.length !== coordinates.length || parsed.waypoints.some((p, i) => p.distance > (via && i === 1 ? 100 : 500))) throw new Error("Straßenanbindung zu weit vom Prüfpunkt entfernt");
    return { ...parsed.routes[0], snap: via ? parsed.waypoints[1].distance : 0 };
  };
  const a = { lon: input.edge.aLon, lat: input.edge.aLat };
  const b = { lon: input.edge.bLon, lat: input.edge.bLat };
  try {
    const directions: SiteAccessResult["directions"] = [];
    for (const [direction, start, end] of [["a_to_b", a, b], ["b_to_a", b, a]] as const) {
      const baseline = await route([start, end], false);
      const via = await route([start, input.site, end], true);
      // Small routing-rounding differences are tolerated, contradictory routes are not.
      if (via.duration < baseline.duration - 30 || via.distance < baseline.distance - 50) throw new Error("Routenvergleich widersprüchlich");
      directions.push({ direction, baselineKm: baseline.distance / 1000, baselineMinutes: baseline.duration / 60,
        viaSiteKm: via.distance / 1000, viaSiteMinutes: via.duration / 60,
        extraKm: Math.max(0, via.distance - baseline.distance) / 1000,
        extraMinutes: Math.max(0, via.duration - baseline.duration) / 60, siteSnapMeters: via.snap });
    }
    return siteAccessResultSchema.parse({ ...base, status: "road_proxy", directions,
      message: "Berechnet wird die Fahrt zwischen zwei Punkten mit und ohne Umweg zum Standort. Diese Straßenroute bestätigt nicht, dass ein Lkw dort einfahren kann. Fahrzeugmaße, Gewicht, Einfahrt und Öffnungszeiten sind nicht geprüft. Der Verkehr je Fahrtrichtung lässt sich daraus nicht ableiten." });
  } catch {
    return { ...base, status: "unavailable", directions: [], message: "Es konnte keine vollständige, widerspruchsfreie Route berechnet werden. Das bedeutet nicht, dass der Standort für Lkw unzugänglich ist; die Zufahrt muss separat geprüft werden." };
  }
}
