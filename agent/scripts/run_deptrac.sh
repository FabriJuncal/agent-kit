#!/usr/bin/env bash
set -euo pipefail
if [ -x ./vendor/bin/deptrac ]; then
  ./vendor/bin/deptrac --formatter=json --no-interaction | tee agent/exports/deptrac_layers.json
  if command -v jq >/dev/null 2>&1; then
    jq '{violations: (.rules.violations // [] | map({layer: .layer, dependency: .dependency_class}))[:50]}' agent/exports/deptrac_layers.json || true
  fi
else
  echo '{"violations":[],"note":"deptrac not installed"}' | tee agent/exports/deptrac_layers.json
fi
