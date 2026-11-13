# Research en canvas

## Antes de empezar

`$CANVAS` es una abreviatura del comando completo del CLI de canvas (`scripts/canvas.mjs`) de Phantom Workspace. Su ruta absoluta viene en tus instrucciones de Phantom; si no la tienes, dilo y no adivines.

## Cuándo usarla

Úsala cuando el usuario pida investigar un tema, traer fuentes al canvas o aporte fuentes para explorar.

## Paso 1: Recolectar

Busca con amplitud. Trae todo lo encontrado sin filtrar por gusto. Deduplica por URL y anota el subtema de cada fuente.

## Paso 2: `refs.json`

Escribe `refs.json` con el formato exacto `[{ "url", "title", "source", "note" }]`. `note` es obligatoria, ocupa una línea y explica por qué entra la fuente.

```json
[
  { "url": "https://ejemplo.test/a", "title": "Fuente A", "source": "Ejemplo", "note": "Explica el enfoque histórico del subtema." },
  { "url": "https://ejemplo.test/b", "title": "Fuente B", "source": "Ejemplo", "note": "Aporta casos recientes del subtema." }
]
```

## Paso 3: Crear el espacio

```sh
$CANVAS research "Nombre" --from refs.json
```

El comando crea `Research · Nombre` con la zona `Bandeja` y el panel `Lector`. Di al usuario que abra el espacio, recorra las fuentes en el Lector y use Me gusta, Descartar, Más así o Comentar.

## Paso 4: Leer la respuesta del usuario

```sh
$CANVAS refs --space "Research · Nombre" --status liked
$CANVAS refs --space "Research · Nombre" --status discarded
$CANVAS refs --space "Research · Nombre" --status inbox
$CANVAS comments
```

Cada comentario hecho desde el Lector trae `Página` con la URL que veía y `Captura` con la ruta de una imagen. Lee esa imagen para ver lo mismo que el usuario.

## Paso 5: Atender cada pedido

Ante «trae 5–10 como esta», busca fuentes parecidas a ESA fuente concreta en el aspecto que el usuario dijo que le gusta. Añádelas con una segunda ejecución de `research` sobre el mismo `Nombre`; no duplica URLs. Escribe una `note` que cite la fuente original.

Si no dice qué le gusta, pregunta una sola vez en el hilo. Un comentario negativo o un Descartar significa no volver a proponer esa fuente ni otras del mismo tipo por ese motivo.

## Paso 6: Cerrar

```sh
$CANVAS reply N "Respuesta"
$CANVAS mark ID liked|discarded|inbox
```

Responde con `reply N "…"` en cada hilo. Nunca uses `resolve` salvo que el usuario lo pida. Usa `mark ID liked|discarded|inbox` solo cuando el usuario lo pida de palabra.

## Límites

Solo hay una página viva en el Lector. Los sitios con login o que bloquean la descarga quedan sin vista previa. No hay selección de elementos de la página: la captura y el texto del comentario son la única señal. Dilo en vez de inventar.
