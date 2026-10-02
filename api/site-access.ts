import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZodError } from "zod";
import { checkSiteAccess, siteAccessInputSchema } from "../shared/site-access.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Allow", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST ist zulässig" });
  if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") return res.status(415).json({ error: "application/json erforderlich" });
  try {
    const text = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (text && Buffer.byteLength(text) > 4096) return res.status(413).json({ error: "Anfrage ist zu groß" });
    const input = siteAccessInputSchema.parse(typeof req.body === "string" || Buffer.isBuffer(req.body) ? JSON.parse(text!) : req.body);
    const baseUrl = process.env.SITE_ROUTING_BASE_URL;
    const config = baseUrl ? { baseUrl, profile: process.env.SITE_ROUTING_PROFILE || "driving" } : undefined;
    return res.status(200).json(await checkSiteAccess(input, config));
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "Ungültiges JSON" });
    if (error instanceof ZodError) return res.status(422).json({ error: "Ungültiger Standort oder ungültige Modellstrecke" });
    return res.status(503).json({ error: "Routingdienst nicht korrekt konfiguriert. Erreichbarkeit bleibt offen." });
  }
}
