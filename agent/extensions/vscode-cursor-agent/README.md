# Agent Context Toolkit

Extensión ligera para VSCode y Cursor que expone los artefactos generados por los scripts del repositorio `agent-kit`. Está pensada para que cualquier agente humano o automático cuente con el contexto Selenium, dependencias y reglas de arquitectura sin abandonar el editor.

## Instalación rápida

1. En la carpeta `agent/extensions/vscode-cursor-agent`, ejecuta `npm install` (instala `@vscode/vsce` localmente).
2. Empaqueta la extensión con `npm run package` (genera `agent-context-toolkit-*.vsix`) o usa `Developer: Install Extension from Location...` en VSCode/ Cursor apuntando a este directorio.
3. Abre Cursor/VSCode y haz clic en el nuevo icono **Agent** de la barra lateral; desde allí accedes al panel interactivo, además de los árboles `Agent Contextos` y `Agent Composer`. Los comandos también están disponibles desde la paleta (`Ctrl/Cmd + Shift + P`).

## Funcionalidades incluidas

### ¿Qué problemas resuelve?

- **Onboarding lento o manual**: copiar la carpeta `agent/`, ejecutar scripts y buscar exports suele tomar tiempo. El panel automatiza la creación de la carpeta, el bootstrap y muestra el estado de cada artefacto para detectar qué falta.
- **Contexto disperso**: los agentes (humanos o IA) deben alternar entre docs, scripts y terminal. La extensión centraliza contextos, dependencias y automatizaciones en el mismo editor.
- **Inconsistencia entre proyectos**: cada repo puede necesitar scripts diferentes. Los *presets* encapsulan definidos para cada caso y permiten con un click cambiar de stack (Selenium, genérico, etc.).
- **Falta de visibilidad en arquitectura**: al exponer Deptrac y Composer desde el panel, es más sencillo revisar capas y dependencias sin salir del flujo de trabajo.

- **Presets multi-stack**  
  Incluye presets listos para Laravel, Selenium + Fullstack, Next.js, Angular, Ionic, PHP nativo y un preset genérico. Puedes seleccionar el preset desde el panel o el comando `Agent: Configurar extensión`, y cada uno aporta sus propios contextos, tareas y snippets.

- **Selector de agente IA y credenciales reutilizables**  
  El botón “Agente IA” del panel abre un asistente para elegir Codex, OpenAI o un proveedor personalizado, solicitar el token/API key y almacenarlo de forma segura. El estado conectado se muestra en la sección **Agent** y cualquier botón de tipo “Prompt IA” reutiliza esas credenciales automáticamente.

#### Presets disponibles

| Preset | ¿Cuándo usarlo? |
| --- | --- |
| **Laravel** | Repos con `artisan` donde necesitas exports de rutas, modelos, env y chequeos Deptrac. |
| **Selenium + Fullstack** | Proyectos con foco en E2E Selenium (Laravel o no) que requieren snippets y diagnósticos. |
| **Next.js** | Apps React/Next con `next.config.js`; prioriza manifest, signals y notas FE. |
| **Angular** | SPA Angular con `angular.json`; centraliza manifiesto y señales del stack. |
| **Ionic** | Aplicaciones móviles híbridas (`ionic.config.json`) que necesitan overview y señales compartidas. |
| **PHP Nativo** | APIs o sitios PHP sin framework (solo `composer.json` + `public/index.php`). |
| **Proyecto genérico** | Cualquier otro stack donde solo se necesita un overview y notas rápidas. |

- **Contextos del proyecto a un clic**  
  El árbol “Agent Contextos” se genera a partir del preset activo. Si algún archivo falta, la vista lo marca en amarillo y sugiere correr la automatización correspondiente.

- **Bootstrap instantáneo del directorio agent/**  
  Desde el panel puedes pulsar “Crear estructura agent/” para clonar la plantilla del preset seleccionado dentro del workspace. Si ya existe, el flujo permite completar archivos faltantes o sobrescribirlos según prefieras.

- **Árbol de dependencias Composer**  
  Cuando el preset lo define (por ejemplo el preset Selenium), lee `agent/exports/composer_deps.json` y genera un árbol navegable para detectar paquetes, capas y versiones. Se refresca automáticamente al cambiar el archivo o mediante el comando `Agent: Refrescar dependencias Composer`.

- **Snippets autogenerados para Selenium**  
  Autocompletado para JavaScript/TypeScript/React/PHP. Puedes anotar fragmentos personalizados en `agent/scripts/export_selenium_context.mjs` usando el marcador:

  ```js
  // @agent-snippet javascript Login feliz
  /*
  ```javascript
  await driver.findElement(By.css('#email')).sendKeys(credentials.email);
  await driver.findElement(By.css('#password')).sendKeys(credentials.password);
  await driver.findElement(By.css('button[type="submit"]')).click();
  ```
  */
  ```

  Los fragmentos marcados aparecen como `selenium:login-feliz` dentro del autocompletado. Si no hay anotaciones, se exponen plantillas por defecto (Page Object, test Jest y test PHPUnit).

- **Diagnósticos Deptrac inline**  
  Si `agent/exports/deptrac_layers.json` contiene una propiedad `violations` con objetos `{ file, line, layer, message }`, el editor mostrará advertencias en los archivos afectados.

- **Sonido de finalización del agente**  
  Reutiliza el comando `Agent: Reproducir sonido de finalización` para avisar que la IA terminó y ahora lo dispara automáticamente cada vez que se regeneran los exports (bootstrap, Selenium, Composer, Deptrac o snippets). Por defecto, usa `Glass.aiff` en macOS. Configura `agentToolkit.soundFile` en la configuración del usuario o edita `config.json` dentro de la extensión. El mensaje mostrado se controla con `agentToolkit.soundMessage`.

- **Panel de control en la Activity Bar**  
  Un contenedor dedicado (“Agent”) muestra el estado de los artefactos definidos por el preset, genera botones dinámicos para ejecutar las tareas declaradas (bootstrap, exportadores, scripts propios) y expone accesos rápidos a configuración, contextos, documentación y botones personalizados.

- **Configuración guiada**  
  El comando `Agent: Configurar extensión` abre un panel interactivo para seleccionar el workspace root, elegir/limpiar el preset activo, vincular o limpiar el agente de IA, configurar el sonido y acceder rápidamente a la documentación o al `config.json`.

### Conceptos clave

| Concepto | ¿Qué es? | ¿Qué problema resuelve? | Casos de uso |
| --- | --- | --- | --- |
| **Preset** | Un paquete de configuración y plantilla que describe contextos, tareas, snippets y archivos a observar. | Evita duplicar configuraciones por proyecto y habilita cambiar de stack sin reinstalar la extensión. | Preset “genérico” para proyectos ligeros, preset “Selenium” para apps Laravel con automatizaciones E2E. |
| **Selenium** | Framework para automatizar navegadores. El preset incluye exports (`selenium_test_context.md`) y snippets asociados. | Mantiene documentados los flujos críticos y acelera la escritura de tests de UI. | Exportar selectores tras agregar un nuevo formulario o generar snippets para un bot de QA. |
| **Bootstrap (`./agent/bootstrap.sh`)** | Script maestro que orquesta los exports definidos por el preset (contextos, señales, diagnósticos). | Reúne en un solo comando todas las tareas iniciales; garantiza que los archivos estén sincronizados. | Ejecutarlo antes de arrancar un sprint o tras hacer merge de cambios relevantes. |
| **Composer** | Gestor de dependencias PHP. La extensión lee `agent/exports/composer_deps.json` cuando el preset lo soporta. | Brinda un árbol navegable de paquetes y capas para auditar arquitectura rápidamente. | Identificar quién depende de un paquete vulnerable o mapear capas antes de refactorizar. |
| **Deptrac** | Herramienta de análisis estático que valida reglas de capas en PHP. El preset Selenium la ejecuta y la extensión muestra los diagnósticos. | Detecta violaciones de arquitectura directamente en el editor para actuar sobre el código afectado. | Revisar warnings al mover clases entre módulos o antes de aprobar un PR. |

## Generación de datos

Cada preset define las tareas que aparecen en el panel. Por ejemplo:

```
# Preset genérico
./agent/bootstrap.sh                        # genera agent/exports/project_overview.md

# Preset Selenium
./agent/bootstrap.sh                        # genera los contextos base
node agent/scripts/export_selenium_context.mjs  # refresca recomendaciones Selenium
./agent/scripts/run_deptrac.sh              # produce deptrac_layers.json
```

Cada vez que los archivos cambian, la extensión se actualiza automáticamente gracias a los watchers internos. También puedes lanzar estas tareas desde la pestaña **Agent** sin salir del editor.
Si el proyecto aún no tiene la carpeta `agent/`, arranca usando el botón “Crear estructura agent/” (o el comando `Agent: Crear carpeta agent/`) y luego ejecuta el bootstrap del preset elegido.

### Panel del agente: botones y ejemplos

| Botón | ¿Para qué se usa? | Ejemplo práctico |
| --- | --- | --- |
| `Ejecutar ./agent/bootstrap.sh` | Corre la automatización principal del preset (genera exports, checklists, diagnósticos). | Antes de comenzar un sprint en Laravel/Selenium corre el bootstrap para refrescar `selenium_test_context.md`, rutas y señales. |
| `Exportar contexto Selenium` | Lanza sólo el script de contexto Selenium (snippets y recomendaciones). | Hiciste cambios en Blade o componentes JS y querés actualizar los selectores y snippets sin volver a ejecutar todo el bootstrap. |
| `Ejecutar análisis Deptrac` | Ejecuta `agent/scripts/run_deptrac.sh` para construir `agent/exports/deptrac_layers.json`. | Estás refactorizando módulos y necesitás validar que no rompes las reglas de arquitectura antes de subir el PR. |
| `Crear estructura agent/` | Copia la plantilla del preset seleccionado dentro del workspace (o la fusiona con la existente). | En un proyecto nuevo eliges el preset `genérico` para generar `project_overview.md` y `project-notes.md` en segundos. |
| `Seleccionar preset…` | Abre un picker para cambiar de preset sin editar settings. | Cambias de un proyecto Selenium a un microservicio Node: seleccionas el preset genérico y regenera el panel acorde. |
| `Abrir contextos` | Lanza el quick pick con los archivos clave declarados por el preset. | Necesitas revisar `project_overview.md` antes de responderle a QA; lo abres desde este botón. |
| `Abrir dependencias` | Enfoca el árbol “Agent Composer” y refresca `composer_deps.json` si existe. | Auditoría rápida: buscás qué paquetes tocan la capa “Payments” sin salir del panel. |
| `Editar snippets` | Abre el archivo `agent/scripts/export_selenium_context.mjs` (u otro definido por el preset) para modificar snippets. | Añades un snippet `selenium:reset-password` luego de detectar un nuevo flujo. |
| `Abrir bootstrap` | Abre el script de bootstrap del preset para editar o revisar pasos. | Quieres agregar una tarea adicional (`npm run lint`) al bootstrap genérico. |
| `Configurar extensión…` | Lanza el asistente `Agent: Configurar extensión` con opciones para workspace, preset, sonido, etc. | Cambias temporalmente el workspace root para trabajar sobre un subproyecto. |
| `Ver documentación` | Abre este README en el editor. | Necesitas compartir las instrucciones del panel con otro integrante. |
| `Editar config.json` | Abre el fallback interno `config.json` de la extensión. | Ajustas el sonido por defecto para todos los usuarios del VSIX interno. |
| `Probar sonido` | Ejecuta `Agent: Reproducir sonido de finalización` para validar la notificación. | Antes de dejar corriendo un agente te aseguras de escuchar la alerta configurada. |

#### Botones personalizados

- Abre `Agent: Configurar extensión` y elige **Gestionar botones personalizados…** o pulsa el botón homónimo en el panel.
- Define un nombre, el tipo (script o prompt IA) y el comando asociado:
  - **Script**: apunta a cualquier archivo o comando (`./scripts/deploy.sh`, `npm run lint`). Se ejecuta en la terminal “Agent Toolkit” ubicada en el workspace.
- **Prompt IA**: escribe el prompt y el comando exacto que lo recibirá (por ejemplo `codex generate -m code-1 --prompt "{prompt}"`). Usa `{prompt}` como placeholder para incrustar el texto que captures al crear el botón. Cuando el comando comience con `codex`, la extensión verificará que tengas sesión iniciada antes de ejecutarlo.
- Los botones se guardan en `agent/custom_actions.json` dentro del proyecto, por lo que se versionan o comparten como parte del repo.

**Ejemplos prácticos**

| Nombre del botón | Tipo | Configuración | ¿Qué hace? |
| --- | --- | --- | --- |
| `Deploy staging` | Script | `./scripts/deploy_staging.sh` | Ejecuta tu script de despliegue sin abrir otra terminal. |
| `Generar changelog` | Script | `npm run changelog` | Lanza un comando npm que sintetiza el changelog del release actual. |
| `Codex: resumen sprint` | Prompt IA | Prompt: `Resume el estado del sprint con foco en blockers y dependencias.`<br>Runner: `codex generate -m code-1 --prompt "{prompt}"` | Ejecuta el comando oficial de Codex; la extensión comprueba que tengas sesión (`codex auth login`). |
| `OpenAI GPT-4: QA checklist` | Prompt IA | Prompt: `Genera una checklist de QA para el módulo de pagos basado en agent/exports/project_manifest.json.`<br>Runner: `openai api chat_completions.create -m gpt-4o-mini -g user "{prompt}"` | Usa la CLI de OpenAI para pedirle a GPT‑4 una checklist contextual. |
| `Claude: ideas UX` | Prompt IA | Prompt: `Propón mejoras UX para la pantalla de onboarding descrita en DOCUMENTACION.md.`<br>Runner: `claude --prompt "{prompt}"` | Reutiliza una CLI o script que envía el prompt a Claude y devuelve sugerencias. |

**Notas importantes**

- Los botones personalizados aparecen al principio del panel para que estén siempre visibles.
- Antes de ejecutar un prompt, selecciona tu proveedor desde el botón **Agente IA** (o con `Agent: Configurar agente IA`); el token queda guardado en el llavero seguro de VSCode y se aplica en todos los botones de tipo IA.
- Puedes crear tantos botones como necesites (por ejemplo, ejecutar pruebas de Cypress, disparar workflows de GitHub Actions o pedirle a un agente de IA que genere tests adicionales). Siempre que el comando sea válido en tu terminal, el panel lo integrará como un botón reutilizable.

## Personalización

La forma más rápida es lanzar `Agent: Configurar extensión` (también accesible desde el botón del panel Agent). Si prefieres editar manualmente:

- `agentToolkit.workspaceRoot`: si trabajas en un monorepo con carpetas anidadas, apunta aquí al directorio raíz que contiene `agent`.
- `agentToolkit.soundFile`: ruta absoluta o relativa al archivo de audio deseado (`~` se expande al directorio de usuario). En macOS, dejarlo vacío usa `Glass.aiff`; en Linux/Windows necesitas definirlo.
- `agentToolkit.soundMessage`: texto mostrado junto a la notificación sonora.
- `agentToolkit.preset`: fuerza el preset que debe usar la extensión. Déjalo vacío para que se detecte automáticamente.
- `Agent: Configurar agente IA`: comando adicional (y botón en el panel) para elegir el proveedor y registrar credenciales; se almacenan en el llavero de VSCode y no se versionan en el repo.

## Próximos pasos sugeridos

- Empaquetar versión `.vsix` y publicarla en el marketplace privado/organización.
- Añadir pruebas unitarias con [`@vscode/test-electron`](https://code.visualstudio.com/api/working-with-extensions/testing-extension) para asegurar extractores de snippets y parseo de JSON.
- Extender la vista de dependencias para abrir documentación oficial de cada paquete (enlace a packagist).
