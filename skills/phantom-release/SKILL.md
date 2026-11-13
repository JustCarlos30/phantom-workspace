# Construir y empaquetar

Esta skill solo aplica dentro del repositorio de Phantom Workspace. Sus comandos `npm` y `node ./scripts/...` son propios de ese repositorio.

Usa los scripts del proyecto desde su raíz. Verifica primero que las dependencias, Chromium y la evidencia requerida estén disponibles; no anuncies una release si algún paso o su resultado no se observó.

Para construir el estado local actual del worktree principal, usa `build:latest`. Incluye cambios sin commit y archivos sin seguimiento de ese worktree; no hace fetch, pull, merge ni commit. Su `--dry-run` muestra fuente, entorno, comandos y salida sin escribir. La ejecución normal instala dependencias de desarrollo, instala Chromium y ejecuta el empaquetado; termina solo tras comprobar el ejecutable y `BUILD.json` con la procedencia de la fuente.

```sh
npm run build:latest -- --dry-run
npm run build:latest
```

Para empaquetar directamente, `package` construye con Vite, crea el paquete Linux x64, incorpora el runtime Node y el Chromium seleccionado, y escribe `BUILD.json`. Requiere Chromium instalado; si falta, el script indica el comando de instalación. Comprueba el ejecutable anunciado y `BUILD.json` antes de reportarlo.

```sh
npm run package
```

Finaliza solo un paquete recién construido y verificable: el script de finalización compara archivos de aplicación con el paquete, sincroniza documentación, exige la evidencia E2E final de 34 checks sin fallos y escribe los manifiestos de release. Ejecuta el script solo cuando esas precondiciones existan; comunica cualquier incumplimiento en lugar de afirmar que la release quedó finalizada.

```sh
node ./scripts/finalize-release.mjs
```
