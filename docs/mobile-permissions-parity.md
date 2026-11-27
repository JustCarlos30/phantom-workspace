# Permisos móviles: capabilities seleccionables

Catálogo en `src/phone-permissions.mjs` (`projectActions`, `nodeActions`), usado por el editor de `AndroidGatewaySettings.jsx`.

| Ámbito | Capability | Requiere |
|---|---|---|
| Proyecto (`nodeId: null`) | `terminal.create`, `terminal.agent.handoff`, `limits.read` | `workspace.read` |
| Nodo terminal | `terminal.write`, `terminal.stop` | `read` del nodo |
| Nodo chat | `chat.send`, `chat.stop`, `chat.question.answer`, `chat.permission.answer` | `read` del nodo |
| Terminal con `data.chat` | ambos conjuntos | `read` del nodo |

## Reglas
- Desmarcar la lectura elimina todas las capabilities dependientes del mismo ámbito.
- `standardGrants` no cambia: chat principal `read/chat.send/chat.stop` y `workspace.read`.
- Los grants desconocidos ya presentes en un dispositivo se conservan al editar.
- El reconocimiento de autoridad del agente (chat principal/orquestador) y el SAS/QR no cambian; no se aprueban dispositivos automáticamente.

## Limitaciones
- Marcar una casilla solo concede el permiso en el host. **No basta para ejecutar**: el gateway y la app Android externos deben admitir cada método (`terminal.create`, `terminal.agent.handoff`, `limits.read`, `terminal.write`, `terminal.stop`, `chat.send`, `chat.stop`, `chat.question.answer`, `chat.permission.answer`) antes de poder usarlo. Esto no está verificado aquí.
- Chat en terminales se detecta solo con el `type` y `data.chat` que informa el catálogo del host; si el host no lo informa, el nodo no ofrece acciones de chat (no se infiere).
