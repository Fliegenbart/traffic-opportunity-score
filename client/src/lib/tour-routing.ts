import { alongRoute, type TourCharger } from "@shared/tour-plan";

export type Hub = { id: string; name: string; operator: string; status: "live" | "announced"; lon: number; lat: number; maxKw?: number | null };
export type Charging = { verified: Hub[]; proxy: { lon: number; lat: number; chargePoints: number; maxKw: number }[] };
export type Network = "live" | "announced" | "proxy";
export type Place = { lon: number; lat: number; label: string };
export type Route = { places: Place[]; line: [number, number][]; legs: { km: number; hours: number }[]; truckRouting: boolean };

// A truck is limited to 80 km/h; the car route time is the lower bound in towns and on slow roads.
const TRUCK_KMH = 80;

export async function geocode(q: string): Promise<Place | null> {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
  const hits = (await response.json()) as { lat: string; lon: string; display_name: string }[];
  return hits.length ? { lon: Number(hits[0].lon), lat: Number(hits[0].lat), label: hits[0].display_name.split(",").slice(0, 2).join(", ") } : null;
}

// Truck routing (HERE, paid) runs on the server and only when it is switched on there. One refusal turns it off for this page visit.
let truckRoutingOff = false;
async function fetchTruckRoute(places: Place[], vehicleId?: string): Promise<Route | null> {
  if (truckRoutingOff) return null;
  try {
    const response = await fetch("/api/tour-route", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ places: places.map((p) => ({ lon: p.lon, lat: p.lat })), ...(vehicleId ? { vehicle: vehicleId } : {}) }) });
    // 502 = no truck route for this tour; everything else (not enabled, limited, no API in local dev) applies to all tours.
    if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) { if (response.status !== 502) truckRoutingOff = true; return null; }
    const body = (await response.json()) as { line: [number, number][]; legs: { km: number; hours: number }[] };
    return { places, line: body.line, legs: body.legs, truckRouting: true };
  } catch { truckRoutingOff = true; return null; }
}

// Fallback: public OSRM demo server (car profile), time scaled to truck speed. Not for production load.
export async function fetchRoute(places: Place[], vehicleId?: string): Promise<Route> {
  const truck = await fetchTruckRoute(places, vehicleId);
  if (truck) return truck;
  const coords = places.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  const body = (await response.json()) as { code: string; routes?: { geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[] };
  if (body.code !== "Ok" || !body.routes?.length) throw new Error("route");
  const route = body.routes[0], every = Math.max(1, Math.ceil(route.geometry.coordinates.length / 4000));
  return {
    places, truckRouting: false, line: route.geometry.coordinates.filter((_, i, all) => i % every === 0 || i === all.length - 1),
    legs: route.legs.map((l) => ({ km: l.distance / 1000, hours: Math.max(l.duration / 3600 * 1.1, l.distance / 1000 / TRUCK_KMH) })),
  };
}

// Chargers along the route for each network level: confirmed truck parks, plus announced ones, plus unconfirmed fast chargers.
export function chargersAlong(route: Route, charging: Charging): Record<Network, TourCharger[]> {
  const total = route.legs.reduce((sum, l) => sum + l.km, 0);
  const along = (points: { lon: number; lat: number }[], maxOff: number, make: (i: number) => Omit<TourCharger, "atKm">) => {
    const { hits, lengthKm } = alongRoute(route.line, points, maxOff);
    return hits.map((h) => ({ ...make(h.index), atKm: h.atKm * total / (lengthKm || 1) }));
  };
  const hub = (list: Hub[]) => along(list, 5, (i) => ({ id: list[i].id, name: list[i].name, operator: list[i].operator, maxKw: list[i].maxKw || 300, lon: list[i].lon, lat: list[i].lat }));
  const live = hub(charging.verified.filter((h) => h.status === "live"));
  const announced = [...live, ...hub(charging.verified.filter((h) => h.status === "announced"))];
  const proxy = [...announced, ...along(charging.proxy, 2, (i) => ({ id: `p${i}`, name: `Schnelllader ${charging.proxy[i].maxKw.toLocaleString("de-DE")} kW (Lkw-Zufahrt unbestätigt)`, maxKw: charging.proxy[i].maxKw, lon: charging.proxy[i].lon, lat: charging.proxy[i].lat }))];
  return { live, announced, proxy };
}
