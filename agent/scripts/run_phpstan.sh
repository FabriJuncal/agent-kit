#!/usr/bin/env bash
set -euo pipefail
if [ -x ./vendor/bin/phpstan ]; then
  ./vendor/bin/phpstan analyse app --level=max --error-format=json | tee agent/exports/phpstan_report.json
  if command -v jq >/dev/null 2>&1; then
    jq '{errors: .totals, files: (.files | to_entries | map({file: .key, errors: (.value.messages | length)}) | sort_by(-.errors)[:15])}' agent/exports/phpstan_report.json || true
  fi
else
  echo '{"errors":"phpstan not installed"}' | tee agent/exports/phpstan_report.json
fi
