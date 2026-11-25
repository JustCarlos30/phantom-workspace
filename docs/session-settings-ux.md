# Selector de modelos y configuración integrada de sesión

## Cambios
- `SessionChip` (ChatCard y PhantomChat) ya no abre un `details` con popup grande: es un botón (`aria-expanded`) que muestra `SessionSettingsView` en el área principal de la tarjeta, con encabezado y **Volver**.
- La conversación (`.pc-thread`) queda montada pero oculta; el compositor no se desmonta, así que borrador y estado se conservan. Volver o Escape restauran scroll y devuelven el foco a la carpeta. Recibir mensajes no cierra la vista.
- Con la configuración abierta el selector de modelo de la barra se deshabilita para no duplicar diálogos de búsqueda.
- Modelo: `.pc-models` se ancla al ancho de la fila de selectores (sin solapar el botón); el input no se comprime (`flex: 0 0 36px`) y la lista hace scroll (`min-height: 0`).
- Sin cambios de backend, proveedores ni semántica de permisos.

## Pruebas
`test/composer-ux.test.mjs`: dos pruebas nuevas renderizadas (configuración abrir/volver con borrador y mensaje entrante a 320/480, card y dock; catálogo de 120 modelos a 320/480/900) y adaptación de las previas al nuevo flujo.

## Evidencia visual
Las capturas se escriben en `.test-artifacts/composer-*-settings-{before,open}.png` y `composer-*-model-long.png` al ejecutar la prueba. **Pendiente:** no pude ejecutar Chromium en esta sesión, por lo que no hay capturas «antes» del popup anterior ni verificación observada; los checks del controlador deben confirmarlo.
