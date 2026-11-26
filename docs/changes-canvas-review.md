# Revisión de cambios en el canvas

## Interfaz compartida

`ChangesCanvasContext` define el contrato propiedad del canvas: `host` es la capa dentro de `canvas-world`; `expandedHost` vive en `canvas-stage`, fuera de la transformación. `activeId` y `expandedId` identifican el acompañante abierto y ampliado, y `placement` expresa `{left, top, width, height}` en coordenadas mundo. `open(nodeId)` abre y reencuadra una sola vez guardando cámara anterior; `close(nodeId)` limpia; `expand(nodeId)` conserva el encuadre; `restore(nodeId)` recupera exactamente el encuadre y panel previos. Solo hay un acompañante activo por canvas. Ninguna operación envía mensajes a agentes.

El consumidor monta un portal absoluto en `host` para el nodo activo, o en `expandedHost` al ampliarlo; fuera del canvas ofrece una vista alternativa legible. Conserva selección y scroll entre modos. La ubicación lateral mantiene el fallback existente de `placePanel`.

## Antes

El modelo de touched files agrupaba y resumía archivos, y clasificaba las líneas del diff sin coordenadas. La colocación lateral ya contemplaba derecha, izquierda y superposición acotada al viewport.

## Propuesta

Cada línea del diff mantiene `kind` y `text` y añade `oldLine`, `newLine` y `hunkIndex` para navegación. Adiciones no inventan número anterior y eliminaciones no inventan número nuevo; metadatos y cabeceras de hunk mantienen la clasificación existente. La comparación de listas incluye `originalPath`, relevante para renombres.

La revisión visual prevista presenta el diff en un panel acompañante del canvas, con expansión en una capa no transformada y restauración del estado previo. El contexto compartido documenta ese límite de propiedad; la interfaz del acompañante pertenece a la integración visual.

## Pasos de verificación

El check de aceptación declarado ejecuta `node --test test/touched-files.test.mjs`. El job `changes-review-test` ejecuta además las pruebas de panel y canvas, sin red y conservando los demás servicios Compose.

## Pendientes y límites

Este cambio implementa el contrato compartido y los metadatos del modelo; no implementa ni acredita la UI del acompañante en canvas. Las pruebas de interfaz nombradas por el job están previstas para su integración y no se afirma aquí que existan o hayan sido ejecutadas. No se usaron capturas sintéticas como prueba de datos reales.
