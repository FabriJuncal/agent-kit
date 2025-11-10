#!/usr/bin/env bash
set -euo pipefail

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_with_temp_redirect() {
  local target="$1"
  shift
  local tmp
  tmp=$(mktemp)
  if "$@" >"$tmp"; then
    mv "$tmp" "$target"
    return 0
  else
    rm -f "$tmp"
    return 1
  fi
}

run_php_to_file() {
  local target="$1"
  shift
  if ! command_exists php; then
    echo "⚠️  PHP no está instalado; se omite php $*"
    return 1
  fi
  run_with_temp_redirect "$target" php "$@"
}

safe_run() {
  "$@" || true
}

bash agent/init.sh
node agent/scripts/export_common.mjs
node agent/scripts/detect_stack.mjs > agent/exports/signals.json
SIG=$(jq -r '.signals' agent/exports/signals.json)

# Laravel
if jq -e '.laravel == true' <<<"$SIG" >/dev/null; then
  run_php_to_file agent/exports/project_manifest.json agent/scripts/export_project.php || true
  run_php_to_file agent/exports/models.json agent/scripts/export_models.php || true
  run_php_to_file agent/exports/env_meta.json agent/scripts/export_env.php || true
  if ! run_php_to_file agent/exports/routes.json artisan route:list --json; then
    run_php_to_file agent/exports/routes.txt artisan route:list || true
  fi
  node agent/scripts/scan_laravel_fs.mjs || true
  safe_run bash agent/scripts/run_phpstan.sh
  safe_run bash agent/scripts/run_rector_dry.sh
  safe_run bash agent/scripts/run_deptrac.sh
fi

# Angular/FE
if jq -e '.angular == true' <<<"$SIG" >/dev/null; then
  node agent/scripts/export_angular.mjs || true
  node agent/scripts/scan_routes_ts.mjs || true
fi

node agent/scripts/export_selenium_context.mjs || true
node agent/scripts/scan_project.mjs || true
node agent/scripts/synthesize.mjs
node agent/scripts/checklist.mjs
echo "✅ Onboarding completo. Revisa agent/config.yaml y agent/system_prompt.md"
