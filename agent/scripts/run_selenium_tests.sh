#!/usr/bin/env bash
set -uo pipefail

WORKSPACE_ROOT=$(pwd)
MODULES_FILE="agent/exports/selenium_modules.json"
SELECTED=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --modules)
      SELECTED="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ ! -f "$MODULES_FILE" ]]; then
  echo "No se encontró $MODULES_FILE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "El script requiere jq para leer $MODULES_FILE" >&2
  exit 1
fi

if [[ -z "$SELECTED" ]]; then
  echo "Debe indicar --modules modulo1,modulo2" >&2
  exit 1
fi

IFS=',' read -r -a MODULE_IDS <<< "$SELECTED"

if [[ ${#MODULE_IDS[@]} -eq 0 ]]; then
  echo "No se indicaron módulos válidos." >&2
  exit 1
fi

update_module_status() {
  local module_id="$1"
  local status="$2"
  local message="$3"
  node - <<'NODE' "$MODULES_FILE" "$module_id" "$status" "$message"
const fs = require('fs');
const [, , file, id, status, messageArg] = process.argv;
const message = messageArg || '';
try {
  const modules = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const now = new Date().toISOString();
  let updated = false;
  const next = modules.map((module) => {
    if (module.id !== id) {
      return module;
    }
    updated = true;
    return {
      ...module,
      lastStatus: status,
      lastRun: now,
      lastMessage: message
    };
  });
  if (updated) {
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
  }
} catch (error) {
  // Ignorar errores de lectura/escritura
}
NODE
}

run_module() {
  local module_id="$1"
  local module_json
  module_json=$(jq -rc --arg id "$module_id" 'map(select(.id == $id)) | first // empty' "$MODULES_FILE")

  if [[ -z "$module_json" ]]; then
    echo "WARN: No se encontró el módulo \"$module_id\" en $MODULES_FILE" >&2
    return 2
  }

  local module_name
  module_name=$(jq -r '.name // .id' <<<"$module_json")
  local description
  description=$(jq -r '.description // empty' <<<"$module_json")
  local command
  command=$(jq -r '.command // empty' <<<"$module_json")
  local test_path
  test_path=$(jq -r '.testPath // empty' <<<"$module_json")

  if [[ -n "$description" ]]; then
    echo "--> $module_name - $description"
  else
    echo "--> $module_name"
  fi

  if [[ -n "$command" ]]; then
    bash -lc "$command"
    return $?
  fi

  if [[ -z "$test_path" ]]; then
    echo "ERROR: El módulo \"$module_name\" no define testPath ni command" >&2
    return 3
  fi

  if [[ "$test_path" == *.py ]]; then
    python -m pytest "$test_path"
    return $?
  fi

  if [[ "$test_path" == *.js || "$test_path" == *.cjs || "$test_path" == *.mjs ]]; then
    node "$test_path"
    return $?
  fi

  if [[ "$test_path" == *.ts ]]; then
    if command -v ts-node >/dev/null 2>&1; then
      ts-node "$test_path"
    else
      node "$test_path"
    fi
    return $?
  fi

  if [[ -f "$test_path" ]]; then
    if [[ -x "$test_path" ]]; then
      "$test_path"
    else
      bash "$test_path"
    fi
    return $?
  fi

  bash -c "$test_path"
}

OVERALL_STATUS=0
PASSED=0
FAILED=0

for module in "${MODULE_IDS[@]}"; do
  module_id=$(echo "$module" | xargs)
  if [[ -z "$module_id" ]]; then
    continue
  fi

  if run_module "$module_id"; then
    PASSED=$((PASSED + 1))
    update_module_status "$module_id" "passed" "Última ejecución exitosa"
  else
    EXIT_CODE=$?
    FAILED=$((FAILED + 1))
    OVERALL_STATUS=1
    update_module_status "$module_id" "failed" "Falló (código $EXIT_CODE)"
  fi

  echo
done

if [[ $FAILED -eq 0 ]]; then
  echo "[OK] Todos los módulos finalizaron correctamente (${PASSED})"
else
  echo "[WARN] $FAILED módulo(s) fallaron. Revisa la salida para más detalles."
fi

exit $OVERALL_STATUS
