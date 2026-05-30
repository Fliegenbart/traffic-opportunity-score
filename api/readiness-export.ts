import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getReadinessSubmissions } from "./readinessStore.ts";

function csvEscape(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: Awaited<ReturnType<typeof getReadinessSubmissions>>) {
  const headers = [
    "id",
    "timestamp",
    "companyName",
    "email",
    "score",
    "readinessLevel",
    "leadClass",
    "totalTrucks",
    "trucksToReplace24m",
    "projectTiming",
    "wantsConsultation",
    "consentContact",
    "utm",
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.timestamp,
      row.submission.company.companyName,
      row.submission.contact.email,
      row.scoringResult.score,
      row.scoringResult.readinessLevel,
      row.scoringResult.leadClass,
      row.submission.fleet.totalTrucks,
      row.submission.fleet.trucksToReplace24m,
      row.submission.economics.projectTiming,
      row.submission.economics.wantsConsultation,
      row.submission.contact.consentContact,
      JSON.stringify(row.submission.utm || {}),
    ]
      .map(csvEscape)
      .join(","),
  );

  return [headers.join(","), ...lines].join("\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const configuredToken = process.env.ADMIN_EXPORT_TOKEN;
  const requestToken =
    String(req.query.token || "") ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!configuredToken || requestToken !== configuredToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const format = String(req.query.format || "json");
  const rows = await getReadinessSubmissions();

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=readiness-leads.csv");
    return res.status(200).send(toCsv(rows));
  }

  return res.status(200).json(rows);
}
