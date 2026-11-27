# API móvil de proyecto: `workspace.mobile.snapshot`

Lectura RPC del host local (`host/mobile-project.mjs`, cableada en `host/server.mjs`) para que un gateway móvil pinte un proyecto y sus sesiones. Estado: implementada y cubierta por `test/mobile-project.test.mjs`. **El cliente Android no la consume todavía**; este documento no acredita que ningún cliente funcione.

## Modelo de confianza

- El socket local del host (`host.sock`, modo 0600) **no autentica teléfonos** y concede autoridad completa a quien conecta. Esta RPC solo hace lectura acotada, pero no decide qué puede ver un dispositivo.
- El **gateway Android externo debe imponer `nodeIds` desde los permisos (grants) del dispositivo** y nunca reenviar identificadores elegidos por el cliente sin cruzarlos con ellos. Un `nodeIds` vacío devuelve una vista vacía; no significa «todos».
- La RPC no acepta estado del cliente (solo `workspaceId` y `nodeIds`), no inicia procesos y no modifica el host (los tests comprueban que el estado, las sesiones y los chats no cambian).

## Petición

```json
{ "method": "workspace.mobile.snapshot", "payload": { "workspaceId": "…", "nodeIds": ["…"] } }
```

| Campo | Regla |
| --- | --- |
| `workspaceId` | Texto obligatorio; debe existir (`Workspace not found` si no). |
| `nodeIds` | Array explícito, obligatorio. Máx. 64 ids de texto (duplicados se ignoran). `[]` ⇒ resultado vacío. |
| otros campos | Rechazados (`Campo no admitido`). |

Cada id debe ser un nodo `terminal` del proyecto (incluye tarjetas de chat) o el chat principal `phantom:<workspaceId>`. Cualquier otro id (de otro proyecto, inexistente, de otro tipo de panel) rechaza **toda** la petición con el mismo mensaje `Nodo no autorizado o no disponible en este proyecto`, sin revelar si existe en otro sitio.

## Respuesta (`version: 1`)

```json
{
  "version": 1,
  "observedAt": "ISO-8601",
  "project": { "id": "…", "name": "…" },
  "limits": { "nodeIds": 64, "pending": 50, "attention": 50, "text": 200, "title": 120 },
  "sessions": [{
    "nodeId": "…", "kind": "terminal | chat | main", "title": "…", "hidden": false,
    "process": { "state": "running | exited | lost | none", "exitCode": 0 },
    "chat": { "provider": "claude", "running": false },
    "agent": { "state": "…", "reportedStatus": "idle|working|blocked|review|null", "source": "manual|agent|null", "updatedAt": "…|null", "observedAt": "…|null", "run": { "phase": "…", "stalled": false } },
    "pendingCount": 0,
    "target": { "workspaceId": "…", "nodeId": "…", "sessionId": "…|null" }
  }],
  "pending": [
    { "kind": "permission", "id": "…", "nodeId": "…", "sessionId": "…|null", "summary": "Permiso: Bash", "danger": true },
    { "kind": "question", "id": "…", "nodeId": "…", "sessionId": "…|null", "summary": "…", "questionCount": 1 }
  ],
  "attention": [{ "id": "…", "title": "…", "source": "…", "createdAt": "…", "acknowledged": false, "nodeId": "…", "sessionId": "…|null" }],
  "tasks": [{ "id": "task_…", "title": "…", "nodeId": "…", "via": "agent.cardId" }],
  "truncated": { "pending": false, "attention": false }
}
```

### Semántica de `agent.state`

Solo se informa lo que el host observa; **nunca se deduce `completed` de un proceso inactivo**.

- Chats (`chat`/`main`): `awaiting_approval` si hay un permiso pendiente vivo, `awaiting_input` si hay una pregunta, `working` si hay un turno u operación en curso, `idle` en otro caso (idle = sin turno activo, no «terminado»).
- Terminales vivas: la señal de pantalla del host (`working`, `awaiting_approval`, `awaiting_input`); si no hay, el estado que el propio agente reportó por hooks (`working`, `blocked`, `review`, solo con `source: "agent"`); si no, `idle`.
- Terminal sin proceso vivo: `exited` o `lost` (el host se reinició); sin sesión: `none`. Un estado reportado antiguo (`reportedStatus`) se muestra aparte y no se usa para afirmar actividad de un proceso muerto.
- `agent.run.phase` es el avance que el host ya guarda para runs de Phantom; se copia tal cual, junto a `stalled`.

### Pendientes, atención y tareas

- `pending`: permisos y preguntas **vivos** de los turnos de chat de los nodos pedidos (id de petición que acepta `chat.permission.answer` / `chat.question.answer`). El resumen se limita a la herramienta (permiso) o al texto de la primera pregunta (200 car., sin rutas). No incluye `detail` del comando ni opciones. La app abre la sesión con `chat.get` para ver el contenido completo. Las terminales que esperan en pantalla se reflejan en `agent.state`, sin id de petición.
- `attention`: elementos de `workspace.attention` atribuibles por `nodeId` o `sessionId` a un nodo autorizado (más recientes primero, máx. 50). Los avisos de proyecto sin atribución se omiten.
- `tasks`: solo la tarea vinculada al nodo mediante `agent.cardId`. No se infieren por otros medios; sin vínculo, no aparecen. El estado de la tarea no se copia (se consulta por las vías de Phantom existentes).
- `target`: destino para abrir la sesión. `sessionId` es la sesión de terminal vigente del nodo, o `null` para chats (se abren con `workspaceId` + `nodeId`).

### Lo que nunca se devuelve

`state`/`settings`, `env`, tokens, `cwd`, rutas de worktree, PID, shell, historial/`snapshot` de terminal, ni datos de nodos no pedidos. Los textos pasan por un limpiador que sustituye la ruta del proyecto, el home y rutas absolutas conocidas por `[ruta]`, quita controles y los acota. La respuesta está acotada por los límites anteriores; `truncated` indica recortes.

## Contratos existentes que se reutilizan (observados en `host/server.mjs`)

| RPC | Parámetros observados | Notas / diferencias para el gateway |
| --- | --- | --- |
| `terminal.create` | `{ workspaceId, nodeId?, cols?, rows?, shell? }` → `{ session, node }` | Sin `nodeId` crea un nodo terminal nuevo. **Inicia un proceso**: es una escritura que el gateway debe autorizar aparte. Falla si el nodo ya tiene una sesión viva. |
| `terminal.agent.handoff` | `{ sessionId, project, … }` (ver `validateHandoff`) → `{ handoffId, workspaceId, nodeId, sessionId, … }` | Está pensado para un agente dentro de una terminal: exige la **sesión viva del panel emisor** (`sessionId`) y resuelve el proyecto destino por nombre. Un teléfono no tiene esa sesión; el gateway debe elegir una sesión emisora autorizada o se necesita un contrato nuevo. |
| `chat.get` / `chat.send` / `chat.stop` | `{ workspaceId, nodeId, text? }` | `nodeId` puede ser `phantom:<workspaceId>`. |
| `chat.permission.answer` | `{ workspaceId, nodeId, requestId, decision: allow\|always\|deny }` | `requestId` = `pending[].id`. |
| `chat.question.answer` | `{ workspaceId, nodeId, requestId, answers\|undefined }` | Las respuestas se indexan por el texto completo de cada pregunta (que la snapshot no entrega). |
| `limits.read` | `{ force? }` | Porcentajes y reinicios de las suscripciones; no es por proyecto. |

Ninguna de estas RPC comprueba permisos de dispositivo: todas confían en el llamador del socket.

## Adaptación pendiente del gateway

1. Mapear los grants del dispositivo a `nodeIds` por proyecto y construir siempre la petición desde ahí; rechazar cualquier id fuera de los grants antes de llamar al host.
2. Aplicar los mismos grants a `chat.*` y `terminal.*` (el host no lo hace) y exigir firma/biometría para las escrituras según `docs/mobile-security.md`.
3. Decidir cómo cubrir `terminal.agent.handoff` desde un teléfono (ver tabla).
4. Refrescar por sondeo o por eventos del host; la snapshot es una foto con `observedAt`, no una suscripción.
5. Verificar con un cliente real: hasta entonces la paridad móvil no está demostrada.
