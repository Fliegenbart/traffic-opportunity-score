import { distanceKm, type GeoPoint } from "./geo";

// Touren-Check: one e-truck tour from the depot, charged at the depot and, if needed, during the driver's breaks.
// All numbers are planning values for a first answer, not instructions for a driver.

export type TourVehicle = { id: string; label: string; batteryKwh: number; maxChargeKw: number; emptyKwhPerKm: number; kwhPerKmPerTon: number; maxPayloadT: number; dieselLPer100: number };

// Generic classes instead of brand models: consumption is a model value until real driving data calibrates it.
export const TOUR_VEHICLES: TourVehicle[] = [
  { id: "long", label: "Sattelzug Fernverkehr · 600 kWh", batteryKwh: 600, maxChargeKw: 400, emptyKwhPerKm: 0.78, kwhPerKmPerTon: 0.013, maxPayloadT: 24, dieselLPer100: 29 },
  { id: "regional", label: "Sattelzug Regional · 480 kWh", batteryKwh: 480, maxChargeKw: 375, emptyKwhPerKm: 0.78, kwhPerKmPerTon: 0.013, maxPayloadT: 24, dieselLPer100: 29 },
  { id: "rigid", label: "Verteiler-Lkw 18–26 t · 280 kWh", batteryKwh: 280, maxChargeKw: 150, emptyKwhPerKm: 0.62, kwhPerKmPerTon: 0.016, maxPayloadT: 12, dieselLPer100: 23 },
];

export type TourAssumptions = {
  temperatureC: number; reservePercent: number;
  depotPrice: number; publicPrice: number; truckPerKm: number; driverPerHour: number;
  dieselPrice: number; dieselTruckPerKm: number; dieselTollPerKm: number;
};

// Depot price and truck rate are the launch prices of the as-a-service package; everything else is an editable assumption.
export const DEFAULT_TOUR_ASSUMPTIONS: TourAssumptions = {
  temperatureC: 10, reservePercent: 15,
  depotPrice: 0.30, publicPrice: 0.55, truckPerKm: 0.42, driverPerHour: 30,
  dieselPrice: 1.65, dieselTruckPerKm: 0.25, dieselTollPerKm: 0.35,
};

// EU driving rules (VO 561/2006), simplified: 45 min break after 4.5 h, 11 h rest after 9 h driving a day.
// A customer stop of 45 min or more counts as the break (the ramp crew unloads).
export const BREAK_AFTER_H = 4.5;
export const BREAK_MIN = 45;
export const DAILY_DRIVE_H = 9;
export const REST_MIN = 11 * 60;
// Average charging power over a stop is below the peak (charging curve).
const CHARGE_CURVE = 0.85;
// On the road the truck charges to 90 % at most; a full charge only pays off during the long rest.
const ROAD_CHARGE_CAP = 0.9;

export type TourLeg = { km: number; hours: number; payloadT: number };
export type TourStop = { label: string; dwellMin: number };
export type TourCharger = { id: string; name: string; operator?: string; atKm: number; maxKw: number; lon: number; lat: number };

export type TourEvent =
  | { type: "start" | "arrive"; label: string; minute: number; soc: number; atKm: number }
  | { type: "drive"; km: number; minutes: number; kwh: number }
  | { type: "stop"; label: string; minute: number; soc: number; dwellMin: number; atKm: number }
  | { type: "charge"; charger: TourCharger; minute: number; socFrom: number; socTo: number; kwh: number; minutes: number; kw: number; pause: "break" | "rest"; extraMin: number; cost: number; atKm: number }
  | { type: "pause"; pause: "break" | "rest"; minute: number; minutes: number; soc: number; atKm: number }
  | { type: "stranded"; minute: number; atKm: number; fromKm: number };

export type TourPlan = {
  feasible: boolean; events: TourEvent[];
  km: number; minutes: number; driveMinutes: number; kwh: number; publicKwh: number; chargeStops: number; extraChargeMin: number; arrivalSoc: number;
  gap: { fromKm: number; toKm: number } | null;
  cost: { electric: { truck: number; energy: number; driver: number; total: number }; diesel: { truck: number; fuel: number; toll: number; driver: number; total: number; minutes: number } };
};

export function consumptionKwhPerKm(vehicle: TourVehicle, payloadT: number, temperatureC: number) {
  // Cold costs range: about +0.8 % per degree below 15 °C (heating, battery).
  return (vehicle.emptyKwhPerKm + vehicle.kwhPerKmPerTon * payloadT) * (1 + 0.008 * Math.max(0, 15 - temperatureC));
}

// legs[i] ends at stops[i]; the last stop is the arrival. Chargers carry their position along the whole route.
export function planTour(vehicle: TourVehicle, legs: TourLeg[], stops: TourStop[], chargers: TourCharger[], a: TourAssumptions = DEFAULT_TOUR_ASSUMPTIONS, startLabel = "Depot"): TourPlan {
  const ends: number[] = []; legs.reduce((sum, l, i) => (ends[i] = sum + l.km), 0);
  const total = ends[ends.length - 1] || 0;
  const legAt = (s: number) => Math.min(legs.length - 1, ends.findIndex((e) => s < e - 1e-9) < 0 ? legs.length - 1 : ends.findIndex((e) => s < e - 1e-9));
  const speed = (i: number) => legs[i].hours > 0 ? legs[i].km / legs[i].hours : 70;
  const cons = (i: number) => consumptionKwhPerKm(vehicle, legs[i].payloadT, a.temperatureC);
  // Walks along the route until `budget` (hours or kWh) is used up and returns the position reached.
  const reach = (from: number, budget: number, rate: (i: number) => number) => {
    let s = from, left = budget;
    for (let i = legAt(from); i < legs.length && left > 1e-9; i++) {
      const span = ends[i] - s, need = span * rate(i);
      if (need >= left) return s + left / rate(i);
      left -= need; s = ends[i];
    }
    return left > 1e-9 ? Infinity : s;
  };
  const between = (from: number, to: number, rate: (i: number) => number) => {
    let sum = 0;
    for (let i = legAt(from), s = from; i < legs.length && s < to - 1e-9; i++) { const e = Math.min(ends[i], to); sum += (e - s) * rate(i); s = e; }
    return sum;
  };

  const battery = vehicle.batteryKwh, reserve = battery * a.reservePercent / 100;
  const sorted = [...chargers].sort((x, y) => x.atKm - y.atKm);
  const events: TourEvent[] = [];
  let s = 0, soc = battery, minute = 0, sinceBreak = 0, today = 0, lastCharge = 0;
  let driveMinutes = 0, kwh = 0, publicKwh = 0, publicCost = 0, chargeStops = 0, extraChargeMin = 0;
  let gap: TourPlan["gap"] = null;
  const pct = () => Math.round(soc / battery * 100);
  const drive = (to: number) => {
    if (to <= s + 1e-9) return;
    const hours = between(s, to, (i) => 1 / speed(i)), used = between(s, to, cons);
    events.push({ type: "drive", km: to - s, minutes: hours * 60, kwh: used });
    soc -= used; kwh += used; minute += hours * 60; driveMinutes += hours * 60; sinceBreak += hours; today += hours; s = to;
  };
  const rested = (pause: "break" | "rest") => { sinceBreak = 0; if (pause === "rest") today = 0; };

  events.push({ type: "start", label: startLabel, minute, soc: 100, atKm: 0 });
  for (let guard = 0; s < total - 1e-6 && guard < 200; guard++) {
    const target = ends[legAt(s)];
    const energyLimit = reach(s, soc - reserve, cons);
    const breakLimit = reach(s, BREAK_AFTER_H - sinceBreak, (i) => 1 / speed(i));
    const dayLimit = reach(s, DAILY_DRIVE_H - today, (i) => 1 / speed(i));
    const limit = Math.min(energyLimit, breakLimit, dayLimit);
    if (limit >= target - 1e-6) {
      drive(target);
      const index = legAt(s - 1e-6), stop = stops[index], last = index === legs.length - 1;
      if (last) events.push({ type: "arrive", label: stop?.label ?? startLabel, minute, soc: pct(), atKm: s });
      else { events.push({ type: "stop", label: stop.label, minute, soc: pct(), dwellMin: stop.dwellMin, atKm: s }); minute += stop.dwellMin; if (stop.dwellMin >= BREAK_MIN) sinceBreak = 0; }
      continue;
    }
    const pause: "break" | "rest" = dayLimit <= limit + 1e-6 ? "rest" : "break";
    const needed = between(s, total, cons) + reserve - soc;
    // Furthest charger the truck can still reach, so that the stop falls into the break that is due anyway.
    const charger = needed > 0 ? [...sorted].reverse().find((c) => c.atKm > s + 1 && c.atKm <= limit) : undefined;
    if (!charger) {
      if (energyLimit <= limit + 1e-6) {
        drive(energyLimit);
        events.push({ type: "stranded", minute, atKm: s, fromKm: lastCharge });
        gap = { fromKm: lastCharge, toKm: s };
        break;
      }
      drive(limit);
      const minutes = pause === "rest" ? REST_MIN : BREAK_MIN;
      events.push({ type: "pause", pause, minute, minutes, soc: pct(), atKm: s });
      minute += minutes; rested(pause);
      continue;
    }
    drive(charger.atKm);
    const pauseMin = pause === "rest" ? REST_MIN : BREAK_MIN;
    const cap = pause === "rest" ? battery : battery * ROAD_CHARGE_CAP;
    const goal = Math.min(cap, between(s, total, cons) + reserve);
    const added = Math.max(0, goal - soc), kw = Math.min(charger.maxKw, vehicle.maxChargeKw);
    const chargeMin = added / (kw * CHARGE_CURVE) * 60, minutes = Math.max(pauseMin, chargeMin), cost = added * a.publicPrice;
    events.push({ type: "charge", charger, minute, socFrom: pct(), socTo: Math.round((soc + added) / battery * 100), kwh: added, minutes, kw, pause, extraMin: Math.max(0, chargeMin - pauseMin), cost, atKm: s });
    soc += added; publicKwh += added; publicCost += cost; chargeStops++; extraChargeMin += Math.max(0, chargeMin - pauseMin);
    minute += minutes; lastCharge = s; rested(pause);
  }

  const feasible = !gap && s >= total - 1e-6;
  // Diesel reference: same route and stops, breaks and rests without charging time.
  const driveH = legs.reduce((sum, l) => sum + l.hours, 0);
  const dwell = stops.slice(0, -1).reduce((sum, st) => sum + st.dwellMin, 0);
  const rests = Math.max(0, Math.ceil(driveH / DAILY_DRIVE_H - 1e-9) - 1), breaks = Math.max(0, Math.ceil(driveH / BREAK_AFTER_H - 1e-9) - 1 - rests);
  const dieselMinutes = driveH * 60 + dwell + rests * REST_MIN + breaks * BREAK_MIN;
  // Rest time is not paid working time.
  const paid = (minutes: number, restCount: number) => Math.max(0, minutes - restCount * REST_MIN) / 60 * a.driverPerHour;
  const eRests = events.filter((e) => (e.type === "charge" || e.type === "pause") && e.pause === "rest").length;
  const liters = legs.reduce((sum, l) => sum + l.km * vehicle.dieselLPer100 / 100 * (0.75 + 0.25 * l.payloadT / vehicle.maxPayloadT), 0);
  const totalKwh = between(0, total, cons);
  const electric = { truck: total * a.truckPerKm, energy: publicCost + Math.max(0, totalKwh - publicKwh) * a.depotPrice, driver: paid(minute, eRests) };
  const diesel = { truck: total * a.dieselTruckPerKm, fuel: liters * a.dieselPrice, toll: total * a.dieselTollPerKm, driver: paid(dieselMinutes, rests) };
  return {
    feasible, events, km: total, minutes: minute, driveMinutes, kwh: feasible ? kwh : totalKwh, publicKwh, chargeStops, extraChargeMin, arrivalSoc: Math.round(soc / battery * 100), gap,
    cost: { electric: { ...electric, total: electric.truck + electric.energy + electric.driver }, diesel: { ...diesel, total: diesel.truck + diesel.fuel + diesel.toll + diesel.driver, minutes: dieselMinutes } },
  };
}

// Position of each point along a route line (km from the start) and its distance to the line.
export function alongRoute(line: [number, number][], points: GeoPoint[], maxOffKm: number) {
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) cum[i] = cum[i - 1] + distanceKm({ lon: line[i - 1][0], lat: line[i - 1][1] }, { lon: line[i][0], lat: line[i][1] });
  const lons = line.map((p) => p[0]), lats = line.map((p) => p[1]);
  const box = { w: Math.min(...lons) - 0.1, e: Math.max(...lons) + 0.1, s: Math.min(...lats) - 0.1, n: Math.max(...lats) + 0.1 };
  return {
    lengthKm: cum[cum.length - 1] || 0,
    hits: points.map((p, index) => {
      if (p.lon < box.w || p.lon > box.e || p.lat < box.s || p.lat > box.n) return null;
      let best = Infinity, at = 0;
      for (let i = 0; i < line.length; i++) { const d = distanceKm(p, { lon: line[i][0], lat: line[i][1] }); if (d < best) { best = d; at = cum[i]; } }
      return best <= maxOffKm ? { index, atKm: at, offKm: best } : null;
    }).filter((h): h is { index: number; atKm: number; offKm: number } => !!h),
    pointAt: (km: number): GeoPoint => { let i = cum.findIndex((c) => c >= km); if (i < 0) i = line.length - 1; return { lon: line[i][0], lat: line[i][1] }; },
  };
}
