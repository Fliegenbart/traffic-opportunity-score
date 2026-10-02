import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import siteAccessHandler from "./api/site-access";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default defineConfig({
  plugins: [react(), {
    name: "local-site-access-api",
    configureServer(server) {
      server.middlewares.use("/api/site-access", async (req, res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
          for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk);
            if (bytes > 4096) { res.statusCode = 413; res.end(JSON.stringify({ error: "Anfrage ist zu groß" })); return; }
            chunks.push(Buffer.from(chunk));
          }
          const request = Object.assign(req, { body: Buffer.concat(chunks).toString("utf8") });
          const response = Object.assign(res, {
            status(code: number) { res.statusCode = code; return response; },
            json(body: unknown) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); return response; },
          });
          await siteAccessHandler(request as VercelRequest, response as VercelResponse);
        } catch { res.statusCode = 500; res.end(JSON.stringify({ error: "Lokale Straßenprüfung nicht verfügbar" })); }
      });
    },
  }],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
