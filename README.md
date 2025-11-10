# Agent Context Toolkit

Una sola extensión para que tu equipo, tus agentes IA y tu editor hablen el mismo idioma. Agent Context Toolkit evita el caos típico de “¿qué debo correr?”, mantiene a Cursor/VSCode al tanto del estado real del proyecto y celebra cada tarea terminada con un sonido claro de éxito.

## Problemas que elimina

- **Integraciones lentas.** Instalar el kit en un workspace nuevo pasa de varias horas a un par de comandos.
- **Contexto escondido.** Rutas, dependencias y notas viven en un panel siempre visible en el editor.
- **Pruebas olvidadas.** Los módulos Selenium quedan listados, con su último estado y con un runner listo para reejecutarlos.
- **IA sin brújula.** Los agentes (Codex, etc.) reciben instrucciones claras y saben qué comando disparar al final para confirmar que todo quedó listo.

## Cómo lo logra (sin lenguaje técnico)

- Detecta si tu proyecto ya tiene la carpeta `agent/`. Si no está, te guía para crearla y prepararla.
- Ordena cada parte del contexto (overview, dependencias, snippets, diagnósticos) en tarjetas simples dentro de la barra lateral.
- Muestra botones para tareas comunes (instalar, reinstalar, limpiar, lanzar Selenium, abrir documentación) y permite agregar botones propios.
- Te recuerda qué preset usas, qué archivos faltan y si el sonido final está configurado.

---

## Instalación y empaquetado

1. **Instala dependencias**
   ```bash
   npm install
   ```
2. **Empaqueta la extensión**
   ```bash
   npm run package
   ```
   Obtendrás un archivo `agent-context-toolkit-*.vsix`.
3. **Instala el `.vsix` en Cursor/VSCode**
   - Usa “Extensions → … → Install from VSIX…” o “Developer: Install Extension from Location…”.
4. **Añade la extensión al editor**
   - Verás el ícono **Agent** en la barra lateral. Desde allí se abre el panel webview, “Agent Contextos” y “Agent Composer”.

### Requisitos previos sencillos

- Node.js 18 o superior (para empaquetar).
- `vsce` viene como dependencia (`npm install` ya la incluye).
- Acceso a `code` o `cursor` en la terminal (Command Palette → “Shell Command: Install ‘code’ command in PATH”) para poder ejecutar comandos del editor desde la consola.

---

## Uso diario (todo desde la consola)

> Los agentes IA integrados a Cursor no pueden hacer clic. Por eso cada acción importante tiene su comando equivalente.

1. **Instalar o reinstalar el kit**
   ```bash
   ./agent/bootstrap.sh
   ```
   (La extensión puede generar la carpeta `agent/` usando los presets incluidos; luego corre este comando para poblarla.)
2. **Exportar contexto Selenium**
   ```bash
   node agent/scripts/export_selenium_context.mjs
   ```
3. **Ejecutar análisis Deptrac**
   ```bash
   ./agent/scripts/run_deptrac.sh
   ```
4. **Lanzar módulos Selenium**
   ```bash
   ./agent/scripts/run_selenium_tests.sh --modules checkout,payments
   ```
5. **Reproducir el sonido de “tarea terminada”**
   ```bash
   node ./play_done_sound.js
   ```
   (El script detecta tu sistema operativo, usa el sonido predeterminado y muestra el mensaje “🔔 El agente terminó su tarea”.)

El panel de la extensión reflejará el resultado de cada comando: estados actualizados, módulos con su último run y mensajes de sonido personalizados.

---

## Casos reales y ejemplos prácticos

| Situación | Comandos clave | Resultado visible en el panel |
| --- | --- | --- |
| Configurar un workspace nuevo | `./agent/bootstrap.sh` → `node agent/scripts/export_selenium_context.mjs` → `./agent/scripts/run_deptrac.sh` | Tarjetas en verde (instalado), contextos listos y diagnósticos frescos. |
| Ejecutar pruebas E2E en lote | `./agent/scripts/run_selenium_tests.sh --modules login,checkout` | Lista Selenium actualizada con `lastStatus`, `lastRun` y mensajes por módulo. |
| Resetear antes de cambiar de stack | `rm -rf agent` → `node ./play_done_sound.js` (tras reinstalar) | Panel vuelve a mostrar “Instalar Agent Kit” y guía el nuevo preset. |
| Mantener notas del equipo | Edita `agent/notes/AGENT_NOTES.md` → `node ./play_done_sound.js` | El panel muestra las notas actualizadas y la IA tiene memoria compartida. |

---

## Prompts sugeridos para agentes IA (con paso final de sonido)

> Estos prompts están pensados para Codex u otros agentes que viven dentro de Cursor. Recuerda que **todo se ejecuta desde la consola** y que el último paso siempre es ejecutar `node ./play_done_sound.js`.

### 1. Crear una feature

```
Objetivo: Crear la feature <NOMBRE>.
Pasos:
1. Verifica si existe la carpeta agent/. Si falta, usa los presets de la extensión y luego corre ./agent/bootstrap.sh.
2. Analiza los exports clave (agent/exports/*.json) para entender dependencias y rutas relacionadas.
3. Implementa la feature en los archivos necesarios y actualiza las notas en agent/notes/AGENT_NOTES.md.
4. Ejecuta pruebas relacionadas (por ejemplo ./agent/scripts/run_selenium_tests.sh --modules <lista>).
5. Resume los cambios en consola.
6. Ejecuta al final: node ./play_done_sound.js.
```

### 2. Modificar una feature existente

```
Objetivo: Ajustar la feature <NOMBRE>.
Pasos:
1. Corre node agent/scripts/export_selenium_context.mjs para refrescar contexto y detectar módulos afectados.
2. Inspecciona agent/exports/selenium_modules.json y actualiza los módulos impactados (testPath, tags, etc.).
3. Realiza las modificaciones solicitadas en código y documenta cualquier decisión en agent/notes/AGENT_NOTES.md.
4. Ejecuta ./agent/scripts/run_selenium_tests.sh --modules <afectados> y comparte el resultado.
5. Si cambiaste dependencias, vuelve a correr ./agent/bootstrap.sh para regenerar exports.
6. Al terminar, ejecuta: node ./play_done_sound.js.
```

### 3. Resolver un bug

```
Objetivo: Corregir el bug <DESCRIPCIÓN>.
Pasos:
1. Reproduce el bug con ./agent/scripts/run_selenium_tests.sh --modules <relacionados> o con el comando descrito en agent/exports/selenium_modules.json.
2. Inspecciona los exports relevantes (por ejemplo routes.json, env_meta.json, fe_routes.json) para ubicar la causa.
3. Aplica la corrección en el código y actualiza cualquier snippet o nota que ayude a evitar regresiones.
4. Vuelve a correr los módulos Selenium afectados para confirmar el fix.
5. Genera un resumen del origen del bug, la solución aplicada y los archivos tocados.
6. Finaliza ejecutando: node ./play_done_sound.js.
```

### 4. Crear commits descriptivos por módulo (GitFlow)

```
Objetivo: Registrar cambios siguiendo GitFlow con commits claros por módulo.
Pasos:
1. Ejecuta git status y agrupa los archivos modificados según el módulo o componente (ej. checkout, payments, auth).
2. Para cada módulo:
   a. Revisa los diffs con git diff <archivos-del-módulo>.
   b. Redacta un mensaje usando el formato gitflow: <tipo>(<módulo>): descripción breve.
      - Ejemplos de tipo: feat, fix, refactor, chore, docs.
   c. Crea el commit: git commit -m "feat(checkout): valida totales antes de pagar".
3. Cuando todos los módulos estén listos, muestra el resumen con git log -1 --stat y compártelo en consola.
4. Si necesitas push, usa git push origin <rama> (respetando la convención gitflow: develop, release/x, hotfix/x).
5. Cierra el flujo ejecutando: node ./play_done_sound.js.
```

Con estos prompts, los agentes IA tienen una hoja de ruta clara, se apoyan en los exports del kit y siempre anuncian que terminaron la tarea.

---

## Consejos finales

- Mantén `node ./play_done_sound.js` a mano: es la señal oficial de que cualquier flujo terminó bien.
- Si trabajas en un entorno sin interfaz gráfica, instala la extensión igual; el panel se actualizará aunque los comandos se disparen desde la terminal.
- Versiona la carpeta `agent/` (o al menos `config.yaml`, `system_prompt.md`, `notes/`) para que el contexto viaje con tu repo.
- Cuando compartas el `.vsix`, acompáñalo con estos prompts para que otros equipos repliquen la misma dinámica.
