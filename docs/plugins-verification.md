# Verificación desktop de plugins

## Ejecución declarada

```sh
npm ci
npm run build
node test/plugins-desktop.mjs
```

Requiere Node compatible con el proyecto, Electron/Playwright y la CLI real en
`~/.local/lib/node_modules/phantom-harness/bin/phantom.mjs`. Usa Electron con
`--ozone-platform=headless`, siguiendo `test/terminal-scroll-smoke.mjs`.
`PHANTOM_TEST_EXECUTABLE` permite seleccionar un ejecutable empaquetado.
La ausencia de la CLI hace fallar esta aceptación; no se sustituye por un mock.

## Cobertura del script

- Centro abierto desde la paleta: activación, preferencias guardadas y conexión
  real; CLI inexistente, indisponibilidad visible y recuperación mediante edición.
- Card creada con formulario, scope y check Node de fixture; búsqueda, detalle,
  tablero y reemplazo confirmado. Inspección nativa del contrato original intacto
  y del nuevo objeto. No se pulsa Ejecutar ni se inicia un modelo.
- Skill con instrucciones, acción y recurso: publicación, búsqueda, referencia
  SHA256, nueva versión e historial; lectura de la revisión original para comprobar
  su conservación. Apertura de referencia exacta como panel del canvas.
- Desactivación/reactivación, reload y conservación de paneles, datos de referencia
  y preferencias; segundo proyecto Git independiente con preferencias iniciales
  propias y catálogos nativos vacíos aun compartiendo el directorio de datos.
- Terminal real: escritura antes y después de visitar una herramienta, recuperación
  del foco xterm y conservación de la misma sesión PTY.
- Errores de página y mensajes de consola warning/error inesperados fallan el test.

Los flujos se operan mediante `click`, `fill`, selección y teclado sobre controles
reales. `invoke` se reserva para abrir proyectos de fixture e inspeccionar estado
y resultados. Las esperas comprueban estado/ARIA o resultados observados, con
polling corto y plazo acotado. `PASS` se imprime solo al completar las assertions.

## Aislamiento, limpieza y capturas

Cada ejecución crea `/tmp/opencode/phantom-plugins-desktop-*`, con
`WorkspaceHome` (`PHANTOM_WORKSPACE_HOME`), `PhantomData` externo a los dos
proyectos y archivos sintéticos sin datos personales. Git se inicializa con argv
directo y `shell:false`; la CLI administra exclusivamente los datos temporales
configurados antes de abrir las superficies nativas. El check fixture se declara
en la Card, no se ejecuta al guardarla.

`finally` cierra Electron, detiene únicamente el host cuyo cmdline contiene el
home temporal propio y borra el árbol temporal. Las capturas permanecen fuera
del repositorio:

- `/tmp/opencode/phantom-plugins-desktop.png` — 1440 × 960.
- `/tmp/opencode/phantom-plugins-narrow.png` — 1100 × 760.
- `/tmp/opencode/phantom-plugins-cards.png`.
- `/tmp/opencode/phantom-plugins-skills.png`.

## Estado de verificación

Checks declarados para el controlador: dependencias, build y desktop. Este
documento describe la cobertura implementada; no acredita una ejecución ni
resultados antes de recibir el feedback del controlador. Un fallo de producción
debe repararse en su componente propietario, conservando las assertions de esta
aceptación.

### Feedback del controlador · intento 1

El check desktop falló al guardar la primera Card mediante el formulario real:
`Host: Campo de contrato desconocido: deps`. El flujo no llegó a las assertions
posteriores. Esto requiere una reparación de producción fuera del alcance de
estos dos archivos; el test conserva el formulario y sus assertions.

La limpieza también intentó consultar `app.process()` después de cerrar el
dispatcher de Playwright y ocultó el error inicial. Se ha corregido guardando la
referencia al proceso justo después del lanzamiento; esta reparación aún requiere
el siguiente check del controlador.
