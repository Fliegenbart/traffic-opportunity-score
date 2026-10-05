// Global fixed-window counters shared by all serverless instances, via the Upstash/Vercel KV Redis REST API.
// No SDK dependency: one pipelined INCR + EXPIRE NX per call.
export type LimitResult = "ok" | "limited" | "unavailable";
type Env = Record<string, string | undefined>;

export function limitStore(env: Env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export async function consumeLimit(key: string, limit: number, windowSeconds: number, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<LimitResult> {
  const store = limitStore(env);
  if (!store) return "unavailable";
  try {
    const response = await fetcher(`${store.url}/pipeline`, {
      method: "POST", signal: AbortSignal.timeout(2000), redirect: "error",
      headers: { Authorization: `Bearer ${store.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", `tos:${key}`], ["EXPIRE", `tos:${key}`, String(windowSeconds), "NX"]]),
    });
    if (!response.ok) return "unavailable";
    const [incr] = await response.json() as { result?: unknown }[];
    const count = Number(incr?.result);
    if (!Number.isFinite(count)) return "unavailable";
    return count <= limit ? "ok" : "limited";
  } catch {
    return "unavailable";
  }
}

// Only Vercel's own header is trustworthy; x-forwarded-for can be set by the client.
export function callerId(headers: Record<string, string | string[] | undefined>, remoteAddress?: string) {
  const raw = headers["x-vercel-forwarded-for"];
  return String((Array.isArray(raw) ? raw[0] : raw) || remoteAddress || "unknown").split(",")[0].trim().slice(0, 64);
}

export const dayKey = (now = new Date()) => now.toISOString().slice(0, 10);
