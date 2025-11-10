# Agent Context Toolkit

Extensión ligera para VSCode y Cursor que expone los artefactos generados por los scripts del repositorio `agent-kit`. Permite que agentes humanos o IA mantengan a mano el contexto Selenium, dependencias y reglas de arquitectura sin abandonar el editor.

## Instalación rápida

1. En `agent/extensions/vscode-cursor-agent`, ejecuta `npm install` (instala `@vscode/vsce`).
2. Empaqueta la extensión con `npm run package` (genera `agent-context-toolkit-*.vsix`) o usa `Developer: Install Extension from Location...` apuntando a este directorio.
3. Abre Cursor/VSCode, haz clic en el icono **Agent** de la barra lateral y listo: el panel webview, `Agent Contextos` y `Agent Composer` quedarán disponibles. Los comandos también se exponen en la paleta (`Ctrl/Cmd + Shift + P`).

## Funcionalidades incluidas

### ¿Qué problemas resuelve?

- **Onboarding manual**. Detecta si el proyecto carece de `agent/`, ofrece un botón único para instalarlo y ejecuta automáticamente `bootstrap`, export Selenium y Deptrac en cuanto la estructura queda lista.
- **Contexto disperso**. Centraliza overview, notas, dependencias, diagnósticos y snippets dentro del editor, con estados visibles para cada artefacto.
- **Inconsistencia entre proyectos**. Los *presets* encapsulan plantillas y comandos distintos (Laravel, Selenium, Next.js, Angular, Ionic, PHP nativo, genérico) y permiten cambiar de stack sin reinstalar la extensión.
- **Visibilidad de arquitectura**. Composer y Deptrac aparecen como árboles y diagnósticos dentro del panel para navegar dependencias y violaciones sin abrir otras herramientas.
- **Pruebas Selenium orquestadas**. La IA alimenta `agent/exports/selenium_modules.json`, el botón **Ejecutar Test Selenium** ofrece un picker de módulos y el script `agent/scripts/run_selenium_tests.sh` ejecuta los tests apropiados (pytest, Node, comandos personalizados) dejando trazabilidad en el JSON.

### Flujo del panel

#### 1. Primer arranque: `Instalar Agent Kit`

Al abrir un workspace nuevo la extensión valida si existe la carpeta `agent/`. Si falta, oculta el resto de acciones y sólo muestra **Instalar Agent Kit**. Ese flujo:

- Copia la plantilla del preset elegido (o detectado) dentro del workspace.
- Lanza consecutivamente `./agent/bootstrap.sh`, `node agent/scripts/export_selenium_context.mjs` y `./agent/scripts/run_deptrac.sh` si el preset los define.
- Asegura la existencia de `agent/exports/selenium_modules.json` y del runner `agent/scripts/run_selenium_tests.sh`.

Una vez completado, los estados cambian a “Instalado” y el resto de botones aparece.

#### 2. Botonera principal

Los botones personalizados (scripts o prompts IA) se listan primero; después se muestran las acciones del kit en este orden:

1. **Crear Función** – abre el gestor de botones personalizados (`agent/custom_actions.json`).
2. **Ejecutar Test Selenium** – abre un selector múltiple con los módulos definidos en `selenium_modules.json` y lanza `agent/scripts/run_selenium_tests.sh --modules ...`.
3. **Configuración / Ocultar configuración** – despliega o colapsa el panel secundario descrito abajo.
4. **Reinstalar Agent Kit** – elimina `agent/` y repite la instalación completa con el preset elegido.
5. **Limpiar** – borra la carpeta `agent/` sin reinstalarla (ideal para resetear el entorno o cambiar de stack desde cero).

#### 3. Panel de configuración

Al pulsar **Configuración** se habilitan accesos rápidos a:

- Abrir contextos del preset.
- Abrir dependencias Composer (si existen exports).
- Editar snippets (`agent/scripts/export_selenium_context.mjs`).
- Abrir el `bootstrap.sh` del preset.
- Ejecutar `Agent: Configurar extensión` para actualizar workspace root o preset.
- Editar el `config.json` embebido o ver la documentación.
- Configurar el agente IA y probar el sonido de finalización.

### Guía paso a paso para usar el Agent Kit

1. **Instalar/Actualizar la estructura**. Usa `Instalar Agent Kit` (o `Reinstalar` si necesitas refrescar plantillas). Revisa que en la terminal “Agent Toolkit” se ejecuten `bootstrap`, export Selenium y Deptrac sin errores.
   - *Prompt sugerido para la IA*: `"Instala o reinstala el Agent Kit en este workspace y confirma que bootstrap, export_selenium_context y run_deptrac terminaron sin errores. Resume los archivos creados o actualizados."`
2. **Verifica el preset activo**. Desde `Configuración → Configurar extensión` define el preset correcto si el auto-detector no coincide.
   - *Prompt IA*: `"Abre Agent: Configurar extensión y fija el preset Selenium si detectas scripts relacionados a selenium_test_context.md; justifica la selección."`
3. **Revisa contextos y dependencias**. Usa `Abrir contextos` y `Abrir dependencias` para validar que los exports estén sanos antes de iniciar tareas.
   - *Prompt IA*: `"Abre los contextos definidos por el preset y resume qué archivos faltan o están desactualizados; si hay composer_deps.json, genera una lista de paquetes críticos."`
4. **Configura el agente IA**. Pulsa `Configurar agente IA`, elige Codex/OpenAI/custom y completa el flujo (`codex auth login` se ejecuta automáticamente). Sin esta sesión no podrás crear botones Prompt IA.
   - *Prompt IA*: `"Ejecuta Agent: Configurar agente IA, selecciona Codex CLI, autentícate con codex auth login y confirma que whoami responde correctamente."`
5. **Crea botones personalizados**. Desde `Crear Función` agrega scripts recurrentes o prompts IA reutilizables. Se guardan en `agent/custom_actions.json`.
   - *Prompt IA*: `"Crea un botón personalizado llamado 'Codex: Auditoría Routes' que use el runner codex generate -m code-1 --prompt "{prompt}" con el texto 'Revisa agent/exports/routes.json y enumera endpoints sin pruebas'."
6. **Mantén el catálogo Selenium al día**. Actualiza `agent/exports/selenium_modules.json` cada vez que la IA detecta un flujo nuevo. Incluye `testPath` o `command`, y opcionalmente `env`, `tags`, `owner`, `lastStatus`.
   - *Prompt IA*: `"Analiza agent/exports/selenium_test_context.md y agrega/actualiza módulos en selenium_modules.json con id, descripción, testPath y tags que reflejen Checkout, Login y Payments."`
7. **Ejecuta tests Selenium bajo demanda**. Usa `Ejecutar Test Selenium`, selecciona uno o varios módulos y revisa el outcome en la terminal.
   - *Prompt IA*: `"Ejecuta 'Ejecutar Test Selenium' para los módulos checkout y payments, espera la salida y actualiza selenium_modules.json con los estados reportados."`
8. **Ajusta la configuración avanzada**. Desde `Configuración` abre snippets, bootstrap, documentación o `config.json`. Aprovecha el panel sólo cuando la estructura ya esté instalada; si no, la sección se oculta.
   - *Prompt IA*: `"Abre agent/scripts/export_selenium_context.mjs y agrega un snippet llamado selenium:reset-password siguiendo el formato oficial; describe los cambios."`
9. **Limpia cuando sea necesario**. El botón `Limpiar` borra `agent/` (para recrearlo limpio) y apaga watchers; úsalo antes de clonar otra plantilla o cuando quieras asegurar que no quedaron residuos.
   - *Prompt IA*: `"Ejecuta 'Limpiar' para eliminar la carpeta agent/, confirma en git status que desapareció y deja indicado que se debe reinstalar antes de continuar."`

### Probar el sonido fuera del editor

Cuando no tienes VSCode/Cursor abierto pero quieres confirmar el sonido de finalización, ejecuta el script `agent/scripts/play_done_sound.js`. Reutiliza el mismo flujo del botón **Probar Sonido**: respeta `config.json`, las settings `agentToolkit.soundFile/soundMessage` y usa los mismos reproductores por plataforma.

```
node agent/scripts/play_done_sound.js
```

Puedes sobreescribir temporalmente el archivo o el mensaje con flags opcionales:

```
node agent/scripts/play_done_sound.js --sound-file ~/Downloads/campana.wav --message "¡Export listo!"
```

### Presets multi-stack

| Preset | ¿Cuándo usarlo? |
| --- | --- |
| **Laravel** | Repos con `artisan`: genera manifest del proyecto, rutas, modelos, env y diagnósticos Deptrac. |
| **Selenium + Fullstack** | Apps que necesitan contexto Selenium, snippets E2E y árbol de dependencias PHP. |
| **Next.js** | Apps React/Next con `next.config.js`; prioriza signals FE y notas de despliegue. |
| **Angular** | SPA Angular con `angular.json`, manifiesto TS y rutas mapeadas. |
| **Ionic** | Aplicaciones móviles híbridas (`ionic.config.json`) que comparten señales FE y móviles. |
| **PHP Nativo** | APIs o sitios PHP sin framework. Sólo requiere `composer.json` + `public/index.php`. |
| **Genérico** | Proyectos ligeros donde basta un overview + notas rápidas. |

El preset puede fijarse desde `agentToolkit.preset`, el comando `Agent: Configurar extensión` o durante la instalación del kit.

### Catálogo de módulos Selenium y runner smart

- `agent/exports/selenium_modules.json` almacena los módulos que la IA va generando. Cada entrada admite:

  ```json
  [
    {
      "id": "checkout",
      "name": "Checkout feliz",
      "description": "Completa la compra web estándar",
      "testPath": "selenium/tests/checkout.spec.js",
      "lastStatus": "passed",
      "lastRun": "2024-11-08T12:34:00Z"
    },
    {
      "id": "payments-api",
      "name": "Pagos API",
      "command": "npm run e2e:payments"
    }
  ]
  ```

  - Usa `testPath` para archivos `.py`, `.js/.ts/.mjs/.cjs` o scripts ejecutables.
  - Usa `command` para delegar en `npm run ...`, `php artisan dusk`, etc.
  - El runner actualiza `lastStatus`, `lastRun` y `lastMessage` automáticamente tras cada ejecución.

- `agent/scripts/run_selenium_tests.sh --modules id1,id2` detecta la extensión del archivo, llama a `pytest`, `node`, `ts-node` (si existe) o ejecuta el comando indicado y registra el resultado de cada módulo.
- El botón **Ejecutar Test Selenium** enlaza esa experiencia dentro del editor: seleccionas uno o varios módulos y observas el resultado en la terminal “Agent Toolkit”.

### Botones personalizados

- Se gestionan desde **Crear Función** o el comando `Agent: Gestionar botones personalizados`.
- Se almacenan en `agent/custom_actions.json` para versionarlos junto con el repo.
- Tipos disponibles:
  - **Script**: ejecuta `./scripts/deploy.sh`, `npm run lint`, `php artisan test`, etc. El comando se lanza dentro del workspace configurado.
  - **Prompt IA**: define el prompt y el comando que lo recibirá (`codex generate -m code-1 --prompt "{prompt}"`, `openai api ...`, `claude ...`). El placeholder `{prompt}` se reemplaza automáticamente.
- Los botones se listan antes de las acciones internas del panel para que siempre estén visibles.

**Ejemplos prácticos**

| Nombre del botón | Tipo | Configuración | ¿Qué hace? |
| --- | --- | --- | --- |
| `Deploy staging` | Script | `./scripts/deploy_staging.sh` | Lanza tu script de despliegue sin abrir otra terminal. |
| `Generar changelog` | Script | `npm run changelog` | Sintetiza el changelog del release actual. |
| `Codex: resumen sprint` | Prompt IA | Prompt: `Resume el estado del sprint con foco en blockers y dependencias.`<br>Runner: `codex generate -m code-1 --prompt "{prompt}"` | Ejecuta la CLI oficial de Codex; la extensión comprueba/lanza `codex auth login` según sea necesario. |
| `OpenAI GPT-4: QA checklist` | Prompt IA | Prompt: `Genera una checklist de QA para el módulo de pagos basado en agent/exports/project_manifest.json.`<br>Runner: `openai api chat_completions.create -m gpt-4o-mini -g user "{prompt}"` | Usa la CLI de OpenAI para solicitar una checklist contextual. |
| `Claude: ideas UX` | Prompt IA | Prompt: `Propón mejoras UX para la pantalla de onboarding descrita en DOCUMENTACION.md.`<br>Runner: `claude --prompt "{prompt}"` | Envía el prompt a tu CLI de Claude corporativa. |

### Configuración del agente IA

`Agent: Configurar agente IA` (también disponible en el panel de configuración) permite elegir entre:

- **Codex CLI**: ya no requiere tokens. La extensión valida `codex auth whoami` y, si no hay sesión, ejecuta `codex auth login` en la terminal para que completes el flujo web. Una vez logueado, se memoriza el runner por defecto (`codex generate -m code-1 --prompt "{prompt}"`).
- **OpenAI API** o **proveedor personalizado**: solicitan el token/API key y lo guardan en el llavero seguro de VSCode. Las variables quedan disponibles cuando envías prompts.

### Conceptos clave

| Concepto | ¿Qué es? | ¿Qué problema resuelve? | Casos de uso |
| --- | --- | --- | --- |
| **Preset** | Paquete que define plantillas, contextos, comandos y snippets. | Evita duplicar configuraciones y permite cambiar de stack con un click. | Pasar de Selenium a un microservicio Node usando el preset genérico. |
| **Selenium** | Framework y tooling para automatizar navegadores. | Documenta flujos críticos y expone snippets/exports listos para IA. | Generar selectores tras modificar Blade o componer nuevos tests E2E. |
| **Bootstrap (`./agent/bootstrap.sh`)** | Script maestro que orquesta exports, señales y diagnósticos. | Deja el contexto sincronizado antes de iniciar un sprint o revisar un PR. | Se ejecuta automáticamente al instalar el kit (y puede relanzarse manualmente). |
| **Composer** | Gestor de dependencias PHP; la extensión representa `composer_deps.json`. | Facilita auditorías de paquetes y capas sin salir del editor. | Explorar quién depende de `illuminate/mail` antes de refactorizar. |
| **Deptrac** | Análisis estático de capas PHP. | Detecta violaciones de arquitectura directamente en el editor. | Revisar warnings al mover servicios entre módulos. |

### Generación de datos y scripts relevantes

```
# Preset genérico
./agent/bootstrap.sh                        # genera agent/exports/project_overview.md

# Preset Selenium
./agent/bootstrap.sh                        # contextos base
node agent/scripts/export_selenium_context.mjs  # recomendaciones + snippets
./agent/scripts/run_deptrac.sh              # deptrac_layers.json
./agent/scripts/run_selenium_tests.sh       # ejecuta módulos declarados en selenium_modules.json
```

Cada vez que estos archivos cambian, el panel se actualiza automáticamente gracias a los watchers. Si el proyecto aún no tiene `agent/`, arranca con **Instalar Agent Kit**; si necesitas un reset completo, usa **Reinstalar** o **Limpiar**.

### Panel del agente: botones y prompts de referencia

| Botón | ¿Cuándo usarlo? | Prompt IA sugerido |
| --- | --- | --- |
| `Instalar Agent Kit` | Primer uso en un workspace sin `agent/`; ejecuta automáticamente bootstrap/export/Deptrac y prepara runners Selenium. | `"Instala el Agent Kit y reporta qué archivos/exports se generaron o faltan."` |
| `Crear Función` | Gestiona los botones personalizados (scripts o prompts IA) visibles al inicio del panel. | `"Crea/edita un botón personalizado llamado '<nombre>' que ejecute <comando> y documenta el resultado."` |
| `Ejecutar Test Selenium` | Selecciona módulos desde `selenium_modules.json` y corre `run_selenium_tests.sh`, actualizando `lastStatus`. | `"Ejecuta el botón 'Ejecutar Test Selenium' para los módulos <ids> y resume la salida indicando módulos fallidos."` |
| `Configuración` | Muestra accesos a contextos, dependencias, snippets, bootstrap, configuración general, documentación, sonido y agente IA. | `"Abre el panel de Configuración y registra qué acciones están disponibles/pending según el preset."` |
| `Reinstalar Agent Kit` | Refresca la estructura y vuelve a lanzar los automations (útil en cambios mayores o para alinear la plantilla). | `"Reinstala el Agent Kit, confirma que bootstrap/export/Deptrac terminaron y anota diferencias vs. la instalación previa."` |
| `Limpiar` | Elimina `agent/` para iniciar desde cero o cambiar de stack sin residuos. | `"Ejecuta 'Limpiar', verifica que la carpeta agent/ ya no existe y deja el workspace listo para reinstalar."` |

### Vistas complementarias y sus prompts recomendados

- **Agent Contextos**: muestra los archivos clave del preset y su estado.
  - Prompt: `"Abre la vista Agent Contextos, identifica archivos faltantes y sugiere qué script del agent debería regenerarlos."`
- **Agent Composer**: renderiza `agent/exports/composer_deps.json` como árbol navegable.
  - Prompt: `"Refresca Agent Composer y enumera dependencias críticas (ej. payments, auth) indicando versión y capa."`
- **Diagnósticos Deptrac**: los warnings aparecen en el editor; usa el botón `Ejecutar análisis Deptrac` (cuando el preset lo define) y revisa `agent/exports/deptrac_layers.json`.
  - Prompt: `"Corre Deptrac desde el Agent Kit y resume las violaciones agrupadas por capa."`
- **Snippets Selenium**: edita `agent/scripts/export_selenium_context.mjs` para agregar bloques reutilizables.
  - Prompt: `"Actualiza el archivo de snippets Selenium agregando un snippet 'selenium:login-happy' con los selectores recientes."`
- **Documentación y config.json**: accesos rápidos desde `Configuración` para mantener configuraciones compartidas.
  - Prompt: `"Abre la documentación del Agent Kit, verifica los lineamientos vigentes y confirma que config.json refleje el preset actual."`

### Personalización

La ruta más rápida es abrir **Agent: Configurar extensión** (también accesible desde el panel). Ajustes manuales disponibles:

- `agentToolkit.workspaceRoot`: root alternativo si trabajas en monorepos o subcarpetas.
- `agentToolkit.preset`: fuerza un preset específico; vacío intenta detectar automáticamente.
- `agentToolkit.soundFile` y `agentToolkit.soundMessage`: controlan el aviso cuando los exports cambian.
- `Agent: Configurar agente IA`: administra credenciales/CLI usadas por los botones de tipo IA.

### Próximos pasos sugeridos

- Empaquetar el `.vsix` y publicarlo en tu marketplace privado u organización.
- Añadir pruebas con [`@vscode/test-electron`](https://code.visualstudio.com/api/working-with-extensions/testing-extension) para validar extractores, watchers y comandos del panel.
- Extender la vista de dependencias para abrir documentación oficial (Packagist, npm, etc.) o enriquecer el árbol con métricas adicionales.
