# Agent Kit (Universal)

## Cómo usar
1. Copiá la carpeta `agent/` al raíz de tu proyecto.
2. En la terminal, corré:
   ```bash
   chmod +x agent/bootstrap.sh agent/init.sh agent/scripts/* || true
   ./agent/bootstrap.sh
   ```
3. Revisa `agent/config.yaml`, `agent/system_prompt.md` y los JSON en `agent/exports/`.

## Requisitos
- Node 18+, jq, Git. (Laravel: PHP 8.2+, Composer y herramientas dev opcionales)
