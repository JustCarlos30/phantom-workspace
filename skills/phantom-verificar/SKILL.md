# Verificar antes de publicar

Esta skill solo aplica dentro del repositorio de Phantom Workspace. Sus comandos `npm` y `node ./scripts/...` son propios de ese repositorio.

Ejecuta las comprobaciones desde la raíz de la app y registra evidencia observada: comando, resultado, duración si está disponible, fallos y ubicación de artefactos o capturas. Nunca declares aprobado un check, recorrido o paquete que no observaste.

Sigue este orden antes de publicar:

1. Instala las dependencias declaradas si el entorno las necesita.
2. Ejecuta la suite definida por el proyecto.
3. Construye el frontend.
4. Comprueba whitespace y marcadores de diff con Git.
5. Si el cambio toca interfaz, ejecuta los recorridos de escritorio pertinentes y revisa su evidencia. Los recorridos históricos de `VERIFICATION.md` no acreditan cambios nuevos.

```sh
npm ci --no-audit --no-fund
npm test
npm run build
git diff --check
npm run test:desktop
```

`VERIFICATION.md` también declara recorridos específicos de escritorio para áreas concretas; elige los que cubran el cambio de interfaz y conserva las rutas de capturas, JSON de checks o fallos que generen. Si un check no aplica, explica por qué; si no pudo ejecutarse, informa el bloqueo y no lo reemplaces por una afirmación de aprobación.

Antes de publicar, resume qué comandos pasaron, cuáles fallaron o no se ejecutaron, la evidencia disponible y el alcance que esa evidencia sí cubre.
