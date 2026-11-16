---
name: Phantom Workspace
description: Vidrio ligero, teclas activas claras y planos ciruela translúcidos sin blur; trazo de actividad local e identidad Gengar pixelada sobre un lienzo espacial.
colors:
  accent: "#a78bda"
  accent-soft: "color-mix(in srgb, var(--accent) 17%, transparent)"
  accent-mint: "#7cc9a0"
  accent-amber: "#e3bf86"
  accent-rose: "#f29ac4"
  accent-cyan: "#7cc4ff"
  bg: "#0b0910"
  surface: "#131019"
  surface-2: "#1c1725"
  surface-3: "#292133"
  ink: "#f4f3f7"
  muted: "#aaa8b3"
  ink-3: "#8d8b96"
  hairline: "color-mix(in srgb, #fff 8%, transparent)"
  fill: "color-mix(in srgb, #fff 5%, transparent)"
  fill-2: "color-mix(in srgb, #fff 9%, transparent)"
  fill-3: "color-mix(in srgb, #fff 14%, transparent)"
  glass-tint: "color-mix(in srgb, var(--accent) 10%, color-mix(in srgb, #05030a 25%, var(--surface-3)))"
  glass: "color-mix(in srgb, var(--glass-tint) 48%, transparent)"
  glass-thick: "color-mix(in srgb, var(--glass-tint) 68%, transparent)"
  ink-on-glass: "#ece9f2"
  on: "#f1ecf8"
  on-ink: "#1a1226"
  workplane: "color-mix(in srgb, var(--surface) 80%, transparent)"
  workplane-wash: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent)"
  well: "color-mix(in srgb, var(--surface) 90%, transparent)"
  well-raised: "color-mix(in srgb, var(--surface-2) 94%, transparent)"
  well-terminal: "color-mix(in srgb, var(--terminal-bg) 90%, transparent)"
  rail: "var(--surface)"
  terminal-bg: "#0e0b13"
  terminal-ink: "#ddd5e9"
  primary-ink: "#130d1e"
  note: "#211d2c"
  danger: "#ee788a"
  success: "#7cc9a0"
  warning: "var(--attention)"
  working: "#bb9af7"
  attention: "#e9b46a"
  error-bg: "color-mix(in srgb, var(--danger) 15%, var(--surface))"
  mission-bg: "color-mix(in srgb, var(--success) 14%, transparent)"
  mission-ink: "var(--success)"
typography:
  sans: '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
  display: "650 24px/30px var(--sans)"
  title: "600 17px/22px var(--sans)"
  headline: "600 15px/22px var(--sans)"
  body: "400 14px/22px var(--sans)"
  control: "500 13px/18px var(--sans)"
  support: "400 12px/16px var(--sans)"
  micro: "500 11px/14px var(--sans)"
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
    backgroundColor: "{colors.on}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "34px"
  tool-button-primary:
    backgroundColor: "{colors.on}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.ctl}"
    padding: "6px 10px"
  tool-button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    padding: "6px 10px"
  tool-field:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    padding: "7px 9px"
    width: "100%"
  project-item-active:
    backgroundColor: "{colors.on}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.obj}"
    padding: "6px 8px"
    width: "100%"
  panel-row-selected:
    backgroundColor: "{colors.on}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.ctl}"
  tool-badge:
    backgroundColor: "{colors.fill-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  canvas-node:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.obj}"
  background-option:
    textColor: "{colors.ink}"
    rounded: "{rounded.obj}"
    padding: "5px 5px 9px"
---


# Design System: Phantom Workspace

Este documento describe la implementación integrada en una sola capa. Los materiales y controles toman como referencia el panel rápido de One UI y la píldora de Spotify, aprobados por Carlos el 2026-11-14. Las restricciones estáticas viven en `test/design-tokens.test.mjs`; los resultados de ejecución pertenecen al controlador. La interfaz usa español.

## Reglas

Tres reglas deciden casi todo. Las pruebas de tokens expresan restricciones estáticas de las dos primeras y del material.

1. **Una caja por objeto.** Solo dibuja contorno lo que se puede mover o lo que flota: panel, zona, rail, islas, dock, menús. Dentro de un objeto se separa con espacio, tipografía y un paso de tono; nunca con líneas. Filas, botones de icono y controles de barra descansan sobre nada: la isla es su caja. Un relleno en reposo sobre cada control convierte la isla en una cuadrícula de cajas y está retirado. Como mucho un nivel de relleno interior: el control donde se escribe o se elige (campo del compositor, pista del segmentado, pozo de código o de terminal).
2. **El peso lo da el estado.** El chrome usa `--shadow-chrome`, con relieve interior y contacto ciruela, sin halo de color. Los paneles usan `--shadow-rest` y `--shadow-float`, sin halo coloreado; conversaciones y terminales resuelven esas elevaciones localmente a `--shadow-workplane-rest` y `--shadow-workplane-lift`. Selección: contorno sólido exterior de 2 px separado 3 px; foco: hairline sin contorno de selección. Los controles activos usan tecla clara `--on` y tinta `--on-ink`; el acento conserva selección de panel y foco de teclado. El trabajo real tiene un trazo interior violeta con cabeza blanca y cola segmentada; atención usa ámbar, error rojo y éxito menta. Es una capa SVG independiente del material y del anillo de selección.
3. **Lo fantasma es comportamiento y material.** El chrome usa vidrio ahumado violeta oscuro al 48/68 % con blur de 40 px. Los planos de trabajo transmiten color por alpha al 80 % y un lavado diagonal del acento al 6 %, sin backdrop-filter; los pozos de lectura y escritura permanecen densos al 90/94 %. El relieve de controles usa `--shadow-key` y `--shadow-well`, con excepciones planas para las teclas de iconos propios. La entrada CSS aparece por opacidad y un desplazamiento vertical de 4 px, sin desenfocar texto; al soltar, el control recupera escala con resorte. Gengar pixelado identifica rail, notch y entradas vacías según la preferencia de personaje. El reposo sin animación continua es un requisito de rendimiento; la salvedad del GIF vacío se describe en Movimiento. Se conservan los fondos existentes, sin añadir manchas multicolor, barras de ecualizador ni onda en el dock.

### Tokens (`src/canvas-ui.css`, bloque `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--r-ctl` | 8 px | Controles: botones, campos, filas, pozos interiores |
| `--r-obj` | 14 px | Objetos: paneles, menús, popovers, barras |
| `--r-isle` | 26 px | Islas que flotan: rail, inspector, paleta |
| `--r-mark` | 4 px | Marcas de menos de 20 px: kbd, casilla, scrollbar. No es una superficie |
| `--r-pill` | 999 px | Chips y estados. No es una superficie |
| `--hairline` | blanco al 8 % | El único borde. Lo dibuja el objeto, una vez |
| `--shadow-chrome` | `inset 0 1px 0 #ffffff26, inset 0 -1px 0 #05030a59, 0 1px 2px #05030a66, 0 18px 40px -20px #05030acc` | Filo de luz superior, sombra interior inferior, contacto y caída ciruela. Un solo filo: el anillo interior se retiró para no duplicar el hairline. Sin halo del acento |
| `--shadow-key` | `inset 0 1px 0 #ffffff4d, inset 0 -1px 0 #05030a66, 0 1px 3px #05030a8c` | Acción primaria, indicador segmentado y botón activo del dock/navegación |
| `--shadow-well` | `inset 0 1px 2px #05030a8c, inset 0 0 0 1px #05030a33` | Pistas segmentadas y pulsación de los controles elevados |
| `--glass-tint` | `color-mix(in srgb, var(--accent) 10%, color-mix(in srgb, #05030a 25%, var(--surface-3)))` | Acento al 10 % sobre `--surface-3` oscurecido 25 % hacia `#05030a` |
| `--glass` / `--glass-thick` | tinte al 48 % / 68 % sobre transparente | Islas / chrome de lectura, con alpha real |
| `--glass-filter` | `blur(40px) saturate(190%)` | Elimina el detalle detrás del chrome |
| `--glass-sheen` | Grano fino de ruido fractal (SVG en data URI, alpha 4,5 %) sobre `linear-gradient(172deg, #ffffff12 0%, #ffffff07 26%, #ffffff03 100%)` | Velo de 172° (`#ffffff12` / `#ffffff07` / `#ffffff03`) concentrado arriba que nunca llega a cero, conservando el ahumado violeta oscuro |
| `--ink-3` / `--muted` | `#8d8b96` / `#aaa8b3`; en chrome ambos usan `var(--ink-on-glass)` | Metadatos, texto secundario e iconos en reposo |
| `--ink-on-glass` | `#ece9f2`; `#8d8b96` con transparencia reducida o contraste aumentado | Tinta secundaria local del chrome |
| `--on` / `--on-ink` | `#f1ecf8` / `#1a1226` | Tecla activa sólida y su tinta oscura |
| `--workplane` | `color-mix(in srgb, var(--surface) 80%, transparent)` | Losa translúcida de conversación/terminal |
| `--workplane-wash` | `linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent)` | Lavado diagonal estático; alpha combinado máximo 81,2 % |
| `--well` | `color-mix(in srgb, var(--surface) 90%, transparent)` | Pozo de lectura del chat lateral |
| `--well-raised` | `color-mix(in srgb, var(--surface-2) 94%, transparent)` | Campo de escritura |
| `--well-terminal` | `color-mix(in srgb, var(--terminal-bg) 90%, transparent)` | Hilo de chat del canvas y salida de terminal |
| `--ease-spring` | `linear(0, .36 12%, .72 25%, .94 40%, 1.05 58%, 1.025 75%, 1)` | Un solo rebote de 5 % y asentamiento |
| `--dur-spring` | 420 ms | Recuperación de controles, segmentado y entrada CSS del chrome |
| `--shadow-rest` | `0 1px 2px #05030a80, 0 14px 30px -16px #05030ad9` | Panel apoyado, sin halo coloreado |
| `--shadow-float` | `0 2px 6px #05030a73, 0 30px 68px -24px #05030af2` | Panel seleccionado, arrastrado o en foco, sin halo coloreado |
| `--shadow-workplane-rest` | `0 2px 4px #05030a66, 0 10px 20px -12px #05030a99` | Conversaciones y terminales en reposo |
| `--shadow-workplane-lift` | `0 3px 6px #05030a73, 0 16px 28px -14px #05030ab3` | Conversaciones y terminales seleccionadas, enfocadas o arrastradas |
| `--working` | `#bb9af7` | Trazo de trabajo interior de 2 px, órbita de 5,6 s |
| `--attention` | `#e9b46a` | Permiso/pregunta pendientes, turno que necesita al usuario |

`test/design-tokens.test.mjs` restringe radios, sombras, tokens retirados y presupuesto de bordes por hoja (`test/design-budget.json`, sin exceso ni holgura). Admite radios tokenizados, `0`, `50%`, `inherit`, medidas en `em`, ajustes concéntricos y escala de overview. Las sombras usan los tokens de la tabla o anillos de estado sin desplazamiento ni blur. `--shadow-float` pertenece a paneles `.canvas-node`, también en responsive. El test exige vidrio ≥44/60 %, blur ≥34 px y saturación 190 %, dos capas inset, resorte `linear()` y chrome opaco en las dos preferencias de accesibilidad. Exige workplane al 76–82 %, lavado ≤10 % y alpha combinado ≤82 %, pozos ≥86 %, contraste AA de tintas de lectura/estado y ausencia de backdrop-filter en los planos. Comprueba que el compositor no anime su altura, que no vuelva el antiguo filo de actividad y que seis hojas de materiales/indicadores auxiliares no contengan animaciones infinitas. Esto no equivale a comprobar todas las animaciones de la aplicación.

Sin pestañas laterales de color para categorías: el tipo se lee en glifo y etiqueta. Skills usa libro; `ShellIcons.jsx` exporta `BookIcon` y lo asocia a `phantom-skills`.

Estado del presupuesto: chat 14, terminal 1 y chat lateral 1. Plugins 9, Skills 4 y Repository 11: cabeceras, segmentados, listas y pozos de lectura se separan por espacio y tono; los bordes restantes incluyen campos, estados y guías estructurales. `test/design-budget.json` conserva el recuento exigible por hoja.

`src/studio.css` tiene presupuesto de 8 bordes, incluido `.interface-scale select`, el selector nativo de escala de interfaz en Apariencia. Su borde `--hairline` delimita el área donde se elige un valor; `focus-visible` identifica el foco de teclado. Es un borde funcional de formulario, contabilizado en ese presupuesto.

## Arquitectura de información

Dirección aprobada por Carlos el 2026-11-14 («que todo se sienta fácil», referencia One UI y Apple). Mocks en `.impeccable/mocks/dx/`.

**Una línea por estado, una acción por fila.** Cada fila lleva un título humano (el nombre de la sesión, nunca un UUID), una palabra de estado, una línea de detalle y como mucho una acción principal. Lo técnico (rutas, identificadores, JSON, salida cruda) vive detrás de un `<details>` llamado «Detalles». La interfaz no explica lo que no hace.

**Cinco destinos, no veinticinco paneles.** El dock separa crear (Terminal, Navegador, Nota, Zona) de ir (Trabajo, Git, Servicios, Contexto, Automatizar). Cada destino es un panel con pestañas (`src/hooks/hubs.mjs`); los tipos de panel anteriores siguen siendo válidos para lienzos guardados y abren su destino en la pestaña correspondiente.

| Destino | Pestañas |
|---|---|
| Trabajo | Tareas · Borradores · Misiones |
| Git | Ramas · Historial · Cola |
| Servicios | Este proyecto · Docker · Todos los proyectos |
| Contexto | Documentos y memoria · Skills |
| Automatizar | Secuencias · Navegador · Código |

`App.jsx` reutiliza el panel existente de cada destino al abrirlo. `ToolPanels.jsx` recuerda la pestaña elegida en localStorage (`phantom.hub.${type}`, por tipo de destino); una petición explícita de pestaña prevalece sobre ese recuerdo. Las aperturas dirigidas a una tarea (`cardId`), referencia (`ref`) o panel (`focusNodeId`) conservan su destino dedicado en lugar de convertirse en un panel unificado.

**Una bandeja.** Rail y campana abren «Te necesitan», con vistas Pendientes, En curso y Hoy. Pendientes separa «Decide ahora» (permisos, preguntas, tareas o sesiones bloqueadas y problemas de integración) de «Cuando puedas» (ramas listas, cambios sin guardar en la base y cola sin nadie integrando). El contador compartido solo cuenta «Decide ahora»; el modelo evita repetir la misma sesión entre fuentes cuando ya está representada. Los permisos se aprueban o rechazan en la fila y las preguntas ofrecen sus opciones o llevan al chat/sesión para responder. Las demás acciones abren la tarea, sesión, Git o el orquestador; abrir la bandeja no resuelve pendientes. Sin conexión se indica el estado y se desactivan las respuestas; una fuente fallida muestra aviso y Reintentar.

**Una Configuración**, por categorías, con filas agrupadas. Las fuentes del proyecto se «conectan»; la palabra plugin no aparece en la interfaz.

### Vocabulario

| Se dice | No se dice |
|---|---|
| integrar · Cola | incorporar, Incorporaciones, merge, solicitud |
| sin guardar · Guardar | WIP, sin commitear, commit (como verbo de botón) |
| sesión | vista, proceso, descriptor |
| main · la carpeta del proyecto | checkout, rama de integración, base |
| copia propia de la sesión | worktree |
| Te necesitan | atención, avisos, bandeja de actividad |

Estados de una rama, y solo estos: Trabajando · Sin guardar · Lista · En cola · Integrando · Conflicto · En main.

## Vidrio y Planos

- **Bases de plano.** Ciruela/violeta: `--bg #0b0910`; trabajo `--surface #131019`; elevación `--surface-2 #1c1725` y `--surface-3 #292133`. Base de terminal `--terminal-bg #0e0b13`. Son colores sólidos de los que se derivan las mezclas translúcidas; nunca negro puro. Los valores viven en el bloque `:root` de `src/canvas-ui.css`, que manda sobre `studio.css`.
- **Tinta.** `--ink #f4f3f7`, `--muted #aaa8b3` y `--ink-3 #8d8b96` son los niveles efectivos de `canvas-ui.css`, cargado después de `studio.css`. En chrome, tanto `--muted` como `--ink-3` se reasignan localmente a `--ink-on-glass #ece9f2`. Las teclas activas usan `--on-ink #1a1226` sobre `--on #f1ecf8`, incluidos sus metadatos. Los colores de estado son independientes del acento.
- **Rellenos y teclas.** Escalera blanca-alfa de 5/9/14 %. Reposo usa `--fill` y hover `--fill-3` en los controles normalizados. Primarias, proyecto/espacio seleccionado, filas activas, navegación, dock, filtros y resultados seleccionados usan la tecla clara sólida. `--shadow-key` da relieve y `--shadow-well` marca pistas/pulsación; las teclas de iconos propios del rail, navegación y dock tienen excepciones sin sombra en `identity.css`. La primaria no lleva degradado. Estos relieves no se aplican al plano de lectura ni a la salida de terminal.
- **Acento.** Violeta `#a78bda` (clave `lilac`) para selección de panel, foco de teclado e identidad de proyecto; los controles activos normalizados usan tecla clara. Iris, Menta, Arena, Rosa y Cian siguen disponibles por proyecto.
- **Estados.** `--working` violeta espectral, `--attention` ámbar (te necesita), `--danger` rojo rosado, `--success` menta. Cada estado tiene un valor; los fondos se derivan con `color-mix`. El acento no se usa para estado: selección y teclado son contornos sólidos; actividad es perímetro interior y etiqueta. `test/design-tokens.test.mjs` exige contraste de texto AA (4,5:1) para texto principal, secundario, trabajo y atención sobre los cinco planos opacos.
- **Vidrio.** Solo el chrome usa `--glass` al 48 % y `--glass-thick` al 68 % del tinte compartido (acento al 10 % sobre `--surface-3` oscurecido 25 % hacia `#05030a`), blur de 40 px y saturación 190 %. Inspector, menús, popovers y bandejas usan el material más grueso; el rail y las islas, el ligero. `--glass-sheen` aporta grano fino de ruido fractal (SVG en data URI, alpha 4,5 %) sobre un velo de 172° (`#ffffff12` / `#ffffff07` / `#ffffff03`) concentrado arriba que nunca llega a cero, separado del color translúcido, para conservar el ahumado violeta oscuro. `--shadow-chrome` combina luz superior y sombra interior inferior, contacto y caída, con el hairline como único filo, sin halo de color. No hay refracción ni animación del blur.
- **Planos translúcidos.** La losa de conversación/terminal usa `--workplane` al 80 % y `--workplane-wash` diagonal al 6 % (alpha máximo combinado 81,2 %), con cabecera y cuerpo transparentes para no apilar superficies completas. Hilo lateral: `--well` al 90 %; hilo del canvas y salida de terminal: `--well-terminal` al 90 %; escritura: `--well-raised` al 94 %. No usan backdrop-filter ni brillo de vidrio; conservan elevaciones locales sin halo. La selección no atenúa ni filtra el texto de paneles vecinos. El canvas permanece transparente y deja ver el arte entre paneles.
- **Accesibilidad del material.** `prefers-reduced-transparency: reduce` y `prefers-contrast: more` convierten vidrio, losa y pozos en superficies opacas, eliminan filtro, sheen y lavado diagonal y restauran `--ink-on-glass #8d8b96`. Contraste aumentado eleva `--hairline` al 22 %. Transparencia reducida oculta la atmósfera `::before`; el arte independiente `::after` conserva su control de personaje.
- **Tipografía.** `--sans` Inter → SF Pro → sistema; `--mono` Monaspace Neon → GeistMono → JetBrains Mono, solo para código, rutas y medidas. Siete roles, cada uno con un trabajo, declarados como `font: var(--t-…)`: Display 24/30·650 (pregunta o título de una vista vacía), Título 17/22·600 (nombre de un panel o isla), Encabezado 15/22·600 (encabezado dentro de contenido), Lectura 14/22·400 (lo que se lee: respuestas, notas), Control 13/18·500 (lo que se pulsa: filas, botones, menús), Apoyo 12/16·400 (lo que acompaña: modelo, hora, ruta, acciones) y Micro 11/14·500 (atajos y contadores; es el mínimo). Tres pesos: 400, 500 y 600; 650 solo en Display. Lo que se lee es más grande que lo que se pulsa. Las etiquetas van en caja natural; nunca en mayúsculas con tracking. Las hojas aún no migradas conservan sus tamaños sueltos y se pasan a roles al tocarlas.
- **Atmósfera.** Se conservan Gengar, Aurora, Marea, Brasa, Grafito e imagen propia, sin nuevos presets ni manchas multicolor añadidas. Los degradados existentes se localizan arriba a la derecha (82 % × 80 %) y abajo a la izquierda (64 % × 64 %), sin repetición. La imagen propia usa `cover` centrado. Ambiente y personaje tienen intensidades independientes. «Mostrar Gengar» controla la presencia de personaje, incluidos sprites del chrome y estados vacíos, además del arte ambiental local (`assets/gengar-source.md`). En un canvas vacío se suprime la imagen de fondo del personaje para no duplicar la mascota. La atmósfera permanece inmóvil incluso con una preferencia de pulso guardada.

## Iconos

`src/components/ShellIcons.jsx` define geometría propia sobre retícula de 24 px, con variante de línea (`strokeWidth=1.75`, extremos y uniones redondos) y silueta sólida monocroma con vaciados `evenodd`. El tamaño predeterminado es 20 px. Incluye terminal, chat, nota, sitio, imagen, zona, selección, mano, minimapa, encuadrar, actividad, recursos, mapa, plugins, comandos, libro, tareas, Git y herramientas del shell. `SHELL_ICONS` asigna tipos; `SHELL_LINE_ICONS` y `SHELL_SOLID_ICONS` permiten elección explícita.

La variante automática pasa a sólida con `.active`, `aria-pressed`, `aria-current`, `aria-expanded` o fila seleccionada. `variant="line"` fuerza línea y `active` fuerza sólido. La tinta activa es `--on-ink`. Rail y dock usan tecla clara con radio de control; navegación con estos iconos usa botones circulares de 32×32 px. El glifo de cabecera de un panel seleccionado/enfocado también recibe tecla clara y silueta sólida. Son señales de estado, no mosaicos decorativos permanentes.

Lucide continúa en controles auxiliares: 14 px/trazo 2, 16 px/trazo 1,75 y 20 px/trazo 1,5; las cabeceras de herramientas conservan ajustes de 18 px. Los SVG decorativos son `aria-hidden`; el nombre accesible lo aporta el control.

## Lienzo y chrome

- El canvas va de borde a borde; el chrome son objetos apoyados sobre él con un único hueco `--gutter` de 16 px. En foco, la región se posiciona de forma absoluta: los insets del rail e inspector reducen su ancho disponible, sin desplazar un plano de ancho completo fuera del viewport. La prueba de escritorio exige que región y panel enfocado permanezcan dentro de sus límites.
- **Rail:** 252 px, radio `--r-isle`, vidrio `--glass`, alto según contenido; contraído es una píldora de 48 px. `src/sidebar.css` es el único dueño de lo que hay dentro: una sola forma de fila (40 px, radio `--r-obj`, borde izquierdo común de 10 px) para actividad, sesiones, recursos, mapa y utilidades. Las filas no tienen relleno en reposo; hover es `--fill-2`; la fila seleccionada y lo que está abierto (bandeja, Sitios) son tecla clara `--on`. Una sesión que te necesita no es una caja; se marca con anillo ámbar en el disco, línea de estado ámbar y título en 600; el único relleno ámbar del rail es el resumen «Necesitan de ti», sin contorno. «Ver todo el mapa» es la vista de reposo y nunca se vuelve tecla. Proyecto y Espacio no son campos de formulario: el proyecto es el título del rail (disco con sus iniciales en el acento del proyecto y nombre en Título, con el caret visible solo al pasar o abrir) y el espacio es un chip en píldora bajo el nombre. Las etiquetas «Proyecto» y «Espacio» quedan solo para lectores de pantalla. Sus menús son un plano sólido `--surface-3` con el mismo brillo, porque un segundo backdrop-filter anidado no oculta las filas de debajo. Las utilidades (Sitios, Plugins, Comandos, Dictado) son una fila de cuatro toggles redondos de 44 px nombrados por tooltip, no cuatro filas más: la lista conserva la altura para las sesiones.
- **Controles del shell:** `src/shell.css` es el único dueño del aspecto de la fila superior, la navegación y el dock. Las islas de 48 px son píldoras (`--r-isle`); sus controles son círculos de 32 px sin relleno en reposo, con hover `--fill-2` y estado activo en círculo claro `--on`. Los grupos se separan con 8 px de aire, sin reglas verticales. Menús y bandejas flotantes comparten `--r-isle`. **Jerarquía**, igual en todas las islas: (1) claro sólido `--on` para la única elección vigente —panel seleccionado en el rail, herramienta activa en navegación—, nunca más de una por isla; (2) velo `--fill-3` con borde de vidrio `--shadow-rim` para lo abierto o encendido (bandeja, Sitios, minimapa, menús, Phantom, inspector); (3) nada en reposo. El color queda fuera de esa escalera y solo significa tipo de panel (`--type`: teselas del dock y glifo del panel seleccionado) o estado. **Estado en el rail:** el disco del agente lleva un anillo violeta si trabaja o ámbar si te necesita, y su línea de estado toma el mismo color; la fila que te necesita y «Necesitan de ti» llevan velo y contorno ámbar, con el conteo en píldora ámbar. El aviso pendiente de la campana es un punto ámbar. `--shadow-rim` (`inset 0 1px 0 #ffffff1f, inset 0 0 0 1px #ffffff0a`) es el borde de toda cápsula dentro de una isla: pozos de proyecto/espacio, búsqueda, teselas y estados encendidos.
- **Fila superior:** título y controles son dos islas de 48 px (`--bar`); entre ellas hay canvas. `--top-clear` es la primera línea libre.
- **Inspector:** contrapeso del rail, 360 px, cuelga bajo los controles.
- **Franja inferior:** el área de paneles (`.canvas-stage`) termina 148 px antes del borde inferior en mapa y 88 px en foco. Navegación, minimapa y creación quedan fuera de su recorte: ninguna cámara puede colocar contenido interactivo bajo esas islas. La franja conserva la atmósfera, sin caja ni borde adicional.
- **Dock:** una sola fila de `--dock-h` (56 px): lecturas de actividad a la izquierda y creación a la derecha, en el mismo objeto. Crear son discos de 36 px, solo icono (el nombre queda para lectores de pantalla y tooltip), con relleno oscuro teñido (tono del tipo al 22 % sobre `--surface-2`), icono en el tono del tipo y anillo interior del tono al 34 %; el tono es tinta, nunca relleno saturado; activo sigue siendo `--on`. En mapa comparte columna con navegación (48 px encima, separadas 12 px); el minimapa ocupa una columna independiente de 190 px. En foco el dock se centra y el panel termina 16 px antes de la franja. Con Phantom o el inspector abiertos por debajo de 1700 px, el minimapa cede su columna y las lecturas y la búsqueda se pliegan a su glifo: la fila conserva su centro en vez de desplazarse.

`src/panels.css` es el dueño del aspecto de los paneles de herramientas (`tw-*` dentro de `.canvas-node`), Skills, barra del navegador y nota.
- **Retícula:** puntos en espacio-mundo; duplican el paso por debajo de 14 px. El viewport no se desplaza: solo la cámara.
- **Ritmo:** múltiplos de 4 px (`--s-1`…`--s-6`).

## Card de chat y terminal

La card es la caja. Dentro no hay líneas:

- **Cabecera** (44 px): mismo tono que la card, sin costura. Glifo del tipo, título de 14 px/peso 600 y tres acciones redondas de 30 px sin relleno, atenuadas en reposo y plenas con hover, selección o foco; cerrar se tiñe de rojo al pasar.
- **Identidad:** selector de agente y carpeta en una fila, sin fondo propio.
- **Hilo:** a sangre, sobre pozo denso translúcido sin blur, en Lectura (14/22), sin pulsos decorativos en el contenido. Turnos separados por 28 px (32 px en foco y 20 px en Phantom), mensajes propios un paso de tono, columna de hasta 780 px. La respuesta no lleva avatar ni cabecera: modelo, hora y costo se dicen una vez al pie, en Apoyo y `--ink-3`, junto a Copiar.
- **Acciones:** cada llamada es una línea sin caja: glifo de 14 px, etiqueta y destino en Apoyo. Conserva el estado accesible y el indicador discreto de main; solo los estados en curso, fallidos o detenidos añaden texto. Solo las escrituras suben el glifo a tinta plena. Cuatro o más acciones seguidas se pliegan en una frase de lo hecho, abierta mientras trabaja. Subagentes, código y salidas siguen siendo pozos de un tono con `--r-ctl`. Las guías de 1 px de razonamiento y pasos anidados indican anidamiento, no contienen.
- **Segmentado** Claude · OpenCode · Codex · Terminal: pista `--fill` con pozo; indicador activo `--on`, tinta `--on-ink` y relieve `--shadow-key`. La identidad del proveedor no tiñe la tecla activa.
- **Compositor:** continúa el plano de lectura de borde a borde (`.pc-composer::before` con `--well-terminal`): no hay una segunda banda de tono bajo el hilo. El campo es el único objeto: `--well-raised`, radio `--r-isle` y borde de vidrio `--shadow-rim`. Foco usa acento del proyecto y anillo estático de 3 px, independiente del trazo de actividad. Modelo, Effort y permisos son una familia de píldoras de 30 px sin relleno en reposo; el permiso activo lleva velo y borde de vidrio. Sus menús se abren siempre en el mismo sitio, sobre el borde izquierdo del campo y con el mismo ancho (320 px), en vidrio; el valor vigente es un velo con su marca, no una tecla clara. Debajo, sin fondo: contexto, costo y pista de teclado; metadatos y controles envuelven en ancho reducido.
- **Tamaño compartido:** `ChatCard` y `PhantomChat` usan `useComposerSize`. Altura inicial mínima de 38 px, una fila, mismo padding incluso en foco. El máximo es el menor entre el 45 % del alto del contenedor y el espacio libre tras cabeceras, avisos, controles, metadatos y reserva de hilo (hasta 96 px o 20 % del alto). Se recalcula al escribir, borrar, enviar y cambiar ancho/alto o controles; `ResizeObserver` y observación de contenido conservan el límite sin depender del zoom del canvas. Al llegar al máximo, el texto tiene scroll interno y los controles permanecen fuera de ese scroll. No se anima la altura al teclear.
- **Chat lateral:** losa `--workplane` más lavado diagonal, hilo `--well` y campo `--well-raised`, sin backdrop-filter. Cabecera y selector no añaden costuras interiores. Los controles pueden envolver en anchos estrechos; sus menús flotantes conservan vidrio.
- **Plugins, Skills y Repository:** título de herramienta 15 px/600, icono de cabecera 18 px; títulos de sección y etiquetas en caja natural, 12 px/600 y tono secundario; cuerpo 13 px; glifos Lucide con trazo 1,75. Sin contornos interiores redundantes en cabeceras, segmentados y pozos; se conservan estados, contenido, foco y rutas de navegación.
- **Terminal:** el pozo de salida se distingue por tono. Su borde superior es transparente y solo se colorea con estado (violeta trabajando, ámbar te necesita).
- **Preguntas y permisos pendientes** sí llevan borde de color: es estado. Resueltos, lo pierden.
- **Zoom semántico:** por debajo del 45 % la card es una ficha (título, estado, tres líneas de salida); por debajo del 25 %, título y estado.

## Panel de Phantom

Isla a la derecha, espejo geométrico del rail: `--r-isle`, hueco `--gutter`, losa `--workplane` y lavado diagonal, con sombra `--shadow-workplane-rest` (elevada en drawer). No tiene backdrop-filter. El espacio de trabajo cede su ancho. Cabecera de 56 px sin costura, «Phantom» en Título y contexto en Apoyo; ámbar si necesita al usuario. Conserva Chat y Orquestador, cola de incorporaciones y conversión de texto dictado en tarea. El agente que responde es un menú compacto dentro del compositor, junto al modelo; los permisos viven bajo el campo. Enviar usa tecla clara y tinta oscura. Las sugerencias de una conversación nueva son filas con glifo, sin borde.

## Estados y «Bordes vivos»

- **Escalera de foco.** Mapa: viñeta suave y atmósfera. Selección: contorno claro y elevación discreta; ningún panel ni su texto cambia de brillo, saturación u opacidad al seleccionar vecinos. Solo la atmósfera baja al 55 %. Foco: atmósfera al 12 %, sin retícula. Lo que te necesita conserva sus señales reales.
- **Geometría.** `ActivityTrace.jsx` monta un SVG decorativo solo con un estado real. Tres rectángulos posibles recorren el interior del panel: inset de 1 px, trazo de 2 px, radio `calc(var(--r-obj) - 1px)` y `pathLength=200`. No captura eventos. No añade superficie, backdrop-filter ni halo desenfocado de panel.
- **Trabajo.** Cabeza blanca de 4 % del perímetro (`stroke-dasharray: 8 192`), pequeño `drop-shadow` violeta estático de 2 px y cola violeta al 55 % con seis segmentos de 2 % y huecos de 1,2 %. `stroke-dashoffset` va de 0 a −200 en 5,6 s, `steps(100)`, en sentido horario y mientras persista el trabajo.
- **Atención/turno.** Cabeza ámbar con dos segmentos (`8 92`), órbita de 3,2 s y 9,375 iteraciones: 30 s de animación activa. Al terminar se oculta la cabeza y queda el contorno fijo. **Error:** contorno rojo, tres destellos de 0,5 s con `steps(2, end)`, después fijo. **Éxito:** cabeza menta, una órbita de 5,6 s y desaparición. No hay trazo en reposo.
- **Suspensión.** El SVG pausa su línea temporal con documento oculto, panel fuera de vista (IntersectionObserver) o Concentración; al volver continúa. Movimiento reducido elimina animación y filtro, oculta cabeza/cola y conserva contorno fijo. Material, anillo exterior y estado accesible permanecen independientes; permiso/pregunta pendiente prevalece sobre trabajo y reposo.
- **Campo de ondas existente.** `PixelField.jsx` conserva señales alrededor de paneles sobre el lienzo, no en el dock: trabajo tiene halo estático; atención puede emitir hasta el retroceso de 30 s y error/éxito una onda. No pinta en reposo, se detiene con documento oculto, omite objetivos lejos del viewport y se oculta en foco. Movimiento reducido conserva halos fijos y transparencia reducida limpia el campo. Concentración lo oculta por CSS; esa ocultación no suspende por sí sola su bucle JavaScript, una salvedad frente al requisito de detener toda animación de estado.

## Notch

`ActivityNotch.jsx` muestra el estado del proyecto junto a integraciones, límites y avisos. Conserva el conteo ante lecturas antiguas o fallidas y añade «desactualizado» con la causa. El texto principal es «Host desconectado», «Recuperando actividad…», el número que necesita al usuario, «En curso» o «Actividad». Abrir el notch muestra la bandeja de pendientes; no resuelve nada. El ámbar distingue atención y el texto acompaña siempre al sprite o a su glifo de respaldo.

`activityMood` prioriza `asleep` (host desconectado), `unsure` (fuente no fresca), `grin` (necesita al usuario), `working` (trabajo real) y `calm` (reposo). `PhantomFace` mantiene su API pero renderiza `assets/gengar-icon.png` a 40×30 px, con `image-rendering: pixelated`: no cambia ojos ni sonrisa mediante SVG. `asleep` usa gris y opacidad .5; `unsure`, .7; `grin`, contorno ámbar de 1 px y pulso de opacidad 1–.7 cada 2,4 s; `working`, salto vertical de 2 px cada 1,2 s con `steps(2, end)`. `calm` queda estático. «Mostrar Gengar» desactivado sustituye el sprite del notch por `CircleDot` y el del rail por su respaldo.

## Movimiento

`--ease-out` conserva la respuesta de color (`--dur-fast` 140 ms) y las transiciones generales (`--dur` 240 ms). `--ease-spring`, `linear()` con rebote de 5 %, y `--dur-spring` 420 ms gobiernan recuperación al soltar, indicador segmentado y entradas CSS. Los controles se hunden a escala .96 (.97 en filas anchas), sin cambiar layout. `materialize` anima opacidad 0→1 y `translate: 0 4px`→`0 0`, sin blur ni escala. Movimiento reducido lo sustituye por fundido de 60 ms y elimina escala/resorte de controles.

`Presence.jsx` conserva una entrada/salida finita distinta: opacidad, blur 8/12 px y escala .96/1.02, con 200 ms de entrada y 160 ms de salida para paneles o 120 ms para otras superficies. Backdrops y movimiento reducido no usan blur/escala; con este último la duración es 60 ms. Es filtro del elemento, no backdrop-filter nuevo. El paneo conserva su inercia.

Ambiente y luces permanecen estáticos incluso con «Pulso ambiental» guardado. Concentración atenúa ambiente/personaje al 12 %, oculta retícula y campo de ondas, y detiene animación CSS decorativa. `useSpriteMotion` autoriza movimiento de identidad solo con intersección, visibilidad CSS efectiva, documento visible, ausencia de ancestro inert, movimiento permitido y Concentración desactivada. Observa intersección, ancestros, visibilidad del documento y cambios de preferencia; el sprite de estado queda estático al suspenderse. El GIF no se pausa con CSS: `GengarMascot` sustituye su fuente por PNG cuando se suspende.

**Salvedad de implementación:** el estado vacío visible carga `gengar-idle.gif` sin exigir trabajo real. Por tanto, el código integrado aún permite movimiento continuo en ese reposo; no se declara cumplido el requisito de quietud total. Esta entrega documental describe la discrepancia, cuya resolución corresponde a la integración de código.

El dictado comparte `VoiceActivity` en terminal, captura global, Voz e intención y todos los compositores. Su momento focal es un orbe de 40 px estilo Siri: cuatro colores suaves (rosa, lila, iris y cielo), con escala y desplazamiento procedentes del analizador de audio y transición de 100 ms. Gira lentamente en compositor mientras hay nivel real, sin simular escucha en silencio. El permiso pendiente muestra un orbe ámbar quieto; al transcribir el micrófono se apaga y el orbe queda pequeño y neutro con un pulso de opacidad. El texto «Te escucho…» acompaña una transcripción de 15 px, con palabras confirmadas en tinta y parciales en muted con fundido suave. El aura de la superficie conserva su anillo espectral de 3 px y una luz interior amplia y suave cuya opacidad respira con el nivel real, sin filtros ni backdrop-filter. Movimiento reducido elimina giro, escala reactiva, transiciones y pulsos, conserva nivel en opacidad y estados escritos. No se anima el tamaño del compositor. La captura global usa un objeto flotante opaco con sombra del sistema, destino explícito y foco protegido; terminal requiere revisión e inserción literal sin Enter.

## Estados vacíos

`src/components/EmptyState.jsx` comparte la anatomía de icono, título, descripción, detalles, acciones y pista; `src/empty-state.css` controla su geometría. Los mensajes de carga, error y estado pertenecen a su fuente.

- **Tamaños:** `panel` (predeterminado) reserva 40 px para el icono, con SVG de 24 px, título de 15 px y cuerpo de 13 px; `hero` reserva 64 px, SVG de 32 px y título de 24 px (22 px a ≤850 px de ancho; 21 px e icono de 48 px a ≤650 px de alto); `compact` reserva 24 px, SVG de 16 px, título de 12 px y cuerpo de 11 px.
- **Retícula:** ritmo de 4 px mediante los tokens de espaciado: separación interna de 8 px (12 px en `hero`), padding vertical de 24 px (8 px en `compact`) y horizontal de 16 px por defecto. Descripciones y pistas se limitan a 44ch; las acciones pueden envolver. `--empty-inset` adapta el margen interior a cada panel: 8 px en los grupos del rail, 17 px en el índice de paneles, 16 px en selectores y 12 px en los grupos laterales del repositorio.
- **Alineación:** `hero` y `panel` centran horizontalmente caja y contenido en su contenedor; `hero` ocupa el canvas mediante `inset: 0`. `compact` alinea el contenido a la izquierda con el contenido/encabezado del panel, incorporando su inset. Se usan `min-width: 0`, límites de ancho y ajuste de texto para contener el contenido.
- **Identidad de entrada:** bienvenida y canvas sin paneles usan `GengarMascot` cuando está habilitado el personaje; sin personaje conservan carpeta/capas como respaldo. El GIF se presenta a 148×126 px (74×63 px si la altura es menor de 699 px); el PNG de suspensión, a 80×60 px. Dimensiones enteras y render pixelado, sin suavizado ni escalado tipográfico. La caja de icono de estos estados se adapta al sprite. La mascota es `aria-hidden`, con título, explicación y acciones en español aportados por `EmptyState`. El arte ambiental del personaje se suprime detrás del vacío para no duplicarlo.

`test/empty-states-desktop.mjs` implementa mediciones en Electron y host aislados a 1520×980 y 1100×760: centros y bordes con tolerancia de ±2 px, overflow horizontal sin tolerancia y capturas `/tmp/opencode/empty-states-*.png`. Incluye bienvenida, Skills/Plugins sin proyecto, canvas sin paneles, ambos grupos del rail, índice vacío y chat nuevo; exige esos casos y examina los demás `.empty-state` visibles. Esto describe la prueba; los resultados corresponden a los checks del controlador.


## Comportamiento y contratos

Contratos de interacción, persistencia y navegación. Donde citen radios, sombras o bordes concretos, mandan las Reglas de arriba.

### Capturas y enlaces del chat

El Markdown del chat renderiza enlaces como acciones de teclado/puntero, no texto decorativo. Los enlaces `file:///ruta/captura.png` o rutas absolutas de imágenes PNG/JPEG/WebP/GIF expanden una vista previa dentro del mensaje; `![descripción](ruta)` la muestra directamente. La cabecera incluye «Cerrar vista previa» y estados de carga/error explícitos. Se reutilizan superficie, hairline, radios y foco del tema; la imagen mantiene su proporción, se adapta al ancho del mensaje y el hilo conserva su scroll.

La lectura pasa por `desktop.previewImage`: solo archivos raster de hasta 12 MB dentro de proyectos, artefactos autorizados o `/tmp/opencode` (capturas locales del agente). No se carga `file://` directamente en Chromium ni se amplía la CSP. Enlaces HTTP(S) abren el navegador del sistema; otros archivos usan la apertura local ya autorizada. Esquemas ejecutables y archivos remotos no generan acciones. Verificación: `test/local-images.test.mjs` y `test/markdown-links-desktop.mjs`.

### Controles, navegación y campos

Los botones del shell normalizados miden 34 px de alto, padding `0 14px` y peso 550; las primarias usan `--on`/`--on-ink`. Las cabeceras de panel conservan controles de 28×28 px y la barra superior, de 32×32 px. Los botones de herramienta mantienen padding `6px 10px`; sus campos están etiquetados, ocupan el ancho disponible y usan padding `7px 9px`. Carga, error, vacío y no disponible conservan mensajes distintos y ligados a sus fuentes.

Las filas de proyectos y paneles truncan nombres largos conservando etiquetas y rutas accesibles. La selección usa tecla clara y `aria-current`. El acceso independiente a foco aparece por hover, foco de teclado, estado pulsado o dispositivo sin hover. Arriba/abajo e Inicio/Fin desplazan foco y revelan destino sin activarlo; Enter/Espacio activan, Tab conserva el recorrido nativo. Carpetas y utilidades no añaden contornos de fila; una costura separa el pie. Conexión conserva texto junto a su punto de estado.

El drawer retiene Tab/Shift+Tab, empieza en cerrar, cierra con Escape o scrim y restaura el foco de apertura salvo navegación explícita. Cerrado es inert; abierto vuelve inert el workspace y bloquea entrada PTY/oculta navegador nativo mediante la política de overlays existente. El rail de escritorio reserva ancho e insets. Mientras un control del rail tiene foco, el canvas bloquea la apropiación automática de entrada por la terminal; al salir del rail libera esa propiedad y un clic en terminal puede recuperarla.

El foco de teclado usa contorno de acento de 2 px, con ajustes locales; en el rail el offset es −2 px para no recortarlo. La nota usa el caret sin segundo contorno interior. xterm conserva la propiedad del cursor y de la entrada, sin contorno genérico en su textarea auxiliar.

### Configuración, Apariencia y persistencia local

`Settings.jsx` reúne la configuración en una hoja del inspector no modal. El botón del rail y la acción `settings` de la paleta abren Configuración; la ruta `appearance` abre su categoría Apariencia y la ruta anterior `plugins` abre Conexiones (`Inspector.jsx`). En ancho reducido se muestra primero la lista de categorías y luego su contenido, con regreso a Configuración. `ToolPanels.jsx` también admite el tipo de panel `settings`: carga los ajustes con `state.get` si no recibe el estado; Apariencia solo aparece cuando recibe sus controles, disponibles en el inspector de `App.jsx`.

| Categoría | Contenido implementado |
|---|---|
| Agentes | Agente y shell de sesiones nuevas; activación de tareas y memoria de Phantom por proyecto, modelo, ejecutable y carpeta de datos; estado de las cuentas disponibles |
| Git e integración | Integración automática y comando de pruebas antes de integrar, por proyecto |
| Apariencia | Fondo, acento, escala de interfaz, ambiente, personaje, concentración y retícula |
| Voz | Proveedor, modelo, URL de API, comando local y salida del motor; comando para instalar o actualizar el motor local |
| Teléfono | Controles existentes de `MobileSettings` y `AndroidGatewaySettings` |
| Conexiones | Bitácora de videos desde Markdown y su apertura; Convenciones cuando su fuente está lista, por proyecto |
| Datos y respaldo | Exportación con historial opcional, selección y confirmación de importación JSON, carpeta de datos |
| Avanzado | Cerrar solo la ventana o detener todo y salir, con confirmación si hay actividad; versión y detalles del equipo |

Los campos de texto se editan como borradores con Guardar y Descartar; los selectores e interruptores guardan al cambiar. Shell y voz usan `settings.update`; el agente predeterminado se guarda en localStorage como `phantom.cardMode`. La configuración de Phantom actualiza valores propios del proyecto con `plugins.update` cuando ya existen y usa los ajustes generales para los demás. Conexiones usa `plugins.update` y Git `merge.configure`, ambos con el proyecto explícito; Git y Conexiones piden abrir un proyecto si falta. Los fallos de carga y guardado conservan mensajes visibles. Estas rutas de persistencia son distintas de las preferencias locales de Apariencia descritas a continuación.

Las opciones de fondo de Apariencia usan CSS y assets locales, con previsualizaciones ilustrativas. Selección con check y `aria-pressed`; acentos existentes Violeta, Iris, Menta, Arena, Rosa y Cian. «Intensidad ambiental» y «Presencia de Gengar» tienen salida numérica independiente; «Mostrar Gengar», «Pulso ambiental», «Concentración» y retícula son checkboxes etiquetados. Restablecer devuelve Gengar/Violeta/retícula ON/ambiente 55 %/personaje ON al 55 %/pulso OFF/concentración OFF/sin imagen.

Las preferencias se guardan sincrónicamente en localStorage bajo `phantom:studio:${workspaceId || 'default'}`, por proyecto y perfil local. Cambiar proyecto carga sus preferencias sin copiarlas del anterior. La versión 3 conserva fondo, acento v2 (incluido Iris explícito), retícula, imagen, intensidad y campos desconocidos; migra la presencia antigua según fondo Gengar/sin imagen y copia su intensidad anterior al nuevo deslizador del personaje. Solo Iris anterior a v2 conserva la migración histórica a Violeta. Pulso y concentración nuevos nacen OFF. La lectura normaliza sin sobrescribir el original; el siguiente cambio guarda v3. JSON inválido recupera defaults; claves, booleanos, intensidades finitas 0–100 e imagen se validan. Un fallo al escribir notifica y no aplica el cambio. Es almacenamiento local, no sincronización cloud.

La imagen propia admite PNG/JPEG/WebP de hasta 2×1024×1024 bytes, decodificados con `createImageBitmap` antes de producir la data URL. La recarga solo acepta data URLs base64 del tipo permitido menores de 2.800.000 caracteres. Los fallos de tipo, tamaño, lectura, decodificación y guardado tienen mensajes visibles; el campo se desactiva durante la carga. Desmontar o restablecer invalida solicitudes pendientes. Elegir fondo elimina la imagen; quitar imagen conserva el fondo elegido. La imagen local se superpone a la atmósfera, centrada y con `cover`, bajo la atenuación ambiental; Gengar sigue en una capa independiente. Los sprites de identidad son assets locales; las capturas de revisión son evidencia de ejecución, no assets de marca.

### Trabajo espacial y propiedad de entrada

Selección es la herramienta predeterminada: arrastrar canvas vacío selecciona paneles intersectados y Shift añade. Mano (H), Espacio mantenido fuera de edición o botón central permiten paneo sobre contenido; V vuelve a selección. La rueda normal dentro de un panel pertenece a su contenido; Ctrl/Cmd/Alt+rueda hace zoom alrededor del cursor en mapa. Trackpad y pinch conservan paneo y zoom anclado; foco conserva scroll/entrada del panel.

La navegación agrupa selección, mano, comentarios, zoom, encuadre, minimapa y guía. Barra de 48 px, controles de 32 px y numerales tabulares; teclas activas claras, con círculos para iconos propios. El popover ofrece 25/50/100/150 %, encuadrar todo (0) y selección (2); 1 restaura 100 % y +/− usa el centro del área operativa. La franja inferior reserva columnas para creación/navegación y minimapa; los controles permiten scroll horizontal si falta ancho. Los popovers abren encima y cierran por Escape/clic exterior.

Encuadre y minimapa usan el área operativa medida, con 72 px libres arriba y 16 px abajo. Al estabilizar un resize se reencuadran mediante cámara los paneles visibles que exceden el área, sin alterar coordenadas/dimensiones persistidas; los deliberadamente fuera de pantalla permanecen fuera. Tab sobre un panel recortado lo encuadra. Foco usa insets laterales de 12 px, y=72 px y altura del stage menos 88 px; volver a mapa al mismo tamaño conserva cámara.

La entrada de cámara se acumula en ref y renderiza una vez por frame de entrada. Persiste tras 180 ms de inactividad, al soltar, blur o protocolo de flush, con identidad de proyecto explícita. La navegación discreta interpola 180 ms y admite interrupción; movimiento reducido aplica destino directamente. Los cuerpos memorizados evitan rerenders por cámara; las previsualizaciones geométricas confirman el último ref al soltar.

Identidad de cámara/layout y nombres se conservan separados de geometría temporal de foco y rutas canónicas. La navegación cede a edición, incluido xterm. Escribir en terminal exige stream activo escribible y foco real: Espacio, Escape, Ctrl+C, `0` y letras pertenecen a terminal. Ctrl/Cmd+Shift+Enter es la ruta explícita a foco de panel. El inspector no modal no reenvía teclas al PTY. Superficies bloqueantes y transporte desconectado mantienen el bloqueo; la oclusión del navegador nativo tiene política separada.

Solo un navegador enfocado y no oculto muestra su vista nativa; overview y ausencias siguen siendo contenido de ejecución. Phantom conserva autoridad sobre Cards/Decisiones/Skills; layout, referencias, borradores y notas son de la aplicación. Los errores de fuente/guardado permanecen visibles y relanzar una sesión terminada/perdida es explícito.


## Verificación

Los checks declarados para esta entrega son `npm test` y `npm run build`, a cargo de Phantom. Esta reescritura se basa en lectura del código integrado y de `test/design-tokens.test.mjs`; no declara resultados de pruebas, rendimiento medido ni aprobación visual.

`npm test` incluye las restricciones de tokens/materiales y las pruebas de preferencias importadas por `test/design-tokens.test.mjs`. Estas últimas cubren normalización, migración, validación, conservación de preferencias y claves por proyecto. Las comprobaciones estáticas de contraste cubren planos opacos, pozos translúcidos incluso sobre blanco, teclas claras y chrome con los seis acentos sobre atmósferas CSS existentes. Las imágenes personales son contenido de ejecución; no se infiere contraste universal del chrome sobre ellas.

Las herramientas de captura y scripts de escritorio son evidencia complementaria solo si se ejecutan y revisan sus resultados:

- `node test/design-capture.mjs <etiqueta>`, tras build: capturas `/tmp/opencode/design-<etiqueta>-*.png`.
- `node test/solid-workplanes-desktop.mjs`: materiales calculados, elevaciones, texto de vecinos, foco y controles en conversaciones/terminales; su nombre no convierte en opacos los nuevos planos.
- `node test/spectral-ui.mjs`: estados, mapa/selección/foco, acciones IPC sintéticas, hit-testing, separación de chrome y preferencias de accesibilidad; capturas `/tmp/opencode/spectral-ui-*`.
- `node test/unified-design-desktop.mjs`: compositores, preferencias, Gengar, concentración, movimiento reducido y errores del renderer; capturas `/tmp/opencode/unified-design-*`.
- `node test/empty-states-desktop.mjs`, `node test/sidebar-floating.mjs`, `node test/canvas-controls.mjs` y `node test/desktop-motion.mjs`: geometría de vacíos, navegación/foco, propiedad PTY y ciclo de movimiento.

La integración debe distinguir la cobertura de estos scripts de la validación efectiva del material actual. La quietud del GIF vacío y la suspensión JavaScript del campo de ondas en Concentración son discrepancias de código descritas arriba, no excepciones aprobadas al requisito de rendimiento. El controlador comunica los checks y el padre integra y revisa el conjunto.
