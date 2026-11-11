# Identidad y avance de agentes

Cada panel de terminal puede conservar una asignación a una card de Phantom y una sesión de OpenCode. El nombre visible es el título del panel; el ID del panel mantiene la identidad al renombrarlo o abrir una nueva sesión de terminal.

## Usarlo

1. Abre **Identidad y card** debajo de la carpeta de una terminal.
2. Escribe un nombre, selecciona una card y, opcionalmente, una sesión OpenCode de esta carpeta o de sus worktrees.
3. Declara el paso y su estado. Guarda la identidad.
4. Usa la flecha junto a la card para abrirla; desde la card, **Ver terminal** vuelve al panel, incluso si estaba oculto.
5. **Copiar contexto guardado** prepara la identidad y los comandos de reporte para pegarlos en la conversación del agente. Copia la asignación persistida y conserva los cambios aún sin guardar en el formulario.

Los listados proceden de Phantom y de `opencode session list --format json --max-count 1000`. Seleccionar una sesión es una asociación explícita; no comprueba qué proceso está ejecutándose en la PTY. El catálogo es acotado y muestra sesiones accesibles del proyecto y de su familia Git de worktrees.

## Reportar desde un agente

Las terminales creadas con esta versión reciben las variables `PHANTOM_AGENT_NODE`, `PHANTOM_AGENT_CLI`, `PHANTOM_WORKSPACE_SOCKET` y `PHANTOM_TERMINAL_SESSION_ID`. Sus procesos descendientes pueden consultar la identidad vigente y reportar avance:

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" context
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Validando tokens" working
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Falta configurar la base de datos" blocked
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Checks ejecutados; pendiente revisión" review
```

Estados: `idle`, `working`, `blocked`, `review`. El reporte actualiza únicamente paso, estado, origen y fecha; nunca el resultado nativo de la card. `review` significa listo para revisión. El agente necesita recibir las instrucciones y ejecutar el comando para que aparezca un reporte; vincular OpenCode no lo habilita automáticamente.

El contexto consulta el nombre y la asignación actuales del host, sin depender de una copia antigua del nombre en el entorno. Una terminal ya abierta antes de esta versión puede recibir un vínculo manual, pero necesita una nueva sesión para heredar las variables de reporte. Una sesión finalizada o reemplazada no puede publicar nuevos reportes.

## Persistencia y fuentes

La asignación se almacena en `node.data.agent`:

```js
{
  cardId, cardTitle,
  provider: 'opencode', providerSessionId,
  step, status,
  source: 'manual' | 'agent', updatedAt
}
```

Los campos son opcionales. Desvincular o cambiar la card reinicia el paso declarado. El nombre se mantiene en `node.title`; no se duplica. Los descriptores de terminal incluyen el nombre y la asignación actuales. Cerrar el host conserva los últimos reportes como historial: no acredita que el agente siga activo al restaurar. El estado de la PTY se muestra por separado.

Las actualizaciones de presentación mediante `node.update` conservan la asignación actual, evitando que un cambio de tamaño de texto o un guardado antiguo borre un reporte reciente. El editor guarda únicamente campos modificados desde su apertura.

## API del host

- `opencode.sessions {workspaceId}` → `{available,items:[{id,title,directory,updated}],observedAt,reason?,limit?}`. Lectura del CLI local, ruta opcional en `settings.opencodePath`.
- `terminal.agent.update {workspaceId,nodeId,patch}` → node. Campos permitidos: `name`, `cardId`, `providerSessionId`, `step`, `status`. Las nuevas asociaciones se validan contra los catálogos del proyecto.
- `terminal.agent.context {sessionId}` → identidad/asignación vigente y estado de terminal.
- `terminal.agent.report {sessionId,patch:{step?,status?}}` → contexto actualizado. Solo la sesión viva actual del panel puede reportar.

Este incremento aporta identidad, vínculos, reportes y navegación. El chat de mando, el envío de instrucciones por SDK y la distribución automática de trabajo son capas posteriores.

## Verificación

```sh
npm test
npm run build
node test/agent-desktop.mjs
```

Las pruebas usan PTY/IPC reales y datos de cards/sesiones explícitamente sintéticos, sin ejecutar modelos. Cubren pertenencia al proyecto, persistencia, reportes desde el CLI y la PTY, sesiones obsoletas, concurrencia de reporte/edición, recuperación de errores de guardado/clipboard, navegación y render de escritorio.
