import type { ReadinessSubmission, ScoringResult } from "../shared/readiness.ts";

export async function sendLeadToCrm(
  submission: ReadinessSubmission,
  scoringResult: ScoringResult,
) {
  // MVP mock: connect HubSpot, Salesforce, Pipedrive or another CRM here later.
  console.log("CRM mock lead", {
    company: submission.company.companyName,
    email: submission.contact.email,
    score: scoringResult.score,
    leadClass: scoringResult.leadClass,
  });

  return { ok: true, provider: "mock-crm" };
}

export async function sendLeadToDepotOnePartner(
  submission: ReadinessSubmission,
  scoringResult: ScoringResult,
) {
  if (!submission.contact.consentContact) {
    return { ok: false, skipped: true, reason: "missing_contact_consent" };
  }

  // MVP mock: connect a future E.ON Drive / DepotOne partner endpoint here.
  console.log("DepotOne partner mock lead", {
    company: submission.company.companyName,
    email: submission.contact.email,
    score: scoringResult.score,
    leadClass: scoringResult.leadClass,
  });

  return { ok: true, provider: "mock-depotone-partner" };
}
