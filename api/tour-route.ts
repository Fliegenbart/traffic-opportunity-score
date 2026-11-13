import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZodError } from "zod";
import { cachedHereTourRoute, tourRouteInputSchema } from "../server/here-tour.js";
import { callerId, consumeLimit, dayKey, limitStore } from "../server/rate-limit.js";

// HERE is paid per route. It needs its own switch and a shared counter; otherwise the pages keep their free prototype routing.
const DAILY_ROUTES = () => Math.max(0, Number(process.env.HERE_TOUR_DAILY_LIMIT) || 300);
const HOURLY_ROUTES_PER_CALLER = 90;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Allow", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST ist zulässig" });
  if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") return res.status(415).json({ error: "application/json erforderlich" });
  try {
    const text = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (text && Buffer.byteLength(text) > 2048) return res.status(413).json({ error: "Anfrage ist zu groß" });
    const input = tourRouteInputSchema.parse(typeof req.body === "string" || Buffer.isBuffer(req.body) ? JSON.parse(text!) : req.body);
    const apiKey = process.env.HERE_API_KEY;
    if (!apiKey || process.env.HERE_TOUR_ROUTING_ENABLED !== "1" || !limitStore()) return res.status(503).json({ error: "Lkw-Routing ist nicht aktiviert.", enabled: false });
    const caller = callerId(req.headers, req.socket?.remoteAddress);
    const guard = async () => await consumeLimit(`here-tour:ip:${caller}`, HOURLY_ROUTES_PER_CALLER, 3600) === "ok" && await consumeLimit(`here-tour:day:${dayKey()}`, DAILY_ROUTES(), 86400) === "ok";
    const result = await cachedHereTourRoute(input, apiKey, guard);
    if (!result) { res.setHeader("Retry-After", "3600"); return res.status(429).json({ error: "Lkw-Routing vorübergehend begrenzt.", enabled: true }); }
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "Ungültiges JSON" });
    if (error instanceof ZodError) return res.status(422).json({ error: "Ungültige Wegpunkte" });
    console.error("tour-route failed:", error instanceof Error ? error.name : "unknown");
    return res.status(502).json({ error: "Keine vollständige Lkw-Route erhalten.", enabled: true });
  }
}
