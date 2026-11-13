# Integrar ramas

## Antes de empezar

`$RAMAS` es una abreviatura del comando completo del CLI de ramas (`scripts/branches.mjs`) de Phantom Workspace. Su ruta absoluta viene en tus instrucciones de Phantom; si no la tienes, dilo y no adivines.

Mantén el checkout del proyecto limpio y en la rama de integración. Nunca fuerces un push, descartes archivos ni uses opciones que destruyan trabajo.

1. Consulta el estado y localiza la rama, sus commits, cambios sin commit, conflictos previstos y si su terminal sigue activa.

```sh
$RAMAS status --all
```

2. Si hay cambios sin commit, confirma que el agente de esa rama terminó. Si sigue activo, pregunta al usuario y no modifiques su worktree. Si terminó, crea el commit solo con un mensaje que describa esos cambios.

```sh
$RAMAS commit RAMA "Describe el cambio"
```

3. Integra una rama cada vez. El comando crea un merge sin fast-forward y ejecuta los checks configurados; no lo sustituyas por Git manual.

```sh
$RAMAS integrate RAMA
```

4. Ante `merged`, informa la rama, la base, el identificador resultante y el resultado observado de los checks. Ante `checks-failed`, informa el comando, código, timeout si ocurrió y la salida final: el merge ya fue deshecho y la base queda sin ese cambio. Ante `conflict`, informa los archivos: el merge en la base ya fue deshecho.

5. Para un conflicto, actualiza la rama con la base dejando el conflicto en su propio worktree. No lo hagas si la terminal de la rama sigue activa: pide que el agente se actualice y resuelva. Edita los archivos, concluye con `commit`; o abandona únicamente ese merge pendiente con `abort`.

```sh
$RAMAS update RAMA --resolve
$RAMAS commit RAMA "Resuelve conflictos con la base"
$RAMAS abort RAMA
```

6. Tras integraciones correctas, publica la rama base sin forzar. Luego limpia solo ramas que ya estén integradas, no tengan terminal ni cambios; usa primero `--dry-run` cuando haya duda.

```sh
$RAMAS publish
$RAMAS clean --dry-run
$RAMAS clean
```

Concluye informando exactamente qué se integró, qué falló y por qué, qué se publicó y qué se limpió o quedó pendiente.
