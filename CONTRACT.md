# Contrato de implementación v1

Todos los agentes trabajan en esta raíz, con ownership de archivos disjunto. No commits ni cambios a configuraciones personales. ESM JS en host/desktop; React JSX en renderer. `npm install` lo maneja el coordinador.

## Datos

`state.get` → `{schemaVersion:1,activeWorkspaceId,workspaces,settings,lastSavedAt}`.

Workspace: `{id,name,path,canonicalPath,createdAt,updatedAt,camera:{x,y,zoom},nodes:[],tasks:[],contextRefs:[],missions:[],workflows:[],services:[],attention:[]}`. IDs UUID; campos adicionales compatibles permitidos.

Node: `{id,type,title,x,y,width,height,groupId:null,data:{}}`. Tipos: `terminal`, `browser`, `note`, `tasks`, `context`, `git`, `services`, `docker`, `mission`, `workflows`, `playwright`, `playground`, `incorporaciones`. Cámara en coordenadas pantalla; posición de node en unidades canvas. Tamaño inicial terminal 640×400; browser 800×520. El usuario crea paneles; restaurar no inicia procesos nuevos.

Task local: `{id,kind:'draft'|'checklist'|'phantom',title,description,status:'todo'|'doing'|'done',phantomId?,missionId?,refs:[],createdAt}`. Phantom source status permanece separado. Mission: `{id,title,notes,nextAction,refs:[],createdAt}`. ContextRef: `{id,path?,kind,title,source?,ref?}`. Workflow: `{id,title,description,steps:[],version:1}`. Service: `{id,url,title,source:'pinned'|'managed'|'compose',...}`.

Reference: node `reference` con `data.tags?:string[]`; research usa exactamente un tag de estado `research:inbox`, `research:liked` o `research:discarded` (otros tags se conservan). Comment: `{id,number,nodeId?,x,y,messages:[],resolved?,page?}`; `page` es `{url,title?,capture?}`, donde `url` es HTTP(S), `title` es texto y `capture` es el nombre privado `<32-hex>.png` de la captura persistida de la página.

## Bridge renderer

`window.phantom.invoke(method,payload={})` → Promise resultado; errores rechazados con mensaje útil. `window.phantom.onEvent(callback)` → unsubscribe. Evento `{type,workspaceId?,sessionId?,...}`. `window.phantom.platform` literal Linux. No APIs Node en renderer remoto.

Renderer sin bridge muestra 'Abre la aplicación de escritorio' (no datos fake). Puedes usar test bridge solo dentro de pruebas.

## Host RPC

Socket Unix privado en directorio de estado. Una línea JSON por mensaje: request `{id,method,payload}`; response `{id,result}` o `{id,error:{message,code?}}`; evento `{event:{type,...}}`. Cliente mantiene conexión y correlación de IDs. Host toma `--data <path>`; ready JSON en stdout. Estado por defecto `${XDG_STATE_HOME||~/.local/state}/phantom-workspace`, override `PHANTOM_WORKSPACE_HOME`. No estado en carpeta del usuario abierta. Socket path `host.sock`. El cliente arranca host separado si no existe. Procesos Electron y daemon independientes.

### Métodos core (agente host)

- `system.info`, `state.get`, `settings.update {patch}`.
- `workspace.open {path}`, `.select {id}`, `.update {id,patch}`, `.relocate {id,path}`.
- `node.create {workspaceId,type,title?,x?,y?,width?,height?,data?}` → node; `.update {workspaceId,id,patch}` → node; `.remove {workspaceId,id}`.
- `terminal.create {workspaceId,nodeId?,shell?,cols?,rows?}` → `{session,node}`; `.list {workspaceId}` → array; `.attach {sessionId,fromSeq?}` → `{session,data,seq,truncated}` (ANSI snapshot); `.write {sessionId,data}`, `.resize {sessionId,cols,rows}`, `.stop {sessionId}`. Sesión `{id,workspaceId,nodeId,pid,status:'running'|'exited'|'lost',cols,rows,generation,exitCode?,createdAt}`.
- Identidad de agentes: `terminal.agent.update/context/report` y `opencode.sessions`, especificados en [AGENT-IDENTITY.md](AGENT-IDENTITY.md). `node.title` es el nombre; `node.data.agent` conserva vínculo y avance declarado. `node.update` preserva ese objeto; sus cambios usan el método dedicado. No modifica el resultado fuente de Phantom.
- Cards de chat: un node `terminal` con `data.chat {provider:'claude'|'opencode'|null,autoApprove?}` conversa con ese agente en vez de mostrar el PTY (`null` = terminal). `data.chat` solo cambia con `chat.configure {workspaceId,nodeId,provider?,autoApprove?}`; `node.update` lo preserva. `chat.get {workspaceId,nodeId}` → `{provider,autoApprove,running,sessionId,messages}`; `chat.send {…,text}` lanza un turno headless del CLI (`claude -p --output-format stream-json`, `opencode run --format json`) en el cwd de la card y reanuda la sesión del proveedor; `chat.stop`; `chat.clear` olvida la conversación del proveedor activo. Cola: `chat.send` con un turno en curso (o con mensajes ya en espera) responde `{ok,queued:true,id}` y lo añade a `queue:[{id,text,createdAt}]` del hilo (máx. 20, persistida); al terminar una respuesta `done` se envía el siguiente; `stopped`/`error` o un reinicio del host la dejan en pausa. `chat.queue.remove {…,id}` → `{ok,text}`; `chat.queue.send {…,id?}` reanuda (con `id`, ese va primero). `chat.get` y `chat.update` incluyen `queue`. Mensaje `{id,role,provider?,parts:[{type:'text',text}|{type:'tool',id,name,detail,status}],status:'streaming'|'done'|'error'|'stopped',error?}`. Evento `chat.update {workspaceId,nodeId,provider,running,messages,reset?}` (upsert por id). Un hilo por proveedor, persistido en `chats.json`; rutas en `settings.claudePath`/`opencodePath`.
- Incorporaciones (`host/merges.mjs`, `host/merge-guard.mjs`): por proyecto, `workspace.integration {enabled,plan,queue:[]}`. Activo, cada terminal solo escribe su rama `phantom/terminal-<nodeId>` y una única sesión orquestadora (node `terminal` con `data.role:'orchestrator'`, sin worktree, cwd = checkout del proyecto; `node.update` preserva `role`) ordena e incorpora en la rama del checkout. Guard: hooks `reference-transaction` y `pre-push` en el `.git` común; solo restringen procesos con entorno de terminal Phantom (`PHANTOM_TERMINAL_SESSION_ID`/`PHANTOM_TERMINAL_ROLE`, rama propia en `PHANTOM_TERMINAL_BRANCH`) y dejan pasar a quien presenta `PHANTOM_MERGE_TOKEN` (orquestador y host). Es una barandilla, no un sandbox; no se instala sobre hooks ajenos ni con `core.hooksPath` personalizado.
- Ramas (`host/branches.mjs`, panel `branches`): lectura de todas las ramas locales y sus worktrees (`branch.overview`: terminal dueña, commits delante/detrás de la rama de integración, archivos sin guardar y cuáles ya son idénticos en la base, solapes y conflicto previsto con `git merge-tree`). Acciones explícitas del usuario: `branch.commit` (guarda todo el worktree en su rama), `branch.integrate` (merge `--no-ff` en la base; un conflicto se aborta y se informa), `branch.update` (trae la base; fast-forward si no hay commits propios, merge solo con árbol limpio) y `branch.remove` (quita worktree y rama solo si no hay cambios sin guardar, ni commits fuera de la base, ni terminal en el canvas). Nunca usa `--force` ni descarta trabajo. Skills (`skills.catalog`) añade el origen `worktree` para Skills nuevas o modificadas en otros worktrees; `phantom.list` de tareas añade `location {path,branch,main}` a cada Card.
  - Renderer: `merge.status {workspaceId}` → `{available,enabled,reason?,base:{branch,oid,uncommitted},guard:{installed,reason?},orchestrator:{nodeId,title,running}|null,plan,planUpdatedAt,active:[],queue:[],history:[],observedAt}`; `merge.configure {workspaceId,enabled}` instala/quita el guard → status. `active`: terminales con trabajo sin solicitar `{nodeId,title,branch,ahead,behind,uncommitted,files,fileCount,overlaps:[{path,with:[]}],step,status,running}`. Solicitud: `{id,nodeId,title,branch,summary,note,status:'queued'|'merging'|'merged'|'conflict'|'rejected'|'withdrawn',headOid,base,conflicts?,mergedOid?,requestedAt,updatedAt,finishedAt?}` (+ `position,stale,files,overlaps` en `queue`).
  - Solo desde una sesión de terminal (CLI `scripts/agent.mjs`, no expuestos al renderer): `merge.queue {sessionId}`; worker `merge.submit {sessionId,summary?}` (exige worktree limpio y commits nuevos; reenviar reabre la misma solicitud) y `merge.withdraw {sessionId}`; orquestador, con `token`: `merge.plan {text}`, `merge.order {ids}`, `merge.note {id,text}`, `merge.reject {id,reason}`, `merge.run {id}` (merge `--no-ff` del commit enviado; un conflicto se aborta, queda `conflict` y vuelve al worker como `blocked` + atención).
- Eventos `terminal.output {sessionId,workspaceId,data,seq}`, `terminal.exit {sessionId,workspaceId,exitCode}`, `state.changed {workspaceId?}`, `attention.new {workspaceId,item}`. Snapshot xterm headless+serialize, salida offscreen acotada, no replay de input. Historial al disco y estado lost en arranque frío.
- `task.create {workspaceId,...fields}`, `.update {workspaceId,id,patch}`, `.remove`; equivalentes `mission.create/update/remove`, `workflow.save/remove`, `context.pin/unpin`.
- `attention.list {workspaceId}`, `.ack {workspaceId,id}`, `.create {workspaceId,title,source,ref?}`.
- `storage.export {includeHistory?}` → JSON portable sin secrets/transcript default; `.import {data}` valida y nunca ejecuta.
- `host.shutdown` explícito termina procesos de este host y daemon.

## Routing integraciones

Agente host importa `handleIntegration(method,payload,context)` desde `integrations/index.mjs`. Resultado `{handled:boolean,result?}`. Context: `{workspace, getWorkspace(id), state, persist(), emit(event), sessions}`. `workspace` resuelto por payload.workspaceId cuando existe. `sessions` array de descriptores vivos (IDs/pid). Integraciones validan workspace y argumentos. Si hay método desconocido, host rechaza. `persist()` escribe estado y publica state.changed. Tests pueden pasar context fixture.

### Integraciones (agente adapters)

- `git.inspect {workspaceId,base?}` → `{available,root?,branch?,base?,dirty?,changes:[],branches:[],worktrees:[],observedAt,reason?}`. branch entries `{name,current,oid,ahead?,behind?,merged?}`. Sin fetch/merge automático.
- `services.list {workspaceId}` → `{items:[],observedAt}`; `.pin {workspaceId,url,title?}` → service; `.remove {workspaceId,id}`. Items `{id,title,url,source,status?,port?,owner?,observedAt?}`. Docker Compose labels o PTY lineage, nunca puerto huérfano tratado como propio.
- `docker.list {workspaceId}` → `{available,items:[],reason?}`; `.logs {workspaceId,id,tail?}` → `{text}`; `.action {workspaceId,id,action:'start'|'stop'|'restart'}`. IDs comprobados contra proyecto antes de actuar.
- `context.scan {workspaceId,query?}` → `{items:[],truncated}`; `.read {workspaceId,path}` → `{path,text,truncated}`. Solo archivos permitidos en raíz, rutas canónicas y límites de tamaño. Scope puede incluir skills globales por refs explícitas, nunca whole-home crawl.
- `phantom.list {workspaceId,topic:'tasks'|'memories'|'skills',query?}` → `{available,items:[],reason?,observedAt}`. Items normalizados `{id,title,kind,status?,body?,source,revision?,raw}`; raw conserva contrato nativo.
- `phantom.detail {workspaceId,topic,id,ref?}` → JSON; `.create {workspaceId,kind:'card'|'decision'|'skill',input}` → JSON con ID fuente; `.update {workspaceId,kind,id,revision,input}` → real supported API (card replacement explícito si no existe update).
- `phantom.control {workspaceId,id,action:'run'|'cancel'|'recover'|'verify'|'stop',model?}` → resultado/start descriptor; procesos owned y eventos `tool.output`/`tool.status`. No Store mutations. Bin default sibling harness_engineer/bin/phantom.mjs y settings.phantomPath override; ejecutar usando Node >=24 del host. No ejecutar modelos reales en tests.

### Automatización (agente automation)

`integrations/automation.mjs` exporta `handleAutomation(method,payload,context)` con `{handled,result}`. Agente adapters lo importa/encadena.

- `automation.start {workspaceId,url,actions?:[{type:'goto'|'click'|'fill'|'screenshot'|'wait',selector?,value?,url?,milliseconds?}],mode?:'integrated'|'isolated'}` → `{id,status,artifactDir}`. Solo canvas: `integrated` (por defecto) controla un panel del canvas; `isolated` es siempre headless (`headed:true` se rechaza) y su visor de trace se abre en un panel, nunca vía xdg-open. Playwright browser owned, trace.zip/screenshot reales; estado/output enlazados al workspace. Nada de evaluaciones JS arbitrarias desde páginas.
- `automation.list {workspaceId}` → `{items}`; `.stop {workspaceId,id}`; `.trace {workspaceId,id}` → `{path}` para abrir trace en renderer vía desktop.openPath o visor servido por propio proceso.
- `playground.run {workspaceId,runtime:'node'|'python'|'shell',code}` → `{id,status}`; `.stop`, `.list` → `{items}`. Tiempo/output acotados, proceso claramente owned, nunca correr al restaurar.
- `voice.transcribe {workspaceId,audioBase64,mimeType}` → `{text,provider}` usando local configurable o API si key existe en host. settings.voiceProvider/localWhisperCommand; keys jamás al renderer. Estado unavailable claro si falta motor.
- `voice.intent {workspaceId,text}` → `{action:'task'|'decision'|'open'|'search',text,title?,query?}` borrador editable, no ejecutar. UI elige acción explícitamente.
- Eventos `tool.output {workspaceId,id,data}`, `tool.status {workspaceId,id,status,result?,error?}`.

## Desktop (agente desktop)

Main resuelve métodos locales antes de host: `dialog.openFolder` → path|null; `dialog.openFile` → path|null; `desktop.openPath {path}` (comprobar ruta autorizada, no shell string); `desktop.openExternal {url}` http(s) only; `desktop.export {data}` save dialog; `desktop.info`; `desktop.quit {stopHost?:boolean}`.

`browser.attach {id,workspaceId,url,bounds:{x,y,width,height},visible:true}` crea/reusa WebContentsView en partition por workspace; `browser.bounds {id,bounds,visible}`; `browser.navigate {id,url}`; `.back/.forward/.reload/.detach` por id; `.capture {id}` → `{dataUrl}`. Eventos `browser.state {id,url,title,loading,canGoBack,canGoForward,error?}`. WebContentsView activo solo en foco 1:1 o coordenadas no solapadas; overview usa captura/placeholder etiquetada. Renderer tiene controles URL reales. Remote contextIsolation sandbox sin node/preload bridge, bloquear schemes ajenos, nuevas ventanas explícitas, sin aceptar IPC remoto.

`desktop/host-client.mjs` es ownership agente host y exporta `connectHost({dataDir,nodePath,hostPath,onEvent})` → `{invoke,close}`. Main busca runtime Node packaged o env PHANTOM_NODE_BINARY o /usr/bin/node; hostPath dev host/server.mjs, packaged app path. host client no usa Electron import.

## Ownership UI

Agente canvas: `src/App.jsx`, `src/components/Canvas.jsx`, `TerminalPanel.jsx`, `BrowserPanel.jsx`, `src/hooks/**`, `src/styles.css`.
Agente tools: `src/components/ToolPanels.jsx`, `Inspector.jsx`, `CommandPalette.jsx`, `VoiceCapture.jsx`, `src/tools.css`.

Tools exports: `ToolPanel({node,workspace,api,refresh,onOpenPanel,notify})` de ToolPanels; `Inspector({tab,workspace,state,api,refresh,onClose,onOpenPanel,notify})`; `CommandPalette({open,onClose,workspace,onAction})`; `VoiceCapture({workspace,api,refresh,notify,onClose})`. `api(method,payload)` es bridge invoke; refresh vuelve a state.get. onOpenPanel(type,data?,title?) crea panel y enfoca; notify(message,kind?) toast. Inspector tabs: tasks, context, sessions, git, services, docker, workflows, playwright, playground, settings. Tools usa `src/tools.css`, no toca styles.css. App controla pestaña/drawer, sidebar, canvas, crear terminal/browser/note, cmdK, voz, proyecto y toasts.

Tokens CSS compartidos: --bg --surface --surface-2 --ink --muted --line --accent --accent-soft --danger --success --warning --radius; font system sans, terminal monospace real. Textos español. Lucide icons. Estados vacíos útiles, nada de datos inventados en producto.
