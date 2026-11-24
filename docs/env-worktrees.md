# Entorno Compose por worktree

Las acciones `env list`, `env up`, `env run` y `env down` de una terminal usan el `cwd` de su sesión registrado por el host. Compose se busca directamente en ese directorio (`compose.yaml`, `compose.yml`, `docker-compose.yaml` o `docker-compose.yml`). No se busca en la raíz del workspace como alternativa. Un `cd` posterior dentro del shell no cambia el `sender.cwd` registrado: usa la terminal creada para el worktree de origen.

El host entrega ese directorio fuera del payload del agente. Las acciones de terminal rechazan `cwd`, `root`, `environmentId`, `workspaceId`, `owner` y `actor` aportados por el agente. Compose recibe el archivo absoluto, `--project-directory` y el directorio de ejecución del worktree; por tanto sus rutas relativas, incluidos los bind mounts y contextos de build, tienen esa base. Se conserva la eliminación de variables `COMPOSE_*` y la verificación de contexto local y propiedad de contenedores.

Cada raíz canónica obtiene un proyecto Docker distinto por defecto. Los proyectos existentes solo se reutilizan tras las comprobaciones de ownership y configuración habituales. Los owners de worktree guardan una identidad derivada de la raíz canónica y su ruta. Los owners antiguos sin identidad siguen perteneciendo exclusivamente a la raíz del workspace. Servicios homónimos de otros worktrees no se reemplazan, eliminan ni cierran sus browsers al bajar o liberar un entorno.

Al salir la sesión o cerrar su panel se eliminan sus servicios `ephemeral`. Los `persistent` conservan el registro del worktree y solo pierden la vinculación con la terminal. En **Entorno → Docker → Servicios del compose**, la UI lista la raíz y los worktrees con owners registrados, muestra ruta y proyecto, y permite detener un servicio persistente mediante su identidad. Una identidad desconocida o una ruta registrada cuya identidad canónica cambió se rechaza. Si se elimina un worktree mientras conserva servicios, hay que restaurar su ruta original antes de gestionarlos; no se redirige la eliminación a otra raíz.

## Comandos posteriores en la terminal de origen

Una vez que el controlador haya validado e incorporado la reparación al host que atiende esa terminal, ejecutar desde la terminal de Phantom creada para el worktree de Music Talk:

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env list
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env up SERVICIO_PREVIEW
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env run SERVICIO_JOB --timeout 600
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env down SERVICIO_PREVIEW
```

Sustituir `SERVICIO_PREVIEW` y `SERVICIO_JOB` por los nombres realmente declarados en el Compose de ese worktree. Para un perfil declarado:

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env up --profile PERFIL
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env down
```

El último comando baja los servicios efímeros de esa sesión en su entorno. Los persistentes se bajan desde la UI seleccionando la fila de la ruta correspondiente.

## Límite de instalación y comprobaciones

Esta reparación modifica únicamente el worktree de Phantom autorizado. No modifica Music Talk ni la instalación viva; no incorpora ramas, despliega ni reinicia la aplicación. Un host ya instalado seguirá usando su código anterior hasta que el controlador gestione la incorporación e instalación por separado. No se afirma haber arrancado el preview real.

Las regresiones usan Docker simulado y terminales/worktrees temporales para comprobar resolución, argumentos de Compose (base de rutas y mounts), proyectos, owners, browsers, liberación y gestión UI. No acreditan un arranque real de Docker Music Talk. Los checks declarados para el controlador son:

```sh
node --test test/env.test.mjs test/host-server.test.mjs src/hooks/env-view.test.mjs
npm test
```
