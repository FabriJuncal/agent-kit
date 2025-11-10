#!/usr/bin/env bash
# /var/www/html/agent/bootstrap.docker.sh
set -euo pipefail

PROJECT="/var/www/html"   # ajustá si tu repo en contenedores está en otra ruta

# 1) Init local (crea carpetas/plantillas base)
bash agent/init.sh

# 2) Exports comunes con Node (contenedor vite)
docker exec vite sh -lc "node $PROJECT/agent/scripts/export_common.mjs || true"

# 3) Detección de stack (guarda signals.json)
docker exec vite sh -lc "node $PROJECT/agent/scripts/detect_stack.mjs > $PROJECT/agent/exports/signals.json || true"

# 4) Exportadores Laravel (si existe artisan)
docker exec laravel-app sh -lc "[ -f $PROJECT/artisan ] && php $PROJECT/agent/scripts/export_project.php > $PROJECT/agent/exports/project_manifest.json || true"
docker exec laravel-app sh -lc "[ -f $PROJECT/artisan ] && php $PROJECT/agent/scripts/export_models.php > $PROJECT/agent/exports/models.json || true"
docker exec laravel-app sh -lc "[ -f $PROJECT/artisan ] && php $PROJECT/agent/scripts/export_env.php > $PROJECT/agent/exports/env_meta.json || true"
docker exec laravel-app sh -lc "[ -f $PROJECT/artisan ] && php $PROJECT/artisan route:list --json > $PROJECT/agent/exports/routes.json || php $PROJECT/artisan route:list > $PROJECT/agent/exports/routes.txt || true"

# 5) (NUEVO) Escáner completo del árbol Laravel (Node en vite)
docker exec vite sh -lc "node $PROJECT/agent/scripts/scan_laravel_fs.mjs || true"

# 6) Análisis opcional (no falla si no están instalados)
docker exec laravel-app sh -lc "bash $PROJECT/agent/scripts/run_phpstan.sh || true"
docker exec laravel-app sh -lc "bash $PROJECT/agent/scripts/run_rector_dry.sh || true"
docker exec laravel-app sh -lc "bash $PROJECT/agent/scripts/run_deptrac.sh || true"
docker exec laravel-app sh -lc "bash $PROJECT/agent/scripts/run_metrics.sh || true"

# 7) Exportadores FE solo si hay Angular
docker exec vite sh -lc "[ -f $PROJECT/angular.json ] && node $PROJECT/agent/scripts/export_angular.mjs || true"
docker exec vite sh -lc "[ -f $PROJECT/angular.json ] && node $PROJECT/agent/scripts/scan_routes_ts.mjs || true"

# 8) Síntesis + checklist (Node en vite)
docker exec vite sh -lc "node $PROJECT/agent/scripts/synthesize.mjs"
docker exec vite sh -lc "node $PROJECT/agent/scripts/checklist.mjs"
docker exec vite sh -lc "node $PROJECT/agent/scripts/scan_project.mjs || true"

echo '✅ Onboarding completo. Revisá agent/config.yaml, agent/system_prompt.md y agent/exports/*.json'
