#!/usr/bin/env bash
set -euo pipefail
if [ -x ./vendor/bin/rector ]; then
  ./vendor/bin/rector process app --dry-run --output-format=json | tee agent/exports/rector_suggestions.json
  if command -v jq >/dev/null 2>&1; then
    jq '{suggestions: (.file_diffs | map({file: .file, diff: .diff})[:20])}' agent/exports/rector_suggestions.json || true
  fi
else
  echo '{"suggestions":[],"note":"rector not installed"}' | tee agent/exports/rector_suggestions.json
fi
