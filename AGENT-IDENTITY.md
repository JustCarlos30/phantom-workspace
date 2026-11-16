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

## Encargar trabajo a otra terminal

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" projects
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" handoff --project "Nombre del proyecto" --title "Revisar API" "Texto del encargo"
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" handoff --agent codex --file encargo.txt
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" handoff -
```

`handoff [--project ID|NOMBRE] [--title TÍTULO] [--agent claude|codex|opencode|none] (TEXTO | --file RUTA | -)` admite exactamente una fuente; `-` lee stdin. Opciones desconocidas o repetidas dan error de uso. Timeout: 60000 ms. `projects` no recibe argumentos y lista todos los proyectos, marcando el de la sesión.

Por defecto el destino es el proyecto emisor; se admite id exacto o nombre exacto sin distinguir mayúsculas. Un nombre ambiguo o inexistente devuelve los nombres disponibles. El agente por defecto es el detectado en primer plano (Claude Code, Codex u OpenCode); sin uno admitido usa `none`. Se abre un panel visible `Encargo: <título>` con una sesión nueva 120×32 y su worktree, política y entorno habituales. Para trabajo de otro proyecto o rama, usa este camino en vez de escribir fuera del propio worktree.

El texto no puede quedar vacío tras trim y tiene máximo 32000 caracteres. El título es una línea sin controles, máximo 120; por defecto la primera línea no vacía del texto recortada a 60. Límite en memoria: cinco encargos por sesión emisora por hora, reservados al aceptar incluso si falla el arranque; profundidad máxima tres. Sin encargo previo, el emisor tiene profundidad cero.

El arranque escribe una sola línea constante: `claude "<FIJO>"`, `codex "<FIJO>"` u `opencode --prompt "<FIJO>"`, seguida de `\r`. `none` deja la PTY viva sin escribir. La constante pide leer `context`, campo `handoff`; nunca interpola texto, títulos ni nombres en el comando. El encargo viene de otro agente, no del usuario, y no amplía mandato ni permisos. Atención del destino recibe un aviso `Encargo recibido: <título>` con clave única `handoff:<id>`, referencia a la sesión nueva y eventos `attention.new`/`state.changed` (tope 1000). Si falla crear la sesión, el panel conserva `launchState: failed`, se propaga el error y no se añade aviso.

## Enviar procesos largos a Automatizar

Para servidores, watchers y tareas largas que ocuparían la sesión, usa `launch`; no los dejes en primer plano ni en segundo plano de tu propio turno.

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" launch --title "Servidor de desarrollo" "npm run dev"
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" processes
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" output ID 80
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" stop ID
```

`launch [--title TÍTULO] "COMANDO"` crea un panel `Proceso: <título>` en el mismo workspace, con una sesión nueva en la carpeta de la sesión emisora, sin worktree propio. Escribe el comando seguido de `\r`; el título por defecto son sus primeros 60 caracteres. El comando debe tener 1..2000 caracteres tras trim y ser una línea sin controles; el título admite hasta 120. Solo la sesión viva actual del panel puede lanzar procesos. Un proceso no puede lanzar otros. Límite en memoria: diez lanzamientos por sesión emisora por hora, reservados incluso si falla el arranque. Timeout de lanzamiento: 60000 ms.

`processes` lista los procesos del workspace con estado de sesión y `mine` según el panel emisor. `output ID [LÍNEAS]` lee las últimas líneas (80 por defecto, entre 1 y 400); `stop ID` detiene la sesión del proceso. ID es el `processId`, y ambos comandos solo aceptan procesos del mismo workspace. Los argumentos inválidos dan error de uso.

En **Automatizar → Procesos** aparecen los más recientes primero, con **Ver sesión**, **Detener** y **Abrir** para las URL de servicios gestionados atribuidos a su sesión. **Actualizar** y los eventos de salida de terminal refrescan el estado. Cerrar el panel del proceso no elimina ni modifica el worktree emisor. `data.process = {id,command,title,cwd,from:{nodeId,title},createdAt}` es inmutable ante `node.update`.

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

Los campos son opcionales. Desvincular o cambiar la card reinicia el paso declarado. El nombre se mantiene en `node.title`; no se duplica. Al vincular una card, si el panel conserva el nombre genérico «Terminal» y no se envía un nombre, toma el título de la card (una línea, máximo 80 caracteres). Un nombre puesto a mano nunca se reemplaza, y desvincular la card no restaura «Terminal». Los descriptores de terminal incluyen el nombre y la asignación actuales. Cerrar el host conserva los últimos reportes como historial: no acredita que el agente siga activo al restaurar. El estado de la PTY se muestra por separado.

Las actualizaciones de presentación mediante `node.update` conservan la asignación actual, evitando que un cambio de tamaño de texto o un guardado antiguo borre un reporte reciente. El editor guarda únicamente campos modificados desde su apertura.

Un panel creado por encargo guarda `data.handoff = {id,from:{workspaceId,workspaceName,nodeId,title},title,brief,agent,depth,createdAt}`. Es inmutable ante `node.update`, que lo preserva incluso al intentar borrarlo. La profundidad es la del emisor más uno. `context` expone `handoff:{id,from,title,brief,createdAt}` y añade la aclaración de origen y permisos a sus instrucciones.

## API del host

- `opencode.sessions {workspaceId}` → `{available,items:[{id,title,directory,updated}],observedAt,reason?,limit?}`. Lectura del CLI local, ruta opcional en `settings.opencodePath`.
- `terminal.agent.update {workspaceId,nodeId,patch}` → node. Campos permitidos: `name`, `cardId`, `providerSessionId`, `step`, `status`. Las nuevas asociaciones se validan contra los catálogos del proyecto.
- `terminal.agent.context {sessionId}` → identidad/asignación vigente y estado de terminal.
- `terminal.agent.report {sessionId,patch:{step?,status?}}` → contexto actualizado. Solo la sesión viva actual del panel puede reportar.
- `terminal.agent.projects {sessionId}` → `[{id,name,path,current}]`. Exige una sesión existente; socket privado, no renderer.
- `terminal.agent.handoff {sessionId,brief,title?,project?,agent?}` → `{handoffId,workspaceId,workspaceName,nodeId,sessionId,title,agent,launched}`. Solo la sesión viva actual del panel; rechaza claves desconocidas. `launched` indica que se escribió la línea fija de arranque, no que el agente terminó su trabajo. Socket privado, no renderer.
- `terminal.agent.launch {sessionId,command,title?}` → `{processId,nodeId,sessionId,title,command,cwd}`.
- `terminal.agent.processes {sessionId}` → `[{processId,nodeId,sessionId,title,command,cwd,status,createdAt,mine}]`, con `status: "running" | "stopped"`.
- `terminal.agent.process.output {sessionId,id,lines?}` → resultado de `terminals.tail` (incluye `lines`).
- `terminal.agent.process.stop {sessionId,id}` → `{ok:true}` de `terminals.stop`.

Los métodos de procesos requieren una sesión existente y su panel emisor; `launch` exige además que sea la sesión viva actual. Rechazan claves desconocidas. Usan el socket privado, no el renderer; la interfaz consulta `terminal.list` y `services.list`, y detiene mediante `terminal.stop`.

Los encargos abren terminales con contexto y arranque del CLI elegido; conservan el registro, alcance y permisos normales de cada agente.

## Verificación

```sh
npm test
npm run build
node test/conversation-windows.mjs
```

La prueba de ventanas usa Playwright Electron (`--ozone-platform=headless`), un perfil temporal de `createHost`, IPC y una PTY real con catálogos sintéticos inyectados solo en la prueba. Observa las líneas renderizadas de xterm para comprobar conservación de lectura con salida, tipografía y geometría, vuelta al contenido más reciente y ausencia de remontaje. Ejercita rueda de una aplicación en buffer alternativo, resumen semántico, teclado/scroll/error del editor, reportes concurrentes, enfoque sin otra sesión y cambio de sesión, en ventanas de escritorio y estrechas. Escribe capturas y evidencia únicamente bajo `/tmp/opencode`, limpia aplicación/host/PTY en `finally`, imprime `PASS` por comportamiento y termina con código distinto de cero si falla. El controlador ejecuta los checks; este documento no acredita su resultado.
