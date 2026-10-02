#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONPATH="${PWD}/data/planning-python${PYTHONPATH:+:${PYTHONPATH}}"
python3 -m unittest discover -s scripts -p 'test_planning_data.py'
if [[ -x node_modules/.bin/tsx ]]; then
  node_modules/.bin/tsx shared/charging-planning/planning.test.ts
  node_modules/.bin/tsx shared/charging-planning/site-input.test.ts
  node_modules/.bin/tsx shared/charging-planning/api.test.ts
else
  npx --yes tsx@4.21.0 shared/charging-planning/planning.test.ts
  npx --yes tsx@4.21.0 shared/charging-planning/site-input.test.ts
  npx --yes tsx@4.21.0 shared/charging-planning/api.test.ts
fi
npm run check
node scripts/test_charging_runtime.mjs
node_modules/.bin/tsc --noEmit --strict --skipLibCheck --types node --module ESNext --moduleResolution Bundler --target ES2022 scripts/run_charging_plan.ts
