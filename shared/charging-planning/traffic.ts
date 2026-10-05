import { z } from "zod";
import { pointToSegmentKm, type GeoPoint } from "../geo.js";
import { sourceSchema } from "./contracts.js";

export const networkEdgeSchema = z.object({
  edgeId: z.number().int().nonnegative(), label: z.string(),
  aLon: z.number().finite().min(-180).max(180), aLat: z.number().finite().min(-90).max(90),
  bLon: z.number().finite().min(-180).max(180), bLat: z.number().finite().min(-90).max(90),
  lengthKm: z.number().finite().nonnegative(), trucks2019: z.number().finite().nonnegative(), trucks2030: z.number().finite().nonnegative(),
}).strict();
export type NetworkEdge = z.infer<typeof networkEdgeSchema>;
export const networkSchema = z.object({ schemaVersion: z.literal(1), source: sourceSchema,
  method: z.string(), edges: z.array(networkEdgeSchema).max(20000) }).strict();

export function matchTrafficEdge(point: GeoPoint, input: NetworkEdge[], maxDistanceKm = 10) {
  z.object({ lon: z.number().finite().min(5).max(16), lat: z.number().finite().min(47).max(56) }).parse(point);
  z.number().finite().min(0).max(25).parse(maxDistanceKm);
  const edges = z.array(networkEdgeSchema).max(20000).parse(input);
  let best: { edge: NetworkEdge; distanceKm: number; accessVerified: false } | null = null;
  for (const edge of edges) {
    // Edges without modelled truck traffic are not a usable traffic source; matching them would silently yield zero demand.
    if (edge.trucks2030 <= 0) continue;
    const distance = pointToSegmentKm(point, { lon: edge.aLon, lat: edge.aLat }, { lon: edge.bLon, lat: edge.bLat });
    if (distance <= maxDistanceKm && (!best || distance < best.distanceKm)) best = { edge, distanceKm: distance, accessVerified: false };
  }
  return best;
}
