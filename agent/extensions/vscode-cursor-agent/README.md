# Agent Context Toolkit

Extensión ligera para VSCode y Cursor que expone los artefactos generados por los scripts del repositorio `agent-kit`. Está pensada para que cualquier agente humano o automático cuente con el contexto Selenium, dependencias y reglas de arquitectura sin abandonar el editor.

## Instalación rápida

1. En la carpeta `agent/extensions/vscode-cursor-agent`, ejecuta `npm install` (instala `@vscode/vsce` localmente).
2. Empaqueta la extensión con `npm run package` (genera `agent-context-toolkit-*.vsix`) o usa `Developer: Install Extension from Location...` en VSCode/ Cursor apuntando a este directorio.
3. Abre Cursor/VSCode y haz clic en el nuevo icono **Agent** de la barra lateral; desde allí accedes al panel interactivo, además de los árboles `Agent Contextos` y `Agent Composer`. Los comandos también están disponibles desde la paleta (`Ctrl/Cmd + Shift + P`).

## Funcionalidades incluidas

- **Presets multi-stack**  
  Trae de serie un preset genérico (overview + notas) y otro orientado a Selenium/Laravel. Puedes seleccionar el preset desde el panel o el comando `Agent: Configurar extensión`, y cada uno aporta sus propios contextos, tareas y snippets.

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
  Un contenedor dedicado (“Agent”) muestra el estado de los artefactos definidos por el preset, genera botones dinámicos para ejecutar las tareas declaradas (bootstrap, exportadores, scripts propios) y expone accesos rápidos a configuración, contextos y documentación.

- **Configuración guiada**  
  El comando `Agent: Configurar extensión` abre un panel interactivo para seleccionar el workspace root, elegir/limpiar el preset activo, configurar el sonido y acceder rápidamente a la documentación o al `config.json`.

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

## Personalización

La forma más rápida es lanzar `Agent: Configurar extensión` (también accesible desde el botón del panel Agent). Si prefieres editar manualmente:

- `agentToolkit.workspaceRoot`: si trabajas en un monorepo con carpetas anidadas, apunta aquí al directorio raíz que contiene `agent`.
- `agentToolkit.soundFile`: ruta absoluta o relativa al archivo de audio deseado (`~` se expande al directorio de usuario). En macOS, dejarlo vacío usa `Glass.aiff`; en Linux/Windows necesitas definirlo.
- `agentToolkit.soundMessage`: texto mostrado junto a la notificación sonora.
- `agentToolkit.preset`: fuerza el preset que debe usar la extensión. Déjalo vacío para que se detecte automáticamente.

## Próximos pasos sugeridos

- Empaquetar versión `.vsix` y publicarla en el marketplace privado/organización.
- Añadir pruebas unitarias con [`@vscode/test-electron`](https://code.visualstudio.com/api/working-with-extensions/testing-extension) para asegurar extractores de snippets y parseo de JSON.
- Extender la vista de dependencias para abrir documentación oficial de cada paquete (enlace a packagist).
