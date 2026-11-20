# Verificación de Titi

Titi sustituye a `PhantomFace` y `PhantomGlyph` (`src/components/Glyphs.jsx`) como identidad de Phantom. `PhantomGlyph` delega en `PhantomFace`, así que ambos reciben las mismas clases (`phantom-face`, `titi-ghost`, `is-<mood>`), `data-mood` y props; `size` se aplica igual. Los moods mapean así: `calm` → esperando, `working` → pensando, `grin` → necesita, `unsure` → fallo, `asleep` → idle.

## Comportamiento verificado por código

- `src/components/TitiGhost.jsx` dibuja en un `<canvas>` de 44 unidades lógicas con buffer `44 × devicePixelRatio` (HiDPI), `aria-hidden="true"` y tamaño CSS `size`.
- El bucle `requestAnimationFrame` solo se crea cuando `useSpriteMotion` (de `GengarMascot.jsx`) devuelve `true`. Ese hook exige intersección con el viewport, `prefers-reduced-motion` sin activar, documento visible, ausencia de `.app-shell.studio-concentration` y elemento visible. El cleanup cancela el frame al cambiar estado o al desmontar.
- Con movimiento detenido se dibuja un único cuadro estático. Un cambio de mood en ese modo avanza la simulación 2 s de tiempo acumulado antes de dibujar, para representar el estado nuevo. La simulación parte de tiempo 0 y usa semillas fijas, así que el resultado es determinista.
- `GengarMascot` y `App` no se modificaron.

## Inventario Storybook

- Historia `Identidad / Titi` (`identidad--titi`) en `src/stories/Identity.stories.jsx`. Renderiza directamente cinco moods a 32 px y un harness interactivo con botones de mood. Las muestras de marca, notch y chat son composiciones con el markup de producción, no la app completa: marca `span.brand-mark` con `PhantomFace` y fallback `PhantomGlyph` (17 px); notch `button.activity-notch` con `PhantomFace` y fallback `notch-state-fallback`; chat `button.icon-button.phantom-chat-toggle` con `PhantomGlyph` size 17, igual que `App.jsx`. No usa `ActivityNotch` ni monta `App`.
- Registrada en `src/stories/catalog.mjs` con selector `canvas.titi-ghost`.
- Conteos actualizados: 100 stories y 62 fuentes del catálogo, en `test/storybook-smoke.mjs` y `docs/storybook.md`. No se quitó ninguna assertion.

## Prueba visual enfocada

`test/titi-visual.mjs` sirve `storybook-static` con un servidor efímero en `127.0.0.1`, abre `identidad--titi` con Playwright y lee los píxeles del canvas (`getImageData`: hash del buffer y cantidad de píxeles con alfa > 0). Comprueba:

1. Los cinco moods tienen píxeles visibles, buffer HiDPI, `aria-hidden` y hashes distintos.
2. Con movimiento habilitado, el hash del canvas cambia en 4 s como máximo.
3. Con `reducedMotion: 'reduce'`, los cinco moods pasan a `data-motion="stopped"` y mantienen el mismo hash.
4. Con el harness parado, cada cambio de mood (Trabajando, Necesita, Falló, Dormido) produce un hash nuevo y visible.
5. Con `.studio-concentration` en el `.app-shell`, el canvas se detiene y mantiene el hash.
6. Marca (`.brand-mark`), notch (`.activity-notch`) y chat (`.phantom-chat-toggle`) muestran su canvas `titi-ghost` visible, no vacío, con tamaño 32/28/28 px, con `studio-character` apagado, encendido y apagado de nuevo. Los fallbacks (`.brand-state-fallback`, `.notch-state-fallback`) quedan ocultos sin ocultar el canvas. Antes de encender `studio-character` la historia no contiene `.gengar-mascot`.

Tras cambios de motion, media, concentración o clases, la prueba espera a que el canvas tenga al menos 40 píxeles con alfa > 0 antes de leer, porque el atributo `data-motion` puede publicarse antes del dibujo.

Falla ante errores de página o consola, peticiones externas, o canvas sin píxeles. Escribe `/tmp/phantom-titi-evidence/titi-visual.json` y capturas PNG (`moods-running.png`, `moods-reduced-motion.png`, `harness-*.png`, `marca-notch-chat.png`). El cierre del navegador y del servidor va en `finally`.

## Límites

- Los resultados de las comprobaciones (build, tests, build de Storybook, inventario y prueba visual) los ejecuta y registra el controlador del run. Este documento no declara que hayan pasado.
- Las capturas son evidencia generada por la prueba. No hay inspección visual humana ni comparación contra un baseline aprobado.
- La prueba no verifica directamente la limpieza del rAF al desmontar el componente; solo la parada por movimiento reducido, concentración y visibilidad.
- Marca, notch y chat se verifican como composiciones con el mismo markup y clases de producción dentro de la historia. `App` no se monta en Storybook (ver exclusiones en `src/stories/catalog.mjs`), así que la app completa no queda probada por esta prueba.
- La regla de `studio.css` que oculta el notch sin `studio-character` se verifica por el resultado computado de la composición, no contra `App`.
- No se verificó el comportamiento con `Mostrar Gengar` activado o desactivado en la aplicación real.
- La captura `marca-notch-chat.png` la inspecciona el padre; no hay comparación contra baseline.
