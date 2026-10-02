import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const readJson = (file) => JSON.parse(readFileSync(new URL(file, root), "utf8"));

test("Traffic deploys only its charging, access and site-lead APIs", () => {
  const apiFiles = readdirSync(new URL("api/", root)).sort();
  assert.deepEqual(apiFiles, ["charging-plan.ts", "leads.ts", "site-access.ts"]);
});

test("TCO and Readiness implementations are not shipped in the Traffic repo", () => {
  const foreignFiles = [
    "client/src/pages/home.tsx",
    "client/src/pages/depot-readiness.tsx",
    "client/src/components/amortization-chart.tsx",
    "client/src/components/consultation-cta.tsx",
    "client/src/components/cost-breakdown-chart.tsx",
    "client/src/components/detailed-tco-table.tsx",
    "client/src/components/embed-auto-resize.tsx",
    "client/src/components/environmental-impact-card.tsx",
    "client/src/components/eon-drive-benefits.tsx",
    "client/src/components/fleet-size-selector.tsx",
    "client/src/components/lifecycle-assumptions-card.tsx",
    "client/src/components/lifecycle-insight-card.tsx",
    "client/src/components/operation-profile.tsx",
    "client/src/components/pdf-export-button.tsx",
    "client/src/components/summary-metrics.tsx",
    "client/src/components/tax-incentive-selector.tsx",
    "client/src/components/technical-specs-comparison.tsx",
    "client/src/components/timeframe-selector.tsx",
    "client/src/components/truck-parameters-card.tsx",
    "client/src/lib/truck-images.ts",
    "client/src/types/operation-profile.ts",
    "client/src/types/html2pdf.d.ts",
    "shared/schema.ts",
    "shared/lifecycle.ts",
    "shared/lifecycle.test.ts",
    "shared/readiness.ts",
    "shared/readiness.test.ts",
    "shared/readiness-questions.ts",
    "scripts/create_drc_overview_pdf.py",
    "scripts/create_drc_screenshot_pdf.py",
  ];
  const remaining = foreignFiles.filter((file) => existsSync(new URL(file, root)));
  assert.deepEqual(remaining, [], "Foreign implementations must stay in their own repositories");
});

test("Project metadata and test commands refer to Traffic", () => {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  assert.equal(pkg.name, "traffic-opportunity-score");
  assert.equal(pkg.homepage, "https://traffic-opportunity-score.vercel.app");
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(pkg.scripts["test:lifecycle"], undefined);
  assert.equal(pkg.scripts["test:readiness"], undefined);
  assert.ok(pkg.scripts.test.includes("test:boundaries"));
});

test("Legacy page links redirect to the separate tools, never their APIs", () => {
  const config = readJson("vercel.json");
  const redirects = new Map(config.redirects.map((rule) => [rule.source, rule.destination]));
  assert.equal(redirects.get("/tco"), "https://truckonomics.vercel.app/");
  assert.equal(redirects.get("/embed"), "https://truckonomics.vercel.app/embed");
  assert.equal(redirects.get("/depot-readiness"), "https://depot-readiness-check.vercel.app/");
  const rewrite = config.rewrites.find((rule) => rule.destination === "/");
  assert.ok(rewrite, "Traffic needs its SPA rewrite");
  const pattern = new RegExp(`^${rewrite.source}$`);
  for (const endpoint of ["readiness-submit", "readiness-export", "calculate-tco"]) {
    assert.equal(pattern.test(`/api/${endpoint}`), false, "Unknown APIs must not fall through to the SPA");
  }
  assert.equal(pattern.test("/traffic-opportunity"), true);
  assert.equal(pattern.test("/korridor-report"), true);
});

test("Commercial frontend does not silently use a public routing demo", () => {
  const source = readFileSync(new URL("client/src/pages/korridor-report.tsx", root), "utf8");
  assert.equal(source.includes("https://router.project-osrm.org/route/"), false);
});
