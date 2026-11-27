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
- Resuelto en el host: `status` informa `hasChat` (booleano) por nodo, para terminales con `data.chat` y nodos `chat`. `nodeActions` lo consume y conserva la compatibilidad con `data.chat` y `type chat`. No se expone configuración de chat ni otros datos del nodo. Esto no demuestra paridad con la app Android.
- Chat principal de la UI: usa `chatActions()` del mismo catálogo que los nodos chat (`chat.send`, `chat.stop`, `chat.question.answer`, `chat.permission.answer`). El estándar no cambia.
