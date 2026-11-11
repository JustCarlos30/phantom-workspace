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

## Cierre verificado

Según el cierre observado comunicado por Phantom, la task
`task_de22a40a-b922-4b96-9897-c7949c0af0c4`, run
`run_651995e7-5741-4ea4-a7c9-08c996c9c635`, pasó suite, build,
desktop-plugin-flows y auditoría (`mechanical-audit-recorded`). El detector
reportó `[]`. La revisión independiente concluyó **SHIP**, con P1/P2 resueltos.
Los pendientes de los intentos previos se conservan abajo como histórico y no
representan bloqueos vigentes de este cierre.

Los tests nativos utilizan CLI real y datos temporales; **no ejecutan runs de
modelos**. El cierre no acredita ejecuciones de modelos. Las assertions desktop
existentes se conservan. No se ejecutaron checks desde este pase documental.

### Histórico de implementación y revisión

Según el resultado observado comunicado por Phantom, el run
`run_2404d1ef-a373-4050-b1f6-1211d05e270b` de la task
`task_2e3beea7-4792-4f38-8626-11656d029a56` publicó en este worktree y pasó
suite, build, desktop-plugin, scroll y canvas. Este cierre de la implementación
previa no acreditaba todavía los ajustes de la revisión independiente.

Fixes incorporados para la revisión: acciones basadas en tarea `blocked` y último run nativo,
reconciliación y cadenas fallidas de verificación; recuperación solo de runs
`running`/`recovering`; exclusión de acciones con controlador propio vivo;
origen de consulta Phantom con revisión desconocida cuando no se declara;
bloqueo con fuente/controladores no disponibles o con error. Se conserva el
requisito de modelo explícito/configurado. Los unit tests cubren semántica y
cadenas reales; desktop añade origen y Ejecutar deshabilitado sin modelo.

**Pendientes históricos, resueltos en el cierre indicado arriba:** suite, build,
desktop-plugin-flows y mechanical-audit-recorded. En aquel pase de edición no se
ejecutaron checks y aún no había resultado nuevo de auditoría. La auditoría
guarda su salida en `node_modules/.plugin-detector-report.json`: exit 1 registra
findings, no una aprobación visual. El resultado posterior comunicado fue `[]`.

### Comparación con DESIGN.md y la superficie existente

`src/plugins.css` reutiliza `--surface`, `--surface-2`, `--ink`, `--line` y
`--accent`: mantiene el estudio dark y planos de trabajo opacos descritos en
`DESIGN.md`. Usa system-ui 13px/1.5, encabezados compactos, labels 12px,
campos de 34px y botones de 32px; continúa las primitivas de herramientas,
sin introducir tipografía display. El scroll pertenece a `.plugin-surface`,
al tablero horizontal y a bloques de datos acotados, no al documento.
Loading, vacío, unavailable y error conservan mensajes distintos mediante
`ResourceState`/`ErrorNotice`, con reintento y procedencia visible.
Los paneles siguen dentro del canvas y sus límites de ownership: Phantom
posee Cards/Skills y estado de runs, la app posee nodos/preferencias/refs;
los controles no capturan teclas del terminal. El flujo desktop existente
comprueba foco xterm y conservación de PTY. Esta comparación es de código y
contrato visual existente, no una nueva inspección de capturas ni aprobación
del detector; no modifica DESIGN.md ni la estética global.

### Histórico: feedback del controlador · intento 1

El check desktop falló al guardar la primera Card mediante el formulario real:
`Host: Campo de contrato desconocido: deps`. El flujo no llegó a las assertions
posteriores. Esto requería una reparación de producción fuera del alcance de
aquella edición; el test conservó el formulario y sus assertions.

La limpieza también intentó consultar `app.process()` después de cerrar el
dispatcher de Playwright y ocultó el error inicial. Se ha corregido guardando la
referencia al proceso justo después del lanzamiento; en ese momento la reparación
quedaba pendiente del siguiente check del controlador.

### Histórico: recuperación del intento anterior

El mandato del controlador informa que la fuente recuperada de
`child-integrate-repair` ya pasó suite, build, flujos desktop nativos completos de
Cards y Skills y scroll. Incluye la corrección de `deps`/`dependencies`.
Estos resultados corresponden al intento anterior, no a una ejecución nueva en
este workspace.

El fallo pendiente informado entonces era `Target page/context/browser closed` en
`test/canvas-controls.mjs`, línea 65, después del arrastre con herramienta de mano,
sin errores del renderer registrados. Se alinea su fixture con los otros smokes:
Electron headless, `PHANTOM_NODE_BINARY` explícito y referencia al proceso guardada
antes del cierre para diagnóstico y limpieza. Se conservan las assertions del
canvas. La verificación de esta recuperación quedaba pendiente del controlador
en aquel intento.

### Histórico: feedback del controlador · recuperación, reparación 1

`canvas-regression` completó las ocho comprobaciones e imprimió
`{"passed":true}`, sin stderr, pero el proceso excedió 120 segundos y recibió
`SIGKILL`. El check conjunto no pasó: el bloqueo observado ocurre después de las
assertions, durante el cierre. Se sustituye el cierre sin plazo por el patrón del
smoke de plugins: shutdown del host propio, cierre de Electron acotado y
terminación del proceso guardado si sigue vivo. Se comprueba el home temporal en
el cmdline antes de detener el host. En aquel intento quedó pendiente una nueva
ejecución del controlador; este registro se conserva como antecedente del cierre.
