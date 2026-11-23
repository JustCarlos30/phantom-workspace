# Phantom Workspace · Sistema visual v2

## Propósito y fuentes

**Los mocks aprobados por Carlos son la referencia visual. Este documento especifica una implantación futura; no acredita aprobación de la implementación ni resultados de checks.** Sustituye parcialmente `DESIGN.md`. La entrega documental solo edita `docs/design-v2.md`; Phantom ejecuta los checks y controla el cierre.

Referencias leídas completas:

- `.impeccable/mocks/dx/05-profundidad.html`: variante **Propuesta**, superficie degradada y trazo A; canvas, rail, Apariencia, selección, maximización y dock. «Hoy» sirve exclusivamente de comparación histórica.
- `.impeccable/mocks/dx/06-sesion.html`: **nueva, trabajando y dictando**; anatomía interna y compositor compartido.
- `DESIGN.md`; `src/canvas-ui.css` (incluidos todos los bloques `:root` y las sobrescrituras de `.canvas-node`); `src/sidebar.css`, `src/shell.css`, `src/settings.css`, `src/chat.css`, `src/terminal.css`, `src/voice.css`, `src/activity-trace.css`.
- `src/components/ActivityTrace.jsx`, `src/components/SidebarPanels.jsx`, `src/components/Settings.jsx`, `src/components/ChatCard.jsx`, `src/components/VoiceActivity.jsx`, `src/components/Glyphs.jsx`.
- `test/design-tokens.test.mjs` y `test/design-budget.json`.

Lecturas complementarias dirigidas comprobaron los propietarios, las rutas y las comprobaciones del plan, especialmente `test/design-capture.mjs`, `src/components/TitiGhost.jsx`, `src/components/Canvas.jsx`, `src/components/Appearance.jsx`, `src/components/PluginPrimitives.jsx` y los modelos de estado, rail y envío de voz.

**Cómo leer los tokens:** cada tabla nombra variables CSS del producto a crear o cambiar. `∅` significa token nuevo; cuando existe un literal local, se indica. Los valores nuevos proceden del CSS efectivo de 05/06, no de sus textos de demostración. Los nombres de variables propuestos son el puente de implementación. Los aliases conservan el valor de su destino, no crean otra superficie. `--glass` del mock significa relleno blanco alfa de un control; no debe confundirse con `--glass` del producto, que hoy nombra el material del chrome.

Los datos de ejemplo —62 %, 100 %, 9 de 14 pruebas, 64 %, modelos, proveedores y tiempos— no son defaults, catálogos ni telemetría del producto. Las reglas visuales no autorizan nuevos motores, permisos o capacidades. Para sesiones nuevas sigue rigiendo la decisión de Claude Code; OpenCode/Codex en los mocks documentan identidad e historial, no habilitan su ejecución.

## Reglas

### 1. Negro profundo

El negro anterior tendía a gris. Usar el lienzo casi negro, el objeto con interior oscuro y el pozo más oscuro que el objeto, sin transparencia que vuelva a aclararlo con el fondo. La relación exacta del CSS es **lienzo `#020203` < pozo `#040405` < base de objeto `#0b0b0c`**: «pozo aún más oscuro» se refiere al objeto, no significa que deba ser más negro que el lienzo.

| Token del producto | Actual → nuevo | Fuente / destino |
|---|---|---|
| `--bg` | `#050505` → `#020203` | 05/06 `--bg`; sincronizar las declaraciones de studio y canvas |
| `--surface` | `#0d0d0d` → `#0b0b0c` | 05 `--obj`; base opaca bajo el degradado |
| `--surface-2` | `#151515` → `#111113` | 05/06 `--flat`; relleno plano interior |
| `--surface-3` | `#1d1d1d` → `#1d1d20` | 05 `--group-sel`; selección de fila |
| `--terminal-bg` | `#080808` → `#040405` | 05/06 `--well`; también fallback de xterm |
| `--well` | `color-mix(in srgb, var(--surface) 92%, transparent)` → `#040405` | Hilo lateral |
| `--well-terminal` | `color-mix(in srgb, var(--terminal-bg) 90%, transparent)` → `#040405` | Hilo del canvas y salida de terminal |
| `--well-raised` | `color-mix(in srgb, var(--surface-2) 96%, transparent)` → `#0b0b0d` | 06 `--step`; banda de escritura a sangre |
| `--ink`, `--muted`, `--ink-3` | `#f2f0eb`, `#a8a6a0`, `#8b8983` → mismos valores | 05/06 `--ink`, `--ink-2`, `--ink-3` |
| `--dot` | `color-mix(in srgb, var(--ink) 16%, transparent)` → `color-mix(in srgb, #f2f0eb 5%, transparent)` | Puntos de `.scene` |

Retícula: `radial-gradient(color-mix(in srgb, #f2f0eb 5%, transparent) 1px, transparent 1.2px)`, paso **24 × 24 px**, sin la segunda retícula mayor del acabado anterior. Conservar su anclaje al espacio-mundo y el zoom semántico. El ambiente estático de 05 es `radial-gradient(ellipse 900px 640px at 48% 40%, #0e0e11, transparent 72%)`; 06 usa `ellipse 1000px 700px at 50% 42%` con el mismo color y parada. Son composiciones de escenas distintas, no un halo adjunto a cada panel. El tamaño fijo de 1520 × 980 pertenece al fixture, no al viewport obligatorio del producto.

### 2. Material de todos los objetos

Rail, panel, inspector y dock comparten **degradado vertical sutil y un único aro degradado de 1 px**, más claro arriba. No hay aura, resplandor exterior, filtro luminoso ni `backdrop-filter` en paneles del lienzo. La sombra negra de contacto sí forma parte del mock.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--object-top`, `--object-bottom` | `#0f0f11`, `#070708` → `#151518`, `#0b0b0d` | 05/06 `--obj-top`, `--obj-bot`; Etapa 6·1 |
| `--object-sheen` | `∅` → `radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, #fff 4%, transparent), transparent 60%)` | Etapa 6·1, luz cenital |
| `--object-fill` | `linear-gradient(var(--object-top), var(--object-bottom))` → `var(--object-sheen), linear-gradient(var(--object-top), var(--object-bottom))` | `.box`; Etapa 6·1 |
| `--object-ring-width` | `∅` (borde CSS de 1 px) → `1px` | `--ring` |
| `--object-edge-top` | `color-mix(in srgb, #fff 22%, transparent)` → `color-mix(in srgb, #fff 26%, transparent)` | `--edge-top`; Etapa 6·1 |
| `--object-edge-bottom` | `color-mix(in srgb, #fff 6%, transparent)` → `color-mix(in srgb, #fff 7%, transparent)` | `--edge-bot`; Etapa 6·1 |
| `--object-ring` | `∅` → `linear-gradient(var(--object-edge-top), var(--object-edge-bottom))` | `.box::before` |
| `--r-obj`, `--r-isle` | `14px`, `26px` → `24px`, `24px` | `--r-outer`; dock conserva píldora |
| `--shadow-chrome` | `0 1px 2px #00000066, 0 18px 40px -20px #000000cc` → `0 1px 2px #000, 0 16px 32px -16px #000` | `--shadow` |
| `--shadow-rest`, `--shadow-float` | `0 1px 2px #00000080, 0 14px 30px -16px #000000d9`; `0 2px 6px #00000073, 0 30px 68px -24px #000000f2` → ambos `var(--shadow-chrome)` | Una sombra de objeto |
| `--shadow-workplane-rest`, `--shadow-workplane-lift` | `0 2px 4px #00000066, 0 10px 20px -12px #00000099`; `0 3px 6px #00000073, 0 16px 28px -14px #000000b3` → ambos `var(--shadow-chrome)` | Retirar elevación local divergente |
| `--glass-tint`, `--glass`, `--glass-thick` | `#0d0d0d`; `var(--surface)`; `color-mix(in srgb, var(--surface) 60%, var(--surface-2))` → `#0b0b0c`; `var(--surface)`; `var(--surface)` | Bases opacas; imagen separada |
| `--glass-sheen`, `--workplane-wash` | `none`; `linear-gradient(135deg, color-mix(in srgb, var(--accent) 2%, transparent), transparent)` → ambos `var(--object-fill)` | Degradado vertical neutro |
| `--workplane`, `--glass-filter` | `color-mix(in srgb, var(--surface) 80%, transparent)`; `none` → `var(--surface)`; `none` | Sin blur ni transmisión de color |

Etapa 6·1 (aprobada por Carlos tras el laboratorio Propuestas): material cenital; sustituye los valores de los mocks 05/06.

Receta ejecutable del aro: pseudo-elemento con `position:absolute; inset:0; border-radius:inherit; padding:var(--object-ring-width); pointer-events:none`, fondo `var(--object-ring)`, máscara `linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)`, `-webkit-mask-composite:xor; mask-composite:exclude`. En el mock ocupa z-index **3** y la cometa **4**. Quitar el borde/outline de selección anterior para no sumar contornos. No reemplazar `background-color` por un valor de tipo imagen: el degradado va en `background-image` o en el shorthand correspondiente.

Las cabeceras dejan ver este material; ningún cuerpo opaco heredado debe taparlo por completo. Revisar las reglas tardías de canvas, sidebar, shell, settings y terminal, no solo el primer `:root`. Los objetos flotantes auxiliares adoptan el mismo contorno; el comportamiento y dueño de los menús sigue en `src/menus.css`.

### 3. Dos niveles de superficie como máximo

**Nivel 1:** objeto, único contenedor con aro, degradado y radio grande. **Nivel 2:** un relleno plano interior donde se lee salida o se escribe. No anidar otro pozo, burbuja, tarjeta de actividad o tarjeta que solo agrupa. El resto se separa con espacio, tipografía y divisores de **1 px**.

Excepción declarada: los grupos del inspector de Configuración son planos y sin aro. En 06, hilo y compositor son dos zonas contiguas del mismo nivel interior: el compositor cierra el pozo a sangre con un paso tonal y un divisor; no es una caja flotante dentro de él. El textarea queda transparente sobre esa banda. Las pistas de controles, radios e insignias son partes del control, no nuevos contenedores de contenido.

| Token del producto | Actual → nuevo | Uso |
|---|---|---|
| `--interior-flat` | `∅` → `#111113` | 05/06 `--flat`; grupos de Configuración |
| `--divider` | `∅` (se reutiliza `--hairline`, blanco al 10 %) → `#ffffff12` | 05/06; conservar el alfa hexadecimal exacto, no redondearlo a 7 % |
| `--divider-width` | `∅` → `1px` | Listas y guía de actividad |
| `--r-ctl` | `8px` → `12px` | Radio interior común de fila/grupo |
| `--r-group` | `∅` → `calc(var(--r-obj) - var(--box-pad))` | 24 − 12 = 12 px |
| `--section-gap` | `∅` → `8px` | `.sect`; título de sección/lista |
| `--group-gap` | `∅` → `12px` | Pila de grupos de 05/06 |

Los tokens `--group-top:#19191c`, `--group-bot:#0f0f11`, `--pill-top:#1c1c1f` y `--pill-bot:#0e0e10` existen en los mocks, pero no son el relleno efectivo de `.group`: este usa `--flat`. No trasladarlos como una segunda receta de tarjetas degradadas. La miniatura de un mapa, un diff o una imagen es contenido, no una nueva superficie de chrome.

### 4. Jerarquía de atención y cometa A

Solo **«te necesita»** colorea todo el aro: ámbar fino y etiqueta de texto. **Trabajando** mantiene el aro neutro y añade una cometa lima sobre él, con la palabra en tinta secundaria. **Terminó, error y reposo** no colorean el aro; la cabecera dice el estado. Error puede usar `--danger` en la palabra, como 05. Ninguna superficie se rellena de ámbar. Selección aclara el mismo aro, sin outline separado ni halo.

| Token del producto | Actual → nuevo | Uso |
|---|---|---|
| `--working`, `--attention`, `--danger`, `--success` | `#c6f135`, `#f5c04a`, `#f27670`, `#65ba83` → mismos valores | Estado, no decoración |
| `--working-head` | `∅` (cabeza `--ink`) → `#e2ff7a` | Cabeza de la cometa |
| `--attention-ring` | `∅` (atención sin aro) → `color-mix(in srgb, var(--attention) 80%, transparent)` | Sustituye el fondo del aro de 1 px |
| `--selected-edge-top`, `--selected-edge-bottom` | `∅` (borde de acento + outline de 2 px/offset 3 px) → `color-mix(in srgb, #fff 36%, transparent)`, `color-mix(in srgb, #fff 10%, transparent)` | 05 `.pane.sel` |
| `--trace-width` | `∅` (literal `2px`) → `1.5px` | 05/06 `--trace-w` |
| `--trace-duration` | `∅` (literal `5.6s`, `steps(100)`) → `5.6s` en mapa; `7s` en sesión interior | 05 `.ta` / 06 `.ta`, ambos `linear infinite` |

Cometa: cinco rectángulos SVG con `pathLength="100"`; inset x/y = **0.75 px**, ancho/alto = **100 % − 1.5 px**, rx/ry = **24 − 0.75 = 23.25 px**, `fill:none`, sin filtros. Longitudes `--L` y opacidades, en orden cola→cabeza:

| Contexto | Longitudes exactas | Opacidades |
|---|---|---|
| 05, panel del mapa | `26px`, `18px`, `11px`, `6px`, `2.5px` | `.06`, `.14`, `.28`, `.55`, `1` |
| 06, sesión por dentro | `14px`, `10px`, `6px`, `3px`, `1.2px` | `.06`, `.14`, `.28`, `.55`, `1` |

Cada capa usa `stroke-dasharray:var(--L) calc(100px - var(--L))`; anima `stroke-dashoffset` desde `var(--L)` hasta `calc(var(--L) - 100px)`. Solo la cabeza usa `stroke-linecap:round` y `--working-head`. Reutilizar `ActivityTrace`, su observador de intersección y suspensión al ocultarse el documento/Concentración. No hay órbita verde de fin ni destellos rojos; retirar también halos/ondas de `PixelField` alrededor de los paneles.

Preservar las fuentes de estado: `pulseState` y el chat distinguen proceso terminado, permiso, pregunta y turno. Un `pulse-turn` que exige respuesta sigue siendo atención; un resultado meramente no leído no debe convertirse por sí solo en «te necesita». No convertir error en éxito ni inferir actividad de un PTY abierto. Atención prevalece sobre la selección visual y sobre trabajo; terminar un proceso revoca señales viejas. La selección de un panel que pide permiso conserva su aro ámbar y `aria-current`, sin otro aro blanco.

### 5. Controles sin borde, tres niveles y un segmentado

El aro pertenece al objeto. Ningún botón, fila, campo ni segmentado recibe borde de caja, relieve interior o sombra de tecla. **Primario:** marfil/tinta oscura. **Secundario:** círculo de 36 px, 40 px en dock, relleno de un paso. **Fantasma:** transparente hasta hover. Conservar foco visible de teclado: es señal transitoria de foco, no el aro de material ni la selección del objeto.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--on`, `--on-ink` | `#f2f0eb`, `#141414` → `#ece6d8`, `#141414` | 05/06 `--ivory`, `--on-ink` |
| `--on-hover`, `--on-press` | `∅` → `#f6f1e6`, `#d6d0c2` | `.dprim:hover`, `--ivory-press` |
| `--control-size`, `--dock-control-size` | `∅` (32/30 px según familia; dock 36 px) → `36px`, `40px` | 05 `--ctl`, `--ctl-dock`; 06 `--btn`, `--btn-dock` |
| `--control-fill`, `--control-hover`, `--control-press` | `∅` (fill-2/fill-3 y sombras locales) → `#ffffff14`, `#ffffff1f`, `#ffffff0a` | 05/06 `--ctl-fill*` |
| `--shadow-key`, `--shadow-well`, `--shadow-rim` | `0 1px 2px #00000073`; `inset 0 1px 2px #0000008c, inset 0 0 0 1px #00000033`; `inset 0 0 0 1px #ffffff0a` → `none`, `none`, `none` | Controles planos de los mocks |
| `--seg-height`, `--seg-pad`, `--seg-gap` | `∅` (pc-modes: 34/3; st-seg: pad 3) → `36px`, `4px`, `4px` | Receta `.segm` de 06 |
| `--r-pill` | `999px` → `999px` | Segmentado, primaria con texto y medidor |
| `--focus-width`, `--focus-offset` | `∅` (2 px/acento, offset local) → `2px`, `2px` | `:focus-visible` de 05/06; fila: offset −2 px |

**Receta única:** pista `--control-fill`, alto 36, padding 4, gap 4, radio 999; segmentos de **28 px**, seleccionado `--on`/`--on-ink`, pulsado seleccionado `--on-press`; no seleccionado hover `--row-hover`, pulsado `--row-press`. La distribución puede ser flex o columnas iguales según el contenido. 05 usa gap 2 en su barra de comparación; esa barra no se implanta y no justifica un segundo segmentado. No usar `--r-seg:8px` de 06 como otra receta: está declarado, pero `.segm` usa radio píldora.

La primaria textual del dock mide 40 px, padding `0 18px`, gap 8 px; Enviar/confirmar usa círculo de 36 px. Deshabilitado: relleno `--control-fill`, tinta `--ink-3`, sin hover operativo. Conservar `disabled`, lectura sola, nombres accesibles y tamaños táctiles efectivos existentes (44 px con puntero grueso); no confundir diámetro pintado y área de interacción.

### 6. Hover y pulsado de filas

Un paso tonal sobre **toda la fila**, rectángulo redondeado de radio **12 px**, nunca óvalo. Hover y pulsado no escalan ni desplazan fila, icono o texto. Ocultar los divisores inmediatamente anterior y posterior mientras la fila está bajo interacción. La insignia mantiene color, forma y glifo al pasar, pulsar y seleccionar.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--row-hover`, `--row-press` | `∅` (rail usa fill-2 y escala .98; capa global .96) → `#ffffff0a`, `#00000040` | 05/06 |
| `--row-selected` | `∅` (rail: `var(--fill-2)`) → `#1d1d20` | 05 `--group-sel` |
| `--row-selected-hover` | `∅` → `color-mix(in srgb, var(--row-selected), #fff 4%)` | 05 `.row[aria-current]` |
| `--row-selected-press` | `∅` → `color-mix(in srgb, var(--row-selected), #000 25%)` | Mismo selector |
| `--r-row`, `--row-air` | `∅` → `12px`, `2px` | 05/06 radio y aire arriba/abajo |
| `--dur-fast` | `140ms` → `120ms` | `--dur-press`; transición tonal `linear` |

Los mocks implementan los **4 px de aire entre realces** mediante `border-block:2px solid transparent; background-clip:padding-box`. Ese borde transparente no es contorno visible, pero el contador estático lo cuenta: cualquier traslado literal debe reflejarse en el presupuesto. La ocultación usa opacidad, no elimina el espacio del divisor. La transición de insignia de 05 es **200 ms linear** solo al cambiar su estado, nunca como feedback de hover.

### 7. Insignias y paleta estable

Círculo de **32 px**, color plano, glifo blanco centrado, **18 px / trazo 1.75**, sin degradado, brillo ni aro. Glifo secundario de 16 px. Paleta de seis tonos de luminosidad perceptual común y croma equilibrado; la petición de **croma idéntico** tiene una discrepancia material con los literales aprobados: L es siempre 0.64, C alterna 0.10/0.11. Copiar exactamente esta paleta; no normalizar C sin confirmación de Carlos.

| Token del producto a crear | Actual → nuevo | Asignación de 05/06 |
|---|---|---|
| `--badge-steel` | `∅` → `oklch(0.64 0.11 250)` | Codex; carpeta/repositorio; retícula |
| `--badge-mint` | `∅` → `oklch(0.64 0.10 165)` | OpenCode; permisos |
| `--badge-honey` | `∅` → `oklch(0.64 0.11 85)` | Notas/documentos; avisar cuando te necesiten |
| `--badge-coral` | `∅` → `oklch(0.64 0.11 30)` | Claude; sonido en error |
| `--badge-violet` | `∅` → `oklch(0.64 0.10 300)` | Voz/dictado; modelo; sonido al terminar |
| `--badge-petrol` | `∅` → `oklch(0.64 0.10 210)` | Terminal; navegador; animar sesiones activas |
| `--badge-neutral` | `∅` → `oklch(0.36 0.008 260)` | Inactivo/sin clasificar, «vidrio» del mock |
| `--badge-working`, `--badge-attention` | `∅` → `#5d7521`, `#b5872f` | Derivados de estado de 05, no la lima/ámbar brillante de texto |
| `--badge-size`, `--badge-ink` | `∅` (disco de sesión ya 32 px) → `32px`, `#fff` | `.badge` |
| `--glyph-primary`, `--glyph-secondary`, `--glyph-stroke` | `20px`, `16px`, `∅` (Glyphs ya 1.75) → `18px`, `16px`, `1.75` | `.ic`, `.ic.sm` |

Lima y ámbar quedan reservados al estado. La miel OKLCH es una categoría estable y no sustituye a `--attention`. La asignación se reutiliza por concepto, nunca por índice de fila ni por hash variable. Conceptos sin asignación en la tabla usan neutral; no inventar otros colores.

Rail **por estado**: insignia gris con glifo del tipo en reposo, terminó y error; lima apagada si trabaja, ámbar apagado si te necesita. Marcar expresamente: **«predeterminado recomendado, pendiente de confirmación de Carlos frente a por tipo»**. La variante por tipo aplica la paleta estable y conserva la palabra de atención; no requiere introducir ahora una preferencia persistida. Reutilizar `ProviderGlyph` y `ShellIcons` ya existentes; los esquemas SVG simplificados de los mocks no autorizan a sustituir las siluetas compartidas ni a recuperar el asterisco retirado.

### 8. Rail directo y legible

Filas sobre el rail, sin tarjetas por sesión. Título en una línea con elipsis y título completo accesible; apoyo **«tipo · estado · tiempo»**, estado sin recorte y sin convertir toda la línea en color. Los divisores separan grupos, no cada sesión. El contador «Te necesitan» es numeral, no píldora ámbar.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--rail-width` | `252px` → `272px` | 05 `.rail` |
| `--gutter` | Primer root `var(--s-3)`, root tardío efectivo `16px` → `12px` | Rail/inspector a 12 px de la ventana |
| `--row-detail` | `56px` → `56px` | Regla efectiva `.rail .row`; no los 52 px de su comentario/leyenda |
| `--rail-group-inset` | `∅` (margen 12 px entre grupos) → `20px` | 05 `.rgrp { padding-top:20px }` |
| `--rail-gap` | `∅` → `8px` | 05 `.rail` |
| `--t-title` | `600 17px/22px var(--sans)` → `600 15px/20px var(--sans)` | 05/06 |
| `--t-control`, `--t-support` | `500 14px/20px var(--sans)`, `400 12px/16px var(--sans)` → mismos valores | Fila y apoyo; máximo tres estilos por panel |

Rail expandido: top/bottom/left 12 px, padding 12 px, alto disponible con scroll de la lista. Fila de 56 px, padding horizontal 16 px, columna de insignia 32 px y gap 12 px. Cabecera de proyecto: padding `4px 16px 0`. Pie: gap 8 y padding izquierdo 16 px. El nombre del proyecto no compite con otro título de marca.

`SidebarPanels` ya llama `onJump` y `onFocus` por separado. Mantenerlo. `buildSessionRows` ya conserva identificadores, títulos completos, orden estable y recursos asociados. Añadir solo el dato temporal que falta, usando `timeOf`/`ago` existentes; sin fecha válida, omitir tiempo. No inventar antigüedad ni un estado «trabajando» porque una terminal siga abierta.

### 9. Sesión por dentro

**Nueva:** proveedor en filas con radio, Chat/Terminal en el único segmentado, Contexto en filas **etiqueta–valor–chevrón** (carpeta, permisos, modelo). No convertir estas secciones en tarjetas. La lista muestra únicamente proveedores autorizados por la política; el historial conserva su identidad. La geometría del mock de 484 × 804 px sirve para la comparación, no reemplaza las dimensiones persistidas de los paneles.

**Trabajando:** mensaje del usuario como cita marfil; respuesta en prosa; actividad en líneas con guía vertical, glifo, verbo, destino y cifra. Las llamadas a Phantom usan Titi, a través de `PhantomGlyph`. Una sola fila viva resume el trabajo actual y muestra barra fina cuando hay progreso medido. Conservar detalles, errores, permisos, subagentes y enlaces de encargos; retirar sus cajas decorativas, no su información.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--session-row-height` | `∅` → `64px` | 06 `.row { min-height:64px }` |
| `--choice-col`, `--radio-dot` | `∅` → `20px`, `8px` | 06 `.ctl`, radio seleccionado |
| `--control-off` | `∅` → `#4e4e50` | 05/06 `--off`; radio vacío y switch |
| `--panel-header-map`, `--panel-header-session` | `∅` (cabecera exterior 44 px + identidad local) → `52px`, `56px` | 05 `.bar`, 06 `.bar`; no apilar ambas |
| `--activity-row-height`, `--activity-row-py` | `∅` (fila de herramienta 28 px, padding 4 px) → `40px`, `8px` | 06 `.act` |
| `--progress-height`, `--progress-track` | `∅` → `4px`, `#2c2c2d` | 06 `.prog`, `--track` |
| `--quote-width`, `--quote-inset`, `--quote-gap` | `∅` (burbuja alineada a derecha) → `2px`, `12px`, `8px` | 06 `.you`; barra `var(--on)` |
| `--t-body` | `400 14px/22px var(--sans)` → `400 14px/20px var(--sans)` | 06 `.prose`: t-row con peso 400 |
| `--prose-ink` | `∅` (mensaje `--ink`) → `#d9d6cf` | 06 `.prose` |
| `--t-code`, `--t-terminal-preview` | `∅` → `400 12px/16px var(--mono)`, `400 12px/18px var(--mono)` | 06 / 05, respectivamente |
| `--composer-field-min`, `--composer-gap` | `∅` (textarea mínimo 38 px) → `40px`, `12px` | 06 `.field`, `.composer` |

Radio vacío: círculo de 20 px con marca interior `inset 0 0 0 1.5px #4e4e50`; seleccionado: plano marfil con punto oscuro de 8 px. Es el dibujo semántico del radio, no un contorno añadido a la fila. Implementarlo con control nativo o semántica radio completa, incluidos flechas, Inicio/Fin, foco y `aria-checked`.

Guía de actividad: ancho 1 px, x = `16px + 32px / 2` = **32 px** respecto a la lista, top 10 px, bottom 18 px. Columna de glifo 32 × 20 px, glifo normal 16 px, Titi 16 px; el fondo de esa columna es el mismo pozo para interrumpir la guía bajo el icono. Fila viva: gap interno 8 px y padding inferior 12 px. La barra usa lima y radio 999; **64 % es fixture**, no progreso por defecto. Sin total medible, mostrar estado textual sin porcentaje fabricado.

**Compositor idéntico en los tres estados:** a sangre al pie, `#0b0b0d`, divisor superior 1 px `#ffffff12`, sin otra caja. Padding exacto de 06: **12 px arriba, 24 derecha, 24 abajo, 28 izquierda**; gap 12 px entre campo y herramientas, 8 px entre herramientas. El campo base mide 40 px en el fixture; `useComposerSize` sigue creciendo y limitando el texto real sin animar altura ni ocultar controles. Cita de usuario: margen horizontal 16 px y final 8 px; con el gap de pila 12 deja 20 px hasta la respuesta. Mono solo para rutas, comandos y cifras; no cambiar la fuente de la terminal interactiva para imitar la previsualización.

### 10. Dictado dentro del campo

Sin «Te escucho…», sin «Habla, te escucho…», sin botón textual de cancelar y sin orbe/aura. La transcripción ocupa el campo del compositor: confirmado en tinta, parcial en secundaria. Una píldora con micrófono, barras redondeadas y tiempo reemplaza el control de micrófono; X secundaria y palomita primaria. Pista exacta: **«Esc descarta · Enter envía»** en el chat.

| Token del producto a crear | Actual → nuevo | Fuente |
|---|---|---|
| `--voice-meter-height`, `--voice-meter-px`, `--voice-meter-gap` | `∅` (orbe 40 × 40) → `36px`, `12px`, `8px` | 06 `.meter` |
| `--voice-meter-fill` | `∅` → `#ffffff14` | 06 `--glass` |
| `--voice-bar-width`, `--voice-bar-gap`, `--voice-bar-radius`, `--voice-bars-height` | `∅` → `3px`, `3px`, `2px`, `16px` | 06 `.bars` |
| `--voice-caret-width`, `--voice-caret-height`, `--voice-caret-radius` | `∅` → `2px`, `16px`, `1px` | 06 `.caret`, color marfil |
| `--voice-caret-duration` | `∅` → `1.1s` | Blink `ease-in-out`, opacidad 0 al 50 % |
| `--voice-composer-divider` | `∅` (borde lima + halo de 2–5 px) → `#ffffff26` | 06 `.composer.dict` |

Barras del fixture: alturas **6, 12, 16, 10, 14, 6 px**; movimiento `.9s ease-in-out infinite alternate`, delays **−.1, −.5, −.3, −.7, −.2, −.6 s**, `scaleY(.45)`→`scaleY(1)`, color `#c6f135`. Estos números describen el mock estático animado. En producción, la entrada ya disponible `voice.level` gobierna el nivel: no simular captura en silencio, permiso pendiente o transcripción. No introducir un nuevo analizador ni otro bucle de audio. Movimiento reducido elimina blink/interpolación; conserva nivel legible, texto y tiempo.

Reutilizar `useVoiceRecorder`, `mergeDictation`, `sendAction` y `canSubmit`: Enter/palomita durante grabación detienen y arman **un** envío; durante transcripción esperan el resultado final; no enviar la cola parcial ni duplicar el borrador. X/Esc cancelan, desarman y conservan lo escrito antes de dictar. Estados `requesting`, `transcribing`, error y ocupado en otra superficie siguen explícitos, con sus bloqueos actuales. La transcripción confirmada no se concatena repetidamente en cada actualización visual.

La pista de envío corresponde al chat: el dictado dirigido a una terminal mantiene revisión e inserción literal **sin Enter ni secuencias de control**. La captura «Voz e intención» conserva interpretación y aplicación explícitas. Compartir aspecto no convierte esos destinos en envío de comandos. No alterar duración/tamaño máximos, exclusión de micrófono, cancelación al cambiar de destino ni fallos visibles.

### 11. Identidad Titi

Titi, el fantasma de Phantom, sustituye a Gengar en toda la interfaz. **Un solo fantasma de identidad por escena**: el del dock en la escena poblada de 05/06; no repetirlo en marca del rail, notch, cabecera de chat y fondo simultáneamente. Las llamadas de actividad de 06 llevan el glifo Titi de 16 px como identificador de operación; la distinción entre mascota de escena y glifo funcional se explicita en Pendientes para no atribuir una excepción tácita a Carlos.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--identity-size` | `∅` (marca Titi 32 px; notch 28 px) → `28px` | 05/06 `.titi` del dock |
| `--identity-inset` | `∅` → `4px` | Margen izquierdo de `.titi` |
| `--identity-glyph-size` | `∅` (PhantomGlyph usado a 16 px en encargos) → `16px` | 06 `.titi-mini` |
| `--identity-ink` | `∅` → `var(--on)` = `#ece6d8` | Tinta de Titi en los mocks |

**Ya existe**, no crear otro motor: `Glyphs.jsx` renderiza `PhantomFace` mediante `TitiGhost`, y este usa el rig de Titi y `useSpriteMotion`. Quedan Gengar en bienvenida, canvas vacío, arte ambiental y textos de Apariencia; corregir esos puntos y la duplicación de Titi. Reutilizar la API de identidad; no copiar el SVG de demostración como una segunda mascota independiente. Para llamadas repetidas usar una representación quieta del mismo glifo, no un rig animado por fila.

Conservar compatibilidad de preferencias `gengar`/`gengarIntensity` como datos heredados si siguen siendo necesarias, sin exponer el nombre antiguo al usuario ni borrar preferencias personales. Reposo, ocultación, Concentración y movimiento reducido no deben mantener bucles decorativos vivos. La escena vacía debe elegir un solo emplazamiento de identidad, no sumar mascota grande y marca del dock.

### 12. Interacción espacial y movimiento reducido

Clic en sesión del rail = **ver en el mapa**, seleccionar y realzar brevemente su aro; no maximizar. Maximizar/doble clic en cabecera abre desde el rectángulo real de origen, FLIP de **320 ms** sin rebote exagerado; Esc devuelve al mapa y al rectángulo persistido. La geometría animada no se guarda como posición o tamaño del nodo.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--dur-open` | `∅` → `320ms` | 05 |
| `--ease-settle` | `∅` → `cubic-bezier(.22, 1, .36, 1)` | 05/06 |
| `--ease-spring`, `--dur-spring` | `linear(0, .36 12%, .72 25%, .94 40%, 1.05 58%, 1.025 75%, 1)`, `420ms` → `var(--ease-settle)`, `var(--dur-open)` | Retirar rebote/escala de controles |
| `--map-flash-duration`, `--map-flash-ink` | `∅` → `900ms`, `#ffffffb3` | 05 `.flash` / `.pane::after` |
| `--motion-reduced-duration` | `∅` (fallback de 60 ms) → `0ms` | 05/06: `animation:none; transition:none` |

Realce del mismo recorrido del aro, sin escala: opacidad **0 al 0 %, 1 al 18 %, 0 al 100 %**, easing de asentamiento. Puede usarse capa coincidente enmascarada, nunca un contorno desplazado. No ocultar durante ese realce la palabra de atención. FLIP: medir `getBoundingClientRect()` antes/después de cambiar layout, origen `0 0`, invertir desplazamiento y escala del objeto, animar a su geometría final. Cancelar/rebasar animación si cambia el destino o se desmonta.

Con movimiento reducido, aplicar destino directamente y conservar selección/etiquetas; cometa quieta, ningún destello ni fallback de fundido. Esc respeta prioridades existentes: primero dictado, menú o edición; el shell restaura panel cuando posee la navegación. No robar Esc ni otras teclas a xterm con entrada activa. Preservar retorno de foco, overlays `inert` y oclusión del navegador nativo. La atenuación `.28` de vecinos al maximizar en 05 no se aplica a la mera selección; el producto actual oculta vecinos en foco, por lo que no se exige introducir una nueva capa de paneles inactivos.

### 13. Dock con aire y sistema de cajas

Dock de **64 px**, a **24 px** del borde inferior y de cualquier panel. Un solo objeto píldora, Titi, «Nueva sesión» primaria y acciones secundarias circulares. Mantener accesibles las herramientas actuales aunque sus accesos se plieguen; no eliminar funciones para copiar el número de botones del fixture.

| Token del producto | Actual → nuevo | Fuente |
|---|---|---|
| `--dock-h` | `56px` → `64px` | 05/06 `.dock` |
| `--dock-clearance` | `∅` (bottom efectivo `--gutter`, 16 px) → `24px` | Aire inferior y con paneles |
| `--dock-pad`, `--dock-gap` | `∅` (padding 8 px, gap local 8 px en acciones) → `12px`, `12px` | 05/06 `.dock` |
| `--box-pad` | `∅` (insets diferentes por objeto) → `12px` | Caja exterior |
| `--row-py`, `--row-px`, `--row-gap` | `∅`, `∅`, local rail `12px` → `12px`, `16px`, `12px` | Sistema común de 05/06 |
| `--icon-col` | `∅` → `32px` | Columna fija |
| `--divider-inset` | `∅` → `calc(var(--row-px) + var(--icon-col) + var(--row-gap))` | 16 + 32 + 12 = **60 px** respecto a lista |
| `--inspector-width` | `360px` → `320px` | 05 `.settings`; hoja centrada actual aparte |
| `--settings-switch-width`, `--settings-switch-height`, `--settings-switch-thumb` | `∅` (46, 28, 22 px) → `44px`, `26px`, `20px` | 05 `.toggle` |
| `--settings-slider-height` | `∅` (range/select nativo) → `32px` | 05 `.pill` |

Alineaciones: exterior 12 + fila 16 = **28 px** hasta icono/texto sin insignia; texto con insignia a **72 px** desde el exterior; divisor desde 60 px en la lista hasta 16 px del borde derecho. Valores, switches y chevrones comparten el borde derecho. Radio exterior 24, padding 12, radio de grupo 12: concéntricos. En rail las filas no llevan relleno permanente; en Configuración sí lo tiene el grupo plano excepcional.

Inspector: top/right/bottom 12 px, padding 12, gap 12; cabecera de 32 px con margen superior 4 y padding izquierdo 16. Switch: radio 13 px (derivado de 26/2), thumb a 3 px de arriba/izquierda, traslación **18 px**; cambio de fondo **160 ms linear**, thumb **200 ms** con `--ease-settle`. Apagado `#4e4e50`/tinta; encendido marfil/tinta oscura. Slider del mock: pista `linear-gradient(#323234, #222224)`, relleno `linear-gradient(#ece6d8, #cfcac0)`, contacto `inset 0 1px 0 #ffffff14`; icono 16 px a 8/8, tinta `#1a1a1a`, trazo 2. Es evidencia exacta de un control especializado; no extender ese degradado/relieve a grupos o botones. Su convivencia con la regla de material exclusivo del objeto requiere la resolución indicada en Pendientes.

Fixture 05: rail 272, inspector 320, paneles de mapa 418 × 248, cabecera 52, separaciones entre paneles 16; región maximizada x=312, y=72, w=852, h=820. Fixture 06: paneles x=16/518/1020, y=64, w=484, h=804; terminan en y=868, dock empieza en 892: **24 px libres**. El dock de 05 está centrado en x=738; el de 06 se alinea a right=16. En producto se calcula sobre área operativa disponible, no se fijan esas coordenadas de fixture ni se desplazan nodos guardados.

## Qué reemplaza de DESIGN.md

Quedan derogadas, para las familias anteriores, estas reglas vigentes:

1. **Chrome mate sin degradado, brillo ni filo iluminado** y planos de trabajo al 80 % con lavado diagonal: pasan al material vertical opaco y aro único de las reglas 1–3. Se mantiene ausencia de blur, aura y resplandor.
2. **Planos `#050505` / `#080808` / `#0d0d0d` / `#151515` / `#1d1d1d`**, y la premisa de menús como único plano elevado: nueva escalera y material común. Los menús conservan navegación, selección textual y dueño CSS; no se añade una nueva lógica de menú.
3. **Atención sin contorno** y prohibición absoluta de categorías coloreadas: atención lleva aro ámbar de objeto; insignias usan OKLCH. Sigue prohibido el lavado ámbar de superficies y pozos.
4. **Selección con borde de acento, halo u outline separado**, contornos rojos de error, órbita verde de éxito, cabeza blanca con `drop-shadow` y ondas alrededor de paneles: sustituir por la regla 4. Estado no equivale a selección.
5. **«Dentro no hay líneas»**, burbujas de usuario, tarjetas de subagente/encargo como agrupación y campo del compositor con halo: divisores/guía, cita y compositor a sangre. Mantener detalle y acciones reales.
6. **Controles sin relleno en reposo para toda la isla**, sombra de tecla/pozo y escala .96/.97/.98 con resorte: tres niveles planos, secundarios con relleno y feedback tonal sin movimiento.
7. **Radios 8/14/26, rail 252, inspector 360, dock 56, botones de dock 36 y margen inferior 16**: medidas de las tablas. El título de 17/22 pasa a 15/20 en estas familias.
8. **Orbe de voz, «Te escucho…», cancelación textual y aura espectral**: medidor y transcripción dentro del campo. Se conservan los contratos de audio, envío explícito e inserción segura en terminal.
9. **Gengar, assets GIF/PNG como identidad visible y su presencia duplicada**: Titi existente; no reimplementar el rig ni borrar datos de preferencias por cambiar el nombre visible.
10. **Fundido reducido de 60 ms y recuperación con resorte** en estas interacciones: inmediato con movimiento reducido; FLIP 320 ms con movimiento permitido.

No deroga contratos de fuente de estado, persistencia, permisos, errores, accesibilidad, selección/copiar, entrada PTY, historial, catálogos autorizados ni navegación. Los formularios de Cards/Skills fuera de las escenas conservan su estructura funcional; el material exterior y los tokens compartidos sí les alcanzan. No convertir la excepción de grupos de Configuración en permiso para anidar tarjetas en otras familias.

### Pruebas de tokens que deben reescribirse o adaptarse

Nombres **literales** de `test/design-tokens.test.mjs`. Reescribir las restricciones obsoletas, no borrar el test ni rebajar contraste, seguridad o presupuesto para hacerlo pasar.

| Nombre actual del test | Cambio de contrato / etapa |
|---|---|
| `radii come from the three shapes` | E1/E3/E5: radios 24/12, tokens de fila/grupo y fórmulas concéntricas; marcas pequeñas del medidor tokenizadas. Evitar una whitelist de números arbitrarios. |
| `shadows use chrome or matte workplane elevations, or a state ring` | E1: sombra negra exacta; controles sin relieve; aro enmascarado. E4: decidir slider antes de admitir su contacto. |
| `approved type roles use local families and three weights` | E1/E5: título 15/20, lectura 14/20; conservar fuentes locales y pesos 400/500/600. |
| `sidebar keeps neutral selection, compact status and consistent control sizes` | E1/E3: negros nuevos, glifo 18, rail 272, insignias 32, fila 56, selección `#1d1d20`; conservar estado legible, `aria-current` y target táctil. |
| `sidebar status text retains AA over its selected neutral surface` | E1/E3: retirar exigencia `background-image:none`; comprobar degradado y superficie seleccionada real, no mezcla fija del 9 %. |
| `matte chrome has ivory keys, a spring and accessible opaque fallbacks only on chrome` | E1/E3: reemplazar material mate/spring por degradado y marfil `#ece6d8`, sin blur, sin escala. Conservar reduced-transparency y contrast-more. |
| `workplane elevation aliases stay local and the canvas exposes environmental art` | E1: unificar elevación de objetos; preservar canvas transparente al arte permitido y texto de vecinos estable. |
| `neutral reading and state inks retain AA contrast on opaque planes` | E1: ampliar superficies al pozo, compositor y extremos/interpolación del degradado; mantener 4.5:1 para texto y 3:1 para indicador. |
| `workplanes transmit colour without blur, wells remain dense and composer height never animates` | E1/E5: derogar alpha 76–82 %, wash diagonal y densidad basada en mezclas; exigir opacidad/material nuevo. Conservar sin backdrop-filter, `useComposerSize` y altura sin animación. |
| `reading and state inks retain AA on translucent wells, including a white image behind them` | E1: medir pozos opacos y escritura, imagen blanca sin penetración; conservar AA de teclas y tinta. |
| `chrome reading inks retain AA across the existing CSS atmospheres and project accents` | E1/E3: evaluar extremos del degradado, no asumir mezcla 60/40; insignias coloreadas solo en los selectores autorizados. Dock neutro fuera del estado. |
| `materials retire the old activity glint and keep auxiliary status indicators still` | E2: permitir únicamente cometa de trabajo en su hoja y realce finito del aro; revisar prohibición literal de `.canvas-node::after`. No habilitar infinitos genéricos ni recuperar `--filo-*`. |
| `black planes step up in order and menus own the only raised plane` | E1: comprobar negro profundo y nivel de lectura, retirar «único plano elevado» como axioma. Conservar semántica del picker/selección de menú. |
| `categories are decorative neutrals and active switches are ivory with dark indicators` | E3/E4: categorías/insignias OKLCH, no todas fill-3; switches siguen marfil/oscuro. Proveedor no tiñe superficies enteras. |
| `attention aliases cannot colour surfaces, wells or rings in any src stylesheet` | E2/E3: permitir **solo** aro exterior enmascarado de atención y disco de estado del rail; mantener rastreo transitivo de aliases y prohibición de superficies ámbar. Retirar exigencia de atención sin trazo como único diseño posible. |
| `ivory fallback agrees across CSS, preferences and terminal without losing saved accents or ANSI` | E1: actualizar fallback de fondo terminal a `#040405`; distinguir tecla `--on:#ece6d8` de acento/cursor `#f2f0eb`. Conservar preferencias y ANSI exactos. |
| `drawn edges stay within budget` | Todas: conservar igualdad exacta del recuento por hoja, incluir nuevos divisores reales; complementar con aserciones del aro y ausencia de contornos de controles. |

Se conservan como restricciones `canvas chrome never borrows panel selection elevation, including responsive rules` y `retired tokens stay retired`; no es necesario reintroducir tokens retirados para el aro nuevo. **Ningún test de este archivo impone directamente Gengar**: importa `test/appearance-preferences.test.mjs`, que protege preferencias, no la obligación de dibujar esa mascota. La exigencia visual de Gengar vive en scripts de escritorio que se adaptan en E4.

El presupuesto real leído no coincide con algunos números narrados en DESIGN: canvas **20**, chat **13**, terminal **1**, sidebar **1**, studio **7**, phantom-chat **1**, menus **1**. Shell, settings, voice, activity-trace e identity no tienen entrada y su límite implícito es **0**. `drawnEdges` cuenta declaraciones `border`, incluidos bordes transparentes y divisores, pero no `outline`, `box-shadow`, SVG ni máscaras. No usar esas omisiones para esconder un segundo aro. Recontar con el mismo algoritmo, documentar selector y razón de cada delta y guardar el número exacto en `test/design-budget.json`, sin holgura ni cifras futuras inventadas.

## Plan por etapas

Orden obligatorio: **Etapa 1 → Etapa 2 → Etapa 3 → Etapa 4 → Etapa 5**. Cada etapa consume la anterior; no se da por completada con un cambio de tokens aislado si sus overrides visibles siguen mostrando la receta vieja. Las listas siguientes son rutas reales comprobadas y delimitan la implantación futura; no son permiso de edición durante esta entrega documental.

**Comprobaciones propuestas, no ejecutadas aquí.** Los comandos se invocan desde la raíz. Los `.test.mjs` se ejecutan con `node --test`; los scripts de Electron con `node`. `test/design-capture.mjs <etiqueta>` recibe una **etiqueta de salida, no un selector de escena**: actualmente recorre `empty`, `focus`, `map-selected`, `map-rest`, `synthetic-states`, `attention`, `settings-categories`, `settings-switches`, `space-menu`, `model-menu` y `tray`. Las escenas de sesión y FLIP que se proponen abajo aún deben incorporarse al script.

Antes de usarlo como evidencia v2, adaptar sus aserciones: hoy espera tecla `rgb(242, 240, 235)`, categorías neutras e incluso tinta `rgb(198, 241, 53)` en el fixture de atención. Lo correcto es marfil `#ece6d8`, paleta de insignias y ámbar `#f5c04a`, sin relajar los pozos neutros. Su «antes» carga CSS de HEAD y solo tres módulos seleccionados: ampliar la captura de fuentes a los componentes visuales afectados para evitar mezclar JSX nuevo y CSS viejo. Conservar perfiles aislados, builds absolutos, comprobación de artefactos, timeout y cierre de procesos propios. El chequeo de pintura del rail debe medir el rail real; no simplemente bajar el umbral si cambian sus dimensiones.

### Etapa 1 · Tokens y material: negro, degradado, aro

**Dependencia:** ninguna. **Resultado observable:** canvas profundo; rail, paneles, inspector, dock y objetos flotantes con el mismo degradado y un solo aro; pozos opacos; sin blur o halo ni doble contorno al seleccionar. No queda un `.node-body` plano tapando el material del objeto.

**Archivos a editar:**

- Material y fallbacks: `src/canvas-ui.css`, `src/studio.css`, `src/sidebar.css`, `src/shell.css`, `src/settings.css`, `src/chat.css`, `src/terminal.css`, `src/phantom-chat.css`, `src/menus.css`, `src/components/TerminalPanel.jsx`.
- Contrato y evidencia: `test/design-tokens.test.mjs`, `test/design-budget.json`, `test/design-capture.mjs`, `test/solid-workplanes-desktop.mjs`, `DESIGN.md`.

**Adaptar tests existentes:** filas E1 de la tabla anterior; `solid-workplanes-desktop` deja de exigir transparencia/elevaciones distintas y comprueba material efectivo, selección sin doble aro, lectura estable y contención. El test de fallback terminal conserva cursor y ANSI. Actualizar el presupuesto únicamente a los recuentos resultantes de estas hojas; no asignar margen a etapas futuras.

**Comprobaciones propuestas:**

```text
node --test test/design-tokens.test.mjs
node test/solid-workplanes-desktop.mjs
node test/design-capture.mjs design-v2-e1
```

Escenas aplicables: `map-rest`, `map-selected`, `focus`, `settings-categories`, `space-menu`. Comparar a 1520 × 980 con 05; inspeccionar colores calculados, máscara del aro y una terminal interactiva. Probar también imagen de fondo clara, contraste aumentado y transparencia reducida sin disminuir umbrales AA.

**Riesgos:** cascada de múltiples roots, mezcla accidental de tipo imagen/color, máscara que intercepte acciones, radio que recorte foco, xterm con fondo de fallback viejo. Los tokens comunes afectan familias no mostradas: comprobarlas con sus tests existentes sin refactorizar sus modelos.

### Etapa 2 · Estados del panel y trazo cometa

**Dependencia:** E1. **Resultado observable:** cinco estados en una escena: atención con aro ámbar; trabajo con cometa A; fin/error/reposo con aro neutro; palabra de estado siempre visible. Sin resplandor ni ondas exteriores. Realce de mapa y maximización parten del panel correcto y respetan movimiento reducido.

**Archivos a editar:**

- `src/components/ActivityTrace.jsx`, `src/activity-trace.css`, `src/components/Canvas.jsx`, `src/canvas-ui.css`, `src/App.jsx`, `src/components/Presence.jsx`, `src/components/ActivityNotch.jsx`, `src/components/ChatCard.jsx`, `src/terminal.css`.
- `test/design-tokens.test.mjs`, `test/design-budget.json`, `test/terminal-borders-smoke.mjs`, `test/spectral-ui.mjs`, `test/desktop-motion.mjs`, `test/canvas-controls.mjs`, `test/design-capture.mjs`, `DESIGN.md`.

**Adaptar tests existentes:** tests de glint/atención; `terminal-borders-smoke` exige hoy 2 px, `pathLength` anterior, outline separado y animaciones de fin/error: reemplazar esas expectativas por geometría/cometa exactas y ausencia de doble aro. Conservar `src/hooks/terminalBorderState.mjs` y sus pruebas de precedencia: `PixelField preserves its signal mapping and adds a distinct green emission` verifica un mapa de datos, no obliga a montar el campo de ondas. Retirar su montaje alrededor de paneles en Canvas y comprobar la ausencia visual en `spectral-ui`, sin refactorizar ese motor. En `desktop-motion` y `canvas-controls`, medir FLIP/retorno de foco sin cambiar propiedad PTY.

**Comprobaciones propuestas:**

```text
node --test test/design-tokens.test.mjs src/hooks/terminalBorderState.test.mjs src/hooks/activityModel.test.mjs src/hooks/input-ownership.test.mjs
node test/terminal-borders-smoke.mjs
node test/desktop-motion.mjs
node test/canvas-controls.mjs
node test/spectral-ui.mjs
node test/design-capture.mjs design-v2-e2
```

Escenas: ampliar `synthetic-states` y `attention` con paneles reales de los cinco estados; `focus` y `map-selected` para ida/vuelta. Añadir al script observación temporal **propuesta** de `map-flash` y `focus-flip` (origen, destino, retorno y reduced-motion); una captura final no acredita la animación. Comprobar pausa con documento/panel oculto y retiro del trazo al cambiar a reposo.

**Riesgos:** `pulse-turn` puede significar intervención o respuesta sin leer; no usar un solo color para ambos por comodidad. SVG fuera de su radio, dos timelines compitiendo con Presence, persistencia accidental de tamaño maximizado, Esc tomado por el shell mientras escribe xterm. No alterar los estados canónicos para ajustar colores.

### Etapa 3 · Rail, insignias, controles y hover

**Dependencia:** E2; resolver el croma de la paleta antes de afirmar igualdad estricta. **Resultado observable:** rail 272 px con filas de 56, insignias planas y apoyo tipo/estado/tiempo; hover rectangular sin movimiento; tres niveles de controles y un segmentado; dock 64 con 24 px libres.

**Archivos a editar:**

- `src/components/SidebarPanels.jsx`, `src/hooks/sidebarModel.mjs`, `src/hooks/sidebarModel.test.mjs`, `src/sidebar.css`, `src/shell.css`, `src/canvas-ui.css`, `src/identity.css`, `src/components/Glyphs.jsx`, `src/components/ShellIcons.jsx`, `src/App.jsx`, `src/components/Canvas.jsx`, `src/components/PluginPrimitives.jsx`.
- `test/design-tokens.test.mjs`, `test/design-budget.json`, `test/session-glyphs.test.mjs`, `test/sidebar-model.spec.mjs`, `test/sidebar-floating.mjs`, `test/sidebar-desktop.mjs`, `test/canvas-controls.mjs`, `test/desktop-motion.mjs`, `test/design-capture.mjs`, `DESIGN.md`.

**Adaptar tests existentes:** sidebar/contraste/categorías/atención de la tabla; ampliar `rows expose defaults, original node and title, status and model basename` con tiempo válido/ausente, sin cambiar orden y ownership. En `session-glyphs`, conservar siluetas distintas y ausencia de emblemas genéricos, añadir tamaño/trazo y estabilidad de insignia; no exigir el asterisco dibujado en el mock. Scripts de sidebar dejan de exigir punto superpuesto/acento al seleccionar y miden rectángulo de hover, foco y ausencia de clipping.

**Comprobaciones propuestas:**

```text
node --test test/design-tokens.test.mjs test/session-glyphs.test.mjs src/hooks/sidebarModel.test.mjs test/sidebar-model.spec.mjs src/hooks/panelFraming.test.mjs src/hooks/input-ownership.test.mjs
node test/sidebar-floating.mjs
node test/sidebar-desktop.mjs
node test/canvas-controls.mjs
node test/design-capture.mjs design-v2-e3
```

Escenas: `synthetic-states`, `map-rest`, `map-selected`, `focus`; ampliar con hover/pulsado y rail por estado/por tipo como fixtures claramente identificados. Medir círculo 32, glifo 18, borde derecho común y dock; añadir ventana 1100 × 760 y puntero grueso a las comprobaciones geométricas existentes. No recortar el estado para hacer caber el tiempo.

**Riesgos:** cambiar el glifo al aplicar selección sólida automática; confundir badge ámbar con superficie ámbar; introducir una preferencia antes de que Carlos la confirme; reducir áreas de interacción al diámetro visual; conservar escala por un selector global tardío. El dock debe conservar acceso al catálogo completo de herramientas.

### Etapa 4 · Configuración e identidad Titi

**Dependencia:** E3; resolver especialización visual del slider y emplazamiento de identidad cuando sea necesario. **Resultado observable:** Apariencia como inspector de 320 px y grupos planos de radio 12 sin aro; filas, switches y controles alineados. Titi existente ocupa un único emplazamiento de identidad; no queda Gengar visible en bienvenida, vacío, fondo ni textos de ajustes.

**Archivos a editar:**

- Configuración: `src/components/Settings.jsx`, `src/components/Appearance.jsx`, `src/components/PluginPrimitives.jsx`, `src/components/Inspector.jsx`, `src/settings.css`, `src/canvas-ui.css`, `src/studio.css`.
- Identidad y emplazamiento: `src/App.jsx`, `src/components/Canvas.jsx`, `src/components/Glyphs.jsx`, `src/components/TitiGhost.jsx`, `src/components/GengarMascot.jsx`, `src/components/ActivityNotch.jsx`, `src/components/PhantomChat.jsx`, `src/identity.css`, `src/stories/Identity.stories.jsx`, `src/stories/fixtures.js`.
- Evidencia: `test/design-tokens.test.mjs`, `test/design-budget.json`, `test/gengar-identity-desktop.mjs`, `test/titi-visual.mjs`, `test/empty-states-desktop.mjs`, `test/unified-design-desktop.mjs`, `test/ui-refinement.mjs`, `test/design-capture.mjs`, `DESIGN.md`.

**Adaptar tests existentes:** categorías, switches y contornos de controles; scripts `gengar-identity-desktop`, `empty-states-desktop` y `unified-design-desktop` pasan de IMG/GIF/tamaños de Gengar a presencia única de Titi, quietud y acciones intactas. Mantener el nombre de archivo del test durante la transición no conserva la identidad vieja. `titi-visual` ya prueba el rig: reutilizar sus fixtures, añadir conteo de emplazamientos; no sustituirlo por un screenshot sin aserciones. `ui-refinement` conserva carga, error, guardado, foco, disabled/read-only y contención; cambia expectativas de borde y radio en Configuración.

**Comprobaciones propuestas:**

```text
node --test test/design-tokens.test.mjs test/appearance-preferences.test.mjs test/interface-scale.test.mjs test/execution-policy.test.mjs test/public-settings.test.mjs
node test/ui-refinement.mjs
node test/titi-visual.mjs
node test/gengar-identity-desktop.mjs
node test/empty-states-desktop.mjs
node test/unified-design-desktop.mjs
node test/design-capture.mjs design-v2-e4
```

Escenas: `settings-categories`, `settings-switches`, `empty`, `map-rest`; adaptar el fixture de Apariencia para comprobar su posición de inspector, scroll y agrupación. Las categorías y rutas existentes siguen accesibles; el panel de ajustes embebido conserva su adaptación por contenedor. Datos/validaciones de teléfono y proveedores no se cambian para reproducir controles de muestra.

**Riesgos:** tokens heredados y `.settings-sheet` mantienen la hoja centrada de 960 px; controles compartidos afectan varias categorías; Titi ya aparece en múltiples lugares; `useSpriteMotion` vive en `GengarMascot.jsx`, por lo que quitar ese módulo sin conservar el hook rompería el rig. Los switches de sonido/animación de 05 no prueban que existan preferencias equivalentes: no conectar controles ficticios ni inventar persistencia; ver Pendientes.

### Etapa 5 · Sesión por dentro y dictado

**Dependencia:** E4. **Resultado observable:** las tres escenas de 06 con idéntico compositor, proveedor por filas, Chat/Terminal segmentado, contexto alineado, cita de usuario, actividad sin tarjetas y medidor de dictado. Envío/cancelación y las funciones actuales de chat, terminal y voz conservan su semántica.

**Archivos a editar:**

- Sesión: `src/components/ChatCard.jsx`, `src/components/TerminalCard.jsx`, `src/components/TerminalPanel.jsx`, `src/components/PhantomChat.jsx`, `src/components/PhantomOrchestrator.jsx`, `src/components/PluginPrimitives.jsx`, `src/chat.css`, `src/terminal.css`, `src/phantom-chat.css`, `src/canvas-ui.css`.
- Dictado: `src/components/VoiceActivity.jsx`, `src/components/VoiceDictation.jsx`, `src/components/VoiceCapture.jsx`, `src/voice.css`, `src/stories/Voice.stories.jsx`. Reutilizar los hooks de captura y envío actuales; no cambiarlos para el acabado.
- Pruebas/evidencia: `test/design-tokens.test.mjs`, `test/design-budget.json`, `test/subagent-card-width.test.mjs`, `test/voice-desktop.mjs`, `test/unified-design-desktop.mjs`, `test/conversation-windows.mjs`, `test/solid-workplanes-desktop.mjs`, `test/design-capture.mjs`, `DESIGN.md`.

**Adaptar tests existentes:** restricciones de compositor/material, tipografía y bordes; `subagent card and its children shrink within the available width` y `phantom link and its children shrink within the available width` conservan contención aunque se elimine la tarjeta. `voice-desktop` deja de buscar orbe/aura y cancelación textual, comprueba medidor, texto confirmado/parcial dentro del campo, X/palomita y permisos/errores. `conversation-windows`/`unified-design-desktop` comprueban la nueva fila de proveedor y el mismo compositor en foco/mapa/lateral. Los tests de `voice-send`, permisos y chat son regresiones a conservar, no contratos que se deban relajar.

**Comprobaciones propuestas:**

```text
node --test test/design-tokens.test.mjs test/subagent-card-width.test.mjs src/hooks/voice-send.test.mjs src/hooks/voice-pcm.test.mjs src/hooks/voiceStream.test.mjs src/hooks/chatState.test.mjs src/hooks/phantom-run-link.test.mjs src/hooks/delegated-runs.test.mjs test/chat-permissions.test.mjs test/chats.test.mjs test/execution-policy.test.mjs
node test/voice-desktop.mjs
node test/conversation-windows.mjs
node test/unified-design-desktop.mjs
node test/solid-workplanes-desktop.mjs
node test/design-capture.mjs design-v2-e5
```

Escenas existentes aplicables: `focus`, `model-menu`, `attention`. Añadir al script las escenas **propuestas** `session-new`, `session-working`, `session-dictating`, con fixtures de datos identificados como sintéticos, a 1520 × 980 y en ancho reducido. Verificar que los tres compositores comparten padding, campo y controles; progreso solo con total real; detalle expandible accesible; Enter durante transcripción envía una vez; X/Esc y cambio de proyecto invalidan la entrega tardía. Con movimiento reducido no quedan rAF decorativos, flash, blink ni altura animada. Terminal recibe únicamente texto revisado, jamás Enter añadido.

**Riesgos:** duplicar texto confirmado al mezclar preview y borrador; perder texto al cancelar; carrera de transcripción/submit; convertir un proveedor histórico en disponible; modelo/permisos fuera de pantalla; apagar estado de subagentes porque su caja desaparece; discrepancias entre compositor de canvas y lateral. La captura de mock no prueba audio real ni éxito de un proveedor.

## Fuera de alcance

- Esta entrega no implementa CSS, componentes, pruebas ni migraciones; tampoco genera capturas o acredita checks. Las cinco etapas son encargos futuros.
- No cambiar motores/defaults de ejecución, protocolos de host/PTY/voz, APIs, autorizaciones de Phantom, cifrado, vinculación móvil ni validaciones de guardado. La apariencia de filas de proveedor no autoriza a habilitar OpenCode o Codex.
- No rehacer el rig de Titi, la física de cámara, el render de xterm, ANSI, Markdown o el almacenamiento. Reutilizar lo existente antes de crear abstracciones.
- No copiar controles de comparación «Hoy/Propuesta», leyendas de los mocks, coordenadas fijas ni datos de ejemplo al producto. No añadir opciones de preferencias o sonido sin contrato de comportamiento.
- No reordenar destinos, eliminar herramientas ni rediseñar el contenido funcional de Cards, Skills, Git, Teléfono u otros paneles para hacerlos caber en la maqueta. El cambio de material exterior y controles compartidos no permite alterar sus contratos.

## Pendientes de decisión

1. **Rail por estado frente a por tipo:** predeterminado recomendado, pendiente de confirmación de Carlos frente a por tipo. No presentarlo como decisión cerrada ni crear persistencia por cuenta propia.
2. **Croma idéntico:** Carlos pide seis tonos con igual luminosidad y croma; ambos mocks declaran L=0.64 y C=0.10/0.11. La tabla conserva literalmente la referencia. Para imponer igualdad estricta falta que Carlos confirme la paleta tal cual o entregue el croma común; no calcular otra paleta. Afecta al cierre de E3, no a negro/material de E1.
3. **Alcance de «un solo fantasma por escena»:** 06 contiene Titi del dock y dos glifos Titi de llamadas a Phantom. La especificación distingue identidad de escena y glifo de operación para describir fielmente ambas reglas. Confirmar si el límite cuenta solo la mascota/identidad; si cuenta toda aparición, la combinación aprobada requiere revisión antes del cierre de E4/E5.
4. **Slider de Apariencia:** el control de 05 tiene degradado y contacto interior, mientras la regla general reserva degradado/aro al objeto. Se han registrado sus valores exactos, sin extenderlos. Confirmar esa especialización de control; sin confirmación no inventar un slider plano alternativo ni declarar cumplida esa parte de E4.
5. **Controles funcionales de Apariencia del mock:** «Animar sesiones activas», «Avisar cuando te necesiten», sonidos al terminar/error y escala 80–130 no corresponden uno a uno a los ajustes actuales. Antes de implantar esos controles exactos hay que fijar su alcance y persistencia o identificar un control equivalente existente. Los estados on/off, 62 %, 100 % y volumen 30 % del mock son fixtures; no cambian preferencias reales ni límites de escala.

Discrepancias que no requieren inventar una decisión: rail **56 px** por CSS frente a 52 en leyenda; cometa **5.6 s** en mapa y **7 s** en sesión interior; `--t-code` **12/18** en salida de mapa y **12/16** en actividad interna; segmentado de producto basado en `.segm` de 06 y no en la barra de comparación de 05. El texto de demostración que propone `--surface:#131315` no es una declaración CSS y no se usa. La aprobación de los mocks tampoco acredita aprobación de estas implantaciones futuras.
