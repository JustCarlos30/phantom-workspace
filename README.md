# Phantom Workspace

App de escritorio local para organizar **terminales, navegador, sesiones, tareas y contexto por proyecto**. Versión 0.1 para Linux x64.

## Abrir

```sh
/home/carlosj/Carlos_World/phantom-workspace/launch.sh
```

También puedes abrir `Phantom Workspace.desktop` desde esta carpeta. El ejecutable empaquetado está en:

```text
out/Phantom Workspace-linux-x64/phantom-workspace
```

Incluye Electron, Node, Chromium de Playwright y Phantom 0.5. El paquete fue probado usando sus propios runtimes. Git, Docker, shells y Python para playgrounds usan las herramientas instaladas en el equipo.

## Primer recorrido

1. **Abrir carpeta** registra un proyecto; una carpeta sin Git también funciona.
2. Crea terminales, una nota y un navegador desde la barra inferior. Los paneles nuevos buscan espacio libre.
3. Arrastra una cabecera para ordenar; arrastra la esquina para cambiar tamaño. **Ctrl + rueda** sobre el fondo cambia zoom; **0** ajusta el mapa cuando el foco está en el canvas.
4. Enfoca un panel y usa **Volver al mapa** o **Ctrl + Mayús + Enter** para regresar. La lista permite encontrar paneles fuera de la cámara y recuperar vistas ocultas.
5. **Ctrl + K** abre la paleta. El inspector derecho ofrece contexto, tareas, sesiones, Git, servicios y otras herramientas junto a la terminal.

### Plugin Phantom · Centro de mando

Abre **Plugins** en la barra de proyectos y pulsa **Activar Phantom**. La activación y la frecuencia se guardan por proyecto. **Abrir Centro de mando** crea o recupera su panel del canvas; también está disponible en **Ctrl + K** y en el selector del inspector. En Configuración puedes definir las rutas de la CLI y sus datos nativos; no se instala código externo ni hay marketplace.

El Centro consulta el catálogo de tareas/cards de la familia Git de worktrees y únicamente los eventos de la tarea seleccionada. Prioriza bloqueadas, después activas; conserva por separado el estado nativo y el del controlador local. El detalle muestra objetivo, alcance, checks, evidencias y hasta 100 eventos. La salida del controlador es la recibida realmente por este host, acotada a 64 KiB; no se deduce progreso porcentual. Un controlador terminado no implica que la tarea esté completada.

La consulta automática ocurre cada **4 segundos** (configurable entre 3 y 5), sin solicitudes solapadas y solo con el panel montado, visible y activo. Canvas e inspector comparten lector por proyecto. Los eventos `tool.output` y `tool.status` adelantan la siguiente lectura. Puedes pausar, reanudar o actualizar manualmente. Si falla la conexión se conserva la última lectura válida y se indica que está desactualizada; la reconexión vuelve a consultar. Desactivar detiene las consultas y conserva datos y paneles; el propio panel ofrece **Reactivar Phantom**. Las lecturas conservadas del catálogo viven en esta ventana, no constituyen un historial persistente. Sin CLI disponible se muestra un error recuperable; sin tareas se muestra el estado vacío.

El check `node test/command-center-desktop.mjs` usa fixtures sintéticos explícitos con Vite y `window.phantom` simulado. Cubre activación, salida real, bloqueo, búsqueda, pausa, desactivación, recuperación tras error y catálogo vacío, reconexión y ausencia de desbordamiento en escritorio y compacto. Sus capturas se escriben exclusivamente en `/tmp/opencode/phantom-command-center-review`, fuera del repositorio. `node --test test/command-center.test.mjs` cubre además persistencia, validación, autorización por familia y aislamiento de lecturas tardías; un flujo continuo de salida no debe aplazar indefinidamente el refresco.

### Sesiones y cierre

- Cerrar la ventana conserva el host y sus sesiones. Volver a abrir conecta a los mismos procesos.
- **Ocultar vista** conserva el terminal; **Terminar proceso** lo detiene explícitamente y conserva historial.
- **Cerrar terminal (×)** termina el shell y sus procesos hijos y elimina el panel y sus sesiones, incluido el historial. Las terminales nuevas abren como paneles de 640 × 400 en el mapa; el botón de enfocar permite ampliarlas.
- **Detener host y salir** termina los procesos propios. Tras reiniciar el sistema o perder el host se recuperan la disposición y el historial guardado, con sesiones terminadas/perdidas; un shell nuevo se inicia explícitamente.
- El cierre espera que se guarden notas, nombres y posiciones pendientes. Si el disco/host no confirma, permite reintentar o cancelar.

La acumulación de salida de una terminal no corta la conexión compartida: el host conserva la pantalla y solicita a esa vista una captura actualizada al drenar el canal. Las demás terminales conservan su conexión.

### Una terminal, un worktree

- En un repositorio con commits, cada panel de terminal nuevo crea una rama `phantom/terminal-<id>` desde `HEAD` y un worktree independiente. Los cambios sin commit de la carpeta original no se copian.
- El shell arranca en ese worktree y su barra muestra la rama y la ruta. Relanzar una sesión del mismo panel reutiliza su worktree, también después de reiniciar el host.
- En carpetas sin Git, sin commits o sin Git instalado, abre una terminal normal e indica el motivo en la barra.
- Ocultar, detener o cerrar una terminal conserva los archivos y la rama del worktree. Los worktrees se almacenan en `worktrees/<workspace>/<panel>` dentro del directorio de estado de la app.
- Los paneles, menús, inspector, diálogos y avisos tienen entrada y salida breves. La preferencia del sistema de movimiento reducido sustituye desplazamientos por un fundido suave.
### Dependencias de terminales en worktrees

En proyectos Git, cada terminal crea o reutiliza su propio worktree. Si contiene `package.json` y `package-lock.json`, Phantom abre el shell en cuanto está creado el worktree y prepara sus dependencias en segundo plano con `npm ci --include=dev --no-audit --no-fund --foreground-scripts`. La terminal y los agentes están disponibles durante la instalación. Cada panel muestra el estado y la salida real de npm; los comandos del proyecto pueden necesitar que termine la instalación. La preparación puede tardar hasta cuatro minutos, con descargas y compilaciones nativas de npm. Hace falta npm en el PATH del host. La instalación es independiente por worktree: no se copia ni enlaza `node_modules` del proyecto original y la preparación no edita el manifest ni el lock.

Se omiten proyectos sin Git, sin Node, sin `package-lock.json` o con indicaciones de pnpm/yarn/bun (`packageManager`, locks o workspace pnpm). El soporte inicial no incluye `npm-shrinkwrap.json`: su presencia omite la preparación incluso si también hay package-lock. Un marcador dentro de `node_modules` permite reutilizar instalaciones completas que coincidan con package, lock, plataforma, arquitectura y ABI de Node; si cambia esa huella o faltan archivos se repara la instalación gestionada. Reconectar a una sesión viva o reiniciar el host no instala nada; después de reiniciar se solicita una sesión nueva explícitamente.

Si falla npm, la terminal permanece disponible y el panel muestra el error, una salida acotada y **Reintentar instalación**, sin reiniciar el shell ni el agente. La asignación del worktree se guarda **antes** de instalar; se conservan rama y cambios. Terminar la sesión o cerrar terminal/host cancela la instalación y termina los procesos npm y sus hijos. Una instalación manual preexistente sin marcador, un marcador ilegible o un `node_modules` enlazado se conservan y bloquean la preparación: mueve o elimina explícitamente `node_modules` para autorizar la instalación. Tras un corte abrupto durante la limpieza de npm puede ser necesaria esa misma recuperación si se perdió el marcador.

Para preparar este checkout mediante la misma API idempotente:

```sh
node scripts/setup-worktree.mjs
```

El script informa el resultado o falla con código de salida no cero; no instala al importarse ni crea metadata de preparación fuera de `node_modules`. Más detalles: [host/README.md](host/README.md#terminal-worktree-dependencies).

## Herramientas incluidas

| Herramienta | Funcionamiento |
|---|---|
| Terminales | PTY reales, xterm, snapshot ANSI, reconexión, salida acotada y backpressure. |
| Navegador | Navegación interna en foco; última captura etiquetada en overview. Contexto de navegación separado por proyecto. |
| Tareas | Borradores y checklists locales; consulta, creación y referencia de cards nativas Phantom. |
| Contexto | Búsqueda y lectura acotada de documentos, referencias fijadas, decisiones/memorias y skills de Phantom. |
| Misiones | Notas de continuidad, próxima acción y vínculos a paneles, tareas y ejecuciones. |
| Git | Cambios, ramas, worktrees y comparación con base elegida. «No integrada» no significa «lista para merge». |
| Servicios | URLs fijadas, servicios con proceso propietario y puertos Compose atribuidos al proyecto. |
| Docker | Contenedores propios, logs y acciones explícitas de iniciar/detener/reiniciar. Muestra ausencia o permisos insuficientes. |
| Workflows | Plantillas versionadas con tareas o pasos de playground que se ejecutan explícitamente. |
| Playground | Node, Python o shell en la carpeta seleccionada; ejecución, parada, salida y artefactos identificados. |
| Automatización | `automation.start` usa por defecto el navegador integrado visible. `mode: "isolated"` abre Chromium de Playwright separado y permite trazas reales. |
| Voz | Grabación explícita, transcripción local, texto editable e intención revisada para crear/encontrar trabajo. |

La edición nativa avanzada de cards/skills/decisiones utiliza formularios JSON con validación de Phantom. Una card se reemplaza explícitamente cuando cambia el contrato; la original conserva su evidencia. Los modelos se ejecutan solo mediante una acción de run con configuración válida. Los tests de la app no consumen modelos comerciales.

## Navegador del agente y automatización

En una **terminal nueva creada por Phantom**, el agente descubre `PHANTOM_BROWSER_CLI`, `PHANTOM_BROWSER_ENDPOINT`, `PHANTOM_BROWSER_SESSION` y `PHANTOM_BROWSER_WORKSPACE`. La capacidad privada `PHANTOM_BROWSER_TOKEN` se hereda solo en esa terminal; no debe copiarse a prompts, logs ni archivos del proyecto. Con la ventana abierta y ese proyecto activo:

```sh
node "$PHANTOM_BROWSER_CLI" help
node "$PHANTOM_BROWSER_CLI" context
node "$PHANTOM_BROWSER_CLI" preview http://127.0.0.1:5173/ --timeout-ms 15000
node "$PHANTOM_BROWSER_CLI" status
node "$PHANTOM_BROWSER_CLI" read --selector h1
node "$PHANTOM_BROWSER_CLI" fill --selector '#name' --value 'Ejemplo'
node "$PHANTOM_BROWSER_CLI" click --selector '#apply'
node "$PHANTOM_BROWSER_CLI" screenshot
node "$PHANTOM_BROWSER_CLI" console
```

`preview` y `open` esperan HTTP 2xx/3xx antes de crear/enfocar la vista y reutilizan el panel de la misma terminal y `--key` (predeterminada: `preview`). Read, click, fill y captura operan sobre el mismo WebContentsView visible y su sesión; los selectores son CSS, deben resolver un elemento para click/fill y no tienen auto-wait de Playwright. No existe ejecución de JavaScript arbitrario ni debugger público. Las capturas del CLI tienen nombres privados generados, límite de 8 MiB y retención por proyecto de 16 PNG/64 MiB.

**Abridores del sistema redirigidos.** Muchas skills y CLIs (p. ej. impeccable live, logins OAuth) abren URLs con `xdg-open` o `$BROWSER`, sin conocer este puente. En terminales de Phantom, `scripts/browser-shims/` va primero en `PATH` y `BROWSER` apunta a él: `xdg-open`, `sensible-browser`, `x-www-browser`, `www-browser`, `kde-open(5)` y `gio open` con una sola URL http(s) hacen `open` en el panel integrado. Si el puente falla, devuelven error (no abren el navegador externo a escondidas). Rutas, `mailto:` y otros subcomandos pasan al comando real con el `BROWSER` original. `PHANTOM_BROWSER_EXTERNAL=1` restaura el navegador del sistema.

La API del host acepta estos payloads para `automation.start` (no son subcomandos del CLI browser):

```json
{"workspaceId":"UUID_DEL_PROYECTO","sessionId":"UUID_TERMINAL_ACTIVA","url":"http://127.0.0.1:5173/","actions":[{"type":"fill","selector":"#name","value":"Ejemplo"},{"type":"click","selector":"#apply"}],"keepOpen":true}
```

```json
{"workspaceId":"UUID_DEL_PROYECTO","mode":"isolated","url":"http://127.0.0.1:5173/","headed":false,"actions":[{"type":"screenshot"}]}
```

El modo omitido es `integrated`: usa el puente del desktop y nunca llama a `chromium.launch`. `sessionId` se obtiene de `terminal.list`; puede omitirse si solo hay una terminal activa del proyecto. `key` comparte la identidad del panel con el CLI. Si faltan desktop, proyecto activo o credenciales de una terminal nueva, devuelve un error accionable, sin navegador externo de fallback. `headed:false` requiere `isolated`, que necesita Chromium instalado (`node node_modules/playwright/cli.js install chromium`).

Ambos modos conservan `automation.list`, `automation.stop`, estado/eventos y logs por run. En integrado, al completar se copia la captura al directorio del run y se recoge una instantánea de la consola retenida (hasta 100 mensajes, puede incluir mensajes anteriores del panel; no es streaming continuo). `keepOpen:true` conserva el controlador hasta Stop o `keepOpenMs`; de lo contrario lo libera al completar. **El panel integrado y su sesión permanecen abiertos en ambos casos**, también después de Stop/error; `panelRetained` lo identifica y `browserOpen` indica control vivo del run, no existencia física de esa vista. El cierre visual se hace desde el canvas. Stop y timeout no pueden cancelar un RPC del puente: esperan que termine el RPC pendiente antes de confirmar y no ejecutan más pasos; puede tardar hasta el límite de transporte de 75 s.

El puente integrado **no soporta trace Playwright**: el descriptor declara `traceSupported:false`, `automation.trace` devuelve error y no se inventa `trace.zip`. Para tests con aislamiento, headless, auto-wait y trace/visor usa explícitamente `mode:"isolated"`; ese modo cierra su navegador al completar salvo `keepOpen:true`. La disponibilidad HTTP de preview se comprueba una sola vez mediante el puente; el sondeo HEAD opcional de Servicios es diagnóstico puntual, no requisito adicional ni garantía de readiness de una aplicación. Este flujo utiliza Electron/Chromium; no establece ninguna causa de fallos observados en Firefox.

## Dictado local

En este equipo está preparado **faster-whisper base multilingüe, CPU/int8**, sin credenciales cloud. La app descubre su configuración en `voice-runtime/config.json` dentro de su directorio de estado. La transcripción puede equivocarse: siempre se muestra editable antes de convertirla en acción.

Para preparar otro perfil/equipo con Python3 y soporte venv:

```sh
npm run setup:voice
# Alternativa de menor tamaño:
node scripts/setup-voice.mjs --model tiny
```

El instalador mantiene dependencias y modelos en el directorio propio de la app y respeta una configuración previa. Ajustes permite otro comando local o un proveedor compatible configurado por el host. Las API keys no viajan al renderer. La prueba de audio usó voz sintética; el micrófono personal se utiliza al pulsar Grabar y conceder acceso.

## Datos y configuración

Estado predeterminado: `~/.local/state/phantom-workspace` (respeta `XDG_STATE_HOME`).

```text
state.json            Proyectos, disposición, referencias, tareas locales y preferencias
terminals.json        Historial acotado y descriptores de sesiones
worktrees/            Árboles Git independientes por workspace y panel de terminal
host.sock             Conexión privada al daemon
automation/           Playground, Playwright, logs y trazas por workspace/run
browser-artifacts/    Capturas del puente browser con retención acotada por proyecto
voice-runtime/        Motor y modelo local de voz
electron/             Perfil de la aplicación y contextos de navegador
```

`PHANTOM_WORKSPACE_HOME=/ruta/privada` permite aislar otro perfil. Phantom mantiene sus datos canónicos en su almacén habitual, configurable desde Ajustes. La app exporta/importa organización mediante JSON; exportar historial es opt-in. No mueve los documentos originales del proyecto.

## CLI Phantom: ejecuciones largas

Phantom Workspace carga automáticamente `scripts/phantom-fetch.mjs` mediante `--import` con ruta absoluta al iniciar los controladores `run`, `recover` y `verify` con Node, sin shell. Esto evita el límite de headers de Undici (300 s) mientras el agente sigue trabajando. Para iniciar el CLI manualmente con el mismo preload:

```sh
node --import /RUTA/phantom-workspace/scripts/phantom-fetch.mjs /RUTA/CLI.mjs run ID
```

Sustituye las rutas por las del preload y el archivo de entrada del CLI, e `ID` por el identificador de sesión. Solo los `POST` HTTP a loopback (`localhost`, `127.0.0.0/8`, `[::1]`) con ruta `/session/ID/message` usan `node:http`, sin timeout implícito de headers. La respuesta conserva un body en stream y la cancelación mediante `AbortSignal` hasta terminarlo. Las demás llamadas se delegan al `fetch` original. No requiere dependencias ni configuración global; se aplica únicamente al proceso iniciado con `--import`.

## Desarrollo y comprobaciones

```sh
npm ci
# Si npm bloquea los scripts nativos, revisarlos y habilitar estos dos:
npm install-scripts approve node-pty esbuild
npm rebuild node-pty esbuild
node node_modules/playwright/cli.js install chromium
npm run dev
```

```sh
npm test
node test/desktop-motion.mjs
PHANTOM_DESKTOP_SPIKE=1 PHANTOM_TEST_LOCAL_VOICE=1 npm test
npm run package
PHANTOM_TEST_EXECUTABLE="$PWD/out/Phantom Workspace-linux-x64/phantom-workspace" npm run test:desktop
```

Las pruebas desktop crean perfiles y repositorios sintéticos en `/tmp/opencode`; requieren un display. La prueba de voz real es opt-in y necesita el motor local preparado. Evidencia y límites: [VERIFICATION.md](VERIFICATION.md). [War Room](../harness_engineer/war-room/terminal-canvas/README.md).
