# Agent Kit — Guía de Instalación y Uso

## Alcance
Este documento describe los requisitos, pasos de instalación y formas habituales de operar el Agent Kit dentro de un proyecto existente. No cubre detalles de implementación interna; se enfoca en cómo adoptarlo y sacarle provecho.

## Requisitos previos

| Herramienta | Uso dentro del kit | Cómo verificar |
| --- | --- | --- |
| Node.js 18 o superior | Ejecutar los scripts principales (`*.mjs`) | `node -v` |
| jq | Filtrar y combinar salidas JSON | `jq --version` |
| Git | Obtener metadatos del repositorio | `git --version` |
| PHP 8.2+ y Composer *(opcional, requerido para Laravel)* | Exportadores específicos y análisis (`phpstan`, `rector`, `deptrac`, `phpmetrics`) | `php -v`, `composer -V` |
| Herramientas opcionales: `phpstan`, `rector`, `deptrac`, `phpmetrics`, `docker` | Solo si querés ejecutar sus análisis correspondientes | Comandos individuales (p. ej. `vendor/bin/phpstan --version`) |

> Sugerencia: verificá que el proyecto cuente con permisos para crear la carpeta `agent/exports/`.

## Instalación local (macOS / Linux / WSL)

1. Copiá la carpeta `agent/` al directorio raíz del proyecto que quieras analizar.
2. Asigná permisos de ejecución a los scripts:
   ```bash
   chmod +x agent/bootstrap.sh agent/init.sh agent/clean.sh agent/scripts/* || true
   ```
3. Ejecutá el proceso de onboarding:
   ```bash
   ./agent/bootstrap.sh
   ```
   Este flujo inicial:
   - Crea plantillas base en `agent/config.yaml`, `agent/system_prompt.md` y `agent/notes/AGENT_NOTES.md`.
   - Detecta el stack disponible (Laravel, Angular, etc.) y genera `agent/exports/signals.json`.
   - Produce los archivos resumen en `agent/exports/` con la información relevante del proyecto.
   - Lanza verificaciones opcionales (PHPStan, Rector, Deptrac, PHP Metrics) si las herramientas están instaladas.
4. Revisá y personalizá:
   - `agent/config.yaml`: ajustá el nombre del proyecto, rutas a excluir o semillas de contexto.
   - `agent/system_prompt.md`: afiná el rol y objetivos del agente según tu flujo de trabajo.
   - `agent/notes/AGENT_NOTES.md`: registrá decisiones, pendientes y referencias.
   - Los JSON generados en `agent/exports/` para validar que contienen la información esperada.

### Reejecución
Volvé a correr `./agent/bootstrap.sh` cada vez que haya cambios significativos (nuevos módulos, dependencias, rutas, etc.) para refrescar los exports.

### Inicialización manual
Si necesitás resetear la estructura de carpetas y plantillas sin recolectar datos, podés usar:
```bash
./agent/init.sh
```
Esto no elimina archivos existentes, pero sobrescribe las plantillas base.

## Instalación en entornos con contenedores

Usá `agent/bootstrap.docker.sh` cuando el proyecto viva en múltiples contenedores (por ejemplo, `vite` + `laravel-app`):

1. Asegurate de que el script tenga permisos de ejecución:
   ```bash
   chmod +x agent/bootstrap.docker.sh
   ```
2. Ajustá la variable `PROJECT` del script si el repositorio no está en `/var/www/html`.
3. Confirmá que los contenedores mencionados (`vite`, `laravel-app`) existan y tengan las herramientas necesarias.
4. Ejecutá:
   ```bash
   ./agent/bootstrap.docker.sh
   ```
   El script coordina los comandos en cada contenedor, genera los exports y sintetiza los resultados igual que en el entorno local.

> Tip: si tus servicios tienen nombres distintos, actualizá los `docker exec …` correspondientes antes de correr el script.

## Archivos y carpetas clave

| Recurso | Descripción y uso |
| --- | --- |
| `agent/bootstrap.sh` | Orquesta el onboarding completo en entornos locales. Es el comando recomendado para recolectar todos los artefactos. |
| `agent/bootstrap.docker.sh` | Variante para escenarios Docker Compose / múltiples contenedores. |
| `agent/init.sh` | Crea la estructura mínima del kit y asegura que existan las carpetas necesarias. |
| `agent/clean.sh` | Limpia `agent/exports/` y, con `--reset-plantillas`, vuelve a generar las plantillas base. |
| `agent/config.yaml` | Configuración del agente: nombre del proyecto, rutas semilla, exclusiones y límites de contexto. Editalo para alinearlo con tus necesidades. |
| `agent/system_prompt.md` | Prompt base que guía al agente. Personalizalo con objetivos concretos del equipo. |
| `agent/notes/AGENT_NOTES.md` | Libreta de memoria persistente para el agente (decisiones, TODOs, referencias). |
| `agent/exports/` | Carpeta con todos los artefactos generados. Estos archivos sirven como semillas compactas de información. |
| `agent/scripts/` | Comandos individuales (`*.mjs`, `*.sh`, `*.php`) que podés ejecutar manualmente si querés actualizar un export puntual. |
| `agent/workflows/github-actions-agent-export.yml` | Workflow opcional para automatizar la generación de exports en GitHub Actions. |

## Qué genera el kit

### Exportadores generales
- `project_manifest.json`: nombre del proyecto, timestamp y directorios relevantes para orientar al agente.
- `npm_deps.json` y `composer_deps.json`: dependencias clave detectadas en `package.json` y `composer.lock`.
- `signals.json`: identifica si el proyecto es Laravel, Angular, Vite, Next.js, etc., para activar exportadores específicos.
- `checklist.mjs` (salida en consola): confirma que los archivos fundamentales estén presentes.

### Entornos Laravel
- `project_manifest.json` (versión enriquecida via PHP), `models.json`, `env_meta.json`: metadatos de modelos, variables de entorno relevantes y proyectos Laravel detectados.
- `routes.json` o `routes.txt`: listado de rutas provenientes de `php artisan route:list`.
- `laravel_map.json`: panorama del árbol Laravel (controllers, middleware, vistas, assets, storage, rutas PHP).
- `phpstan_report.json`, `rector_suggestions.json`, `deptrac_layers.json`, `phpmetrics.json`: resultados de las herramientas opcionales si están instaladas.

### Entornos Angular / Frontend
- `angular_workspace.json`: proyectos definidos en `angular.json`.
- `fe_routes.json`: rutas detectadas en archivos de enrutamiento (`*.routes.ts`, `*.routing.ts`).

Podés abrir estos JSON con tu editor o combinarlos con herramientas CLI (`jq`, `less`) para inspeccionar la información.

## Uso cotidiano

- **Actualizar datos después de cambios**: `./agent/bootstrap.sh`.
- **Generar un export específico**: ejecutá el script deseado, por ejemplo:
  - `node agent/scripts/synthesize.mjs`
  - `bash agent/scripts/run_phpstan.sh`
  - `php agent/scripts/export_project.php > agent/exports/project_manifest.json`
- **Limpiar artefactos**: `./agent/clean.sh` borra los exports generados y `./agent/clean.sh --reset-plantillas` además regenera las plantillas iniciales.
- **Personalizar el prompt**: ajustá `agent/system_prompt.md` según el proyecto (por ejemplo, enfocándolo en deuda técnica, performance, onboarding, etc.).
- **Registrar memoria**: usá `agent/notes/AGENT_NOTES.md` para documentar acuerdos, decisiones de arquitectura y tareas pendientes.

> Consejo: agregá la carpeta `agent/` (excepto `agent/exports/` si querés evitar cambios frecuentes) al control de versiones. Los exports pueden regenerarse bajo demanda, pero conviene conservarlos cuando forman parte de reportes o análisis compartidos.

## Automatización con GitHub Actions

El flujo `agent/workflows/github-actions-agent-export.yml` permite generar los mismos artefactos en CI/CD:

1. Copiá el archivo a `.github/workflows/` en tu repositorio.
2. Ajustá las herramientas instaladas o los comandos opcionales según tu stack.
3. Al ejecutarse (push a `main` o disparo manual), subirá un artefacto `agent-exports` con todo el contenido de `agent/exports/`.

Esto es útil para obtener snapshots del estado del proyecto sin intervención manual.

## Buenas prácticas

- Ejecutá el kit en una rama limpia para que los exports reflejen el estado real del repositorio.
- Documentá decisiones directamente en `agent/notes/AGENT_NOTES.md` para que queden disponibles en futuros análisis.
- Sincronizá los exports clave (manifest, dependencias, rutas) cada vez que cambien las piezas principales del proyecto.
- Validá los requisitos antes de correr los scripts para evitar ejecuciones parciales.
- Revisá la salida de la consola tras `bootstrap` para detectar si faltaron herramientas opcionales o si hubo comandos que devolvieron advertencias.

Con estos pasos, el Agent Kit queda listo para asistir a nuevos integrantes del equipo, agentes automatizados o auditorías periódicas sin exponer detalles internos del código.
