---
name: Phantom Workspace
description: Negro profundo, objetos opacos con degradado vertical y aro enmascarado único; Etapa 1 del sistema visual v2.
colors:
  accent: "#f2f0eb"
  accent-soft: "color-mix(in srgb, var(--accent) 17%, transparent)"
  action: "#c6f135"
  bg: "#020203"
  surface: "#0b0b0c"
  surface-2: "#111113"
  surface-3: "#1d1d20"
  menu: "var(--surface)"
  object-top: "#0f0f11"
  object-bottom: "#070708"
  object-fill: "linear-gradient(var(--object-top), var(--object-bottom))"
  object-ring-width: "1px"
  object-edge-top: "color-mix(in srgb, #fff 22%, transparent)"
  object-edge-bottom: "color-mix(in srgb, #fff 6%, transparent)"
  object-ring: "linear-gradient(var(--object-edge-top), var(--object-edge-bottom))"
  selected-edge-top: "color-mix(in srgb, #fff 36%, transparent)"
  selected-edge-bottom: "color-mix(in srgb, #fff 10%, transparent)"
  menu-edge: "color-mix(in srgb, #fff 13%, transparent)"
  ink: "#f2f0eb"
  muted: "#a8a6a0"
  ink-3: "#8b8983"
  hairline: "color-mix(in srgb, #fff 10%, transparent)"
  fill: "color-mix(in srgb, #fff 5%, transparent)"
  fill-2: "color-mix(in srgb, #fff 9%, transparent)"
  fill-3: "color-mix(in srgb, #fff 14%, transparent)"
  glass-tint: "#0b0b0c"
  glass: "var(--surface)"
  glass-thick: "var(--surface)"
  glass-filter: "none"
  glass-sheen: "var(--object-fill)"
  ink-on-glass: "#a8a6a0"
  on: "#f2f0eb"
  on-ink: "#141414"
  workplane: "var(--surface)"
  workplane-wash: "var(--object-fill)"
  well: "#040405"
  well-raised: "#0b0b0d"
  well-terminal: "#040405"
  rail: "var(--surface)"
  terminal-bg: "#040405"
  terminal-ink: "#e1dfda"
  primary-ink: "#141414"
  note: "var(--surface-2)"
  danger: "#f27670"
  success: "#65ba83"
  warning: "var(--attention)"
  working: "#c6f135"
  attention: "#f5c04a"
  error-bg: "color-mix(in srgb, var(--danger) 15%, var(--surface))"
  mission-bg: "var(--fill-2)"
  mission-ink: "var(--muted)"
typography:
  sans: '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
  display: "600 24px/30px var(--sans)"
  title: "600 15px/20px var(--sans)"
  headline: "600 14px/22px var(--sans)"
  body: "400 14px/22px var(--sans)"
  control: "500 14px/20px var(--sans)"
  support: "400 12px/16px var(--sans)"
  micro: "500 12px/16px var(--sans)"
rounded:
  mark: "4px"
  ctl: "8px"
  obj: "24px"
  isle: "24px"
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
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    padding: "0 10px"
    width: "100%"
  panel-row-selected:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
  tool-badge:
    backgroundColor: "{colors.fill-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  canvas-node:
    backgroundColor: "{colors.surface}"
    backgroundImage: "{colors.object-fill}"
    rounded: "{rounded.obj}"
  background-option:
    textColor: "{colors.ink}"
    rounded: "{rounded.obj}"
    padding: "5px 5px 9px"
---


# Design System: Phantom Workspace

Este documento describe las etapas 1 («Tokens y material: negro, degradado, aro») y 2 («Estados del panel y trazo cometa») de [docs/design-v2.md](docs/design-v2.md), basadas en la dirección visual aprobada por Carlos y los mocks 05/06. Sustituye el material mate, los planos translúcidos y los contornos de estado anteriores. Las etapas 3–5 siguen pendientes: rail/insignias/controles, Configuración/Titi y sesión/dictado. Las restricciones estáticas viven en `test/design-tokens.test.mjs`; los resultados de checks y el cierre pertenecen al controlador. La interfaz usa español.

## Reglas

### Paleta negra y menús (2026-11-16)

- Atención: `--attention #f5c04a`. Lo que te necesita no pinta superficies: el ámbar identifica la etiqueta y el aro exterior del panel, y las marcas compactas existentes del rail, dock y campana. Sin velos ni píldoras ámbar. En la bandeja, los discos de icono son `--fill-2` con el icono en el tono del estado. Ámbar significa intervención requerida; lima `--working #c6f135` significa trabajo real. Ámbar se distingue del verde apagado de éxito `#65ba83` y del rojo de error.
- La misma restricción rige en todos los paneles, incluidos terminal, chat, referencias, Skills y voz, también mediante aliases (`--warning`, `--tone`, `--pc-caution`). Chips y discos usan fondos neutros; los pozos no reciben lavados ni bordes ámbar. La excepción E2 es el aro exterior enmascarado de un panel que te necesita, nunca su superficie. Atención no dibuja contornos SVG, halos ni ondas de fondo. Categorías e iconos decorativos son neutros. Los switches activos son `--on` marfil con indicador `--on-ink` oscuro. Verde significa éxito real (o adiciones en un diff), nunca selección, categoría o acción armada. Acento inicial y fallbacks: marfil `#f2f0eb`; las preferencias personales guardadas y sus migraciones se conservan. Marcas, sprites, ANSI y arte mantienen sus colores originales.

Escalera E1: lienzo `#020203` < pozo `#040405` < base de objeto `#0b0b0c`; relleno interior `#111113`, selección de fila `#1d1d20`. Rail, paneles, inspector, dock y flotantes comparten degradado vertical `#0f0f11` → `#070708`, aro degradado de 1 px y sombra negra de contacto. El pozo es más oscuro que el objeto, no que el lienzo.

Tres tintas reales: `--ink #f2f0eb` (lo elegido y lo que se lee), `--muted #a8a6a0` (opciones y texto secundario, también en chrome), `--ink-3 #8b8983` (etiquetas, pistas, contadores). Marfil para teclas y selección; lima (trabajando), ámbar (te necesita), verde y rojo solo significan estado.

Menús, selects y ventanas emergentes (`src/menus.css`, único dueño, cargado al final): (1) base opaca `--menu: var(--surface)`, imagen `--object-fill` y aro enmascarado `--object-ring`, radio `--r-obj`, relleno 6 px; (2) las opciones descansan en `--muted` sin relleno, filas de 34 px (46–48 px con segunda línea), radio `--r-ctl`; (3) un solo relleno, `--fill-2`, para la fila bajo el puntero o el teclado; (4) el valor actual es `--ink`, peso 500 y su marca (check o punto), nunca un relleno ni un borde; (5) la búsqueda es la primera línea del menú, sin caja ni anillo, separada por una línea de 1 px; títulos de grupo, pistas y contadores en `--ink-3` sin negrita; (6) la acción de cierre (Nuevo espacio, Abrir carpeta) va bajo su propia línea; (7) los `<select>` nativos usan `appearance: base-select` y abren el mismo menú, con el chevrón del disparador en `--ink-3`.

La selección de un panel aclara el mismo aro: blanco al 36 % arriba y 10 % abajo, sin borde, outline ni halo adicional. El foco de teclado de los controles conserva su señal independiente. El aro no intercepta acciones (`pointer-events:none`).

### Formularios de Configuración, Cards y Skills (2026-11-18)

- En estas familias, los campos de texto, textarea y selects de formulario usan `--surface-2`, borde de 1 px `--hairline`, radio `--r-ctl`, padding 8×12 px y altura mínima de 38 px. Texto a la izquierda; cantidades a la derecha. Controles en `--t-control`, comandos/identidades en mono 12/20 y ayudas en `--t-support`. Sin sombra interior.
- Hover cambia el borde a `--muted` solo en controles habilitados y editables. Foco de teclado: contorno de 2 px `--accent`, offset 2 px. Solo lectura mantiene selección/copiar y foco, con tinta `--muted`; disabled usa opacidad .55 y cursor de indisponibilidad, también dentro de fieldsets, sin hover activo.
- Búsquedas y filtros compuestos tienen una sola superficie: la caja exterior recibe borde y foco, el input/select interior es transparente. Las pistas de búsqueda usan el tipo de apoyo de 12 px. A ≤340 px de contenedor, Skills prioriza el texto del buscador sobre su icono decorativo y reduce el inset de filtros a 8 px. Los menús abiertos siguen perteneciendo a `menus.css`.
- Configuración conserva grupos con radio de objeto y extremos redondeados, incluso en Detalles, sin recortar el foco con overflow. Sus filas separan etiqueta y control por 8 px y etiqueta/ayuda por 4 px; los formularios se limitan a 720 px. En compacto apilan campos y conservan scroll y acciones.
- Creación de Card/Skill: columna editable de hasta 640 px, 8 px entre label/campo/ayuda, 16 px entre campos y pares, y 24 px desde el encabezado. Grupos separados con espacio; las acciones envuelven y permanecen dentro del scroll. La misma regla rige en canvas e inspector; `panels.css` deja estos campos a su dueño en `plugins.css`.

Evidencia y límites: `docs/ui-refinement.md`. Estas reglas describen implementación; no acreditan aprobación visual humana.

### Refinamiento aprobado el 2026-11-15

La paleta histórica de carbón queda sustituida por los negros de E1. Marfil `#f2f0eb`, lima `#c6f135` para trabajo, ámbar `#f5c04a` para atención, verde `#65ba83` para éxito y rojo `#f27670` para peligro conservan su semántica. El dock y los iconos descansan neutros. Las marcas y sprites originales conservan sus colores.

El chrome y los paneles son opacos, con degradado vertical neutro, sin blur, aura ni resplandor exterior.
Un aro degradado enmascarado y una sombra negra de contacto separan cada objeto del canvas.
Las teclas activas son marfil con tinta oscura; el color se reserva al estado.
Los tipos de panel comparten tono neutro y se distinguen por glifo y etiqueta.
El acento por defecto es marfil; se conservan las elecciones guardadas y las migraciones existentes.

Tipografía vigente: contenido/sidebar/botones 14 px, estados/metadatos 12 px, título de proyecto 15/20 px; pesos 400/500/600, familia Inter/SF/system existente sin fuentes remotas. El sidebar usa tinta secundaria sin la opacidad adicional .72; el proyecto es su único título, los encabezados son micro sin icono y las filas utilitarias pesan 400. El estado no encoge: los metadatos contiguos se truncan antes que «Pide permiso». Targets 40/44 px y filas 44/56 px permanecen tokenizados.

En el sidebar, la base es `--surface` opaca con `--object-fill`; selección es `--surface-3` con texto `--ink` e icono sólido/acento. Los agentes seleccionados conservan su silueta y reciben acento local. «Te necesitan» es el resumen; «Pide permiso» conserva el significado específico entregado por el modelo. El estado ocupa el inicio de la segunda línea, con texto explícito y punto compacto. El estado ámbar y su etiqueta permanecen al seleccionar. No se derivan nuevos estados ni autorizaciones.

Tokens del sidebar: glifo principal 20 px, secundario 16 px; target de escritorio 40 px y táctil 44 px; fila simple 44 px y de dos líneas 56 px. Ritmo 4/8/12/16 px. Las ventanas bajas conservan estos targets y permiten scroll. Los logos SVG mantienen proporciones y se centran en su disco; los sprites pixelados conservan sus dimensiones enteras. ARIA, foco, teclado y callbacks permanecen en los controles existentes.

Estas reglas y el frontmatter prevalecen sobre las descripciones históricas de materiales, colores, tipografía, teclas claras y rail que aparecen más abajo. Los checks del contrato (diseño, modelos de actividad/sidebar, build y captura `design-capture charcoal-type`) corresponden al controlador. La captura usa el markup actual `rail-session-status` y `rail-session-details`, con estados sintéticos de trabajo, permiso y permiso seleccionado; comprueba tamaño y ausencia de clipping del estado. Las imágenes `design-charcoal-type-*.png` son evidencia únicamente después de ejecutarse el check.

La captura `node test/design-capture.mjs colors-standardized` construye con Vite y `root`/`outDir` absolutos de este worktree, exige que todos los artefactos locales coincidan con la salida generada antes de lanzar Electron, sin depender del cwd de npm ni de una caché de build externa. Registra el hash de HEAD y captura sus CSS, componentes de categorías/tema y preferencias de apariencia como «antes»; después reconstruye los archivos actuales y repite las mismas escenas con otro perfil aislado. Añade ajustes (categorías y switch activo visible) y una escena de atención sintética identificada como tal, con aserciones de superficies y pozos neutros, acción marfil y tintas de estado. Los archivos son `/tmp/opencode/design-colors-standardized-before-*.png` y `/tmp/opencode/design-colors-standardized-*.png`; solo son evidencia después de ejecutar el check. El cierre de Electron y el plazo total están acotados; un fallo interrumpe las capturas y restaura el build actual, sin aceptación visual implícita.

Tres reglas deciden casi todo. Las pruebas de tokens expresan restricciones estáticas de las dos primeras y del material.

1. **Una caja por objeto.** Solo dibuja contorno lo que se puede mover o lo que flota: panel, zona, rail, islas, dock, menús. Dentro de un objeto se separa con espacio, tipografía y un paso de tono; nunca con líneas. Filas, botones de icono y controles de barra descansan sobre nada: la isla es su caja. Un relleno en reposo sobre cada control convierte la isla en una cuadrícula de cajas y está retirado. Como mucho un nivel de relleno interior: el control donde se escribe o se elige (campo del compositor, pista del segmentado, pozo de código o de terminal).
2. **El peso lo da el estado.** Todos los objetos usan `--shadow-chrome`: `--shadow-rest`, `--shadow-float` y las dos elevaciones de trabajo son aliases de esa misma sombra negra. Selección aclara el aro existente; foco de teclado conserva su señal independiente. El trabajo real usa lima; atención ámbar, error rojo y éxito verde. La revisión de la capa SVG de actividad corresponde a E2.
3. **Material común.** Chrome y planos de trabajo comparten base opaca, degradado vertical y aro enmascarado de 1 px. Los pozos son opacos y no transmiten el color de imágenes de fondo. Sin backdrop-filter, aura ni resplandor del material. `--shadow-key`, `--shadow-well` y `--shadow-rim` son `none`. La revisión de movimiento, controles e identidad sigue pendiente en las etapas siguientes.

### Estado de terminal

La fila «ahora» reúne marca cuadrada de 6 px, paso legible a 13 px y antigüedad a 12 px con fecha y fuente en el título; overview conserva su resumen sin hora.
La píldora de trabajo usa una marca cuadrada pixelada; lima `--working` para trabajo y ámbar `--attention` para atención.
La línea actual usa una marca lima trabajando y ámbar al pedir permiso o ceder el turno. Solo trabajo recibe borde superior y lavado lima estático del 7 %; atención conserva el pozo neutro, sin lavado ni anillo. Su etiqueta ámbar descansa sobre `--fill-2`; la acción primaria es marfil.
No hay animación continua: solo `materialize` al cambiar de paso, desactivada con movimiento reducido.

### Tokens (`src/canvas-ui.css`, bloque `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--r-ctl` | 8 px | Controles: botones, campos, filas, pozos interiores |
| `--r-obj` | 24 px | Objetos: paneles, menús, popovers, barras |
| `--r-isle` | 24 px | Islas que flotan: rail, inspector, paleta; dock en píldora |
| `--r-mark` | 4 px | Marcas de menos de 20 px: kbd, casilla, scrollbar. No es una superficie |
| `--r-pill` | 999 px | Chips y estados. No es una superficie |
| `--bg` / `--terminal-bg` | `#020203` / `#040405` | Lienzo negro y terminal |
| `--surface` / `--surface-2` / `--surface-3` | `#0b0b0c` / `#111113` / `#1d1d20` | Base de objeto / campos / selección de fila |
| `--object-top` / `--object-bottom` | `#0f0f11` / `#070708` | Extremos del degradado vertical |
| `--object-fill` | `linear-gradient(var(--object-top), var(--object-bottom))` | Imagen, separada de la base opaca |
| `--object-ring-width` | 1 px | Aro enmascarado; overview compensa el zoom con `--ov` |
| `--object-edge-top` / `--object-edge-bottom` | blanco al 22 % / 6 % | Extremos del aro |
| `--object-ring` | `linear-gradient(var(--object-edge-top), var(--object-edge-bottom))` | Único contorno del objeto |
| `--selected-edge-top` / `--selected-edge-bottom` | blanco al 36 % / 10 % | Selección sobre el mismo recorrido |
| `--hairline` | blanco al 10 % | Divisores y bordes interiores existentes |
| `--shadow-chrome` | `0 1px 2px #000, 0 16px 32px -16px #000` | Sombra negra de contacto común |
| `--shadow-key` / `--shadow-well` / `--shadow-rim` | `none` | Sin relieve de control |
| `--glass-tint` | `#0b0b0c` | Negro independiente del acento |
| `--glass` / `--glass-thick` | ambos `var(--surface)` | Bases opacas |
| `--menu` | `var(--surface)` | Base del mismo material, bajo control de menus.css |
| `--menu-edge` | blanco al 13 % | Compatibilidad; no dibuja otro contorno |
| `--glass-filter` | `none` | Chrome sin blur |
| `--glass-sheen` | `var(--object-fill)` | Degradado vertical neutro |
| `--ink-3` / `--muted` | `#8b8983` / `#a8a6a0`; los menús conservan estos tres niveles también en chrome | Metadatos, texto secundario e iconos en reposo |
| `--ink-on-glass` | `#a8a6a0`; `#b0aea8` con transparencia reducida o contraste aumentado | Tinta secundaria local del chrome |
| `--on` / `--on-ink` | `#f2f0eb` / `#141414` | Tecla activa marfil y su tinta oscura |
| `--workplane` | `var(--surface)` | Base opaca de conversación/terminal |
| `--workplane-wash` | `var(--object-fill)` | Mismo degradado del chrome |
| `--well` | `#040405` | Pozo opaco del chat lateral |
| `--well-raised` | `#0b0b0d` | Campo de escritura opaco |
| `--well-terminal` | `#040405` | Hilo de chat del canvas y salida de terminal opacos |
| `--ease-spring` | `linear(0, .36 12%, .72 25%, .94 40%, 1.05 58%, 1.025 75%, 1)` | Un solo rebote de 5 % y asentamiento |
| `--dur-spring` | 420 ms | Recuperación de controles, segmentado y entrada CSS del chrome |
| `--shadow-rest` / `--shadow-float` | `var(--shadow-chrome)` | Mismo contacto en reposo, selección, arrastre y foco |
| `--shadow-workplane-rest` / `--shadow-workplane-lift` | `var(--shadow-chrome)` | Aliases de compatibilidad para conversaciones y terminales |
| `--action` | `#c6f135` | Acción de estado; alias de `--working` |
| `--working` | `#c6f135` | Trabajo en curso |
| `--attention` | `#f5c04a` | Permiso/pregunta pendientes, turno que necesita al usuario |

`test/design-tokens.test.mjs` restringe radios, sombras, tokens retirados y presupuesto exacto de bordes por hoja. E1 exige los negros nuevos, extremos e interpolación del degradado, aro enmascarado de 1 px sin doble contorno, sombra común, pozos opacos y ausencia de backdrop-filter. E2 permite solo cometa de trabajo, realce finito y aro exterior ámbar de atención; mantiene el rastreo transitivo de aliases. Conserva AA de 4,5:1 para texto y 3:1 para el indicador, incluidas escritura, imagen blanca y teclas. Conserva las restricciones de altura del compositor, preferencias, ANSI, actividad y tokens retirados indicadas en `docs/design-v2.md`; las revisiones E3–E5 siguen pendientes. Las aserciones estáticas no acreditan una captura ni aceptación visual.

Sin pestañas laterales de color para categorías: el tipo se lee en glifo y etiqueta. Skills usa libro; `ShellIcons.jsx` exporta `BookIcon` y lo asocia a `phantom-skills`.

Presupuesto E1 con el mismo algoritmo `drawnEdges` (declaraciones `border`, incluidos divisores y bordes transparentes; máscaras no cuentan):

| Hoja | Antes → E1 | Delta y motivo |
|---|---|---|
| `canvas-ui.css` | 20 → 7 | −13: dos reglas comunes de islas, `.canvas-node`, `.zone-selection/.group-selection`, `.tw-palette/.tw-voice/.app-dialog`, `.agent-editor`, rail expandido y contraído, `.workspace-identity/.header-controls`, `.focus-return`, `.inspector-host`, cabecera responsive y `.activity-dock`; sus bordes pasan al aro único |
| `chat.css` | 13 → 10 | −3: `.pc-agent-menu`, `.pc-models`, `.pc-effort-menu`; aro común de menú |
| `sidebar.css` | 1 → 0 | `.context-menu-panel`; aro común |
| `phantom-chat.css` | 1 → 0 | `.phantom-chat`; aro común |
| `menus.css` | 1 → 0 | `::picker(select)`; aro enmascarado |
| `studio.css` / `terminal.css` | 7 / 1 → 7 / 1 | Sin delta |

Shell y settings conservan cero declaraciones contadas. Los demás recuentos permanecen en `test/design-budget.json`, sin margen para etapas futuras. El borde de `.interface-scale select` sigue incluido en studio como borde funcional de formulario.

## Arquitectura de información

Dirección aprobada por Carlos el 2026-11-14 («que todo se sienta fácil», referencia One UI y Apple). Mocks en `.impeccable/mocks/dx/`.

**Una línea por estado, una acción por fila.** Cada fila lleva un título humano (el nombre de la sesión, nunca un UUID), una palabra de estado, una línea de detalle y como mucho una acción principal. Lo técnico (rutas, identificadores, JSON, salida cruda) vive detrás de un `<details>` llamado «Detalles». La interfaz no explica lo que no hace.

**Ramas.** Filtro por estado con contadores y grupo «Ya en main» plegable con su limpieza. Las acciones en lote viven en la cabecera de su grupo; los avisos ok son efímeros (6 s). En estrecho, el chip baja bajo el texto y la acción permanece a la derecha.

**Cinco destinos, no veinticinco paneles.** El dock separa crear (Terminal, Navegador, Nota, Zona) de ir (Trabajo, Git, Servicios, Contexto, Automatizar). Cada destino es un panel con pestañas (`src/hooks/hubs.mjs`); los tipos de panel anteriores siguen siendo válidos para lienzos guardados y abren su destino en la pestaña correspondiente.

| Destino | Pestañas |
|---|---|
| Trabajo | Tareas · Borradores · Misiones |
| Git | Ramas · Historial · Cola |
| Entorno | Este proyecto · Docker · Todos los proyectos |
| Contexto | Documentos y memoria · Skills |
| Automatizar | Secuencias · Navegador · Código |

«Este proyecto» es el tablero del entorno (`Environment.jsx`): abre con una línea de estado, el porqué y un botón principal; después Cómo arrancar (scripts de `package.json`, también de la copia propia de la sesión), Procesos vivos (absorbe la antigua pestaña Procesos; el tipo `processes` abre esta pestaña), Puertos y sitios (salud real con `probe`, cada 15 s), Preparación de las copias de sesión (con Reintentar) y Pruebas de integración. Lo técnico va plegado en «Detalles».

`App.jsx` reutiliza el panel existente de cada destino al abrirlo. `ToolPanels.jsx` recuerda la pestaña elegida en localStorage (`phantom.hub.${type}`, por tipo de destino); una petición explícita de pestaña prevalece sobre ese recuerdo. Las aperturas dirigidas a una tarea (`cardId`), referencia (`ref`) o panel (`focusNodeId`) conservan su destino dedicado en lugar de convertirse en un panel unificado.

**Una bandeja.** Rail y campana abren «Te necesitan», con vistas Pendientes, En curso y Hoy. Pendientes separa «Decide ahora» (permisos, preguntas, tareas o sesiones bloqueadas y problemas de integración) de «Cuando puedas» (ramas listas, cambios sin guardar en la base y cola sin nadie integrando). El contador compartido solo cuenta «Decide ahora»; el modelo evita repetir la misma sesión entre fuentes cuando ya está representada. Una sola pendiente queda abierta a la vez, inicialmente la primera: muestra el tiempo de espera, un extracto de lo último que dijo el agente y permite responder en la fila cuando la terminal espera texto. Los permisos de chat muestran el comando completo y se aprueban o rechazan en la fila; las preguntas ofrecen sus opciones o llevan al chat/sesión. Los permisos de terminal se resuelven en la sesión. La bandeja usa una columna, sin «Tu plan»; los límites viven en Configuración. El control del dock añade la pendiente más urgente y su antigüedad. Las demás acciones abren la tarea, sesión, Git o el orquestador; abrir la bandeja no resuelve pendientes. Sin conexión se indica el estado y se desactivan las respuestas; una fuente fallida muestra aviso y Reintentar.

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

## Material y planos · Etapa 1

- **Bases opacas.** Lienzo `#020203`, pozo `#040405`, objeto `#0b0b0c`, relleno interior `#111113`, selección de fila `#1d1d20`. Studio y canvas declaran la misma paleta. El fallback de xterm usa `#040405`, conservando cursor, selección, preferencias y ANSI.
- **Objeto común.** Rail, paneles, inspector, dock y flotantes usan `--object-fill`: degradado vertical `#0f0f11` → `#070708` sobre base opaca. `--glass`, `--glass-thick`, `--workplane` y `--menu` son aliases de `--surface`; `--glass-sheen` y `--workplane-wash` son aliases de la imagen. No se asigna una imagen a `background-color`. Radio exterior 24 px; dock conserva píldora. Cabeceras y `.node-body` transparentes dejan ver el material.
- **Aro único.** Pseudo-elemento `::before`, absoluto, `inset:0`, radio heredado, padding de 1 px, z-index 3 y `pointer-events:none`. Fondo `linear-gradient(var(--object-edge-top), var(--object-edge-bottom))`, blanco al 22 % arriba y 6 % abajo. Máscara `linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)`, `-webkit-mask-composite:xor; mask-composite:exclude`. Sustituye el borde exterior; no se añade outline de selección. Los elementos interiores del dock no duplican su aro. Los menús son propiedad de `src/menus.css` y restablecen el aro neutro aunque se abran dentro de un panel seleccionado.
- **Selección y foco.** El panel seleccionado aclara el mismo aro a 36 %/10 %, sin aumentar su grosor ni añadir halo. Overview conserva la compensación de zoom semántico. Las acciones y sus focos siguen operativos; el centro transparente de la máscara no cubre texto ni controles. Seleccionar un panel no atenúa ni filtra la lectura de sus vecinos.
- **Contacto.** `0 1px 2px #000, 0 16px 32px -16px #000` para todos los objetos, incluidos reposo, selección, arrastre y foco. Sin backdrop-filter, aura ni resplandor del material. Las elevaciones anteriores son aliases y los tokens de relieve de control son `none`.
- **Pozos.** Hilo lateral, hilo del canvas y salida de terminal: `#040405` opaco. Escritura: `#0b0b0d` opaco. Una imagen blanca detrás no penetra en la lectura. El canvas permanece transparente sobre la base/arte ambiental permitido entre objetos. La reorganización interior de sesión y compositor corresponde a E5.
- **Tintas y controles.** Se conservan `--ink #f2f0eb`, `--muted #a8a6a0`, `--ink-3 #8b8983`, estados y acentos guardados. En E1, `--on` sigue siendo `#f2f0eb` y `--on-ink #141414`; la revisión completa de controles/marfil de la regla 5 queda en E3. Selección de rail usa `--surface-3`. Menús conservan tinta, peso y marca del valor actual, con relleno solo en hover/teclado.
- **Accesibilidad.** Se mantienen `prefers-reduced-transparency: reduce` y `prefers-contrast: more`: bases y pozos opacos, sin filtro, tinta secundaria de chrome `#b0aea8`. Contraste aumentado eleva el aro a 32 %/12 % (seleccionado 44 %/20 %) y hairline a 22 %. Transparencia reducida oculta la atmósfera `::before`; el arte `::after` conserva su control de personaje. Los umbrales siguen en 4,5:1 para texto y 3:1 para indicadores.
- **Tipografía.** `--sans` Inter → SF Pro → sistema, sin descargas remotas; `--mono` para código, rutas y medidas. Display 24/30·600, Título 15/20·600, Headline 14/22·600, Lectura 14/22·400, Control 14/20·500, Apoyo 12/16·400 y Micro 12/16·500. La revisión interior de lectura 14/20 queda en E5.
- **Atmósfera.** Se conservan Marea, Brasa, Grafito e imagen propia; Gengar/Aurora antiguos migran a Grafito sin gradientes violetas por defecto. Los degradados opcionales se localizan arriba a la derecha (82 % × 80 %) y abajo a la izquierda (64 % × 64 %), sin repetición. La imagen propia usa `cover` centrado. Ambiente y personaje tienen intensidades independientes. «Mostrar Gengar» controla la presencia de personaje, incluidos sprites del chrome y estados vacíos, además del arte ambiental local (`assets/gengar-source.md`). En un canvas vacío se suprime la imagen de fondo del personaje para no duplicar la mascota. La atmósfera permanece inmóvil incluso con una preferencia de pulso guardada.

## Iconos

`src/components/ShellIcons.jsx` define geometría propia sobre retícula de 24 px, con variante de línea (`strokeWidth=1.75`, extremos y uniones redondos) y silueta sólida monocroma con vaciados `evenodd`. El tamaño predeterminado es 20 px. Incluye terminal, chat, nota, sitio, imagen, zona, selección, mano, minimapa, encuadrar, actividad, recursos, mapa, plugins, comandos, libro, tareas, Git y herramientas del shell. `SHELL_ICONS` asigna tipos; `SHELL_LINE_ICONS` y `SHELL_SOLID_ICONS` permiten elección explícita.

La variante automática pasa a sólida con `.active`, `aria-pressed`, `aria-current`, `aria-expanded` o fila seleccionada. `variant="line"` fuerza línea y `active` fuerza sólido. La tinta activa es `--on-ink`. Rail y dock usan tecla clara con radio de control; navegación con estos iconos usa botones circulares de 32×32 px. El glifo de cabecera de un panel seleccionado/enfocado también recibe tecla clara y silueta sólida. Son señales de estado, no mosaicos decorativos permanentes.

Lucide continúa en controles auxiliares: 14 px/trazo 2, 16 px/trazo 1,75 y 20 px/trazo 1,5; las cabeceras de herramientas conservan ajustes de 18 px. Los SVG decorativos son `aria-hidden`; el nombre accesible lo aporta el control.

## Lienzo y chrome

El material de todos los elementos de esta sección es el de E1 descrito arriba; sus dimensiones y composición siguen siendo las previas a E3/E4. Las referencias históricas siguientes a sheen ausente, menú plano o `--shadow-rim` quedan sustituidas por el degradado, aro único y tokens de relieve `none`.

- El canvas va de borde a borde; el chrome son objetos apoyados sobre él con un único hueco `--gutter` de 16 px. En foco, la región se posiciona de forma absoluta: los insets del rail e inspector reducen su ancho disponible, sin desplazar un plano de ancho completo fuera del viewport. La prueba de escritorio exige que región y panel enfocado permanezcan dentro de sus límites.
- **Rail:** 252 px, radio `--r-isle`, `--surface` opaco sin sheen, alto según contenido; contraído es una píldora de 48 px. `src/sidebar.css` es el único dueño de lo que hay dentro: filas simples de 44 px y sesiones de 56 px, radio `--r-obj` e inset común de 12 px. Las filas no tienen relleno en reposo; hover y selección usan `--fill-2`, selección con tinta `--ink` y glifo/acento local. Lo abierto usa `--fill-3` con `--shadow-rim`. Una sesión que te necesita conserva punto ámbar, etiqueta explícita («Pide permiso» cuando corresponde) y título en 600, sin aro ni tinte de todos los metadatos; el resumen «Te necesitan» usa texto en `--ink`, icono y contador numeral en ámbar, sin velo ni contorno ámbar. «Ver todo el mapa» es la vista de reposo y nunca se vuelve tecla. Proyecto y Espacio no son campos de formulario: el proyecto es el título del rail (disco con sus iniciales en el acento del proyecto y nombre en Título, con el caret visible solo al pasar o abrir) y el espacio es un chip de 28 px en píldora bajo el nombre, con objetivo táctil de 40 px. ProjectMark usa el acento de cada proyecto: fondo teñido al 22 % sobre `--surface-2`, tinta al 86 % con blanco y anillo interior al 34 %, también en las filas del menú y el rail contraído; mide 36 px en el título y 28 px en filas y contraído. Las etiquetas «Proyecto» y «Espacio» quedan solo para lectores de pantalla. Sus menús son un plano sólido `--menu` sin brillo, más oscuro que el rail, con hover `--fill` y selección `--fill-2`. Las utilidades (Sitios, Plugins, Comandos, Dictado) son una fila de cuatro toggles redondos de 44 px nombrados por tooltip, no cuatro filas más: la lista conserva la altura para las sesiones.
- **Controles del shell:** `src/shell.css` es el único dueño del aspecto de la fila superior, la navegación y el dock. Las islas de 48 px son píldoras (`--r-isle`); sus controles son círculos de 32 px sin relleno en reposo, con hover `--fill-2` y estado activo `--on`. Los grupos se separan con 8 px de aire, sin reglas verticales. Menús y bandejas flotantes comparten `--r-isle`. **Jerarquía:** (1) `--on` marfil para la herramienta activa en navegación; el rail resuelve su selección neutra en `sidebar.css`; (2) velo `--fill-3` con borde fino `--shadow-rim` para lo abierto o encendido (bandeja, Sitios, minimapa, menús, Phantom, inspector); (3) nada en reposo. Dock e iconos descansan neutros; los tipos de panel comparten `--c-lilac` neutro. **Estado en el rail:** punto compacto y etiqueta lima si trabaja o ámbar si te necesita, sin anillos de agente; el permiso conserva su color al seleccionar. El aviso pendiente de la campana es un punto ámbar. `--shadow-rim` (`inset 0 0 0 1px #ffffff0a`) es el borde de cápsulas dentro de una isla: chip de espacio, búsqueda, teselas y estados encendidos.
- **Fila superior:** título y controles son dos islas de 48 px (`--bar`); entre ellas hay canvas. `--top-clear` es la primera línea libre.
- **Inspector:** contrapeso del rail, 360 px, cuelga bajo los controles.
- **Franja inferior:** el área de paneles (`.canvas-stage`) termina 148 px antes del borde inferior en mapa y 88 px en foco. Navegación, minimapa y creación quedan fuera de su recorte: ninguna cámara puede colocar contenido interactivo bajo esas islas. La franja conserva la atmósfera, sin caja ni borde adicional.
- **Dock:** una sola fila de `--dock-h` (56 px): lecturas de actividad a la izquierda y creación a la derecha, en el mismo objeto. Crear son discos de 36 px, solo icono (el nombre queda para lectores de pantalla y tooltip), con relleno neutro `--fill-2`, tinta `--ink` y `--shadow-rim`; hover usa `--fill-3` y activo sigue siendo `--on` con `--on-ink`. En mapa comparte columna con navegación (48 px encima, separadas 12 px); el minimapa ocupa una columna independiente de 190 px. En foco el dock se centra y el panel termina 16 px antes de la franja. Con Phantom o el inspector abiertos por debajo de 1700 px, el minimapa cede su columna y las lecturas y la búsqueda se pliegan a su glifo: la fila conserva su centro en vez de desplazarse.

`src/panels.css` es el dueño del aspecto de los paneles de herramientas (`tw-*` dentro de `.canvas-node`), Skills, barra del navegador y nota.
- **Retícula:** `radial-gradient(var(--dot) 1px, transparent 1.2px)`, tinta `#f2f0eb` al 5 %, paso base 24 × 24 px; sin retícula mayor superpuesta. Conserva el anclaje al espacio-mundo y duplica el paso por debajo de 14 px. El viewport no se desplaza: solo la cámara.
- **Ritmo:** múltiplos de 4 px (`--s-1`…`--s-6`).

## Card de chat y terminal

El hilo y la terminal nunca se desplazan en horizontal; los bloques de código conservan su propio scroll.

La card es la caja. Dentro no hay líneas:

- **Cabecera** (44 px): mismo tono que la card, sin costura. Glifo del tipo, título de 14 px/peso 600 y tres acciones redondas de 30 px sin relleno, atenuadas en reposo y plenas con hover, selección o foco; cerrar se tiñe de rojo al pasar.
- **Identidad:** selector de agente y carpeta en una fila, sin fondo propio.
- **Hilo:** a sangre, sobre pozo denso translúcido sin blur, en Lectura (14/22), sin pulsos decorativos en el contenido. Turnos separados por 28 px (32 px en foco y 20 px en Phantom), mensajes propios un paso de tono, columna de hasta 780 px. La respuesta no lleva avatar ni cabecera: modelo, hora y costo se dicen una vez al pie, en Apoyo y `--ink-3`, junto a Copiar.
- **Acciones:** cada llamada es una línea sin caja: glifo de 14 px, etiqueta y destino en Apoyo. Conserva el estado accesible y el indicador discreto de main; solo los estados en curso, fallidos o detenidos añaden texto. Solo las escrituras suben el glifo a tinta plena. Cuatro o más acciones seguidas se pliegan en una frase de lo hecho, abierta mientras trabaja. Subagentes, código y salidas siguen siendo pozos de un tono con `--r-ctl`. Las guías de 1 px de razonamiento y pasos anidados indican anidamiento, no contienen.
- **Segmentado** Claude · OpenCode · Codex · Terminal: pista `--fill` con pozo; indicador activo `--on`, tinta `--on-ink` y contacto `--shadow-key`. La identidad del proveedor no tiñe la tecla activa.
- **Compositor:** continúa el plano de lectura de borde a borde (`.pc-composer::before` con `--well-terminal`): no hay una segunda banda de tono bajo el hilo. El campo es el único objeto: `--well-raised`, radio `--r-isle` y borde fino `--shadow-rim`. Foco usa acento del proyecto y anillo estático de 3 px, independiente del trazo de actividad. Modelo, Effort y permisos son una familia de píldoras de 30 px sin relleno en reposo; el permiso activo lleva velo y borde fino. Sus menús se abren siempre en el mismo sitio, sobre el borde izquierdo del campo y con el mismo ancho (320 px), en un plano mate; el valor vigente es un velo con su marca, no una tecla clara. Debajo, sin fondo: contexto, costo y pista de teclado; metadatos y controles envuelven en ancho reducido.
- **Tamaño compartido:** `ChatCard` y `PhantomChat` usan `useComposerSize`. Altura inicial mínima de 38 px, una fila, mismo padding incluso en foco. El máximo es el menor entre el 45 % del alto del contenedor y el espacio libre tras cabeceras, avisos, controles, metadatos y reserva de hilo (hasta 96 px o 20 % del alto). Se recalcula al escribir, borrar, enviar y cambiar ancho/alto o controles; `ResizeObserver` y observación de contenido conservan el límite sin depender del zoom del canvas. Al llegar al máximo, el texto tiene scroll interno y los controles permanecen fuera de ese scroll. No se anima la altura al teclear.
- **Chat lateral:** losa `--workplane` más lavado diagonal, hilo `--well` y campo `--well-raised`, sin backdrop-filter. Cabecera y selector no añaden costuras interiores. Los controles pueden envolver en anchos estrechos; sus menús flotantes usan planos mate.
- **Plugins, Skills y Repository:** título de herramienta 15 px/600, icono de cabecera 18 px; títulos de sección y etiquetas en caja natural, 12 px/600 y tono secundario; cuerpo 13 px; glifos Lucide con trazo 1,75. Sin contornos interiores redundantes en cabeceras, segmentados y pozos; se conservan estados, contenido, foco y rutas de navegación.
- **Terminal:** el pozo de salida se distingue por tono. Su borde superior es transparente y solo se colorea lima trabajando; atención permanece como marca y etiqueta sobre plano neutro.
- **Preguntas y permisos pendientes** sí llevan borde de color: es estado. Resueltos, lo pierden.
- **Zoom semántico:** por debajo del 45 % la card es una ficha (título, estado, tres líneas de salida); por debajo del 25 %, título y estado.

## Panel de Phantom

Isla a la derecha, espejo geométrico del rail: `--r-isle`, hueco `--gutter`, losa `--workplane` y lavado diagonal, con sombra `--shadow-workplane-rest` (elevada en drawer). No tiene backdrop-filter. El espacio de trabajo cede su ancho. Cabecera de 56 px sin costura, «Phantom» en Título y contexto en Apoyo; ámbar si necesita al usuario. Conserva Chat y Orquestador, cola de incorporaciones y conversión de texto dictado en tarea. El agente que responde es un menú compacto dentro del compositor, junto al modelo; los permisos viven bajo el campo. Enviar usa tecla clara y tinta oscura. Las sugerencias de una conversación nueva son filas con glifo, sin borde.

## Estados y «Bordes vivos»

- **Jerarquía E2.** Solo «Te necesita» colorea el aro de 1 px: `--attention-ring`, ámbar al 80 %, sin relleno ni resplandor. Trabajo conserva aro neutro y cometa lima. «Terminó», «Error» y «En reposo» conservan aro neutro. Las cinco palabras permanecen en la cabecera; trabajo, fin y reposo usan `--muted`, atención `--attention` y error `--danger`.
- **Selección.** Aclara el mismo aro (blanco 36 % arriba, 10 % abajo), sin outline ni doble contorno. Atención prevalece y mantiene `aria-current`. Los vecinos conservan lectura y luminosidad. Foco oculta vecinos; no cambia la geometría persistida.
- **Cometa A.** `ActivityTrace.jsx` se monta únicamente trabajando: cinco rectángulos SVG, `pathLength="100"`, inset x/y de 0,75 px, ancho/alto 100 % − 1,5 px y rx/ry de 23,25 px (ajustados al radio del zoom semántico). Trazo de 1,5 px, sin relleno ni filtro, z-index 4 sobre el aro de z-index 3. Longitudes cola→cabeza: 26, 18, 11, 6 y 2,5 px; opacidades .06, .14, .28, .55 y 1. Cada capa usa `stroke-dasharray:var(--L) calc(100px - var(--L))`, offset de `var(--L)` a `calc(var(--L) - 100px)` en 5,6 s, continuo lineal. Solo la cabeza usa extremos redondos y `--working-head:#e2ff7a`; cola `--working`.
- **Fuente y precedencia.** `terminalBorderState.mjs` y los estados canónicos permanecen intactos. Un `pulse-turn` de terminal que solicita respuesta es atención; la respuesta de chat meramente no leída se presenta como «Terminó», aunque conserve su pulso canónico. Permiso/pregunta pendiente prevalece sobre trabajo. Error de chat/encargo se presenta como error, nunca éxito; terminar un proceso revoca trabajo o permisos antiguos.
- **Suspensión.** IntersectionObserver y visibilidad del documento pausan la cometa; Concentración conserva su fase sin movimiento. Al pasar a reposo se desmonta. Movimiento reducido deja cometa quieta y palabra legible, sin flash ni fundido de sustitución. Canvas ya no monta `PixelField`: no hay ondas ni halos exteriores. El motor y su mapa de señales permanecen disponibles sin refactorización.
- **Mapa y foco.** «Ver en el mapa» selecciona y realza el mismo recorrido del aro durante 900 ms (opacidad 0→1 al 18 %→0), sin escala; atención conserva ámbar y texto. Maximizar/doble clic y retorno/Esc hacen FLIP desde el rectángulo real, 320 ms con `cubic-bezier(.22,1,.36,1)`; cancelan ante cambio de destino o desmontaje. Movimiento reducido aplica destino directo. Retorno restaura foco y selección, respeta menús/edición/dictado y no roba teclas a xterm. La oclusión del navegador nativo se mantiene durante la transición.
- **Presupuesto E2.** No se añaden declaraciones `border`: canvas 7, terminal 1 y activity-trace 0. `test/design-budget.json` conserva exactamente el presupuesto E1; el realce usa una máscara coincidente, no un segundo aro desplazado.

## Notch

`ActivityNotch.jsx` muestra el estado del proyecto junto a integraciones, límites y avisos. Conserva el conteo ante lecturas antiguas o fallidas y añade «desactualizado» con la causa. El texto principal es «Host desconectado», «Recuperando actividad…», el número que necesita al usuario, «En curso» o «Actividad». Abrir el notch muestra la bandeja de pendientes; no resuelve nada. El ámbar distingue atención y el texto acompaña siempre al sprite o a su glifo de respaldo.

El notch usa texto en `--ink` y una marca ámbar en el punto o glifo, sin anillo ni tinte ámbar de superficie; hover y apertura usan relleno neutro `--fill-2`.

`activityMood` prioriza `asleep` (host desconectado), `unsure` (fuente no fresca), `grin` (necesita al usuario), `working` (trabajo real) y `calm` (reposo). `PhantomFace` mantiene su API pero renderiza `assets/gengar-icon.png` a 40×30 px, con `image-rendering: pixelated`: no cambia ojos ni sonrisa mediante SVG. `asleep` usa gris y opacidad .5; `unsure`, .7; `grin` conserva los colores originales y un pulso de opacidad 1–.7 cada 2,4 s, sin contorno ámbar; `working`, salto vertical de 2 px cada 1,2 s con `steps(2, end)`. `calm` queda estático. «Mostrar Gengar» desactivado sustituye el sprite del notch por `CircleDot` y el del rail por su respaldo.

## Movimiento

`--ease-out` conserva la respuesta de color (`--dur-fast` 140 ms) y las transiciones generales (`--dur` 240 ms). `--ease-spring`, `linear()` con rebote de 5 %, y `--dur-spring` 420 ms gobiernan recuperación al soltar, indicador segmentado y entradas CSS. Los controles se hunden a escala .96 (.97 en filas anchas), sin cambiar layout. `materialize` anima opacidad 0→1 y `translate: 0 4px`→`0 0`, sin blur ni escala. Movimiento reducido lo sustituye por fundido de 60 ms y elimina escala/resorte de controles.

`Presence.jsx` conserva las entradas/salidas de otras superficies (200/120 ms); los paneles no compiten con FLIP al entrar y salen con opacidad durante 160 ms, sin blur ni escala. Con movimiento reducido, Presence aplica duración 0 ms. Los overlays salientes conservan `inert`. El paneo conserva su inercia.

Ambiente y luces permanecen estáticos incluso con «Pulso ambiental» guardado. Concentración atenúa ambiente/personaje al 12 %, oculta retícula y campo de ondas, y detiene animación CSS decorativa. `useSpriteMotion` autoriza movimiento de identidad solo con intersección, visibilidad CSS efectiva, documento visible, ausencia de ancestro inert, movimiento permitido y Concentración desactivada. Observa intersección, ancestros, visibilidad del documento y cambios de preferencia; el sprite de estado queda estático al suspenderse. El GIF no se pausa con CSS: `GengarMascot` sustituye su fuente por PNG cuando se suspende.

**Salvedad de implementación:** el estado vacío visible carga `gengar-idle.gif` sin exigir trabajo real. Por tanto, el código integrado aún permite movimiento continuo en ese reposo; no se declara cumplido el requisito de quietud total. Esta entrega documental describe la discrepancia, cuya resolución corresponde a la integración de código.

El dictado comparte `VoiceActivity` en terminal, captura global, Voz e intención y todos los compositores. Su momento focal es un orbe de 40 px, con escala y desplazamiento procedentes del analizador de audio y transición de 100 ms. Gira lentamente en compositor mientras hay nivel real, sin simular escucha en silencio. El permiso pendiente mantiene el orbe neutro quieto y la etiqueta de estado ámbar, sin aura; al transcribir el micrófono se apaga y el orbe queda pequeño y neutro con un pulso de opacidad. El texto «Te escucho…» acompaña una transcripción de 15 px, con palabras confirmadas en tinta y parciales en muted con fundido suave. Durante la escucha el aura de la superficie conserva su anillo espectral y una luz interior amplia y suave cuya opacidad respira con el nivel real, sin filtros ni backdrop-filter. Movimiento reducido elimina giro, escala reactiva, transiciones y pulsos, conserva nivel en opacidad y estados escritos. No se anima el tamaño del compositor. La captura global usa un objeto flotante opaco con sombra del sistema, destino explícito y foco protegido; terminal requiere revisión e inserción literal sin Enter.

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

Las filas de proyectos y paneles truncan nombres largos conservando etiquetas y rutas accesibles. La selección usa velo neutro y `aria-current`, con acento local en el glifo del panel. El acceso independiente a foco aparece por hover, foco de teclado, estado pulsado o dispositivo sin hover. Arriba/abajo e Inicio/Fin desplazan foco y revelan destino sin activarlo; Enter/Espacio activan, Tab conserva el recorrido nativo. Carpetas y utilidades no añaden contornos de fila. Conexión conserva texto junto a su punto de estado.

El drawer retiene Tab/Shift+Tab, empieza en cerrar, cierra con Escape o scrim y restaura el foco de apertura salvo navegación explícita. Cerrado es inert; abierto vuelve inert el workspace y bloquea entrada PTY/oculta navegador nativo mediante la política de overlays existente. El rail de escritorio reserva ancho e insets. Mientras un control del rail tiene foco, el canvas bloquea la apropiación automática de entrada por la terminal; al salir del rail libera esa propiedad y un clic en terminal puede recuperarla.

El foco de teclado usa contorno de acento de 2 px, con ajustes locales; en el rail el offset es −2 px para no recortarlo. La nota usa el caret sin segundo contorno interior. xterm conserva la propiedad del cursor y de la entrada, sin contorno genérico en su textarea auxiliar. El campo del compositor enfoca con borde de acento al 58 % y halo de 3 px al 13 % sobre `--shadow-rim`. Al dictar pasa a `--working` y su halo crece de 2 a 5 px con `--voice-level`, mientras el aura de la superficie es un filo de 1.5 px que gira cada 6 s. Los selects nativos comparten un chevron `--muted` y transición `--dur-fast`.

### Configuración, Apariencia y persistencia local

`Settings.jsx` reúne la configuración en una hoja flotante centrada no modal, sin desplazar el canvas, el dock ni el minimapa. Se cierra con su botón X o con Escape. El botón del rail y la acción `settings` de la paleta abren Configuración; la ruta `appearance` abre su categoría Apariencia y la ruta anterior `plugins` abre Conexiones (`Inspector.jsx`). En ancho reducido se muestra primero la lista de categorías y luego su contenido, con regreso a Configuración. `ToolPanels.jsx` también admite el tipo de panel `settings`: carga los ajustes con `state.get` si no recibe el estado; Apariencia solo aparece cuando recibe sus controles, disponibles en el inspector de `App.jsx`.

| Categoría | Contenido implementado |
|---|---|
| Agentes | «Proveedores»: una fila por proveedor detectado (Claude Code, OpenCode, Codex) con estado real de sesión, interruptor de habilitar (Claude no se deshabilita si es el único) y motivo si no está disponible, con «Detectar» y reintento. «Motor por área» (Chats, Encargos, Tareas, Juez): agente y modelo solo entre proveedores habilitados; el agente por defecto y el modelo de tareas viven aquí. Shell de sesiones nuevas; activación de tareas y memoria de Phantom por proyecto, ejecutable y carpeta de datos |
| Git e integración | Integración automática y comando de pruebas antes de integrar, por proyecto |
| Apariencia | Fondo, acento, escala de interfaz, ambiente, personaje, concentración y retícula |
| Voz | Proveedor, modelo, URL de API, comando local y salida del motor; comando para instalar o actualizar el motor local |
| Teléfono | `MobileSettings` y `AndroidGatewaySettings` usan grupos y filas como el resto de Configuración, con estado, conexión, vinculación y permisos por dispositivo |
| Conexiones | Bitácora de videos desde Markdown y su apertura; Convenciones cuando su fuente está lista, por proyecto |
| Datos y respaldo | Exportación con historial opcional, selección y confirmación de importación JSON, carpeta de datos |
| Avanzado | Cerrar solo la ventana o detener todo y salir, con confirmación si hay actividad; versión y detalles del equipo |

Los campos de texto se editan como borradores con Guardar y Descartar; los selectores e interruptores guardan al cambiar. Shell y voz usan `settings.update`; los proveedores habilitados y los motores por área se guardan en `settings.providers` y `settings.executionDefaults` (contrato en `docs/provider-engines.md`); la preferencia de card nueva sigue en localStorage como `phantom.cardMode`. La configuración de Phantom actualiza valores propios del proyecto con `plugins.update` cuando ya existen y usa los ajustes generales para los demás. Conexiones usa `plugins.update` y Git `merge.configure`, ambos con el proyecto explícito; Git y Conexiones piden abrir un proyecto si falta. Los fallos de carga y guardado conservan mensajes visibles. Estas rutas de persistencia son distintas de las preferencias locales de Apariencia descritas a continuación.

Las opciones de fondo de Apariencia usan CSS y assets locales, con previsualizaciones ilustrativas. Selección con check y `aria-pressed`; acentos Azul, Naranja, Verde, Rojo y Marfil. «Intensidad ambiental» y «Presencia de Gengar» tienen salida numérica independiente; «Mostrar Gengar», «Pulso ambiental», «Concentración» y retícula son checkboxes etiquetados. Restablecer devuelve Grafito/Marfil/retícula ON/ambiente 55 %/personaje OFF al 55 %/pulso OFF/concentración OFF/sin imagen.

Las muestras seleccionadas llevan contorno sólido exterior de 2 px separado 3 px, sin halo: en acentos rodea el disco de 28 px con su propio color y deja la etiqueta en `--ink`, sin relleno de fila; en fondos usa `--accent`. Hover de acento usa `--fill-2`; el check usa `--on-ink` sobre la muestra y la etiqueta usa Micro.

Las preferencias se guardan sincrónicamente en localStorage bajo `phantom:studio:${workspaceId || 'default'}`, por proyecto y perfil local. Cambiar proyecto carga sus preferencias sin copiarlas del anterior. La versión 4 migra Lilac/Iris/Cyan a Azul, Mint a Verde, Amber a Naranja y Rose a Rojo; fondos retirados Gengar/Aurora pasan a Grafito. Conserva imágenes válidas, booleanos explícitos del personaje, intensidades y campos desconocidos. Sin elección explícita, el personaje queda OFF. La normalización es idempotente; la lectura no sobrescribe el original y el siguiente cambio guarda v4. JSON inválido recupera defaults; claves, booleanos, intensidades finitas 0–100 e imagen se validan. Un fallo al escribir notifica y no aplica el cambio. Es almacenamiento local, no sincronización cloud.

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

`npm test` incluye las restricciones de tokens/materiales y las pruebas de preferencias importadas por `test/design-tokens.test.mjs`. Estas últimas cubren normalización, migración, validación, conservación de preferencias y claves por proyecto. Las comprobaciones estáticas de contraste cubren planos opacos, pozos translúcidos incluso sobre blanco, teclas activas y chrome con los cinco acentos sobre atmósferas CSS existentes. Las imágenes personales son contenido de ejecución; no se infiere contraste universal del chrome sobre ellas.

Las herramientas de captura y scripts de escritorio son evidencia complementaria solo si se ejecutan y revisan sus resultados:

- `node test/design-capture.mjs <etiqueta>`, tras build: capturas `/tmp/opencode/design-<etiqueta>-*.png`.
- `node test/solid-workplanes-desktop.mjs`: materiales calculados, elevaciones, texto de vecinos, foco y controles en conversaciones/terminales; su nombre no convierte en opacos los nuevos planos.
- `node test/spectral-ui.mjs`: estados, mapa/selección/foco, acciones IPC sintéticas, hit-testing, separación de chrome y preferencias de accesibilidad; capturas `/tmp/opencode/spectral-ui-*`.
- `node test/unified-design-desktop.mjs`: compositores, preferencias, Gengar, concentración, movimiento reducido y errores del renderer; capturas `/tmp/opencode/unified-design-*`.
- `node test/empty-states-desktop.mjs`, `node test/sidebar-floating.mjs`, `node test/canvas-controls.mjs` y `node test/desktop-motion.mjs`: geometría de vacíos, navegación/foco, propiedad PTY y ciclo de movimiento.

La integración debe distinguir la cobertura de estos scripts de la validación efectiva del material actual. La quietud del GIF vacío y la suspensión JavaScript del campo de ondas en Concentración son discrepancias de código descritas arriba, no excepciones aprobadas al requisito de rendimiento. El controlador comunica los checks y el padre integra y revisa el conjunto.
