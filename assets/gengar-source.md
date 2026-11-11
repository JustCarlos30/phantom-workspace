# Procedencia de Gengar

- Pokémon: Gengar, número 94.
- Recurso: ilustración oficial (`official-artwork`) distribuida por el repositorio de sprites de PokeAPI.
- Repositorio: https://github.com/PokeAPI/sprites
- URL de descarga: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/94.png
- Destino local: `assets/gengar.png`.
- Utilidad de descarga: `scripts/download-gengar.mjs`.

La utilidad comprueba una respuesta HTTP satisfactoria, la firma PNG y un tamaño
superior a 1000 bytes antes de escribir. Reutiliza el archivo local si ya cumple
esas comprobaciones. La URL sigue la rama `master`, por lo que su contenido puede
cambiar en origen.

PokeAPI distribuye el recurso; la ilustración y los personajes Pokémon pertenecen
a sus respectivos titulares. Esta referencia de procedencia no concede una licencia.
