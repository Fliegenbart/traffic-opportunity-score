import { z } from "zod";
import { demandSchema, PlanningLimitError, type DemandInput } from "./contracts.js";
import type { ChargingSession } from "./contracts.js";

export function generateArrivals(trucksPerDay: number, evShare: number, weights: number[], input: DemandInput, rounding: "nearest" | "floor" | "ceil" = "nearest") {
  z.number().finite().min(0).max(1000000).parse(trucksPerDay);
  z.number().finite().min(0).max(1).parse(evShare);
  z.array(z.number().finite().min(0).max(1000000)).length(24).refine((w) => w.some((x) => x > 0)).parse(weights);
  const d = demandSchema.parse(input);
  const expectedPassing = trucksPerDay * evShare * d.reachableShare * d.captureShare;
  const totalPassing = rounding === "floor" ? Math.floor(expectedPassing) : rounding === "ceil" ? Math.ceil(expectedPassing) : Math.round(expectedPassing);
  const included = d.anchors.filter((a) => a.includedInPassing).reduce((s, a) => s + a.count, 0);
  const additional = d.anchors.filter((a) => !a.includedInPassing).reduce((s, a) => s + a.count, 0);
  if (Math.max(totalPassing, included) + additional > 5000) throw new PlanningLimitError("Maximal 5.000 Szenario-Ladungen je Tag");
  const passingCount = Math.max(0, totalPassing - included);
  const sum = weights.reduce((s, w) => s + w, 0);
  const quotas = weights.map((w) => passingCount * w / sum);
  const counts = quotas.map(Math.floor);
  const order = quotas.map((q, i) => ({ i, fraction: q - counts[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  const remainder = passingCount - counts.reduce((s, n) => s + n, 0);
  for (let i = 0; i < remainder; i++) counts[order[i].i]++;
  let state = d.seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const sessions: ChargingSession[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let i = 0; i < counts[hour]; i++) sessions.push({ id: `passing-${hour}-${i}`, arrivalMinute: hour * 60 + Math.floor(random() * 12) * 5, energyKwh: d.energyKwh, kind: "passing" });
  }
  for (const anchor of d.anchors) {
    for (let i = 0; i < anchor.count; i++) sessions.push({ id: `anchor-${anchor.id}-${i}`, arrivalMinute: anchor.hour * 60 + Math.floor(random() * 12) * 5, energyKwh: anchor.energyKwh, kind: "anchor" });
  }
  sessions.sort((a, b) => a.arrivalMinute - b.arrivalMinute || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { sessions, expectedPassing, roundedPassing: totalPassing, passingSessions: passingCount,
    anchorSessions: included + additional, overlapRemoved: Math.min(included, totalPassing),
    warnings: included > totalPassing ? ["Anker-Nachfrage übersteigt modellierte Durchgangsnachfrage; kein negativer Restverkehr angesetzt."] : [] };
}
