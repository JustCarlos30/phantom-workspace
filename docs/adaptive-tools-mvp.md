# MVP de herramientas frecuentes por proyecto

Hipótesis a evaluar: mostrar accesos frecuentes en «Herramientas» facilita recuperar las herramientas preferidas. Este MVP no mide ahorro de tiempo ni demuestra causalidad.

## Comportamiento

- «Frecuentes en este proyecto» muestra hasta 3 herramientas disponibles con al menos 2 aperturas exitosas registradas desde esta versión. Orden: recuento, última apertura, id de tipo. No se siembra con nodos existentes.
- Se registra en `onOpenPanel` (`src/App.jsx`) solo tras éxito, una vez: foco de un hub existente o creación completada. El id del workspace se captura al inicio, por lo que un cambio de proyecto durante un `await` no mueve el recuento.
- La apertura desde el atajo cuenta como «desde frecuentes» solo si tuvo éxito.
- Persistencia: `localStorage`, clave `phantom.toolUsage.v1:<workspace.id>`; solo ids de tipo, recuentos, timestamps y preferencias. Sin red, sin LLM, sin contenido.
- Si el storage falla (denegado o inexistente) las herramientas se abren igual; el estado (historial, pausa, ocultaciones) se conserva en memoria durante la sesión por proyecto y el launcher avisa desde la primera apertura que no se guarda en el dispositivo. Un JSON corrupto se sanea a vacío sin aviso.
- Controles dentro del launcher: «No sugerir» (solo oculta de frecuentes), pausar/reanudar aprendizaje, borrar historial (borra contadores, descartes y recuentos; conserva la pausa).
- Al buscar, la sección se oculta, así que no hay resultados duplicados. Catálogo y dock conservan su orden.
- «Preferencias y uso» (plegable) muestra aperturas exitosas registradas, aperturas desde frecuentes y descartes.

## Prueba manual

1. Abrir un proyecto → Herramientas: aparece el estado vacío breve; el detalle muestra 0/0/0.
2. Abrir una herramienta (p. ej. Nota) dos veces desde el launcher o atajos; reabrir Herramientas: aparece en frecuentes.
3. Abrirla desde frecuentes: «Desde frecuentes» sube en 1. Provocar un fallo de creación: no sube nada.
4. «No sugerir» desaparece de frecuentes pero sigue en el catálogo; recargar y comprobar que sigue oculta; el descarte suma 1.
5. «Pausar aprendizaje»: abrir herramientas no cambia los totales; «Reanudar» vuelve a contar.
6. «Borrar historial»: contadores, descartes y frecuentes a 0; la pausa se conserva.
7. Cambiar de proyecto: sus frecuentes son independientes.
8. Escribir en la búsqueda: no hay sección frecuentes ni duplicados.
9. Con storage denegado o inexistente: el launcher abre herramientas, conserva preferencias en memoria y avisa discretamente. Con JSON corrupto: se sanea sin aviso.

Pruebas de lógica: `npm test` (`src/hooks/tool-usage.test.mjs`). Story: «Navegación/Herramientas frecuentes» (datos ficticios solo en la story). La revisión visual manual no está acreditada por este documento.

## Limitaciones

- Local por dispositivo; no se sincroniza.
- Solo cuentan acciones que pasan por `onOpenPanel`.
- No se infiere desinterés por no uso.
