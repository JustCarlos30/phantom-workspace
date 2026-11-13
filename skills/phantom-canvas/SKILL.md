# Organizar el canvas

## Antes de empezar

`$CANVAS` es una abreviatura del comando completo del CLI de canvas (`scripts/canvas.mjs`) de Phantom Workspace. Su ruta absoluta viene en tus instrucciones de Phantom; si no la tienes, dilo y no adivines.

Primero lista el canvas; ordena solo lo que el usuario pidió. `hide` solo oculta paneles: no detiene sesiones.

```sh
$CANVAS list --all
$CANVAS arrange --by type --zones
$CANVAS zone "Nombre" ID
$CANVAS hide ID
$CANVAS show ID
```

Para referencias, añade sitios o imágenes con una nota que explique por qué entran. Crea un tablero desde un `refs.json` cuando haya una colección; consulta después las referencias para revisar su estado, nota y comentarios.

```sh
$CANVAS add-site URL --note "Por qué entra"
$CANVAS add-image URL --note "Por qué entra"
$CANVAS board "Referencias" --from refs.json
$CANVAS refs --zone "Referencias"
```

Lee los comentarios abiertos, responde en cada hilo pertinente y conserva el hilo abierto. Ejecuta `resolve` exclusivamente si el usuario indica que quiere resolverlo.

```sh
$CANVAS comments --all
$CANVAS reply N "Respuesta"
$CANVAS resolve N
```

Informa los paneles, zonas, referencias o hilos afectados y cualquier ambigüedad de identificador.
