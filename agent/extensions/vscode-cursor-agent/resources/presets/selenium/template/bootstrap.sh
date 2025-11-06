#!/usr/bin/env bash
set -euo pipefail
bash agent/init.sh
node agent/scripts/export_common.mjs
node agent/scripts/detect_stack.mjs > agent/exports/signals.json
SIG=$(jq -r '.signals' agent/exports/signals.json)

# Laravel
if jq -e '.laravel == true' <<<"$SIG" >/dev/null; then
  php agent/scripts/export_project.php > agent/exports/project_manifest.json || true
  php agent/scripts/export_models.php > agent/exports/models.json || true
  php agent/scripts/export_env.php > agent/exports/env_meta.json || true
  php artisan route:list --json > agent/exports/routes.json || php artisan route:list > agent/exports/routes.txt || true
  bash agent/scripts/run_phpstan.sh || true
  bash agent/scripts/run_rector_dry.sh || true
  bash agent/scripts/run_deptrac.sh || true
fi

# Angular/FE
if jq -e '.angular == true' <<<"$SIG" >/dev/null; then
  node agent/scripts/export_angular.mjs || true
  node agent/scripts/scan_routes_ts.mjs || true
fi

node agent/scripts/export_selenium_context.mjs || true
node agent/scripts/synthesize.mjs
node agent/scripts/checklist.mjs
echo "✅ Onboarding completo. Revisa agent/config.yaml y agent/system_prompt.md"
