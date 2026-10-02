import { z } from "zod";
import { capacitySchema, sessionSchema, type CapacityInput, type ChargingSession } from "./contracts.js";

export interface SessionResult extends ChargingSession {
  deliveredKwh: number;
  startedMinute: number | null;
  completedMinute: number | null;
  status: "queued" | "charging" | "completed" | "rejected" | "unfinished";
}
export function simulateDay(input: ChargingSession[], rawCapacity: CapacityInput) {
  const capacity = capacitySchema.parse(rawCapacity);
  if (capacity.gridPowerKw === null) throw new Error("Netzleistung unbekannt");
  const sessions: SessionResult[] = z.array(sessionSchema).max(5000).parse(input).map((s) => ({ ...s, deliveredKwh: 0, startedMinute: null, completedMinute: null, status: "queued" }));
  if (new Set(sessions.map((s) => s.id)).size !== sessions.length) throw new Error("Doppelte Ladevorgang-ID");
  sessions.sort((a, b) => a.arrivalMinute - b.arrivalMinute || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ports: { session: SessionResult | null; readyMinute: number }[] = Array.from({ length: capacity.ports }, () => ({ session: null, readyMinute: 0 }));
  let cursor = 0;
  let queue: SessionResult[] = [];
  let gridKwh = 0, peakGridKw = 0, peakQueue = 0, occupiedPortMinutes = 0, openMinutes = 0;
  const efficiency = 1 - capacity.lossPercent / 100;
  const slots: { minute: number; gridKw: number; deliveredKwh: number; queue: number; occupiedPorts: number }[] = [];
  // Five-minute planning approximation: unfinished sessions retain their port across closure.
  for (let minute = 0; minute < 1440; minute += 5) {
    const open = capacity.opening.some((w) => minute >= w.startMinute && minute < w.endMinute);
    if (open) openMinutes += 5;
    while (cursor < sessions.length && sessions[cursor].arrivalMinute <= minute) {
      const next = sessions[cursor++];
      if (!open) next.status = "rejected";
      else queue.push(next);
    }
    queue = queue.filter((s) => {
      if (minute - s.arrivalMinute > capacity.maxWaitMinutes) { s.status = "rejected"; return false; }
      return true;
    });
    if (open && capacity.gridPowerKw > 0) {
      for (const port of ports) {
        if (!port.session && port.readyMinute <= minute && queue.length) {
          port.session = queue.shift()!;
          port.session.status = "charging";
          port.session.startedMinute = minute;
        }
      }
    }
    peakQueue = Math.max(peakQueue, queue.length);
    const active = open ? ports.filter((p) => p.session) : [];
    // Port power is delivered DC power; shared grid power is upstream AC power.
    const powerPerPort = active.length ? Math.min(capacity.portPowerKw, capacity.gridPowerKw * efficiency / active.length) : 0;
    let delivered = 0;
    for (const port of active) {
      const s = port.session!;
      const energy = Math.min(s.energyKwh - s.deliveredKwh, powerPerPort * 5 / 60);
      s.deliveredKwh += energy;
      delivered += energy;
      if (s.energyKwh - s.deliveredKwh < 1e-8) {
        s.deliveredKwh = s.energyKwh;
        s.status = "completed";
        s.completedMinute = minute + 5;
        port.session = null;
        port.readyMinute = minute + 5 + capacity.turnaroundMinutes;
      }
    }
    const occupiedPorts = open ? ports.filter((p) => p.session || p.readyMinute > minute).length : 0;
    occupiedPortMinutes += occupiedPorts * 5;
    const slotGridKw = delivered / efficiency * 12;
    gridKwh += delivered / efficiency;
    peakGridKw = Math.max(peakGridKw, slotGridKw);
    slots.push({ minute, gridKw: slotGridKw, deliveredKwh: delivered, queue: queue.length, occupiedPorts });
  }
  for (const s of sessions) if (s.status === "charging") s.status = "unfinished"; else if (s.status === "queued") s.status = "rejected";
  const completedSessions = sessions.filter((s) => s.status === "completed").length;
  const rejectedSessions = sessions.filter((s) => s.status === "rejected").length;
  const unfinishedSessions = sessions.filter((s) => s.status === "unfinished").length;
  const requestedKwh = sessions.reduce((sum, s) => sum + s.energyKwh, 0);
  const deliveredKwh = sessions.reduce((sum, s) => sum + s.deliveredKwh, 0);
  const waits = sessions.filter((s) => s.startedMinute !== null).map((s) => s.startedMinute! - s.arrivalMinute).sort((a, b) => a - b);
  const waitP95Minutes = waits.length ? waits[Math.ceil(waits.length * 0.95) - 1] : null;
  return { sessions, slots, offeredSessions: sessions.length, completedSessions, rejectedSessions, unfinishedSessions,
    unservedSessions: rejectedSessions + unfinishedSessions, requestedKwh, deliveredKwh, gridKwh,
    unservedKwh: Math.max(0, requestedKwh - deliveredKwh), peakGridKw, peakQueue,
    meanWaitMinutes: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null,
    waitP95Minutes, portUtilization: openMinutes ? occupiedPortMinutes / (openMinutes * capacity.ports) : 0,
    gridUtilization: openMinutes && capacity.gridPowerKw ? gridKwh / (capacity.gridPowerKw * openMinutes / 60) : 0 };
}
