# Procedencia de Gengar

- Pokémon: Gengar, número 94.
- Recurso: ilustración oficial (`official-artwork`) distribuida por el repositorio de sprites de PokeAPI.
- Repositorio: https://github.com/PokeAPI/sprites
- URL de descarga: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/94.png
- Destino local: `assets/gengar.png`.
- Utilidad de descarga: `scripts/download-gengar.mjs`.

## Sprites de identidad

| Ruta local | Origen | Formato y dimensiones | Tamaño mínimo |
|---|---|---|---|
| `assets/gengar-icon.png` | https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-vii/icons/94.png | PNG, 40×30 | Más de 100 bytes |
| `assets/gengar-idle.gif` | https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/94.gif | GIF89a, 74×63 | Más de 1000 bytes |

Ambos sprites ya están incluidos desde `ecaffd2`. La utilidad lee y reutiliza los
archivos válidos sin descargarlos ni reescribirlos. Para archivos ausentes o no
válidos exige HTTP satisfactorio, firma de formato, tamaño mínimo y las dimensiones
indicadas antes de escribir. La ilustración `gengar.png` conserva su validación
PNG de más de 1000 bytes. Las URLs siguen `master` y pueden cambiar en origen.

El icono se muestra a 40×30 en marca y actividad; el GIF a 148×126 en vacíos
(74×63 por debajo de 700 px de alto), siempre pixelado. Movimiento reducido,
Concentración, documento oculto o sprite fuera de vista sustituyen el GIF por el
icono estático a 80×60. «Mostrar Gengar» y «Presencia de Gengar» conservan su efecto.

PokeAPI distribuye el recurso; la ilustración y los personajes Pokémon pertenecen
a sus respectivos titulares. Esta referencia de procedencia no concede una licencia.
