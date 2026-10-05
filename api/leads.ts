import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z, ZodError } from "zod";
import { callerId, consumeLimit, dayKey, limitStore } from "../server/rate-limit.js";

const MAX_BODY_BYTES = 16 * 1024;
const text = (max: number) => z.string().max(max);

const leadSchema = z.object({
  tenant: text(64).optional(),
  embed: z.boolean().optional(),
  url: text(2000).optional(),
  utm: z.record(text(200)).refine((u) => Object.keys(u).length <= 10, "Zu viele UTM-Werte").optional(),
  // Honeypot. Keep this field hidden in the UI.
  website: text(200).optional(),
  // Explicit consent to be contacted about this request; without it nothing is processed.
  consent: z.literal(true),
  contact: z.object({
    company: text(200).optional(),
    name: text(200).min(1),
    email: z.string().email().max(254),
    phone: text(50).optional(),
    message: text(5000).optional(),
  }).strict(),
  calculation: z.object({
    timeframeYears: z.number().optional(),
    taxIncentiveRegion: text(100).optional(),
    fleetSize: z.number().optional(),
    bestElectricName: text(200).optional(),
    maxSavings: z.number().optional(),
    breakEvenYear: z.number().nullable().optional(),
    breakEvenMonth: z.number().nullable().optional(),
  }).strict().optional(),
  inputs: z.unknown().optional(),
}).strict();

function asText(value: unknown) {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Same-origin only (the form and embeds are served from this deployment); extra origins via LEAD_ALLOWED_ORIGINS.
function originAllowed(req: VercelRequest) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = new Set((process.env.LEAD_ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean));
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (host) allowed.add(`https://${host}`);
  if (process.env.VERCEL_ENV !== "production" && host) allowed.add(`http://${host}`);
  return allowed.has(origin);
}

// Fallback when no shared store is configured: per-instance only, but leads are cheap and the form must keep working.
const localHits = new Map<string, { expires: number; count: number }>();
function localLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  for (const [k, v] of Array.from(localHits)) if (v.expires < now) localHits.delete(k);
  if (!localHits.has(key) && localHits.size >= 1000) localHits.delete(localHits.keys().next().value!);
  const entry = localHits.get(key) || { expires: now + windowMs, count: 0 };
  entry.count++; localHits.set(key, entry);
  return entry.count <= limit;
}

async function withinLimits(caller: string) {
  const perCaller = 5, perDay = Math.max(1, Number(process.env.LEAD_DAILY_LIMIT) || 50);
  if (!limitStore()) return localLimit(`ip:${caller}`, perCaller, 3600000) && localLimit("day", perDay, 86400000);
  return await consumeLimit(`lead:ip:${caller}`, perCaller, 3600) !== "limited"
    && await consumeLimit(`lead:day:${dayKey()}`, perDay, 86400) !== "limited";
}

async function sendViaResend(params: { to: string; from: string; subject: string; text: string; replyTo: string }) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: params.from, to: [params.to], reply_to: params.replyTo, subject: params.subject, text: params.text }),
  });
  // Only the status is logged: the provider response may echo personal data.
  if (!resp.ok) throw new Error(`Resend error ${resp.status}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Allow", "POST");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!originAllowed(req)) return res.status(403).json({ error: "Origin not allowed" });
  if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    return res.status(415).json({ error: "application/json required" });
  }

  const to = process.env.LEAD_TO_EMAIL;
  // Without a delivery path the lead would only end up in logs. Refuse instead of pretending success.
  if (!to || !process.env.RESEND_API_KEY) return res.status(503).json({ error: "Lead delivery not configured" });

  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null);
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return res.status(413).json({ error: "Request too large" });
    const lead = leadSchema.parse(JSON.parse(raw));

    // Honeypot triggered -> act like success to not tip off bots.
    if (lead.website && lead.website.trim().length > 0) return res.status(204).end();

    if (!(await withinLimits(callerId(req.headers, req.socket?.remoteAddress)))) {
      res.setHeader("Retry-After", "3600");
      return res.status(429).json({ error: "Too many requests" });
    }

    const from = process.env.LEAD_FROM_EMAIL || "Truckonomics <no-reply@truckonomics.app>";
    const subject = `Truckonomics Lead${lead.tenant ? ` (${lead.tenant})` : ""}`;
    const body = [
      "NEW LEAD",
      "",
      `Tenant: ${lead.tenant || "n/a"}`,
      `Embed: ${lead.embed ? "yes" : "no"}`,
      `URL: ${lead.url || "n/a"}`,
      `Consent to be contacted: yes (${new Date().toISOString()})`,
      "",
      "CONTACT",
      `Company: ${lead.contact.company || "n/a"}`,
      `Name: ${lead.contact.name}`,
      `Email: ${lead.contact.email}`,
      `Phone: ${lead.contact.phone || "n/a"}`,
      "",
      "MESSAGE",
      lead.contact.message || "n/a",
      "",
      "CALCULATION (summary)",
      asText(lead.calculation || {}),
      "",
      "UTM",
      asText(lead.utm || {}),
      "",
      "INPUTS (raw)",
      asText(lead.inputs || {}),
    ].join("\n");

    await sendViaResend({ to, from, subject, text: body, replyTo: lead.contact.email });
    return res.status(200).json({ ok: true, delivered: true });
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON payload" });
    if (error instanceof ZodError) return res.status(400).json({ error: "Invalid request data" });
    console.error("Lead capture error:", error instanceof Error ? error.message.slice(0, 100) : "unknown");
    return res.status(500).json({ error: "Internal server error" });
  }
}
