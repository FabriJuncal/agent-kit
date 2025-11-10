# Selenium: Contexto Automatizado para el Agente

Este repositorio incorpora un flujo de _bootstrap_ que genera un mapa específico para planificar pruebas end-to-end con Selenium.

## ¿Qué se genera?

Al ejecutar `./agent/bootstrap.sh` ahora se crea `agent/exports/selenium_test_context.md`, el cual incluye:

- Listado de controladores y rutas web relevantes.
- Formularios detectados en Blade, con sus campos, botones y componentes reutilizables (`component-remote-select`, etc).
- Checklists de escenarios sugeridos (happy path, validaciones, búsquedas, edge cases).
- Selectores CSS recomendados para automatizar cada formulario.
- Guía de estilo para escribir tests Selenium (Python + pytest, patrón Page Object).
- Sección abierta para documentar casos adicionales conforme aparezcan nuevos flujos.

Este archivo se añade automáticamente a `agent/config.yaml` como _seed_, de modo que cualquier agente que tome el relevo tenga el contexto listo.

## Expectativas para la IA

1. Revisar `selenium_test_context.md` antes de generar pruebas.
2. Completar/adaptar la checklist con nuevas variantes cuando se detecten.
3. Producir código Selenium ordenado, usando Page Objects, fixtures parametrizables y asserts claros.
4. Cubrir tantos casos de uso como sea viable (requeridos, límites, errores).

### Código base sugerido

```python
# tests/selenium/pages/nueva_autorizacion_page.py
class NuevaAutorizacionPage:
    def __init__(self, driver):
        self.driver = driver
        self.form = driver.find_element(By.CSS_SELECTOR, "form#form-nueva-autorizacion")

    def set_prestador(self, texto):
        select = Select(self.driver.find_element(By.ID, "prestador"))
        select.select_by_visible_text(texto)

    # ... más acciones

# tests/selenium/test_nueva_autorizacion.py
def test_flujo_feliz(driver, datos):
    page = NuevaAutorizacionPage(driver)
    page.set_prestador(datos["prestador"])
    # ...
    page.submit()
    assert page.toast_ok()
```

El flujo exacto lo determinará la IA al combinar los exports con el análisis del repositorio.

## Próximos pasos

- Añadir nuevos Page Objects o fixtures al ritmo que crezca la aplicación.
- Documentar en esta guía cualquier convención adicional (nombres de data-test-id, políticas de limpieza, etc.).
- Registrar un resumen de cada cambio significativo en `agent/notes/AGENT_NOTES.md` para que la memoria corta del agente no tenga que repetir este contenido.
- Revisar periódicamente que los campos descritos coincidan con el estado real de la UI tras cada release.
