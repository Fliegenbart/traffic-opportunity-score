import { canonicalJson, exportPlanCsv, runChargingPlan, runSensitivity, summarizePlan, type PlanningRequest, type SensitivityChange } from "@shared/charging-planning";

export type PlanSummary = ReturnType<typeof summarizePlan>;
export type PlanEntry = { id: string; plan?: PlanSummary; csv?: string; error?: string };
export type WorkerRequest = { requests: PlanningRequest[]; changes?: SensitivityChange[] };
export type WorkerReply = { entries: PlanEntry[]; sensitivity?: ReturnType<typeof runSensitivity>; error?: string };

// Simulations stay off the UI thread; terminated workers cannot publish stale inputs.
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.changes) {
      self.postMessage({ entries: [], sensitivity: runSensitivity(event.data.requests[0], event.data.changes) } satisfies WorkerReply);
      return;
    }
    const entries = event.data.requests.map((request): PlanEntry => {
      try {
        const result = runChargingPlan(request);
        return { id: request.site.id, plan: summarizePlan(result), csv: exportPlanCsv(result) };
      } catch (error) { return { id: request.site.id, error: error instanceof Error ? error.message : "Berechnung fehlgeschlagen" }; }
    });
    self.postMessage({ entries } satisfies WorkerReply);
  } catch (error) { self.postMessage({ entries: [], error: error instanceof Error ? error.message : canonicalJson(error) } satisfies WorkerReply); }
};
