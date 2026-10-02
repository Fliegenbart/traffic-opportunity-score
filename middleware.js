import { next } from '@vercel/edge';

// Passwortschutz fürs ganze Deployment (Basic Auth, planunabhängig via Edge-
// Middleware). Passwort kommt aus der Vercel-Env-Var SITE_PASSWORD; ist keine
// gesetzt, ist die Seite offen (z. B. lokal). Benutzername ist egal — nur das
// Passwort zählt.
export const config = { matcher: '/(.*)' };

export default function middleware(request) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return next(); // kein Passwort gesetzt -> offen

  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)),
      ); // "user:pass", UTF-8
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      // timing-sicherer Vergleich (konstante Laufzeit statt frühem Abbruch)
      const enc = new TextEncoder();
      const A = enc.encode(pass), B = enc.encode(expected);
      let diff = A.length ^ B.length;
      for (let i = 0; i < Math.max(A.length, B.length); i++) diff |= (A[i] ?? 0) ^ (B[i] ?? 0);
      if (diff === 0) return next();
    } catch (e) { /* ungültiger Header -> unten 401 */ }
  }

  return new Response('Traffic Opportunity — Zugang nur mit Passwort.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Traffic Opportunity", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}
