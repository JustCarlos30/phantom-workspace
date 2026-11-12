# Construir el último estado local integrado

```sh
npm run build:latest
npm run build:latest -- --dry-run
npm run build:latest -- --help
```

Desde cualquier otra carpeta, invoca Node con la ruta absoluta del script (también puede ser la de un linked worktree):

```sh
node /home/carlosj/Carlos_World/phantom-workspace/scripts/build-latest.mjs
node /home/carlosj/Carlos_World/phantom-workspace/scripts/build-latest.mjs --dry-run
```

`latest` significa el estado **local actual del worktree principal**, el primer registro de `git worktree list --porcelain -z`, consultado desde la ubicación del script. Incluye cambios sin commit y archivos sin seguimiento. No elige la rama con el commit más reciente. En esta instalación el principal es `/home/carlosj/Carlos_World/phantom-workspace`, en `integrate/all-2026-11-11`; Git determina la ubicación y rama en cada ejecución. No hace fetch, pull, merge, commit ni reinicia la aplicación.

Muestra carpeta, rama, SHA, estado de cambios y ejecutable antes de construir. Ejecuta, en ese orden y en la carpeta principal:

```sh
npm ci --include=dev --no-audit --no-fund
node node_modules/playwright/cli.js install chromium
npm run package
```

El segundo comando usa exactamente el ejecutable Node que está ejecutando el wrapper (`process.execPath`). Se sustituye cualquier `PLAYWRIGHT_BROWSERS_PATH` heredado por `~/.cache/ms-playwright`, fuera de `out/`, que el empaquetador elimina. Se elimina `ELECTRON_RUN_AS_NODE` del entorno de los comandos.

La salida Linux x64 es `<principal>/out/Phantom Workspace-linux-x64/phantom-workspace`. A su lado, `BUILD.json` conserva sus metadatos y añade `source: { commit, branch, dirty, folder }`, una instantánea de la fuente al comenzar. Evita editar la fuente mientras se construye. En HEAD separado, la rama se muestra como `HEAD`.

Solo se anuncia la finalización después de verificar el ejecutable y leer, enriquecer y comprobar `BUILD.json`. Un fallo termina con código distinto de cero y un mensaje de error. `--dry-run` consulta Git y muestra fuente, entorno, comandos y salida prevista, sin instalar, empaquetar ni escribir archivos.
