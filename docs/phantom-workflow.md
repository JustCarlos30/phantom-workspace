# Registro de cambios con Phantom

Las terminales nuevas de Phantom Workspace inyectan una política de arranque para OpenCode mediante `OPENCODE_CONFIG_CONTENT.instructions`. Cada sesión recibe un archivo propio fuera del proyecto y del worktree, con identidad de terminal, cwd y rama. Se conservan las instrucciones heredadas y todos los demás campos del JSON inline, incluidos proveedores, permisos y MCPs. Un JSON heredado inválido produce un error de lanzamiento que indica cómo corregirlo; no se descarta silenciosamente.

La política no modifica `AGENTS.md` ni la configuración personal/global de OpenCode. Las instrucciones del proyecto mantienen su alcance y el contenido del repositorio no amplía el mandato de una tarea.

## Política y ejecución controlada

El bootstrap es una instrucción para el agente, no una barrera técnica que impida editar desde cualquier proceso del shell. Phantom CLI es quien controla los efectos, los checks y el cierre del trabajo ejecutado mediante sus comandos nativos `do`/`run`. El vínculo de identidad de una terminal tampoco demuestra por sí solo que exista una ejecución controlada.

Para cada solicitud de cambio, antes de editar, el agente debe:

1. Consultar el contexto de la terminal y usar su **cwd exacto**, no la raíz del proyecto ni otro worktree.
2. Determinar si ya está dentro de un `do`/`run` controlado, a partir del mandato/contexto recibido. En ese caso continúa esa tarea, su scope y sus checks, sin crear ni ejecutar tareas anidadas.
3. En otro caso, consultar la ayuda y el catálogo del CLI nativo y crear o reutilizar una tarea que corresponda a esa solicitud y ese worktree, con rutas escribibles explícitas y checks de aceptación. No debe pedir al usuario que diga «crea una card».
4. Vincular el ID canónico devuelto por Phantom a la terminal y ejecutar los efectos del trabajo dentro de `do`/`run`, con argumentos y modelo realmente disponibles según la ayuda instalada.

Una **tarea directa** (`lane: direct`) corresponde a un cambio sencillo y acotado. Una **card coordinada** (`lane: coordinated`, con coordinación nativa) corresponde a trabajo que requiere coordinación de varios pasos. No todo cambio necesita una card coordinada. El campo de identidad histórico `cardId` conserva el ID canónico de cualquiera de estas tareas.

Al retomar la misma solicitud se continúa la misma tarea; una solicitud independiente recibe una tarea independiente. Las preguntas de solo lectura no necesitan tareas ni cards. **Abrir un shell vacío no crea automáticamente ninguna card ni tarea.**

Si faltan runtime, modelo, checks requeridos o una decisión material, el agente comunica el bloqueo y reporta `blocked`, en lugar de hacer cambios sin seguimiento. Un reporte o una consulta nunca completan tareas. `review` solo significa listo para revisión; Phantom conserva la autoridad sobre verificación y cierre. No hay un estado `completed` aceptado por el comando de reportes.

## Comandos y ejemplos

Dentro de una terminal de Phantom Workspace:

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" context
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" bind ID_CANONICO_DEVUELTO_POR_PHANTOM
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Implementando el cambio autorizado" working
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Falta el modelo requerido" blocked
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Listo para revisión de Phantom" review
```

`bind ID` consulta `terminal.agent.context` y utiliza los `workspaceId` y `nodeId` devueltos para llamar a `terminal.agent.update`. La validación de ownership ya existente en el host comprueba el objeto nativo; el comando no crea tareas ni cambia sus estados nativos. La validación de catálogo del host y el requisito de la política de usar el worktree exacto son responsabilidades distintas: vincular un ID no sustituye revisar su contrato.

Ejemplos de aplicación:

- «Corrige el texto de este botón»: tarea directa con el archivo autorizado y un check de aceptación explícito, en el cwd de la terminal.
- «Coordina la migración y la integración de varios componentes»: card coordinada con scope, checks y coordinación nativa definidos.
- «¿Qué hace esta función?»: consulta de solo lectura, sin registro obligatorio.
- «Continúa con el cambio anterior»: consultar contexto y contrato; continuar el mismo ID, sin duplicarlo.

## Terminales nuevas y sesiones ya abiertas

La inyección ocurre al crear el PTY. No cambia el entorno de shells ni procesos OpenCode que ya estén ejecutándose. Tras instalar estos cambios hay que reiniciar el host de Phantom Workspace para cargar el código nuevo y crear o relanzar la sesión de terminal; abrir OpenCode dentro de esa sesión nueva permite heredar el bootstrap. Volver a adjuntar una terminal existente no equivale a relanzarla.

Si se corrige `OPENCODE_CONFIG_CONTENT` en el entorno que inicia el host, también hay que reiniciar ese host y relanzar la terminal para heredar el valor corregido. El contexto conserva los campos previos de identidad/progreso y añade cwd, rama e indicaciones de política. Al relanzar una terminal se genera una identidad de sesión y un archivo de política nuevos; la tarea vinculada al nodo se conserva para poder retomarla.
