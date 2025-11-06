#!/usr/bin/env bash
set -euo pipefail
mkdir -p agent/{exports,notes,scripts,workflows}
[ -f agent/notes/AGENT_NOTES.md ] || cat > agent/notes/AGENT_NOTES.md <<'MD'
# Decisions
# Todos
# References
MD

# placeholders iniciales (serán sobrescritos en Fase 4)
cat > agent/system_prompt.md <<'MD'
# <role>
Agente universal. Completa tareas con economía de tokens.
MD

cat > agent/config.yaml <<'YAML'
version: 1
project:
  name: PLACEHOLDER
  root: .
context:
  seed: []
  exclude: ["vendor/**","node_modules/**","storage/logs/**",".git/**"]
budgets:
  max_context_tokens: 12000
  soft_threshold: 9000
compaction:
  on_soft_threshold:
    summarize_history_to_tokens: 800
    keep_last_messages: 6
    drop_tool_outputs_older_than_hours: 6
memory:
  type: file-notes
  path: agent/notes/AGENT_NOTES.md
YAML
chmod +x agent/scripts/* 2>/dev/null || true
