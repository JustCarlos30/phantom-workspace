# Registro de cambios con Phantom

Phantom Workspace entrega la misma política de arranque a **OpenCode, Claude Code y Codex**, en terminales y en chat cards. Cada sesión de terminal recibe un archivo propio fuera del proyecto y del worktree, con identidad de terminal, cwd y rama.

| Dónde corre el agente | OpenCode | Claude Code | Codex |
| --- | --- | --- | --- |
| Terminal (PTY) | `OPENCODE_CONFIG_CONTENT.instructions` | shim `claude` → `--append-system-prompt` | shim `codex` → `-c developer_instructions=…` |
| Chat card | `OPENCODE_CONFIG_CONTENT.instructions` | `--append-system-prompt` | no es proveedor de chat |

Para OpenCode se conservan las instrucciones heredadas y todos los demás campos del JSON inline, incluidos proveedores, permisos y MCPs. Un JSON heredado inválido produce un error de lanzamiento que indica cómo corregirlo; no se descarta silenciosamente.

Claude Code y Codex no leen instrucciones del entorno. En las terminales, `scripts/agent-shims` va primero en `PATH` y `PHANTOM_AGENT_POLICY` nombra el archivo de política: al escribir `claude` o `codex`, el shim se sustituye por el agente real añadiéndole la política (no queda ningún proceso intermedio). Límites del shim:

- Solo actúa si el agente se resuelve por `PATH`. Una ruta absoluta, un alias o un `PATH` que el rc del shell reordene por delante del shim lo evitan; `command -v claude` debe mostrar `…/scripts/agent-shims/claude`.
- No toca subcomandos de gestión (`claude mcp`, `claude update`…), `--version` ni `--help`.
- Si `claude` ya recibe un `--append-system-prompt` propio, se respeta el del usuario y se avisa por stderr de que la política no se añadió.
- En Codex, `-c developer_instructions` sustituye durante esa sesión a un `developer_instructions` definido en `~/.codex/config.toml`.
- `PHANTOM_AGENT_POLICY_OFF=1` lanza el agente sin política.

En las chat cards el host construye la línea de comandos, así que la política llega siempre, con o sin Incorporaciones; cuando Incorporaciones está activa se añade además el rol de la card.

La política no modifica `AGENTS.md`, `CLAUDE.md` ni la configuración personal/global de ningún agente. Las instrucciones del proyecto mantienen su alcance y el contenido del repositorio no amplía el mandato de una tarea.

## Subagentes de Claude Code

En terminales PTY, el shim añade hooks asíncronos de `SessionStart`, `SessionEnd`, `SubagentStop` y de `PreToolUse`, `PostToolUse`, `PostToolUseFailure` para la herramienta `Agent`. Se suman a los hooks del usuario/proyecto y muestran los subagentes bajo su terminal en Delegación. Solo envían identidad, tipo, descripción y estado: no envían prompts ni mensajes. `PHANTOM_AGENT_HOOKS_OFF=1` los desactiva; un `--settings` propio también los omite. Codex y OpenCode en terminal no reportan subagentes.

## Política y ejecución controlada

El bootstrap es una instrucción para el agente, no una barrera técnica que impida editar desde cualquier proceso del shell. Hay dos autoridades nativas: **Phantom CLI `do`/`run` controla las ediciones, sus pruebas y el cierre de la tarea; el controlador de Incorporaciones/ramas controla la finalización Git del trabajo aceptado**. El vínculo de identidad de una terminal tampoco demuestra por sí solo que exista una ejecución controlada.

Para cada solicitud de cambio, antes de editar, el agente debe:

1. Consultar el contexto de la terminal y usar su **cwd exacto**, no la raíz del proyecto ni otro worktree.
2. Determinar si ya está dentro de un `do`/`run` controlado, a partir del mandato/contexto recibido. En ese caso continúa esa tarea, su scope y sus checks, sin crear ni ejecutar tareas anidadas.
3. En otro caso, consultar la ayuda y el catálogo del CLI nativo y crear o reutilizar una tarea que corresponda a esa solicitud y ese worktree, con rutas escribibles explícitas y checks de aceptación. No debe pedir al usuario que diga «crea una card».
4. Vincular el ID canónico devuelto por Phantom a la terminal y ejecutar las ediciones y sus pruebas dentro de `do`/`run`, con argumentos y modelo realmente disponibles según la ayuda instalada.

Una **tarea directa** (`kind: task`, `lane: direct`) corresponde a un cambio sencillo y acotado. Una **card coordinada** (`kind: card`, `lane: coordinated`, con coordinación nativa) corresponde a trabajo que requiere coordinación de varios pasos. No todo cambio necesita una card coordinada. Los campos de identidad históricos `cardId` y `cardTitle` conservan, respectivamente, el ID canónico y el objetivo (`contract.goal`) de cualquiera de estas tareas.

Al retomar la misma solicitud se continúa la misma tarea; una solicitud independiente recibe una tarea independiente. Las preguntas de solo lectura no necesitan tareas ni cards. **Abrir un shell vacío no crea automáticamente ninguna card ni tarea.**

Si faltan runtime, modelo, checks requeridos o una decisión material, el agente comunica el bloqueo y reporta `blocked`, en lugar de hacer cambios sin seguimiento. Un reporte o una consulta nunca completan tareas. `review` solo significa listo para revisión; Phantom conserva la autoridad sobre verificación y cierre. No hay un estado `completed` aceptado por el comando de reportes.

### Integración después de la aceptación

Después de que Phantom acepte el trabajo, el padre puede invocar el controlador nativo de Incorporaciones/ramas mediante `agent.mjs merge ID` (ID de la solicitud de incorporación) o `scripts/branches.mjs integrate RAMA`. Debe respetar los roles y autorizaciones existentes y mantener activos los hooks y los checks de integración. La aceptación de la tarea no acredita que la rama esté integrada: el resultado de integración se informa a partir de la respuesta observada del controlador.

Esta finalización Git es una operación del controlador de ramas, separada de `do`/`run`: no se intenta que `do`/`run` modifique `HEAD`, ni se incluyen merges en los checks de aceptación del harness, ni se concede shell al ejecutor. Se mantienen el registro obligatorio, el worktree exacto, los scopes, los checks de aceptación y el cierre nativo de tareas.

No se permite sustituir el controlador por Git directo, desactivar hooks (`--no-verify`, cambios de `core.hooksPath`), retirar el entorno del guard, omitir checks de integración (`--no-checks`, `checks --none`), modificar a mano el estado de cola ni fingir tareas `completed`. Si falta la aceptación o el controlador autorizado no está disponible, se comunica el bloqueo. El padre conserva el encargo de integración pendiente y lo continúa por ese controlador cuando estén disponibles sus requisitos.

## Comandos y ejemplos

Dentro de una terminal de Phantom Workspace:

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" context
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" bind ID_CANONICO_DEVUELTO_POR_PHANTOM
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Implementando el cambio autorizado" working
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Falta el modelo requerido" blocked
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Listo para revisión de Phantom" review
```

`bind ID` consulta `terminal.agent.context` y utiliza los `workspaceId` y `nodeId` devueltos para llamar a `terminal.agent.update`. El host consulta `phantom.detail` en el catálogo `tasks` y admite los objetos nativos `kind: task` y `kind: card`; rechaza otros tipos. La integración existente comprueba que `contract.workspace` pertenezca al proyecto seleccionado o a su familia Git de worktrees; un objeto extranjero se rechaza sin alterar el vínculo ni el reporte previo. El comando no crea tareas ni cambia sus estados nativos. La validación de catálogo del host y el requisito de la política de usar el worktree exacto son responsabilidades distintas: vincular un ID no sustituye revisar su contrato.

Cambiar el ID vinculado reinicia el paso y el estado de progreso de la terminal a `idle`, con fuente `manual`. Los reportes posteriores usan fuente `agent` y solo actualizan paso/estado; `review` conserva su significado de listo para revisión. Volver a vincular el mismo ID conserva el progreso.

Ejemplos de aplicación:

- «Corrige el texto de este botón»: tarea directa con el archivo autorizado y un check de aceptación explícito, en el cwd de la terminal.
- «Coordina la migración y la integración de varios componentes»: card coordinada con scope, checks y coordinación nativa definidos.
- «¿Qué hace esta función?»: consulta de solo lectura, sin registro obligatorio.
- «Continúa con el cambio anterior»: consultar contexto y contrato; continuar el mismo ID, sin duplicarlo.

## Atadura y aviso de fin de los runs

Al lanzar `run` desde una terminal, el host ata la tarea a esa terminal (`cardId`, título) y muestra «trabajando». Al terminar, la tarjeta pasa a `review` (tarea `completed`: verificar que funciona y si necesita algo más) o a `blocked` con el motivo (bloqueada, fallida, controlador fallido, estado desconocido o run perdido). Si la terminal fue reatada a otra tarea o desvinculada, no se toca. Es solo el estado visible de la sesión: nunca marca la tarea como completada.

Chats y terminales reciben un aviso automático de fin, una vez por run. En una terminal solo se escribe (mensaje + Enter) si la sesión sigue viva, es la actual del nodo y hay un agente reconocido en primer plano; si no, bastan la tarjeta y el aviso de atención. Tope de 4 avisos por nodo; al agotarlo el host deja un aviso de atención (una vez por nodo). El contador se reinicia con cualquier entrada de usuario a esa terminal (`terminal.write`). Límite: el host no distingue una pulsación humana de otro cliente que escriba por esa misma vía.

## Plan con fases

Para trabajo de varias etapas, el agente declara su plan con `"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" phases set ARCHIVO.json` y enlaza cada encargo con `phases start KEY ID`; el host marca la fase al cerrar el encargo. El plan se ve con datos reales del nodo (`node.data.plan`):

- Tarjeta de terminal y resumen de chat: una línea «Fase N de M · título» con el progreso hechas/total.
- Panel enfocado y cabecera del chat: un desplegable «Plan» con la lista ordenada de fases, su estado, la nota si está bloqueada y el ID corto del encargo.
- Rail de sesiones: «Fase N de M» en el apoyo de la fila.

Una fase pendiente sin encargo aparece como «Sin encargo todavía» y no es ejecutable: hasta enlazarle un ID (`phases task KEY ID` o `phases start KEY ID`) la cadena no puede lanzarla.

## Terminales nuevas y sesiones ya abiertas

La inyección ocurre al crear el PTY. No cambia el entorno de shells ni de agentes que ya estén ejecutándose. Tras instalar estos cambios hay que reiniciar el host de Phantom Workspace para cargar el código nuevo y crear o relanzar la sesión de terminal; abrir OpenCode, Claude Code o Codex dentro de esa sesión nueva permite heredar el bootstrap. Las chat cards lanzan un proceso por turno: tras reiniciar el host, el siguiente turno ya lleva la política. Volver a adjuntar una terminal existente no equivale a relanzarla.

Si se corrige `OPENCODE_CONFIG_CONTENT` en el entorno que inicia el host, también hay que reiniciar ese host y relanzar la terminal para heredar el valor corregido. El contexto conserva los campos previos de identidad/progreso y añade cwd, rama e indicaciones de política. Al relanzar una terminal se genera una identidad de sesión y un archivo de política nuevos; la tarea vinculada al nodo se conserva para poder retomarla.
