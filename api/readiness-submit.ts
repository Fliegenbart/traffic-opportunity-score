import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZodError } from "zod";
import {
  calculateReadinessScore,
  consentVersion,
  readinessSubmissionSchema,
} from "../shared/readiness.ts";
import { saveReadinessSubmission } from "./readinessStore.ts";
import { sendLeadToCrm, sendLeadToDepotOnePartner } from "./crmAdapter.ts";

function parseRequestBody(req: VercelRequest) {
  const body = req.body;
  if (body === undefined || body === null) return body;
  if (typeof body === "string") return JSON.parse(body);
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf-8"));
  return body;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const raw = parseRequestBody(req);
    const submission = readinessSubmissionSchema.parse(raw);
    const now = new Date().toISOString();
    const normalized = {
      ...submission,
      contact: {
        ...submission.contact,
        consentText:
          submission.contact.consentText ||
          "Ich bin einverstanden, dass meine Angaben zur Kontaktaufnahme und fachlichen Ersteinschaetzung an die DepotOne-Partner E.ON Drive, NEoT und Mitsui weitergegeben werden.",
        consentTimestamp: submission.contact.consentContact
          ? submission.contact.consentTimestamp || now
          : submission.contact.consentTimestamp,
        consentVersion: submission.contact.consentVersion || consentVersion,
      },
    };
    const scoringResult = calculateReadinessScore(normalized);
    const entry = {
      id: crypto.randomUUID(),
      timestamp: now,
      submission: normalized,
      scoringResult,
      userAgent: String(req.headers["user-agent"] || ""),
      ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""),
    };

    await saveReadinessSubmission(entry);

    if (normalized.contact.consentContact) {
      await sendLeadToCrm(normalized, scoringResult);
      await sendLeadToDepotOnePartner(normalized, scoringResult);
    }

    return res.status(200).json({
      ok: true,
      id: entry.id,
      timestamp: entry.timestamp,
      score: scoringResult.score,
      readinessLevel: scoringResult.readinessLevel,
      leadClass: scoringResult.leadClass,
      recommendations: scoringResult.recommendations,
      scoringResult,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    if (error instanceof ZodError) {
      return res.status(400).json({ error: "Invalid request data", issues: error.issues });
    }

    console.error("Readiness submit error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
