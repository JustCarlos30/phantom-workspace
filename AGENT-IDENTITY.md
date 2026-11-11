# Identidad y avance de agentes

Cada panel de terminal puede conservar una asignación a una card de Phantom y una sesión de OpenCode. El nombre visible es el título del panel; el ID del panel mantiene la identidad al renombrarlo o abrir una nueva sesión de terminal.

## Usarlo

1. Abre **Identidad y card** debajo de la carpeta de una terminal.
2. Escribe un nombre, selecciona una card y, opcionalmente, una sesión OpenCode de esta carpeta o de sus worktrees.
3. Declara el paso y su estado. Guarda la identidad.
4. Usa la flecha junto a la card para abrirla; desde la card, **Ver terminal** vuelve al panel, incluso si estaba oculto.
5. **Copiar contexto guardado** prepara la identidad y los comandos de reporte para pegarlos en la conversación del agente. Copia la asignación persistida y conserva los cambios aún sin guardar en el formulario.

Los listados proceden de Phantom y de `opencode session list --format json --max-count 1000`. Seleccionar una sesión es una asociación explícita; no comprueba qué proceso está ejecutándose en la PTY. El catálogo es acotado y muestra sesiones accesibles del proyecto y de su familia Git de worktrees.

## Lectura y ventanas de conversación

- **Ir al final** aparece únicamente al leer por encima del final del buffer normal de xterm. Desplaza la vista al último contenido sin enviar entrada a la PTY. La salida entrante conserva la posición de lectura; al ajustar tamaño o tipografía se usa un marcador de xterm para mantener la línea cuando el reflujo lo permite.
- En el buffer alternativo, la rueda conserva el comportamiento de la aplicación (incluidos sus reportes de ratón). No se ofrece historial normal como si fuera el historial de conversación de OpenCode.
- Entre el 25 % y el 45 % de zoom, el resumen prioriza título, estado declarado, misión, paso y señal PTY en una columna, con texto compensado de 10–12 píxeles de pantalla y valores largos limitados a dos líneas. Por debajo del 25 %, muestra solo título, estado declarado y señal PTY. La descripción accesible conserva misión/paso completos, card, origen e identificadores PTY/OpenCode; declara los vínculos ausentes sin inferir actividad. El resumen queda expuesto a accesibilidad, sin controles; barra, terminal y editor quedan inertes y ocultos, conservando sesión y borrador. Los errores no lo cubren; al volver al zoom normal están disponibles las acciones de sesión.
- **Enfocar para escribir** aparece en paneles con menos de 16 filas. Amplía temporalmente el mismo nodo: conserva la sesión y la geometría guardada.
- Al abrir el editor, el foco va a **Nombre del agente**. **Escape** cierra y devuelve el foco al botón de apertura sin desplazar la vista. El formulario se desplaza dentro del panel, con campos y acciones adaptados a 400 px; sus teclas no activan atajos del canvas y sus controles siguen disponibles con la herramienta de mano. Un error de guardado conserva el borrador; guardar solo campos editados respeta los reportes concurrentes.

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
node test/conversation-windows.mjs
```

La prueba de ventanas usa Playwright Electron (`--ozone-platform=headless`), un perfil temporal de `createHost`, IPC y una PTY real con catálogos sintéticos inyectados solo en la prueba. Observa las líneas renderizadas de xterm para comprobar conservación de lectura con salida, tipografía y geometría, vuelta al contenido más reciente y ausencia de remontaje. Ejercita rueda de una aplicación en buffer alternativo, resumen semántico, teclado/scroll/error del editor, reportes concurrentes, enfoque sin otra sesión y cambio de sesión, en ventanas de escritorio y estrechas. Escribe capturas y evidencia únicamente bajo `/tmp/opencode`, limpia aplicación/host/PTY en `finally`, imprime `PASS` por comportamiento y termina con código distinto de cero si falla. El controlador ejecuta los checks; este documento no acredita su resultado.
