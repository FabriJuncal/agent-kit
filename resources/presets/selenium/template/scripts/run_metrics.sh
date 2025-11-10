#!/usr/bin/env bash
set -euo pipefail
if command -v phpmetrics >/dev/null 2>&1; then
  phpmetrics --report-json=agent/exports/phpmetrics.json app || true
  if command -v jq >/dev/null 2>&1; then
    jq '{hotspots: ( .classes | sort_by(-.nbMethodsPublic)[:20] | map({name: .name, methods: .nbMethods, complexity: .wmc, vol: .volume}) )}' agent/exports/phpmetrics.json || echo '{"hotspots":[]}'
  fi
else
  echo '{"hotspots":[],"note":"phpmetrics not installed"}' | tee agent/exports/phpmetrics.json
fi
