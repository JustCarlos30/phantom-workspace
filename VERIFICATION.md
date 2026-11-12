# Verificación de entrega — 0.1.0

## Revisión audiovisual — checks del run controlado

Implementación y pruebas añadidas para revisión normalizada de imagen/video, identidad SHA-256 inmutable, versiones enlazadas, brief persistido y reintento explícito. No se ejecutaron checks desde el ejecutor; Phantom controla su ejecución y cierre. Las verificaciones históricas inferiores no acreditan esta entrega.

- `review-tests`: `node --test test/references.test.mjs test/canvas-cli.test.mjs test/video-review.test.mjs`. Cubre geometría con zoom y bandas, FPS/frame, validación, captura persistida, aislamiento de proyectos/versiones, fallo de guardado, deduplicación de altas/respuestas, reintento concurrente y recuperación de acuse incierto tras reinicio; integra CLI y host.
- `production-build`: `npm run build`.
- `review-interaction`: `node test/video-review-desktop.mjs`. Electron de producción y host reales, perfil temporal, WebM VP8 sintético de 24 FPS/2 s generado con WebCodecs y muxado con duración explícita. Recorre pausa/paso de frame, rectángulo fuera del chrome/bandas, alcance y fuente, fallo real de escritura con conservación de borrador, cola llena con proveedor local inerte, reintento sin duplicados, importación/comparación de render, aislamiento/recarga e imagen anotable. Escritorio 1520×980 y compacto 1100×760. El único diálogo sustituido es el selector de archivo; no se simula el bridge ni se usan proveedores comerciales.
- Evidencia prevista exclusivamente en `/tmp/opencode/video-review-*`: capturas de fallo/desktop/compacto, `checks.json` o `failure.json`, y `detector.json`. El fixture invoca el detector una vez al finalizar mediante argv sin shell; `PHANTOM_IMPECCABLE_BIN` permite al controlador indicar su launcher. Los hallazgos del detector no equivalen a revisión visual aprobada.

Límites explícitos: FPS declarados/rejilla nominal, compatibilidad del decoder, captura PNG condicionada al origen y tamaño; comparación sin sincronización automática; sin detección semántica, tracking ni modificación de fuente acreditada. Persistir un handoff en cola no acredita que el proveedor haya completado la petición. Solo el usuario decide resolver.

## Integración local de todos los worktrees — 2026-11-11

Rama `integrate/all-2026-11-11`. Se preservaron 62 worktrees (incluidos borradores sin commit) en `preserve/2026-11-11/source-*` y un bundle externo. Todas las instantáneas son antecesoras de la rama integrada; `master` conserva `3a8f4f4`. El inventario y las decisiones de precedencia están en [integration-sources.json](docs/integration-sources.json). Las implementaciones anteriores se conservan como historia recuperable; las versiones funcionales actuales se combinan en el árbol final.

Incluye plataforma nativa de plugins/Cards/Skills, centro de mando, identidad/reportes/políticas de agentes, navegador/automatización, actividad, lectura y resumen de conversaciones, controles del lienzo, voz, preparación cancelable de dependencias y Gengar. Las APIs de preferencias comparten estado y conservan configuración e intervalo al actualizarse entre sí.

Validación realizada en el worktree integrado:

- `npm run build`: correcto; aviso de tamaño del bundle.
- Suite: 171 pruebas pasan, 3 opcionales omitidas, cero fallos.
- Seis recorridos adicionales pasan: `conversation-windows.mjs`, `plugins-desktop.mjs`, `activity-desktop.mjs`, `agent-browser-desktop.mjs`, `canvas-controls.mjs`, `command-center-desktop.mjs`.
- Los recorridos usan perfiles y catálogos sintéticos, PTY/IPC/Electron o Chromium reales según el check. No ejecutan modelos comerciales ni modifican el perfil personal.
- `git diff --check`: correcto. Los worktrees fuente conservaron exactamente sus árboles durante la integración.

Evidencia de escritorio: `/tmp/opencode/conversation-windows-7XCtiv`, `/tmp/opencode/activity-desktop-w6mx1F`, `/tmp/opencode/phantom-canvas-222XQO`, `/tmp/opencode/phantom-command-center-review`. Las secciones siguientes documentan la entrega anterior; no acreditan un nuevo paquete distribuible de esta integración.

**0.1 usable, implementada y empaquetada para Linux x64; validación personal pendiente.** Evidencia revisada el 2026-11-11. No equivale a fiabilidad de producción demostrada durante varias jornadas.

## Paquete y arranque

Desde `/home/carlosj/Carlos_World/phantom-workspace`:

```sh
./launch.sh
# O directamente:
"./out/Phantom Workspace-linux-x64/phantom-workspace"
```

`launch.sh` es ejecutable; también existe `Phantom Workspace.desktop` en esta raíz. Uso y datos: [README](README.md). [BUILD.json](out/Phantom%20Workspace-linux-x64/BUILD.json): versión **0.1.0**, `builtAt: 2026-11-11T08:12:00.320Z`, Electron **45.3.0**, Node del host **v26.11.1**, Phantom **0.5.0**, `linux-x64`. Electron informa su Node interno **24.22.2**; es distinto del runtime independiente del daemon. El paquete incluye Node, código Phantom y Chromium completo para Playwright. Git, Docker, shells y otros binarios requieren las herramientas instaladas en el host; Python es necesario para playgrounds Python y para preparar voz en otro perfil.

Estado predeterminado: `${XDG_STATE_HOME:-~/.local/state}/phantom-workspace`; `PHANTOM_WORKSPACE_HOME` aísla un perfil. Los datos de la app quedan fuera del proyecto abierto; la raíz de código no es su almacén de appdata. Phantom conserva su propio almacén canónico.

## Comandos reproducibles

Con dependencias y display disponibles, ejecutar en la raíz de la app:

```sh
PHANTOM_DESKTOP_SPIKE=1 PHANTOM_TEST_LOCAL_VOICE=1 npm test
npm run package
PHANTOM_TEST_EXECUTABLE="$PWD/out/Phantom Workspace-linux-x64/phantom-workspace" npm run test:desktop
```

El test de voz real es opt-in y requiere el motor preparado (`npm run setup:voice`, mediante `scripts/setup-voice.mjs`). Desktop usa proyectos y perfiles sintéticos en `/tmp/opencode`; no precisa un proyecto personal. Las instrucciones de instalación están en el README.

## Resultados observados y orden de ejecución

### Cambio actual: navegador integrado por defecto

La evidencia histórica de la tabla siguiente corresponde al paquete anterior, cuyo modo de automatización abría Chromium separado. No acredita esta nueva ruta integrada ni un paquete reconstruido con ella. Los resultados de los checks actuales los publica el controlador Phantom.

Checks declarados para este cambio, desde la raíz:

```sh
npm ci --no-audit --no-fund
node --test test/automation.test.mjs
npm test
npm run build
```

`test/automation.test.mjs` cubre el contrato integrado por transporte inyectado: elección predeterminada, secuencia preview/fill/click/open, clave compartida, copia durable de capturas, consola, ausencia de lanzamiento Chromium, trace no soportado, Stop con RPC pendiente, keepOpen, timeout y error sin desktop. Las capturas de ese contrato son bytes sintéticos; no prueban renderizado Electron. La prueba Playwright real elige `mode:"isolated"` explícitamente y conserva PNG/ZIP/visor y parada; si falta el ejecutable Chromium comprueba el error accionable y declara skip.

Para comprobar el puente visible real (requiere display):

```sh
node test/agent-browser-desktop.mjs
```

Ese harness prueba Electron y el CLI sobre una fixture HTTP y perfiles propios; no sustituye el contrato de `automation.start`. Para la comprobación manual conjunta: abrir Phantom, activar un proyecto, crear una terminal nueva y ejecutar `node "$PHANTOM_BROWSER_CLI" context`, después `node "$PHANTOM_BROWSER_CLI" preview http://127.0.0.1:5173/ --timeout-ms 15000` con el servidor de ese proyecto activo. Consultar `node "$PHANTOM_BROWSER_CLI" status` y `node "$PHANTOM_BROWSER_CLI" read`; llamar a `automation.start` con el payload integrado del README, usando el mismo workspace/session y clave `preview`. Comprobar que `panelId` coincide con el ID del status, que el DOM visible refleja fill/click, que list/captura/log corresponden al run y que Stop libera `owned` conservando el panel. Repetir con desktop cerrado: debe fallar sin abrir navegador externo. El modo integrado no produce trace; el aislado sí. No hay resultados observados de esta comprobación manual en esta actualización.

Readiness de preview/open usa la primitiva HTTP compartible del puente, sin un segundo sondeo en automation. Servicios conserva su HEAD diagnóstico opcional: no inicia navegación ni espera readiness. La consola integrada es una instantánea retenida, no streaming; no hay auto-wait Playwright, cierre del panel o cancelación de RPC en vuelo (Stop/timeout drenan hasta el límite de transporte de 75 s). No se ha establecido causalidad respecto a Firefox.

| Evidencia | Resultado | Alcance |
|---|---|---|
| Suite completa comunicada por el coordinador, con ambas variables opt-in, después de los fixes de foco y preferencia de shell | **87 passed / 0 failed / 0 skipped** | 59 backend/nativo/ASR + 28 estado renderer; incluye nueva regresión con PTY real de precedencia de shell. |
| Rebuild de ambos fixes y E2E real del paquete final | **34 passed / 0 failed** | [Ledger vigente](.impeccable/review/desktop-checks.final.json), `2026-11-11T08:13:17.891Z`–`08:13:46.704Z`, fixture `phantom-packaged-e2e-yKqZ9s`. |
| Revisión visual comunicada por el coordinador | Cinco imágenes actuales validadas | RC01 resuelto mediante recapturas válidas; SHIP del reviewer limitado al score FR01/02/03, sin aprobación general de toda la UI. |

Orden final: fixes de foco (`useLayoutEffect`) y preferencia de shell → suite completa 87/0/0 → paquete reconstruido → E2E completo 34/0. `terminal.create` sin shell explícito respeta `settings.shell`; el shell explícito por sesión tiene precedencia. Se persisten shell real y cwd inicial (campo `cwd` del descriptor, no cwd actual inferido). La regresión `configured shell is used for new sessions and explicit per-session shell takes precedence` en `test/host-pty.test.mjs` verifica PTY real y metadata persistida de shell.

Dos ajustes de sincronización del harness evitan falsos negativos: el ACK nativo de cierre puede cerrar CDP antes del resultado de evaluate, por lo que se comprueban cierre real, persistencia y daemon; Trace Viewer hidrata después de load y se espera su UI real. Intentos fallidos anteriores se conservan como historia, no bugs abiertos de la app. Esta sincronización documental no reejecuta tests ni reconstruye el paquete.

### Qué acredita el E2E vigente

- Arranque normal del ejecutable empaquetado, sin flag de sandbox añadido a la app; renderer desde `dist`, daemon con Node propio, CLI Phantom y Chromium propios.
- Tres PTY reales con IDs/PIDs distintos, input/output xterm, salida 7 y parada explícita diferenciadas; canvas, resize, zoom, lista/paleta y retorno.
- Los cuatro checks FR02/03 pasan: Tasks y Context mantienen inspector abierto mientras Space/Ctrl+C llegan a la PTY correcta; sus inputs no envían tráfico PTY ni mueven cámara. Rename inline de panel y proyecto persiste Enter/blur, cancela Escape incluso seguido de blur y devuelve foco tras Enter/Escape.
- Tarea local persistida, escaneo/lectura/pin MD; decisión, card y skill nativas con CLI real en almacén aislado; validación inválida visible sin falsa desconexión.
- Git de fixture, disponibilidad/lista Docker de solo lectura; pin de servicio y servicio atribuido a PTY; URL interna real y ausencia de `require`/bridge Phantom en web remota; browser nativo oculto bajo overlays.
- Playground Node real; Playwright con Chromium visible propio, parada, trace real y visor interno. Transcript escrito → revisión → tarea explícita, sin micrófono.
- Guardado al cerrar de nota/geometría; reattach caliente al **mismo PID/sesión**; cierre ordenado del host → `exited`/PID null; crash inesperado del daemon de fixture → `lost`/PID null. Conserva historial/layout y no crea shells automáticamente.
- Cero errores renderer no capturados en este recorrido. Las pruebas sintéticas no son observación de uso de Carlos.

## Voz local: prueba real y límite de precisión

Configuración de este equipo: `~/.local/state/phantom-workspace/voice-runtime/config.json`, **faster-whisper 1.2.1**, modelo **base** multilingüe CPU/int8, **PyAV 16.1.0**. Modelo `Systran/faster-whisper-base`, revisión `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`.

La suite opt-in transcribió WAV sintético en inglés y WebM/Opus reales. La frase «review the project» pasó a «remove the product»: sustitución ASR real, no precisión perfecta. La UI permite revisar y editar antes de actuar. El E2E del paquete usó texto escrito; no probó captura de micrófono. Calidad del español y micrófono de Carlos pendientes.

## Capturas vigentes

Capturas vigentes registradas por el último E2E, descritas en el [informe E2E](.impeccable/review/E2E-final-report.md): [desktop 1520×980](.impeccable/review/desktop.png), [narrow 1100×760](.impeccable/review/narrow.png), [browser nativo](.impeccable/review/browser-native.png), [terminal enfocado](.impeccable/review/focused-terminal.png), [herramientas](.impeccable/review/tools.png). Fixtures sintéticos, no trabajo personal. Assets UI con hash sin cambios respecto al build revisado, según coordinador; sin cambios de geometría/apariencia ni ampliación del SHIP FR01/02/03. El browser se captura directamente porque la captura renderer puede excluir capas nativas. No se realiza recaptura para esta actualización documental.

Los fallos de ejecuciones anteriores están archivados; el viejo resultado 32/2 no son bugs abiertos del paquete vigente. La discrepancia guía/metadata del CLI de diseño está registrada en [procedencia](.impeccable/review/direction-provenance.md), no es defecto de la app.

## Límites y siguiente validación

No se ejecutaron modelos/cloud, captura real de micrófono ni acciones Docker contra contenedores del usuario. Las APIs de control Phantom y Docker existen, pero este recorrido no acredita ejecución comercial de modelos ni lifecycle de contenedores reales. Dossier/refs no importan automáticamente conversaciones: una identidad de proveedor ausente sigue desconocida.

Pendientes: uso observado y aceptación de Carlos, cinco jornadas de dogfood, workload propuesto de **10 min / 12 PTY / 100 nodos / dos previews** y presupuestos p95/CPU/RSS, comparación runtime Tauri/React Flow, lector de pantalla/IME/TUIs personales completos. El crash probado fue del daemon sintético: **no se reinició el PC del usuario**. La restauración tras reboot real sigue por validar.

**Siguiente paso:** abrir un proyecto real con `./launch.sh`, usar esta versión y registrar dónde cuesta crear, encontrar o retomar trabajo. El [backlog](../harness_engineer/war-room/terminal-canvas/backlog.json) conserva aceptación pendiente por card, sin confundir cobertura de código con cierre del gate diario.
