---
name: Phantom Workspace
description: Night glass — a personal spatial workspace; frosted chrome over the canvas, opaque working planes.
colors:
  accent: "#a78bda"
  accent-soft: "color-mix(in srgb, var(--accent) 15%, var(--surface))"
  accent-mint: "#7ddbb9"
  accent-amber: "#edbf79"
  accent-rose: "#e9a0bf"
  accent-cyan: "#6fe3f2"
  bg: "#0b0910"
  surface: "#131019"
  surface-2: "#1c1725"
  surface-3: "#292133"
  ink: "#eee9f4"
  muted: "#a69bb7"
  line: "#332a40"
  hairline: "color-mix(in srgb, #fff 8%, transparent)"
  hairline-strong: "color-mix(in srgb, #fff 13%, transparent)"
  fill: "color-mix(in srgb, #fff 5%, transparent)"
  fill-2: "color-mix(in srgb, #fff 9%, transparent)"
  fill-3: "color-mix(in srgb, #fff 14%, transparent)"
  glass: "color-mix(in srgb, var(--surface) 64%, transparent)"
  glass-thick: "color-mix(in srgb, var(--surface) 84%, transparent)"
  rail: "#131019"
  terminal-bg: "#0e0b13"
  terminal-ink: "#ddd5e9"
  primary-ink: "#130d1e"
  node-border: "#372c44"
  note: "#211d2c"
  danger: "#ee788a"
  success: "#5fe0a5"
  warning: "#ffab40"
  error-bg: "color-mix(in srgb, var(--danger) 15%, var(--surface))"
  mission-bg: "#233a33"
  mission-ink: "#a4dec4"
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
  xs: "6px"
  sm: "9px"
  md: "12px"
  lg: "16px"
  xl: "22px"
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
    padding: "10px 8px"
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

## Gengar oscuro e iconografía funcional (2026-11-11) — paleta vigente

Carlos pidió una paleta más oscura centrada en Gengar y reducir la iconografía genérica «AI slop». Esta sección sustituye las paletas pastel anteriores y el código por colores decorativo de las herramientas. Conserva el layout espacial y el material de chrome de «Vidrio nocturno».

- **Planos:** ciruela casi negra `#0b0910`; trabajo `#131019`; elevación `#1c1725` / `#292133`. Texto marfil violeta `#eee9f4`, secundario `#a69bb7`. Terminal opaca `#0e0b13`.
- **Acento:** Violeta `#a78bda` (clave persistida `lilac`), para selección, foco y acción. Rojo rosado `#ee788a` para peligro; los estados operativos conservan etiquetas y sus roles semánticos. Las otras elecciones de acento se conservan.
- **Atmósfera:** Gengar mantiene el arte oficial local, ahora con bruma ciruela más oscura. Imagen personal, intensidad, retícula y atenuación de foco conservan su comportamiento.
- **Iconos:** `src/components/PanelIcons.js` es la fuente compartida para lanzador, rail, paleta y cabeceras. Ventana para navegador, documento para nota, bandera para misión, libro para contexto/skills, pieza para plugins; cada función tiene un símbolo estable. Trazo 1,75. Se eliminan los fondos de tesela y los colores por grupo en herramientas y cabeceras; selección y foco siguen explícitos. Agentes genéricos usan CPU, no robots; los proveedores identificados conservan sus glifos.
- **Marca:** glifo Phantom angular propio, con silueta puntiaguda y dos cortes oblicuos, sin tesela coloreada. El arte de Gengar sigue siendo el recurso raster existente, sin nuevas imágenes.

Verificación de esta capa: build de Vite correcto; Electron real con proyecto sintético a 1520×980 y 1100×760, inspección de mapa, lanzador y Apariencia; nueve pares texto/fondo ≥4.5:1; acento Iris persistido tras recarga y restablecimiento a Violeta; cero excepciones del renderizador. Evidencia y alcance en `.impeccable/review/gengar-review.md`.

## Vidrio nocturno (2026-11-11) — autoridad visual vigente

### Refinamiento de terminales y conversaciones

Las vistas Claude, OpenCode y Terminal separan controles de trabajo y contexto: barra principal de mínimo 52 px y fila secundaria de mínimo 40 px para carpeta/rama y permisos o estado de sesión. El selector compartido usa tres segmentos iguales, pista de 36 px y controles de 30 px con glifos de 16 px; la selección se desplaza durante `--dur` con `--ease-out` y respeta movimiento reducido. Flechas, Home y End seleccionan modo; Tab entra por la opción activa. Durante una solicitud se impiden cambios concurrentes.

Los controles de tamaño de terminal tienen objetivos de 32 px; carpeta y conexión conservan presencia en anchuras reducidas. La conversación separa turnos por 28 px y usa avatares de 28 px. Se conserva la identidad nocturna y los tonos por proveedor.

Verificación de este refinamiento: build Vite correcto; capturas en Electron real de los tres modos a 1520×980 y 1100×980, más card en mapa; selección por teclado, entrada real en PTY, movimiento reducido y contención de las barras comprobados con fixture aislada. Sin excepciones del renderer. No se enviaron prompts a proveedores. La prueba preexistente `terminal-scroll-smoke.mjs` se detuvo también antes de los cambios esperando `.status-dot.running`: su arranque presupone terminal en lugar del modo Claude predeterminado. El detector señaló valores heredados de radios/tipografía; no constituye una aprobación global de la app.

Carlos pidió conservar el carácter de Phantom pero limpio, «like Apple» y coherente con su escritorio (Hyprland «Neón Suave»: índigo profundo, vidrio esmerilado, hairlines, radios generosos, Inter, Monaspace en la terminal). Esta sección rige sobre cualquier cifra o regla anterior de este documento donde difieran; en particular **sustituye la regla «islas opacas, sin vidrio»**.

- **Material.** El chrome (rail, barras superiores, dock, navegación, minimapa, inspector, menús, paleta, toasts) es vidrio: `--glass` (64 % de superficie) o `--glass-thick` (84 %, planos de lectura) con `backdrop-filter: blur(28px) saturate(170%)`, hairline blanca al 13 % y una sola sombra suave con desplazamiento. Los planos de trabajo (terminal, hilo del chat, cuerpo de herramientas, paneles del mapa) siguen opacos. `prefers-reduced-transparency` vuelve todo opaco.
- **Planos sin relieve.** Nada de degradados, luces interiores ni sombras hundidas en controles: los planos difieren por un tono y una hairline. Los rellenos de control salen de una sola escalera blanca-alfa (`--fill` 5 %, `--fill-2` 9 %, `--fill-3` 14 %).
- **Paleta.** Índigo noche, nunca negro puro (tokens en el frontmatter). Lila sigue siendo el acento predeterminado; se añade **Cian** (`#6fe3f2`, el acento del escritorio). El ANSI de la terminal es el de kitty/Neón Suave (`src/components/TerminalPanel.jsx`).
- **Tipografía.** `--sans`: Inter → SF Pro → sistema. `--mono`: Monaspace Neon → GeistMono → JetBrains Mono. Las fuentes no se empaquetan: se usan las del sistema con esa cadena de respaldo. Texto de chrome 12–13 px; el mínimo sube de 10 a 10,5–11 px. Los iconos lucide usan trazo 1,75.
- **Radios concéntricos.** `--r-xs` 6 · `--r-sm` 9 · `--r-md` 12 · `--r-lg` 16 · `--r-xl` 22. El radio de una isla es el de su control interior más su padding (dock 20 = 12 + 8; rail 22 = 12 + 10). Las cápsulas (99px) son solo para controles pequeños: chips, acciones de pie de card, estado del agente.
- **Selección.** Un panel seleccionado lleva borde de acento y un anillo de 3 px al 26 %; filas seleccionadas usan `--fill-2` o `--accent-soft` con texto en tinta, no en acento.
- **Quién responde.** Claude · OpenCode · Terminal es un control segmentado (`.pc-modes`): pista `--fill`, segmento activo elevado con texto en tinta y glifo en el tono del proveedor. Cada proveedor tiene un glifo y un tono fijos (`src/components/Glyphs.jsx`): Claude sigue el acento del proyecto, OpenCode es menta, otros agentes azul, shell neutro. El mismo glifo aparece en el avatar del chat, la identidad de la card y el selector de modelo.
- **Card de terminal.** Cabecera de 44 px con el glifo del tipo en una tesela; fila de identidad (segmentado, proveedor detectado, estado como cápsula a la derecha, paso actual debajo); pozo de salida a sangre; pie de 44 px con acciones en cápsula.
- **Pasos y bloques del chat.** Las llamadas a herramientas de un turno son una lista plana con hairlines, una tesela de 22 px por tipo (tonos del ANSI) y la fila en curso con un lavado del tono del proveedor. Razonamiento es una cápsula desplegable; código y permisos son planos con hairline; el compositor es un campo de radio 16 con anillo de foco del proveedor.
- **Lanzador de herramientas.** «Herramientas» abre `src/components/ToolPicker.jsx`: búsqueda con foco inicial (Enter abre la primera coincidencia) y cuatro grupos con un tono cada uno: En el mapa (acento), Proyecto (azul), Automatización (ámbar), Phantom (menta).
- **Paleta de comandos.** Estilo Spotlight: vidrio grueso, radio 22, campo de 17 px, fila elegida con `--fill-2` y hairline interior de acento.

Verificación de esta capa: capturas antes/después en Electron real con datos sintéticos (mapa, card, terminal enfocada, lanzador, paleta, inspector, apariencia, chat, menús). No se midió el coste de `backdrop-filter` durante el paneo en hardware lento.

## Paleta vigente: Fantasma violeta (2026-11-11)

Carlos eligió «Fantasma violeta» para toda la app: grafito con tinte violeta profundo (`#14121b`, superficies `#1d1a27` / `#272333`, seams `#36304a`) y acento **Lila** (`#b48cff`) como nuevo predeterminado. Iris, Menta, Ámbar y Rosa siguen disponibles. Los proyectos guardados con Iris sin versión migran a Lila una vez (`v: 2` en la preferencia local); una elección posterior de Iris se respeta. Texto, muted, acento y estados superan 4.5:1 sobre ambas superficies. El tema ANSI de la terminal (`src/components/TerminalPanel.jsx`) y la card de terminal (`src/terminal.css`) usan la misma familia. Donde las secciones siguientes citan los valores grafito/Iris anteriores, rigen los tokens del frontmatter.

## Studio actual: preset Gengar

La apariencia vigente se implementa en `src/studio.css`: grafito (`#15171c`), superficies opacas (`#202329`, `#292d35`) y acento Iris (`#8b9dff`). Las secciones minerales históricas que siguen no describen esta capa visual actual.

Gengar es el fondo predeterminado para preferencias nuevas y al restablecer Apariencia. Las selecciones válidas guardadas se conservan. El preset combina el arte oficial local `assets/gengar.png`, importado mediante Vite sin red en runtime, con bruma violeta sobria a la derecha del canvas. El arte escala con el espacio disponible, dejando libre el centro; la miniatura muestra el mismo recurso. Procedencia: `assets/gengar-source.md`.

La intensidad controla conjuntamente arte y atmósfera; el modo foco reduce esa capa al 12% de su intensidad. Una imagen personal tiene prioridad sobre el arte del preset. La decoración no recibe eventos de puntero y las superficies de trabajo siguen siendo opacas. Aurora, Marea, Brasa y Grafito permanecen disponibles en Apariencia.

## Capa canvas (2026-11-11)

`src/canvas-ui.css` se carga al final y es la autoridad de layout y sistema; supera las cifras de Layout, Elevation y Shapes más abajo donde difieran.

- **Canvas a ventana completa.** Todo el chrome flota sobre él como islas opacas: rail (252px, contraíble a una píldora), identidad + actividad + comandos arriba, creación al centro abajo (centrada en el área libre), zoom/minimapa abajo a la derecha, inspector flotante de 360px. Con inspector abierto, zoom y minimapa se apilan sobre la fila del dock.
- **Islas de vidrio** (ver «Vidrio nocturno»): `--island: var(--glass)`; hairline + una sombra con desplazamiento. Los planos de lectura usan `--glass-thick` para que el contenido detrás tiña pero no se lea.
- **Radios:** `--r-xs` 6px (badges, kbd) · `--r-sm` 9px (controles, filas, campos) · `--r-md` 12px (contenedores medianos) · `--r-lg` 16px (paneles, barras) · `--r-xl` 22px (rail, inspector, lanzador, paleta). Los radios heredados se normalizan a esta escala en la misma hoja.
- **Elevación:** `--elev-1` paneles · `--elev-2` islas · `--elev-3` menús/popovers · `--elev-lift` panel arrastrado. Sin halos de desplazamiento cero.
- **Movimiento:** una curva (`--ease-out`), dos velocidades (`--dur-fast` 140ms, `--dur` 240ms). El momento distintivo es la inercia al soltar el paneo; sin rebotes ni hover que desplace controles. Movimiento reducido elimina la inercia y las entradas.
- **Retícula en espacio-mundo:** los puntos se desplazan y escalan con la cámara y duplican el paso por debajo de 14px.
- **Minimapa:** bloques neutros; acento solo para selección y vista actual.
- **El viewport no se desplaza:** `overflow: clip` en canvas y contenedores; solo la cámara mueve el mapa.
- **Rail:** todas las acciones son la misma fila discreta; solo el proyecto activo y el panel seleccionado se rellenan.
- **Ritmo:** espaciado en múltiplos de 4px (`--s-1`…`--s-6`). Islas de 48px de alto con 8px de padding y controles de 32px; dock de 56px con botones de 40px; separación entre islas y bordes de 12px. Inspector a 72px del borde superior; la fila inferior reserva 88px.
- **Bordes vivos:** el borde de un panel solo pulsa si el estado es real. Trabajando: halo de acento que respira en 2,4s. Te necesita (bloqueado, en revisión, intervención): ámbar, ciclo de 1,4s. Fallo (sesión perdida o salida con código distinto de 0): rojo, tres destellos y luego fijo. En reposo no hay movimiento. El punto de estado del rail repite la señal ámbar. Con movimiento reducido el anillo queda fijo.
- **Zonas:** tipo de panel `zone`. Son áreas con nombre y color (iris, menta, ámbar, rosa, pizarra) que se dibujan detrás de los paneles. Al arrastrar la etiqueta se mueven junto con los paneles que contienen por completo; doble clic encuadra la zona. Se crean desde el dock o alrededor de una selección; la barra de selección aparece sobre el dock.
- **Espacios:** vistas con nombre dentro de un proyecto (`workspace.spaces`, cada una con su cámara). Un panel pertenece a un espacio mediante `data.spaceId`; los paneles sin espacio o con un espacio borrado pertenecen a Principal. Se cambian desde el rail o con Alt + 1…9. Quitar un espacio devuelve sus paneles a Principal; nunca se borra nada. El espacio abierto es una preferencia de cada ventana.

## Overview

**Creative North Star: "Dark studio"**

A personal development studio: graphite navigation and opaque working planes over an optional atmospheric canvas. Compact native controls keep projects, panels and commands within reach. Focusing a panel quiets the personal background while preserving spatial identity and the route back to the map.

This replaces the superseded light “Atlas de estudio” world at the user's request. `.impeccable/surfaces/workspace.md` records the pinned dark, Figma-inspired DX direction; it is code-led, not a randomly selected concept or comp reproduction. `src/styles.css` remains the layout/input base and imports `src/tools.css`; `src/App.jsx` imports `src/studio.css` after that base. **The shipping visual authority is the resulting cascade with `studio.css` overrides**, not the light literals left in the base. Appearance state comes from `src/hooks/useAppearance.js`, `src/components/Appearance.jsx` and their App integration. Frontmatter captures reusable values; the sidecar extends it with previews, depth and behavior.

**Key Characteristics:**
- Graphite shell, opaque tools, iris selection and optional personal atmosphere.
- Native interface sans with compact support text; monospace for terminal/code.
- Direct project/panel routes and separate floating creation and zoom controls.
- Project-local appearance and focus attenuation without camera replacement.

Evidence checked: `.impeccable/review/studio-desktop.png`, `studio-appearance.png` and `studio-focused.png` (1520×980), plus `studio-narrow.png` (1100×760), were opened for this documentation pass. They show synthetic fixture content, not product claims. `studio-checks.json` (2026-11-11T14:53:59.623Z) records seven checks with no recorded errors: real Electron/host/PTY navigation, reload persistence, valid/corrupt image handling and removal, project isolation, focus/camera/selection return, command-palette appearance access, and captures without renderer exceptions. These checks were read, not rerun here. `studio-review.md` ends **SHIP**, with its sole provenance fix resolved, scoped to studio theme, appearance/persistence and App integration. It is not whole-product approval. Supplied general-suite status is **84 passed / 1 failed / 3 skipped**, with the task-catalog failure reported unrelated. The old 34-pass light-world ledger does not verify this styling.

## Colors

### Primary
- **Iris / accent:** default action, selection, caret and keyboard-focus color. The preference can replace it with **Menta**, **Ámbar** or **Rosa**; the hook applies the chosen accent on the document root.
- **Accent wash / accent-soft:** a live mix of the current accent and opaque surface, used for selected panel rows, active controls and the first creation action. It is a CSS color mix, not surface transparency.
- **Primary ink:** dark text on filled accent actions; primary hover mixes the accent with white (12%).

### Neutral
- **Graphite / bg:** shell ground and canvas base; **Rail:** navigation/header context.
- **Working plane / surface:** opaque tool bodies, inspector, floating controls and popovers; **Raised plane / surface-2:** headers, active project and secondary treatments.
- **Light ink / ink**, **Slate / muted**, **Seam / line:** content, secondary context and fine dividers. **Node border:** map frame boundary before selection.
- **Terminal depth:** terminal well; terminal glyph/ANSI/cursor values belong to the terminal implementation rather than the appearance accent palette. **Note:** a slightly warmer dark editing plane.

### Semantic states
- **Success:** save/healthy feedback; **Warning:** caution/unavailable state; **Danger** with **Error ground:** destructive/error feedback. The mint accent and success green are distinct values.
- **Mission ground / mission ink:** compact membership marker. Preserve labels with status dots; color alone does not establish state.

**The Selection Is State Rule.** Use the current accent for action, selection and keyboard ownership; keep accompanying labels and status text.

**The Quiet State Rule.** Each state has exactly one value (success, warning, danger, idle); grounds derive from it with `color-mix`, never as separate literals. Decorative icons, hovers and links stay neutral (muted → ink); the accent appears only on selection, focus, pressed tools and the primary action. Dividers inside a plane use `--line-soft`; `--line` is reserved for control edges and panel frames. Do not nest bordered containers: a terminal well, header or tray section separates by tone, not by an extra stroke. Mission chips are neutral.

## Typography

The shell inherits `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` at 13px; first-party tools explicitly use `system-ui, sans-serif` at 13px/1.5. No imported display face is introduced. The appearance headline is a functional interface heading, not a marketing/display prescription.

- **Headline:** appearance heading, as tokenized above; the retained canvas empty-state heading is 24px/600/1.25 with -.035em tracking, adapting to 22px at narrow widths and 21px at short heights.
- **Title:** tool section headings; the brand separately uses 15px/650 with -.02em tracking.
- **Body / appearance-body:** tool prose versus lighter, compact appearance explanation. Tool paragraphs cap at 72ch.
- **Label:** appearance legends/intensity and tool field labels.
- **Support (11px):** panel navigation, background options, session metadata, appearance footer and local-image row.
- **Micro (10px):** paths, upload help, accent names, grid explanation and pixel-unit hints. These are subordinate labels, not body-copy defaults.
- **Panel title:** inverse-zoom compensation, `min(2.4, max(1, 1 / zoom))`; focus resets the scale to 1. Terminal cells are measured independently, not enlarged through this title scale. Terminal type controls and code retain their implementation-owned monospace behavior.

## Layout

Full-window desktop shell, minimum width 580px; document scrolling is disabled, while lists, tools, terminal content and appearance scroll internally. The retained spatial model places/drags/resizes panels in a transformed map. Focus uses temporary visible geometry (24px left, 55px top; width `max(320, canvasWidth - 48)`, height `max(240, canvasHeight - 145)`), hiding other mounted panels without overwriting stored coordinates. Camera and pre-focus selection return within the UI session.

- Rail: 232px normally, 240px from 1450px; 210px at widths ≤1100px; 232px off-canvas drawer at ≤850px. Recent projects cap at 28% height; the panel list consumes remaining space and scrolls. Short windows (≤700px high) compress panel-row and rail spacing.
- Header: 64px high with 24px horizontal padding; ≤850px uses 13px horizontal padding. These studio overrides supersede base header heights and padding.
- Inspector: base 350px; 370px from 1450px; 325px at ≤1270px; at ≤1100px it overlays the canvas at 350px wide rather than shrinking the map. Nonmodal, with explicit close and contextual selector.
- Appearance: 24px 20px padding, two equal preset columns with 10px gap, 58px-high previews, 24px section separation. Four accent controls share a row with 26px circular swatches.
- Creation dock: centered at bottom 22px, 50px high, padding 5px 7px; actions 38px high. Zoom is separate at top 17px/right 20px, 32px high. Between 851–1100px with inspector open, dock centers in the uncovered width (`calc((100% - 350px) / 2)`), and zoom moves to right 362px. At ≤850px zoom is right 12px. Dock label hides at ≤1270px.
- Canvas grid: CSS radial dots (.7px, `#7d879a42`) every 24px; optional and absent in focus. No raster texture is shipped.
- Terminal chrome: 12px horizontal inset, toolbar minimum 48px and session bar minimum 34px, bordered 7px-radius working well. At terminal container widths ≤420px, directory becomes 11px, toolbar gap 8px and session context 10px. Terminal fitting/input measurement remains implementation-owned.

New terminal panels start at 640px tall to leave room for full-screen application input, including OpenCode. Existing small panels retain their geometry and offer “Enfocar para escribir” below 16 terminal rows. Jump-to-panel positioning reserves the actual navigation toolbar height so focus/close controls remain clickable on narrow desktop windows. `test/terminal-opencode-smoke.mjs` exercises visible unsubmitted input, small-panel focus recovery and closing Fish + OpenCode with an isolated host.

The 1100×760 evidence is narrow desktop, not mobile support. Retained base adaptations include tool padding at ≤600px and compact empty states/picker at ≤650px height.

## Elevation & Depth

Opaque tonal planes and fine seams carry most depth. Soft black shadows lift floating controls without making the working content translucent.

- **Node rest:** `0 6px 18px #0002`; **node focus:** `0 10px 30px #0003`.
- **Floating dock / zoom:** `0 8px 24px #0005` (`--shadow-float`).
- **Popover:** `0 16px 40px #0006` (`--shadow-popover`).
- **Palette / voice:** `0 18px 64px #0007`; **narrow inspector:** `-12px 0 35px #0004`.
- Retained local base shadows: app dialog `0 20px 70px #0f1b3555`, inline-name error `0 4px 14px #202c4420`, and canvas busy `0 4px 15px #202c441a`. These are not new studio shadow tokens.

**The Opaque Work Rule.** Personal atmosphere belongs behind the canvas; terminal and tool operating planes stay opaque.

Background intensity is 55% by default, adjustable 0–100%. Focus multiplies the background layer's opacity by .12 (default .066), rather than dimming text or panel content. Opacity transitions for 220ms `cubic-bezier(.16,1,.3,1)`; reduced motion removes this transition. The base also retains a 180ms drawer transition and 140ms ease-out tool-button color transitions, with reduced-motion overrides. Still captures do not prove frame pacing.

Native browser content is an Electron WebContentsView, not a CSS stacking layer: inspector and blocking overlays must obscure it through native-view policy.

## Shapes

Precise rounded rectangles, not universal pills. Frames retain 10px rounding and 1px borders; selected map panels switch the 1px frame border to the accent (no extra outline), while focused panels use the seam border. Node headers and terminal wells separate by tone, without inner borders. Dock rounding is 12px; presets 8px; shell buttons/terminal wells/upload 7px; panel rows/icon controls 6px; fields/tool controls 5px; badges 3px. Circular accent swatches communicate palette choice. Icons are stroked SVGs.

## Components

### Capturas y enlaces del chat

El Markdown del chat renderiza enlaces como acciones de teclado/puntero, no texto decorativo. Los enlaces `file:///ruta/captura.png` o rutas absolutas de imágenes PNG/JPEG/WebP/GIF expanden una vista previa dentro del mensaje; `![descripción](ruta)` la muestra directamente. La cabecera incluye «Cerrar vista previa» y estados de carga/error explícitos. Se reutilizan superficie, hairline, radios y foco del tema; la imagen mantiene su proporción, se adapta al ancho del mensaje y el hilo conserva su scroll.

La lectura pasa por `desktop.previewImage`: solo archivos raster de hasta 12 MB dentro de proyectos, artefactos autorizados o `/tmp/opencode` (capturas locales del agente). No se carga `file://` directamente en Chromium ni se amplía la CSP. Enlaces HTTP(S) abren el navegador del sistema; otros archivos usan la apertura local ya autorizada. Esquemas ejecutables y archivos remotos no generan acciones. Verificación: `test/local-images.test.mjs` y `test/markdown-links-desktop.mjs`.

### Controls, navigation and fields

Shell actions retain 35px height, 0 13px padding and weight 550. Secondary hover uses the raised plane and muted border. Primary actions use accent fill/dark ink with the lighter hover mix. Shell icon controls are 29px squares; node-header controls retain compensated width and 32px height. Tool buttons remain a separate 12px/500/1.4 primitive, minimum 32px high, 6px 10px padding; disabled opacity is .55 (shell .42). Tool secondary press uses accent wash.

Project navigation retains name/path/initials and an active dot; the selected project uses raised graphite, not the old blue rail fill. Panel rows provide direct selection and a separate focus action; selected rows use accent wash. The map action and creation dock remain explicit routes. Tool fields are labelled, full width, minimum 34px high, padded 7px 9px with seam border. Error/loading/empty/unavailable states remain distinct and source-backed.

Keyboard focus remains a 2px current-accent outline: shell buttons/tab stops offset 3px, shell fields -1px, tool controls 3px, note field -3px. xterm owns cursor/input focus and suppresses generic helper-textarea/screen outlines.

### Appearance and local persistence

Available from the rail, contextual selector and command palette; it occupies the nonmodal inspector. Presets: **Aurora** (violet/teal), **Marea** (petroleum/blue), **Brasa** (warm graphite), **Grafito** (no atmosphere). Presets are CSS gradients, with intentionally illustrative preview gradients rather than pixel-identical miniature canvas crops. Selected options use an accent border, checkmark and `aria-pressed`. Accent options are named/checkmarked Iris, Menta, Ámbar and Rosa. Intensity has numeric output, grid has a labelled checkbox, and reset restores Aurora/Iris/grid on/55%/no image.

Preferences synchronously save to localStorage under `phantom:studio:${workspaceId || 'default'}` on this machine/browser profile, separate from host workspace JSON. Switching projects loads the target project's settings rather than copying the previous entry. Invalid JSON falls back to defaults; load validates preset/accent keys, boolean grid, finite intensity clamped 0–100, and image data URL shape/length. A failed localStorage write reports an error and does not apply the attempted state change. This is not cloud sync or a durability guarantee beyond local storage.

Optional uploads accept PNG/JPEG/WebP MIME types up to 2×1024×1024 bytes; `createImageBitmap` must decode the file before FileReader produces a data URL. Reload accepts only matching base64 image data URLs shorter than 2,800,000 characters. File type/size, read/decode and save failures have visible actionable errors; save failure also notifies through the hook. The file control disables while loading. The project-keyed appearance component invalidates outstanding requests on unmount; reset invalidates them too. Choosing a preset clears the image; removing the image preserves the selected preset. Local data images layer above the CSS atmosphere, cover/center the canvas and receive the same intensity/focus attenuation. No shipping raster assets were added; review screenshots and runtime browser captures are evidence/content, not brand assets.

### Spatial work and product constraints

#### Canvas navigation controls

Selection is the default tool: drag empty canvas to select intersecting panels; Shift adds to the selection. The hand tool (H), held Space outside editing targets, or middle-button drag pans across panel content. V returns to selection. Normal wheel input inside a panel remains with its content; Ctrl/Cmd/Alt + wheel zooms around the cursor in map mode. Trackpad deltas pan the background and pinch events use cursor-anchored zoom. Focus mode retains panel-owned scrolling and input.

The floating navigation toolbar groups selection/hand, zoom, fit and a discoverable gesture guide. It is 42px high with 32px controls, current-accent pressed states and tabular zoom numerals. The zoom popover offers 25/50/100/150%, fit-all (0) and fit-selection (2); 1 restores 100%, and +/− zoom around the viewport center. Below 1270px the toolbar moves to a second row (top 62px, popovers 112px) to clear panel-count and grouping actions. At wider sizes it remains top 17px. Inspector-aware right positioning is retained.

Camera input accumulates synchronously in a ref and renders once per animation frame. Persistence is staged after 180ms idle, on pointer release, blur or the existing before-flush protocol, with explicit workspace identity. Discrete navigation interpolates for 180ms with cubic ease-out and is interruptible; reduced motion applies the target directly. Memoized tool bodies avoid camera-only rerenders. Geometry previews commit their latest ref on release.

Verification: `node test/canvas-controls.mjs` passed eight interaction/layout checks on isolated Electron/host fixtures, including an 80-event input burst, camera reload persistence, cursor anchoring, editor ownership, hand/Space navigation, area selection, keyboard button semantics, exact animated zoom and narrow-inspector clearance. Captures in `/tmp/opencode/phantom-canvas-DRVUgg/` were inspected at desktop and narrow desktop sizes; they use synthetic notes. `node test/desktop-motion.mjs` passed ten lifecycle/motion checks and `node --test src/hooks/*.test.mjs` passed 29 tests. These checks establish tested behavior, not sustained frame-rate measurements. The detector returned only existing palette-literal advisories in `studio.css`.

Preserve camera/layout identity separately from temporary focus geometry and names separately from canonical project paths. Canvas navigation yields to editing targets including xterm. Terminal writes require an active writable stream and actual focus in that terminal; ordinary Space, Escape, Ctrl+C, `0` and letters remain terminal input. Ctrl/Cmd+Shift+Enter is the explicit panel-focus route. Inspector fields never proxy keystrokes into the PTY; the inspector is nonmodal and clicking a visible terminal can reclaim ownership. Blocking surfaces and disconnected transport still block terminal ownership; inspector/native-browser occlusion remains separate from terminal blocking.

Only focused, unobscured browser panels display the native view; overview captures and their missing states remain runtime content. Phantom remains authoritative for native cards/decisions/skills; workspace layout, references, drafts and notes remain app-owned. Keep source/save errors visible and relaunch explicit after exited/lost sessions; background customization does not change lifecycle semantics or promise recovery of unacknowledged edits.

## Do's and Don'ts

### Do:
- **Do** apply the studio override palette and current project accent over the retained layout base.
- **Do** keep working planes opaque and attenuate only the background when focusing.
- **Do** preserve camera identity, direct panel routes and nonmodal inspector input ownership.
- **Do** expose local appearance save/upload failures and retain named, checkmarked choices.
- **Do** quote the studio evidence and scoped verdict with their verification limits.

### Don't:
- **Don't** restore the superseded light palette from base CSS literals or old documentation.
- **Don't** treat optional local uploads, runtime captures or review screenshots as shipping identity assets.
- **Don't** redirect terminal keystrokes through canvas navigation or inspector fields.
- **Don't** infer mobile readiness, whole-product approval or a clean general suite from this packet.
- **Don't** promote sidecar preview ramps into application tokens; they are synthesized metadata only.

Not canonized or repaired: the reported unrelated task-catalog failure and concurrent TerminalPanel/Canvas/Presence changes are outside this documentation pass. The review's provenance finding is resolved, not an outstanding defect or a visual rule.
