#!/usr/bin/env bash
set -euo pipefail
mkdir -p agent/exports
cat <<'DOC' > agent/exports/project_overview.md
# Project Overview

Describe los objetivos del proyecto, actores principales y próximos releases.

- [ ] Documentar dependencias críticas.
- [ ] Enumerar servicios externos.
- [ ] Identificar automatizaciones pendientes.
DOC

echo "✅ Contexto general generado en agent/exports/project_overview.md"
