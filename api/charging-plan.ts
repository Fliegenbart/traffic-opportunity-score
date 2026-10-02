import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { canonicalJson, runChargingPlan, summarizePlan, PlanningLimitError } from "../shared/charging-planning/index.js";

const MAX_BODY_BYTES = 250000;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Allow", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST ist zulässig" });
  if (String(req.headers["content-type"] || "").toLowerCase().split(";")[0].trim() !== "application/json") {
    return res.status(415).json({ error: "application/json erforderlich" });
  }
  try {
    const body = req.body;
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : JSON.stringify(body);
    if (text && Buffer.byteLength(text) > MAX_BODY_BYTES) return res.status(413).json({ error: "Anfrage ist zu groß" });
    const raw = typeof body === "string" || Buffer.isBuffer(body) ? JSON.parse(text!) : body;
    const result = runChargingPlan(raw);
    const fingerprint = createHash("sha256").update(canonicalJson({ modelVersion: result.modelVersion, input: result.input })).digest("hex");
    return res.status(200).json({ fingerprint, ...summarizePlan(result) });
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "Ungültiges JSON" });
    if (error instanceof ZodError) return res.status(422).json({ error: "Ungültige Planungsdaten", issues: error.issues });
    if (error instanceof PlanningLimitError) return res.status(422).json({ error: error.message });
    console.error("Charging plan failed", error instanceof Error ? error.name : "unknown");
    return res.status(500).json({ error: "Plan konnte nicht berechnet werden" });
  }
}
