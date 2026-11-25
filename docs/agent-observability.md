# Observabilidad de agentes y supervisor del Canvas

Este documento describe qué registra Phantom Workspace de cada agente, cómo se consulta, qué hace el supervisor y qué **no** está acreditado. No contiene resultados de ejecución: los checks los ejecuta el controlador del encargo y su salida es la evidencia.

## Antes y después

**Antes:** el chat de una tarjeta mezclaba lo que hacía el agente raíz y sus subagentes en un resumen (`chats.json`) que se recorta; no había modelo ni contexto por agente, ni historial tras terminar o reiniciar, y una llamada al MCP `phantom_workspace.phantom` se mostraba como «Phantom» sin distinguir encargo de consulta.

**Después:**

- Cada agente (raíz, subagente o ejecución de Phantom) tiene un registro durable con dueño explícito (`nodeId`, `parentId`, `taskId`, `runId`), estado, modelo (solicitado y observado por separado), actividad actual y un historial paginado de eventos. Persiste al terminar y tras reiniciar el host.
- El Orquestador del dock muestra el árbol de agentes, el detalle de cada uno (instrucciones, encargo, tokens medidos, historial, resultado) y la sección Supervisor. Lo que el proveedor no expone se muestra como «No disponible» con su motivo; nunca se hereda del padre ni se estima.
- «Ver detalle e historial» en un subagente de **cualquier tarjeta del canvas** o del chat del dock abre ese agente en el Orquestador.
- El supervisor (opt-in por proyecto, apagado por defecto) resume el feed de eventos del workspace con Claude Code (haiku por defecto) y propone acciones con evidencia. No ejecuta nada.

## Piezas

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Almacén | `host/agent-traces.mjs` | JSON + JSONL privados bajo `<dataDir>/agent-traces/<digest>/`; IDs como datos (nunca rutas), symlinks rechazados, secretos redactados antes de escribir, retención explícita (2000 eventos por agente, 300 agentes por proyecto) señalada como truncamiento. |
| Adaptadores | `host/agent-trace-adapters.mjs` | Funciones puras que convierten lo que cada proveedor emite en registros. No se captura razonamiento/thinking. |
| Chats | `host/chats.mjs` (`onTrace`) | Cada turno de una tarjeta alimenta el almacén; un fallo del sumidero se cuenta en `traceFailures` y nunca rompe el turno. |
| Hooks PTY | `scripts/agent.mjs subagent` → `terminal.agent.trace` | El host impone workspace y nodo desde la sesión viva; descarta `taskId`/`runId` que el agente no puede probar; `transcript_path` no se lee ni se reenvía. |
| Ejecuciones Phantom | `host/server.mjs` (`traceRun`) | Un `tool.status` de Phantom con origen verificable crea el agente `run:<id>`; un origen que el host no puede verificar no se registra. |
| Supervisor | `host/workspace-supervisor.mjs`, `host/supervisor-provider.mjs` | Feed local persistido, lotes, límites y propuestas validadas; proveedor = Claude Code sin herramientas ni MCP. |
| UI | `src/components/PhantomOrchestrator.jsx`, `src/hooks/useAgentTraces.js`, `src/hooks/delegation-model.mjs` | Árbol, detalle, historial y supervisor. |

### Contrato RPC

- Operador (renderer, `desktop/security.mjs`): `agent.traces.list`, `agent.traces.detail`, `supervisor.read`, `supervisor.configure`, `supervisor.refresh`. Parámetros exactos; cualquier clave extra, cursor no numérico o `limit` fuera de 1–200 se rechaza.
- Agentes (solo por socket de sesión PTY viva, **no** en el allowlist del renderer): `terminal.agent.trace` (escritura de registros) y `terminal.agent.traces` (lectura). Un worker lee solo su nodo; la sesión orquestadora, su proyecto; nunca otro proyecto. Un vecino es indistinguible de un agente inexistente.
- MCP: la herramienta `traces` es solo lectura y reenvía únicamente la sesión propia. No se registró ninguna herramienta que modifique estado.
- Eventos del host: `agent.traces.changed` y `supervisor.changed`, solo con `workspaceId` (sin contenido). `state.get` y el export general no incluyen historiales.

### Abrir un agente desde el canvas

`Canvas` y `CanvasNode` no pasan props hasta `ChatCard`, así que `App.jsx` ofrece el abridor por `AgentOpenContext`. `ChatCard` añade su propia identidad (proyecto y tarjeta) al agente pulsado, `App.openAgent` valida con `agentOpenRequest` (descarta lo incompleto o de otro proyecto), abre el dock en «Orquestador» y `PhantomChat` entrega la petición a `PhantomOrchestrator`, que la consume una vez.

Mapeo del id local de la tarjeta al id durable (`SubagentCard`): Claude usa el id de la llamada `Agent`; OpenCode, la sesión hija que la llamada reportó (`agent.sessionId`; antes de reportarla el detalle dirá «Agente no encontrado»); Codex, su único hilo receptor (`agent.threadIds`); una llamada sobre varios hilos no tiene un único agente y no ofrece el enlace.

### MCP `phantom_workspace.phantom`

`phantomCallKind` distingue encargo (`run`), vínculo (`bind`), creación y consulta. Solo `{cli:'agent', args:['run'|'bind', ID]}` con ID completo cuenta como encargo/vínculo; cualquier otra forma se muestra como «Consulta a Phantom». Ninguna se presenta como subagente.

## Supervisor

- Apagado por defecto, por proyecto. `supervisor.read` nunca llama al modelo.
- Resumen por lotes tras eventos materiales, con debounce (30 s), una llamada a la vez por proyecto, 6 llamadas por hora, entrada acotada (14 000 caracteres), timeout (90 s) y cancelación al desactivar o cerrar el host. Un fallo conserva el último resumen y no hay reintento automático; tras 3 fallos seguidos el automático se suspende hasta un `refresh` manual.
- Proveedor: Claude Code con `--tools ''`, `--strict-mcp-config`, sin comandos ni ajustes de proyecto y sin sesión guardada, en un directorio temporal, bajo la política de ejecución. Si Claude está deshabilitado, no está instalado o no tiene sesión, el estado es «No disponible» con la acción a seguir; no hay otro proveedor de reserva.
- La salida del modelo es dato no confiable: solo `{summary, proposals}`; los textos con forma de orden de shell se descartan; cada propuesta debe citar IDs que existan en lo enviado; `review-integration` solo cita solicitudes con evidencia de readiness del host. Las propuestas no ejecutan nada ni saltan el controlador de integración: «Revisar cola» solo abre la cola.
- El coste no está disponible en el supervisor y la UI lo dice.

## Qué dice cada proveedor (y qué no)

| Fuente | Modelo | Contexto / tokens | Subagentes | Límite |
| --- | --- | --- | --- | --- |
| Claude (tarjeta de chat) | Solicitado (configuración) y observado (`init`/mensajes) | Tokens por petición del `usage`; ventana de `modelUsage` solo para el modelo observado del raíz | Hijos y nietos por `parent_tool_use_id`; encargo = prompt de la llamada | Las instrucciones del raíz son las que Phantom inyecta por rol, no el prompt de sistema del proveedor. El hijo no expone instrucciones ni ventana. |
| Claude (terminal PTY, hooks) | Observado en `SessionStart` | No medido | Hijos por la llamada `Agent`; sus herramientas internas solo se atribuyen si el hook trae un `agent_id` enlazado a un agente lanzado en segundo plano | Las herramientas de un subagente en primer plano sin enlace se ignoran (nunca se atribuyen al raíz). |
| Codex (tarjeta de chat) | Solicitado; el flujo `exec --json` no informa el observado | Lectura del rollout, solo raíz | Hilos receptores de `spawn_agent` como hijos del raíz | Del hijo solo se conoce el estado y el mensaje que la llamada reporta, no su historial propio. |
| OpenCode (tarjeta de chat) | Observado (`model`) | `step_finish.tokens`, por sesión | Sesión hija por `part.sessionID`; padre conocido solo cuando la llamada `task` reporta `metadata.sessionId` | Hasta entonces el hijo queda «sin padre registrado». |
| Terminales Codex/OpenCode | — | — | No hay hooks | Sin historial por hooks. |

Un proveedor que no expone un dato lo declara no disponible; nunca se atribuye al raíz.

## Evidencia: fixtures frente a proveedor real

**Ninguna prueba ejecuta un proveedor real.** Todo lo siguiente es fixture:

- Los eventos de Claude/Codex/OpenCode/hooks de `test/subagents.test.mjs`, `test/chats.test.mjs`, `test/workspace-events-host.test.mjs` y `test/agent-observability-ui.test.mjs` son sintéticos con la forma documentada de cada flujo; el ejecutable de Claude de los tests de chat es un script falso.
- El resumidor del supervisor es un callback falso; `createSupervisorSummarizer` se prueba con un `spawn` falso (argumentos, errores, límites y cancelación), sin Claude Code real. **No se ha comprobado el supervisor contra Claude Code real.**

Lo que sí ejercitan las pruebas con código productivo:

- `test/workspace-events-host.test.mjs`: host real (`createHost`), socket, PTY `/bin/sh` y `dataDir` temporal; aislamiento por sesión/rol, revocación, reinicio, eventos del host, supervisor con snapshot construido de datos reales.
- `test/agent-observability-ui.test.mjs`: `ChatCard`, `PhantomChat` y `PhantomOrchestrator` productivos con su CSS real en Chromium, respaldados por los módulos reales `agent-traces` y `workspace-supervisor`. El clic en «Ver detalle e historial» recorre `ChatCard` → `AgentOpenContext` → `agentOpenRequest` → pestaña Orquestador → `PhantomChat` (`agentRequest`) → `PhantomOrchestrator`, como en `App.jsx`; solo el estado propio de `App.jsx` está reproducido por la fixture. Genera capturas e informe en `.test-artifacts/` (ignorado). Se ejecuta sin red con `docker compose run --rm agent-observability-test`.
- `test/chats.test.mjs` y `test/desktop-security.test.mjs`: `onTrace` de hijos con el host real y la separación de RPC de operador y de agente.

## Pendientes y límites conocidos

- **`App.jsx` no se monta en ninguna prueba.** La cadena `ChatCard` → contexto → validación → `PhantomChat` → Orquestador se ejercita con componentes y validación productivos, pero el estado propio de `App.jsx` (`agentRequest`, `openPhantomChat`, el `Provider`) lo reproduce la fixture y solo se comprueba por lectura y por `npm run build`.
- Sin evidencia de sesiones reales de Claude, Codex u OpenCode ni del supervisor con Claude Code.
- Las llamadas a MCP dentro de un turno se ven por el evento de herramienta del proveedor (`mcp__phantom_workspace__phantom` con su entrada estructurada). El adaptador `mcp` (llamada JSON-RPC con `agentId`) existe y está probado, pero ningún camino de producción lo alimenta todavía.
- Storybook no tiene fixture de `agent.traces.*` ni `supervisor.*`: el Orquestador solo muestra sus estados de error/no disponible. `test/storybook-smoke.mjs` tolera exactamente esas cinco lecturas sin fixture; cualquier otra llamada sin fixture sigue fallando.
- Los hooks PTY ahora cubren todas las herramientas (antes solo `Agent`): más procesos asíncronos por llamada. Es un cambio deliberado de `test/agent-policy.test.mjs`; permisos y política no cambian.
- El historial no se recorta por tiempo, solo por cantidad; no hay borrado manual.
