---
name: Phantom Workspace
description: Spectral night glass — plum working planes, violet penumbra and quiet activity edges over a spatial canvas.
colors:
  accent: "#a78bda"
  accent-soft: "color-mix(in srgb, var(--accent) 15%, var(--surface))"
  accent-mint: "#7cc9a0"
  accent-amber: "#e3bf86"
  accent-rose: "#e9a0bf"
  accent-cyan: "#6fe3f2"
  bg: "#0b0910"
  surface: "#131019"
  surface-2: "#1c1725"
  surface-3: "#292133"
  ink: "#eee9f4"
  muted: "#a69bb7"
  hairline: "color-mix(in srgb, #fff 8%, transparent)"
  fill: "color-mix(in srgb, #fff 5%, transparent)"
  fill-2: "color-mix(in srgb, #fff 9%, transparent)"
  fill-3: "color-mix(in srgb, #fff 14%, transparent)"
  glass: "color-mix(in srgb, var(--surface) 64%, transparent)"
  glass-thick: "color-mix(in srgb, var(--surface) 84%, transparent)"
  rail: "#131019"
  terminal-bg: "#0e0b13"
  terminal-ink: "#ddd5e9"
  primary-ink: "#130d1e"
  note: "#211d2c"
  danger: "#ee788a"
  success: "#7cc9a0"
  warning: "#e9b46a"
  working: "#bb9af7"
  attention: "#e9b46a"
  error-bg: "color-mix(in srgb, var(--danger) 15%, var(--surface))"
  mission-bg: "color-mix(in srgb, var(--success) 14%, var(--surface))"
  mission-ink: "var(--success)"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-.025em"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  appearance-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    lineHeight: 1.7
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 600
  support:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
  micro:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "10px"
  panel-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "calc(11px * var(--map-label-scale,1))"
    fontWeight: 600
    lineHeight: 1.1
  tool-button:
    fontFamily: "system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  mark: "4px"
  ctl: "8px"
  obj: "14px"
  isle: "22px"
  pill: "999px"
spacing:
  compact: "4px"
  field-gap: "5px"
  tool-gap: "6px"
  control-gap: "8px"
  form-gap: "10px"
  inset: "12px"
  content: "16px"
  appearance-inline: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "35px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "35px"
  tool-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.tool-button}"
    rounded: "{rounded.field}"
    padding: "6px 10px"
  tool-button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.tool-button}"
    rounded: "{rounded.field}"
    padding: "6px 10px"
  tool-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "7px 9px"
    width: "100%"
  project-item-active:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "8px"
    width: "100%"
  panel-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.support}"
    rounded: "{rounded.icon}"
  tool-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  canvas-node:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.node}"
  background-option:
    textColor: "{colors.ink}"
    typography: "{typography.support}"
    rounded: "{rounded.preset}"
    padding: "5px 5px 9px"
---


# Design System: Phantom Workspace

Este documento tiene una sola capa. Si una regla cambia, se edita aquí y en `test/design-tokens.test.mjs` en el mismo cambio; no se añaden secciones «vigentes» al final. El historial de las capas anteriores (Studio, Vidrio nocturno, Lienzo, Acabado) está en git.

## Reglas

Tres reglas deciden casi todo. Las dos primeras las vigila `npm test`.

1. **Una caja por objeto.** Solo dibuja contorno lo que se puede mover o lo que flota: panel, zona, rail, islas, dock, menús. Dentro de un objeto se separa con espacio, tipografía y un paso de tono; nunca con líneas. Como mucho un nivel de relleno interior: el control donde se escribe o se elige (campo del compositor, pista del segmentado, pozo de código o de terminal).
2. **El peso lo da el estado.** El chrome usa `--shadow-chrome`: sombra ciruela suave y un rastro mínimo de halo, también en menús, inspector y variantes responsive. En reposo un panel es tono, una hairline y `--shadow-rest`, con penumbra violeta estática tenue. Seleccionado o arrastrado flota (`--shadow-float`), con halo definido; el panel en foco conserva esa elevación. Selección usa un contorno sólido exterior de 2 px separado 3 px. Trabajando respira el perímetro interior violeta, independiente del acento del proyecto. Lo que te necesita emite: borde ámbar y ondas en el lienzo. Un borde de color siempre significa estado o selección, nunca categoría.
3. **Lo fantasma es comportamiento y material.** Las superficies se materializan y se dispersan, no se deslizan. Las sombras son ciruela, no negras. La marca Phantom vive en el notch de actividad. El arte Gengar es una capa ambiental opcional, independiente de la marca; no aparece en estados vacíos.

### Tokens (`src/canvas-ui.css`, bloque `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--r-ctl` | 8 px | Controles: botones, campos, filas, pozos interiores |
| `--r-obj` | 14 px | Objetos: paneles, menús, popovers, barras |
| `--r-isle` | 22 px | Islas que flotan: rail, inspector, paleta |
| `--r-mark` | 4 px | Marcas de menos de 20 px: kbd, casilla, scrollbar. No es una superficie |
| `--r-pill` | 999 px | Chips y estados. No es una superficie |
| `--hairline` | blanco al 8 % | El único borde. Lo dibuja el objeto, una vez |
| `--shadow-chrome` | ciruela suave + halo mínimo `0 0 20px -12px #9563d61a` | Barras, rail, dock, navegación, minimapa, inspector, menús y overlays; sin halo de selección |
| `--shadow-rest` | ciruela corta + halo tenue `0 0 24px -10px #9563d62e` | Panel apoyado en el lienzo; penumbra estática |
| `--shadow-float` | ciruela larga + halo `0 0 40px -12px #a171e875` | Panel seleccionado, arrastrado o en foco; penumbra estática definida |
| `--working` | `#bb9af7` | Perímetro interior de 2 px, pulso de opacidad .3–.85 cada 4,8 s |
| `--attention` | `#e9b46a` | Permiso/pregunta pendientes, turno que necesita al usuario |

`test/design-tokens.test.mjs` falla si: un `border-radius` usa otro valor (se admiten `0`, `50%`, `em` y los ajustes concéntricos `calc(token - 1px)`); un `box-shadow` no es `--shadow-chrome`, `--shadow-rest`, `--shadow-float` o un anillo de estado (desplazamiento y desenfoque cero); una declaración de `--shadow-float` en `src/canvas-ui.css` o `src/studio.css` se aplica fuera de los paneles `.canvas-node`, incluidas reglas responsive; reaparece un token retirado (`--line`, `--hairline-strong`, `--elev-*`, `--r-xs…xl`, `--object-*`, `--shadow-popover`, etc.); o una hoja supera su presupuesto de bordes en `test/design-budget.json`. El presupuesto solo baja: al quitar bordes, se reduce el número en el mismo cambio.

Sin side-tabs: un borde lateral de color no marca tipo ni categoría (el tipo de memoria se lee en su glifo y etiqueta con tono). Skills usa el glifo de libro de `PanelIcons.js`, no el emblema genérico de IA.

Estado del presupuesto: chat 14, terminal 1 y chat lateral 1. Plugins 9, Skills 4 y Repository 12: cabeceras, segmentados, listas y pozos de lectura se separan por espacio y tono; los bordes restantes incluyen campos, estados y guías estructurales. `test/design-budget.json` conserva el recuento exigible por hoja.

Excepción acotada al presupuesto descendente: `src/studio.css` pasa de 7 a 8 por `.interface-scale select`, el selector nativo de escala de interfaz en Apariencia. Su borde `--hairline` delimita el área donde se elige un valor, en coherencia con los campos existentes; `focus-visible` identifica el foco de teclado. Es un borde funcional de formulario, no un contenedor decorativo. Se conserva y se contabiliza en el presupuesto; esta excepción no amplía los demás presupuestos.

## Material y paleta

- **Planos.** Ciruela casi negra `--bg #0b0910`; trabajo `--surface #131019`; elevación `--surface-2 #1c1725` y `--surface-3 #292133`. Texto `--ink #eee9f4`, secundario `--muted #a69bb7`. Terminal opaca `--terminal-bg #0e0b13`. Nunca negro puro.
- **Rellenos.** Una escalera blanca-alfa: `--fill` 5 %, `--fill-2` 9 %, `--fill-3` 14 %. Sin degradados, luces interiores ni relieve en controles.
- **Acento.** Violeta `#a78bda` (clave `lilac`) para selección, foco y acción. Iris, Menta, Ámbar, Rosa y Cian siguen disponibles por proyecto.
- **Estados.** `--working` violeta espectral, `--attention` ámbar (te necesita), `--danger` rojo rosado, `--success` menta. Cada estado tiene un valor; los fondos se derivan con `color-mix`. El acento no se usa para estado: selección y teclado son contornos sólidos; actividad es perímetro interior y etiqueta. `test/design-tokens.test.mjs` exige contraste de texto AA (4,5:1) para texto principal, secundario, trabajo y atención sobre los cinco planos opacos.
- **Vidrio.** Solo el chrome: `--glass` (64 %) o `--glass-thick` (84 %) con `--glass-filter`. Los planos de trabajo (terminal, hilo, paneles) son opacos. `prefers-reduced-transparency` vuelve el chrome opaco, desactiva su filtro y oculta atmósfera y campo de ondas.
- **Tipografía.** `--sans` Inter → SF Pro → sistema; `--mono` Monaspace Neon → GeistMono → JetBrains Mono, solo para código, rutas y medidas. Chrome a 12–13 px, mínimo 10 px, siempre en píxeles enteros (sin medios píxeles). Las etiquetas van en caja natural, peso 600 y `--muted`; nunca en mayúsculas con tracking. Iconos lucide y `PanelIcons.js` con trazo 1,75.
- **Atmósfera.** Un solo estilo base ciruela/violeta; las opciones de fondo existentes (Gengar, Aurora, Marea, Brasa, Grafito o imagen propia) no cambian materiales ni tipografía. No se añaden presets. Los dos degradados ambientales se localizan arriba a la derecha (82 % × 80 %) y abajo a la izquierda (64 % × 64 %), sin repetición, para dejar zonas oscuras entre luces. La imagen propia conserva `cover` centrado. Ambiente y arte tienen capas e intensidades independientes. «Mostrar Gengar» controla el arte local existente (`assets/gengar-source.md`), incluso sobre otro fondo; su presencia no depende del deslizador ambiental. La identidad sigue siendo el glifo Phantom. El arte no se redistribuye fuera de uso personal.

## Lienzo y chrome

- El canvas va de borde a borde; el chrome son objetos apoyados sobre él con un único hueco `--gutter` de 16 px.
- **Rail:** 252 px, radio `--r-isle`, alto según contenido; contraído es una píldora de 48 px.
- **Fila superior:** título y controles son dos islas de 48 px (`--bar`); entre ellas hay canvas. `--top-clear` es la primera línea libre.
- **Inspector:** contrapeso del rail, 360 px, cuelga bajo los controles.
- **Franja inferior:** el área de paneles (`.canvas-stage`) termina 196 px antes del borde inferior en mapa y 134 px en foco. Navegación, minimapa y creación quedan fuera de su recorte: ninguna cámara puede colocar contenido interactivo bajo esas islas. La franja conserva la atmósfera, sin caja ni borde adicional.
- **Dock:** lecturas de actividad arriba y fila de herramientas abajo en un mismo objeto, sin línea entre ambas. Botones de 64×52 px, icono sobre palabra, sin acción primaria teñida. En mapa comparte columna con navegación; el minimapa ocupa una columna independiente de 190 px, separada 16 px. El dock termina a 16 px del borde inferior; navegación ocupa la fila de 48 px sobre una fila de 104 px, separadas 12 px. En foco el dock se centra en el área libre y el panel termina 16 px antes de la franja.
- **Retícula:** puntos en espacio-mundo; duplican el paso por debajo de 14 px. El viewport no se desplaza: solo la cámara.
- **Ritmo:** múltiplos de 4 px (`--s-1`…`--s-6`).

## Card de chat y terminal

La card es la caja. Dentro no hay líneas:

- **Cabecera** (44 px): mismo tono que la card, sin costura. Glifo del tipo, título de 13 px/peso 600, acciones con aparición por hover o foco de teclado.
- **Identidad:** selector de agente y carpeta en una fila, sin fondo propio.
- **Hilo:** a sangre, opaco, sin pulsos decorativos en el contenido. Turnos separados por 28 px (32 px en foco), mensajes propios un paso de tono, columna de lectura de hasta 780 px. Pasos de herramientas, subagentes, bloques de código y salidas son pozos de un tono (`--fill` o un paso sobre `--terminal-bg`) con `--r-ctl`, sin borde ni cabecera subrayada. Las guías de 1 px de razonamiento y pasos anidados se conservan: indican anidamiento, no contienen.
- **Segmentado** Claude · OpenCode · Codex · Terminal: pista `--fill`; el segmento activo se tiñe con el tono del proveedor. Sin anillos.
- **Compositor:** el campo de escritura (`--surface-2`, `--r-obj`). Hover eleva ligeramente su tono; foco usa acento del proyecto y anillo estático de 3 px, sin confundirse con el pulso de actividad. Modelo, Effort y permisos son texto con hover, no chips rellenos. Debajo, sin fondo: contexto, costo y pista de teclado; metadatos y controles envuelven en ancho reducido.
- **Tamaño compartido:** `ChatCard` y `PhantomChat` usan `useComposerSize`. Altura inicial mínima de 38 px, una fila, mismo padding incluso en foco. El máximo es el menor entre el 45 % del alto del contenedor y el espacio libre tras cabeceras, avisos, controles, metadatos y reserva de hilo (hasta 96 px o 20 % del alto). Se recalcula al escribir, borrar, enviar y cambiar ancho/alto o controles; `ResizeObserver` y observación de contenido conservan el límite sin depender del zoom del canvas. Al llegar al máximo, el texto tiene scroll interno y los controles permanecen fuera de ese scroll. No se anima la altura al teclear.
- **Chat lateral:** fondo, hilo y compositor son sólidos opacos; navegación y chrome flotante conservan vidrio. La cabecera y el selector no añaden costuras interiores. Los controles pueden envolver en anchos estrechos.
- **Plugins, Skills y Repository:** título de herramienta 15 px/600, icono de cabecera 18 px; títulos de sección y etiquetas en caja natural, 12 px/600 y tono secundario; cuerpo 13 px; glifos Lucide con trazo 1,75. Sin contornos interiores redundantes en cabeceras, segmentados y pozos; se conservan estados, contenido, foco y rutas de navegación.
- **Terminal:** el pozo de salida se distingue por tono. Su borde superior es transparente y solo se colorea con estado (violeta trabajando, ámbar te necesita).
- **Preguntas y permisos pendientes** sí llevan borde de color: es estado. Resueltos, lo pierden.
- **Zoom semántico:** por debajo del 45 % la card es una ficha (título, estado, tres líneas de salida); por debajo del 25 %, título y estado.

## Estados, pulsos y notch

- **Escalera de foco.** Mapa: viñeta suave y atmósfera. Selección: la card elegida conserva su luz y flota; las demás bajan a `brightness(.7) saturate(.72)` y la atmósfera al 55 %. Foco: atmósfera al 12 %, sin retícula. Lo que te necesita nunca se atenúa.
- **Bordes vivos.** Trabajando: el borde violeta interior respira cada 4,8 s animando solo opacidad; el desenfoque del halo es estático. Te necesita: borde ámbar en el compás de 2,4 s; a los 30 s queda fijo. Error: tres destellos y borde rojo. Estos estados conservan su borde incluso con hover, selección o foco. Permiso/pregunta pendiente prevalece sobre trabajando y reposo, también en la etiqueta accesible.
- **Campo de ondas** (`PixelField.jsx`): atención se propaga por el lienzo como un sonar con la forma del panel; trabajo mantiene halo estático y no sostiene un bucle de repintado. En reposo no pinta nada. Omite paneles fuera de vista, pausa en documento oculto y se reactiva con cámara/visibilidad. Movimiento reducido conserva estados fijos; transparencia reducida oculta el campo.
- **Notch.** `PhantomFace` (`Glyphs.jsx`) es la marca con ánimo; solo cambian ojos y sonrisa, y solo con estado real: `asleep` host desconectado (ojos cerrados), `unsure` lecturas viejas o con error (un ojo cerrado), `calm` nada pendiente (parpadea cada 7 s), `grin` algo te necesita (ojos encendidos en ámbar, sonríe; late en el compás de 2,4 s). El texto siempre acompaña al glifo.

## Movimiento

Una curva (`--ease-out`), dos velocidades (`--dur-fast` 140 ms, `--dur` 240 ms). Una sola entrada, `@keyframes materialize`: opacidad, desenfoque de 8 px y escala .985 → 1. `Presence.jsx` hace lo mismo al montar y, al desmontar, dispersa (desenfoque 12 px, escala 1.02). Nada se desliza. El paneo conserva su inercia. `prefers-reduced-motion` deja solo el fundido y detiene el pulso ambiental. El pulso opcional dura 16 s y está OFF por defecto; solo modula la luz del ambiente. Concentración atenúa ambiente y personaje al 12 %, oculta retícula y detiene animaciones decorativas sin cambiar las preferencias guardadas de presencia, intensidad o pulso. Los estados reales conservan texto y color.

## Estados vacíos

`src/components/EmptyState.jsx` comparte la anatomía de icono, título, descripción, detalles, acciones y pista; `src/empty-state.css` controla su geometría. Los mensajes de carga, error y estado pertenecen a su fuente.

- **Tamaños:** `panel` (predeterminado) reserva 40 px para el icono, con SVG de 24 px, título de 15 px y cuerpo de 13 px; `hero` reserva 64 px, SVG de 32 px y título de 24 px (22 px a ≤850 px de ancho; 21 px e icono de 48 px a ≤650 px de alto); `compact` reserva 24 px, SVG de 16 px, título de 12 px y cuerpo de 11 px.
- **Retícula:** ritmo de 4 px mediante los tokens de espaciado: separación interna de 8 px (12 px en `hero`), padding vertical de 24 px (8 px en `compact`) y horizontal de 16 px por defecto. Descripciones y pistas se limitan a 44ch; las acciones pueden envolver. `--empty-inset` adapta el margen interior a cada panel: 8 px en los grupos del rail, 17 px en el índice de paneles, 16 px en selectores y 12 px en los grupos laterales del repositorio.
- **Alineación:** `hero` y `panel` centran horizontalmente caja y contenido en su contenedor; `hero` ocupa el canvas mediante `inset: 0`. `compact` alinea el contenido a la izquierda con el contenido/encabezado del panel, incorporando su inset. Se usan `min-width: 0`, límites de ancho y ajuste de texto para contener el contenido.

`test/empty-states-desktop.mjs` implementa mediciones en Electron y host aislados a 1520×980 y 1100×760: centros y bordes con tolerancia de ±2 px, overflow horizontal sin tolerancia y capturas `/tmp/opencode/empty-states-*.png`. Incluye bienvenida, Skills/Plugins sin proyecto, canvas sin paneles, ambos grupos del rail, índice vacío y chat nuevo; exige esos casos y examina los demás `.empty-state` visibles. Esto describe la prueba; los resultados corresponden a los checks del controlador.


## Comportamiento y contratos

Contratos de interacción, persistencia y navegación. Donde citen radios, sombras o bordes concretos, mandan las Reglas de arriba.

### Capturas y enlaces del chat

El Markdown del chat renderiza enlaces como acciones de teclado/puntero, no texto decorativo. Los enlaces `file:///ruta/captura.png` o rutas absolutas de imágenes PNG/JPEG/WebP/GIF expanden una vista previa dentro del mensaje; `![descripción](ruta)` la muestra directamente. La cabecera incluye «Cerrar vista previa» y estados de carga/error explícitos. Se reutilizan superficie, hairline, radios y foco del tema; la imagen mantiene su proporción, se adapta al ancho del mensaje y el hilo conserva su scroll.

La lectura pasa por `desktop.previewImage`: solo archivos raster de hasta 12 MB dentro de proyectos, artefactos autorizados o `/tmp/opencode` (capturas locales del agente). No se carga `file://` directamente en Chromium ni se amplía la CSP. Enlaces HTTP(S) abren el navegador del sistema; otros archivos usan la apertura local ya autorizada. Esquemas ejecutables y archivos remotos no generan acciones. Verificación: `test/local-images.test.mjs` y `test/markdown-links-desktop.mjs`.

### Controls, navigation and fields

Shell actions retain 35px height, 0 13px padding and weight 550. Secondary hover uses the raised plane and muted border. Primary actions use accent fill/dark ink with the lighter hover mix. Shell icon controls are 29px squares; node-header controls retain compensated width and 32px height. Tool buttons remain a separate 12px/500/1.4 primitive, minimum 32px high, 6px 10px padding; disabled opacity is .55 (shell .42). Tool secondary press uses accent wash.

Project navigation uses continuous name rows with plain folder icons and an active dot, without initial avatars or nested cards. Paths stay available in the native tooltip and accessible description rather than dominating each row. The selected project uses raised graphite plus `aria-current`. Panel rows provide map selection and a separate compact focus action, visible on hover, focus-within, when pressed, and on non-hover devices; selected rows use accent wash and `aria-current`. Long names truncate visually while keeping full accessible labels. Folder, Plugins, appearance, settings and commands are borderless rows; a single footer seam separates utilities from project content. Connection retains a text label beside its status dot.

The drawer traps Tab/Shift+Tab, starts at its close control, closes on Escape or scrim activation and restores the opening control's focus after the inert-state commit, unless an action has already moved focus to its destination. Its closed state is inert; the main workspace is inert while it is open. Existing overlay policy blocks PTY input and obscures native browser content while the drawer is active. Desktop layout reserves the rail's full width and insets instead of overlaying the canvas. Project and panel lists contain scroll chaining and suppress horizontal scrolling. The map action and creation dock remain explicit routes. Tool fields are labelled, full width, minimum 34px high, padded 7px 9px with seam border. Error/loading/empty/unavailable states remain distinct and source-backed.

Sidebar verification entry point: `node test/sidebar-floating.mjs`, using an isolated Electron/host profile, synthetic long names and overflowing project/panel lists. It exercises project/panel selection (including drawer routes and the last overflowing panel), focus/map return, appearance, Plugins, keyboard, drawer and working-region clearance, explicitly checks name truncation, observes typed input through the real PTY attachment and checks that drawer input does not reach it. Inspector close actions target the switcher so duplicated contextual close controls remain unambiguous. Captures are written beneath `/tmp/opencode/phantom-sidebar-*`. It invokes the Impeccable detector once at the end via an argv spawn. This describes the test implementation, not an observed pass or a new visual approval; the controller owns execution and check results.

Within project and panel lists, Up/Down and Home/End move focus and reveal the destination in the scrollable list without activating it. Enter/Space activate the focused button; Tab retains native traversal, including each separate panel-focus action. The sidebar interaction script exercises these focus-only routes with overflowing lists. These are implementation details, pending controller checks for this continuation.

While a rail control has keyboard focus, the canvas receives blocked terminal-input ownership so activating a terminal row cannot auto-focus the PTY and interrupt Tab traversal. Leaving the rail releases that ownership; clicking the terminal can reclaim input. This desktop navigation ownership does not obscure the native browser; drawer and overlay occlusion still use the existing separate policy.

Keyboard focus remains a 2px current-accent outline: shell buttons/tab stops offset 3px, shell fields -1px, tool controls 3px, note field -3px. Inside the rail the outline is inset (-2px) to stay visible at scroll boundaries. xterm owns cursor/input focus and suppresses generic helper-textarea/screen outlines.

### Appearance and local persistence

Disponible desde el rail, selector contextual y paleta; ocupa el inspector no modal. Las opciones de fondo existentes usan CSS y assets locales, con previsualizaciones ilustrativas. Selección con check y `aria-pressed`; acentos existentes Violeta, Iris, Menta, Arena, Rosa y Cian. «Intensidad ambiental» y «Presencia de Gengar» tienen salida numérica independiente; «Mostrar Gengar», «Pulso ambiental», «Concentración» y retícula son checkboxes etiquetados. Restablecer devuelve Gengar/Violeta/retícula ON/ambiente 55 %/personaje ON al 55 %/pulso OFF/concentración OFF/sin imagen.

Las preferencias se guardan sincrónicamente en localStorage bajo `phantom:studio:${workspaceId || 'default'}`, por proyecto y perfil local. Cambiar proyecto carga sus preferencias sin copiarlas del anterior. La versión 3 conserva fondo, acento v2 (incluido Iris explícito), retícula, imagen, intensidad y campos desconocidos; migra la presencia antigua según fondo Gengar/sin imagen y copia su intensidad anterior al nuevo deslizador del personaje. Solo Iris anterior a v2 conserva la migración histórica a Violeta. Pulso y concentración nuevos nacen OFF. La lectura normaliza sin sobrescribir el original; el siguiente cambio guarda v3. JSON inválido recupera defaults; claves, booleanos, intensidades finitas 0–100 e imagen se validan. Un fallo al escribir notifica y no aplica el cambio. Es almacenamiento local, no sincronización cloud.

Optional uploads accept PNG/JPEG/WebP MIME types up to 2×1024×1024 bytes; `createImageBitmap` must decode the file before FileReader produces a data URL. Reload accepts only matching base64 image data URLs shorter than 2,800,000 characters. File type/size, read/decode and save failures have visible actionable errors; save failure also notifies through the hook. The file control disables while loading. The project-keyed appearance component invalidates outstanding requests on unmount; reset invalidates them too. Choosing a background clears the image; removing the image preserves the selected background. Local data images layer above the CSS atmosphere, cover/center the canvas and receive ambient intensity/focus attenuation; the Gengar layer remains independent. No shipping raster assets were added; review screenshots and runtime browser captures are evidence/content, not brand assets.

### Spatial work and product constraints

#### Canvas navigation controls

Selection is the default tool: drag empty canvas to select intersecting panels; Shift adds to the selection. The hand tool (H), held Space outside editing targets, or middle-button drag pans across panel content. V returns to selection. Normal wheel input inside a panel remains with its content; Ctrl/Cmd/Alt + wheel zooms around the cursor in map mode. Trackpad deltas pan the background and pinch events use cursor-anchored zoom. Focus mode retains panel-owned scrolling and input.

The navigation toolbar groups selection/hand/comments, zoom, fit, minimap and a discoverable gesture guide. It is 48px high with 32px controls, current-accent pressed states and tabular zoom numerals. The zoom popover offers 25/50/100/150%, fit-all (0) and fit-selection (2); 1 restores 100%, and +/− zoom around the working stage centre. Navigation lives in the bottom shelf, above creation and beside the minimap, at both 1520×980 and 1100×760. Rail and inspector insets constrain the shelf columns; controls retain their names and can scroll horizontally if their column becomes too narrow. Toggling the minimap does not move the working stage or other controls. Explicit popovers open above their toolbar and dismiss through the existing Escape/outside-click route.

Framing and minimap viewport geometry use the measured working stage, with 72px top clearance and 16px bottom clearance. On settled viewport resize, visible panels that exceed that area are reframed through the camera only; panel coordinates and dimensions are untouched. Deliberately offscreen panels stay outside that automatic framing set. Tab focus entering a clipped panel frames that panel; normal pan/zoom remains available. Focus geometry uses 12px side insets, y=72px and height=stage height−88px. Returning from focus at the same viewport size retains the map camera; intermediate widths during the focus/rail transition do not trigger reframing.

Camera input accumulates synchronously in a ref and renders once per animation frame. Persistence is staged after 180ms idle, on pointer release, blur or the existing before-flush protocol, with explicit workspace identity. Discrete navigation interpolates for 180ms with cubic ease-out and is interruptible; reduced motion applies the target directly. Memoized tool bodies avoid camera-only rerenders. Geometry previews commit their latest ref on release.

Verification: `node test/canvas-controls.mjs` passed eight interaction/layout checks on isolated Electron/host fixtures, including an 80-event input burst, camera reload persistence, cursor anchoring, editor ownership, hand/Space navigation, area selection, keyboard button semantics, exact animated zoom and narrow-inspector clearance. Captures in `/tmp/opencode/phantom-canvas-DRVUgg/` were inspected at desktop and narrow desktop sizes; they use synthetic notes. `node test/desktop-motion.mjs` passed ten lifecycle/motion checks and `node --test src/hooks/*.test.mjs` passed 29 tests. These checks establish tested behavior, not sustained frame-rate measurements. The detector returned only existing palette-literal advisories in `studio.css`.

Preserve camera/layout identity separately from temporary focus geometry and names separately from canonical project paths. Canvas navigation yields to editing targets including xterm. Terminal writes require an active writable stream and actual focus in that terminal; ordinary Space, Escape, Ctrl+C, `0` and letters remain terminal input. Ctrl/Cmd+Shift+Enter is the explicit panel-focus route. Inspector fields never proxy keystrokes into the PTY; the inspector is nonmodal and clicking a visible terminal can reclaim ownership. Blocking surfaces and disconnected transport still block terminal ownership; inspector/native-browser occlusion remains separate from terminal blocking.

Only focused, unobscured browser panels display the native view; overview captures and their missing states remain runtime content. Phantom remains authoritative for native cards/decisions/skills; workspace layout, references, drafts and notes remain app-owned. Keep source/save errors visible and relaunch explicit after exited/lost sessions; background customization does not change lifecycle semantics or promise recovery of unacknowledged edits.


## Verificación

`npm test` incluye las reglas de tokens. `node test/design-capture.mjs <etiqueta>` (tras `npm run build`) abre Electron real con un proyecto sintético y escribe capturas en `/tmp/opencode/design-<etiqueta>-*.png` para comparar antes y después.

La primera implementación espectral de `task_96921754-f29f-416f-a5d4-e2ea1d6944b8` pasó cuatro checks, pero la revisión visual encontró superposición: `/tmp/opencode/spectral-ui-GRaGQh/narrow-attention.png` mostraba el minimapa sobre Aprobar; `narrow-rest`, `narrow-working` y `selected-working` mostraban minimapa/toolbar sobre enviar o detener. Ese resultado previo no constituye aprobación visual.

`node test/spectral-ui.mjs` usa Electron compilado y host/perfil aislados; sustituye respuestas de conversación y de Aprobar/enviar/detener mediante un fixture IPC en el proceso de prueba, sin ejecutar proveedores. Captura escritorio 1520×980 y 1100×760 cruzando reposo/trabajando/atención con mapa/selección/foco, además de teclado y preferencias de movimiento/transparencia reducidos. Comprueba nueve puntos de hit-testing por acción, separación geométrica entre chrome y área operativa, clics/activación de teclado que llegan una sola vez al IPC y su respuesta visible (incluido Aprobado), uso y alternancia del minimapa, overflow horizontal, actividad del perímetro y quietud del hilo. Artefactos en `/tmp/opencode/spectral-ui-*`; el controlador ejecuta los checks y el padre inspecciona las capturas. Esta corrección y las nuevas comprobaciones quedan pendientes de ejecución y revisión; no se declara nueva aprobación.

`test/appearance-preferences.test.mjs` cubre normalización, migración v2 idempotente, conservación de preferencias, validación y claves por proyecto; también se carga desde el check de tokens. `test/unified-design-desktop.mjs` usa Electron/host aislados y un ejecutable Node determinista como proveedor sintético, sin modelos ni agentes reales. Mide ambos compositores con borradores sin modificar durante cambios de ancho/alto, máximos, scroll de texto/hilo, contracción al borrar/enviar y controles visibles. Examina materiales y controles de Gengar, migración, recarga, cambio de proyecto, reset, fallo de guardado, concentración y reduced-motion; exige ausencia de errores del renderer. Las capturas se escriben en `/tmp/opencode/unified-design-*`. Estos son contratos de prueba, no resultados observados: el controlador ejecuta los checks.
