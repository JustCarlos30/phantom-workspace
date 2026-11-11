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
- **Cerrar terminal (×)** termina el shell y sus procesos hijos y elimina el panel y sus sesiones, incluido el historial. Las terminales nuevas abren enfocadas y listas para escribir.
- **Detener host y salir** termina los procesos propios. Tras reiniciar el sistema o perder el host se recuperan la disposición y el historial guardado, con sesiones terminadas/perdidas; un shell nuevo se inicia explícitamente.
- El cierre espera que se guarden notas, nombres y posiciones pendientes. Si el disco/host no confirma, permite reintentar o cancelar.

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
| Playwright | Navegador de ejecución visible en ventana propia, pasos editables y trazas reales. **Ver trace grabado en canvas** abre el visor interno. |
| Voz | Grabación explícita, transcripción local, texto editable e intención revisada para crear/encontrar trabajo. |

La edición nativa avanzada de cards/skills/decisiones utiliza formularios JSON con validación de Phantom. Una card se reemplaza explícitamente cuando cambia el contrato; la original conserva su evidencia. Los modelos se ejecutan solo mediante una acción de run con configuración válida. Los tests de la app no consumen modelos comerciales.

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
host.sock             Conexión privada al daemon
automation/           Playground, Playwright, logs y trazas por workspace/run
voice-runtime/        Motor y modelo local de voz
electron/             Perfil de la aplicación y contextos de navegador
```

`PHANTOM_WORKSPACE_HOME=/ruta/privada` permite aislar otro perfil. Phantom mantiene sus datos canónicos en su almacén habitual, configurable desde Ajustes. La app exporta/importa organización mediante JSON; exportar historial es opt-in. No mueve los documentos originales del proyecto.

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
PHANTOM_DESKTOP_SPIKE=1 PHANTOM_TEST_LOCAL_VOICE=1 npm test
npm run package
PHANTOM_TEST_EXECUTABLE="$PWD/out/Phantom Workspace-linux-x64/phantom-workspace" npm run test:desktop
```

Las pruebas desktop crean perfiles y repositorios sintéticos en `/tmp/opencode`; requieren un display. La prueba de voz real es opt-in y necesita el motor local preparado. Evidencia y límites: [VERIFICATION.md](VERIFICATION.md). [War Room](../harness_engineer/war-room/terminal-canvas/README.md).
