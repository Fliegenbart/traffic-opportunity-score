import assert from "node:assert/strict";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../api/leads";
import { callerId, consumeLimit } from "../server/rate-limit";

let status = 0;
let payload: unknown;
const response = { setHeader() { return this; }, status(code: number) { status = code; return this; },
  json(body: unknown) { payload = body; return this; }, end() { return this; } } as unknown as VercelResponse;
const valid = { tenant: "standort-check", consent: true, contact: { name: "Test", email: "test@example.org" } };
const call = async (body: unknown, headers: Record<string, string> = {}, method = "POST") => {
  await handler({ method, body, headers: { host: "app.test", origin: "https://app.test", "content-type": "application/json", "x-vercel-forwarded-for": "198.51.100.1", ...headers } } as unknown as VercelRequest, response);
  return status;
};

const saved = { ...process.env };
const originalFetch = globalThis.fetch;
const logs: string[] = [];
const originalLog = console.log, originalError = console.error, originalWarn = console.warn;
console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
try {
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL;
  delete process.env.LEAD_TO_EMAIL; delete process.env.RESEND_API_KEY;
  assert.equal(await call(valid, {}, "GET"), 405);
  assert.equal(await call(valid, { origin: "https://evil.example" }), 403, "Fremde Origin abgelehnt");
  assert.equal(await call(valid, { origin: "" }), 403, "Fehlende Origin abgelehnt");
  assert.equal(await call(valid, { "content-type": "text/plain" }), 415);
  assert.equal(await call(valid), 503, "Ohne Versandweg kein stilles Loggen");
  assert.equal(logs.some((l) => l.includes("test@example.org")), false, "Keine personenbezogenen Daten im Log");

  process.env.LEAD_TO_EMAIL = "inbox@example.org"; process.env.RESEND_API_KEY = "fixture-key";
  const sent: string[] = [];
  globalThis.fetch = async (_url, init) => { sent.push(String(init!.body)); return new Response("{}", { status: 200 }); };
  assert.equal(await call({ ...valid, consent: false }), 400, "Einwilligung ist Pflicht");
  assert.equal(await call({ ...valid, contact: { ...valid.contact, message: "x".repeat(5001) } }), 400, "Nachricht begrenzt");
  assert.equal(await call(JSON.stringify({ ...valid, inputs: "x".repeat(17000) })), 413, "Body begrenzt");
  assert.equal(await call({ ...valid, unexpected: 1 }), 400, "Unbekannte Felder abgelehnt");
  assert.equal(await call({ ...valid, website: "bot" }), 204);
  assert.equal(sent.length, 0, "Honeypot sendet nichts");
  assert.equal(await call(valid), 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].includes("198.51.100.1"), false, "Keine IP-Adresse in der Mail");
  for (let i = 0; i < 4; i++) assert.equal(await call(valid), 200);
  assert.equal(await call(valid), 429, "Limit pro Absender");
  assert.equal(await call(valid, { "x-vercel-forwarded-for": "198.51.100.2" }), 200, "Andere Absender bleiben möglich");

  globalThis.fetch = async () => new Response("echo test@example.org", { status: 500 });
  assert.equal(await call(valid, { "x-vercel-forwarded-for": "198.51.100.3" }), 500);
  assert.equal(logs.some((l) => l.includes("test@example.org")), false, "Fehlerantwort des Anbieters nicht geloggt");

  // Shared counter: fails closed only for "limited", store outage counts as unavailable.
  const env = { UPSTASH_REDIS_REST_URL: "https://store.fixture/", UPSTASH_REDIS_REST_TOKEN: "t" };
  let n = 0;
  const store = (async (url: string, init: RequestInit) => {
    assert.equal(url, "https://store.fixture/pipeline");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer t");
    return Response.json([{ result: ++n }, { result: 1 }]);
  }) as unknown as typeof fetch;
  assert.equal(await consumeLimit("k", 2, 60, env, store), "ok");
  assert.equal(await consumeLimit("k", 2, 60, env, store), "ok");
  assert.equal(await consumeLimit("k", 2, 60, env, store), "limited");
  assert.equal(await consumeLimit("k", 2, 60, {}, store), "unavailable");
  assert.equal(await consumeLimit("k", 2, 60, env, (async () => { throw new Error("down"); }) as unknown as typeof fetch), "unavailable");
  assert.equal(callerId({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.1"), "10.0.0.1", "x-forwarded-for wird nicht vertraut");
  assert.equal(callerId({ "x-vercel-forwarded-for": "5.6.7.8, 1.1.1.1" }), "5.6.7.8");
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalLog; console.error = originalError; console.warn = originalWarn;
  for (const key of ["LEAD_TO_EMAIL", "RESEND_API_KEY", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"]) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
}
console.log("Anfrage-API: Origin, Größen, Einwilligung, Honeypot, Limits, Datensparsamkeit und globaler Zähler geprüft.");
