---
name: Phantom Workspace
description: Lienzo protagonista — estudio dark continuo y recuperable.
colors:
  accent: "#8b9dff"
  accent-soft: "color-mix(in srgb, var(--accent) 15%, var(--surface))"
  bg: "#15171c"
  surface: "#202329"
  surface-2: "#292d35"
  ink: "#eceef3"
  muted: "#a5adbb"
  line: "#373d48"
  danger: "#ff9da8"
  success: "#8ad8b6"
  warning: "#edbf79"
  terminal-bg: "#151a23"
  terminal-chrome: "#1c222d"
  note: "#24252b"
  mission-bg: "#253c35"
  mission-ink: "#a4dec4"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  terminal:
    fontFamily: '"DejaVu Sans Mono", "Liberation Mono", monospace'
    fontSize: "13px"
    lineHeight: 1.24
rounded:
  field: "5px"
  icon: "6px"
  button: "7px"
  node: "10px"
  dock: "12px"
spacing:
  control-gap: "8px"
  inset: "12px"
  content: "16px"
  section: "24px"
---

# Design System: Phantom Workspace

## Dirección y procedencia

**Lienzo protagonista.** Carlos fija sidebar compacto y plegable, controles flotantes y mínimos bordes. Implementación code-led / Operate; seed: none (unavailable). `.impeccable/surfaces/workspace.md` registra el contrato. Este documento sustituye el registro anterior del tema claro; la fuente actual del tema es `src/studio.css`, sobre la estructura de `src/styles.css` y los componentes.

Grafito e iris, tipografía nativa y superficies operativas opacas. La cabecera y el sidebar desktop son transparentes sobre el mismo fondo del lienzo, sin costuras estructurales. La marca es discreta; los comandos preceden a proyectos y paneles en filas compactas. No se añadieron fondos decorativos ni gradientes: se reutilizan las atmósferas Aurora, Marea, Brasa y Grafito existentes, ahora sobre todo el shell. La retícula permanece solo en el mapa (24px, punto .7px).

## Tokens y contraste

Los colores del frontmatter corresponden a `studio.css`. Texto principal `#eceef3`, secundario `#a5adbb`; superficies operativas `#202329` y `#292d35`. Iris `#8b9dff` identifica selección, acciones y foco. Las acciones primarias usan texto oscuro `#171b28`. Estados incluyen texto además de color. El contorno fino `#373d48` delimita nodos; selección mantiene borde y outline de acento.

Las preferencias existentes por proyecto (`phantom:studio:<id>`) conservan fondo, imagen local, intensidad, retícula y acento. Acentos alternativos: Menta `#7ddbb9`, Ámbar `#edbf79`, Rosa `#e9a0bf`. Intensidad inicial 55%; en enfoque se multiplica por .12. La imagen personal solo afecta el fondo: terminales, notas, herramientas y popovers siguen opacos.

Interfaz base 13px nativa, controles de navegación 11px, marca 13px, rutas y estados 10px. Títulos de nodos conservan compensación de escala `min(2.4, max(1, 1 / zoom))`. xterm conserva sus métricas independientes; no se aplica animación de transformación a su contenido.

## Layout y navegación

- Mínimo desktop 580px; no es una propuesta mobile.
- Sidebar desktop: **224px expandido / 56px plegado**, liberando 168px de layout. Expandido por defecto. Preferencia global local `phantom:sidebar-collapsed`, independiente del proyecto y tolerante a errores de almacenamiento (sigue funcionando en la sesión).
- Toggle siempre visible en cabecera, con nombre, title, `aria-expanded` y `aria-controls`. El rail plegado conserva proyectos por iniciales, crear, buscar, abrir carpeta, paneles, apariencia y configuración. Las etiquetas recortadas siguen accesibles y los controles tienen identificación textual/title.
- Cabecera 60px, sin banda sólida ni borde estructural: conserva nombre editable, ruta, guardado, errores y comandos. El guardado permanece visible en anchuras compactas.
- A 850px o menos, sidebar de 224px como drawer temporal con scrim. Oculto es `inert`; abierto limita Tab a sus controles. Escape, scrim o selección cierran y devuelven foco al disparador. Cruzar breakpoint cierra el drawer; el plegado desktop se conserva independientemente.
- Desktop expandido/plegado no bloquea xterm. Solo el drawer abierto participa en la política de overlays bloqueantes. El browser nativo sigue usando la política de ocultación existente.
- A 1100px o menos el inspector pasa a overlay derecho de 350px. En desktop ancho consume espacio (370px desde 1450px, 325px en la variante compacta). Superficie tonal `#202329`, sin borde de separación.
- Dock inferior centrado a 22px del borde, altura 50px, botones 38px; zoom separado arriba, controles de al menos 32px. Navegación usa áreas de 32–36px, proyectos mínimo 42px.

## Continuidad del trabajo

El plegado cambia el ancho del rail, no la cámara, las coordenadas almacenadas, la selección ni la identidad del terminal. El Canvas permanece montado. El resize del viewport usa su observador existente; no hay reconstrucción de xterm por plegado.

Mapa: zoom .15–1.8, fit hasta 1; arrastre por cabecera, selección múltiple con Mayús y resize por esquina. Geometrías de creación: terminal/herramienta 640×400, browser 800×520, nota 420×340, con colocación por `findPanelPlacement`. Enfoque usa geometría temporal (24px,55px), ancho `max(320, canvasWidth - 48)` y alto `max(240, canvasHeight - 145)`; el retorno conserva cámara y selección previa. Otros paneles permanecen montados y ocultos durante enfoque.

Nombres se editan en línea: Enter confirma y devuelve foco, Escape cancela, blur confirma sin robar foco. El nombre del proyecto no modifica su carpeta canónica. Notas, layout y cámara usan la cola durable existente; cambios de proyecto esperan flush. Guardado pendiente/error y recuperación permanecen explícitos.

Las teclas normales del terminal pertenecen a xterm. Solo un stream activo y con foco real dentro de su xterm escribe en PTY. Inspector no modal permite recuperar la terminal por clic; paleta, drawer y demás overlays bloqueantes suspenden input. Ctrl/Cmd+K abre comandos; Ctrl/Cmd+Mayús+F busca paneles. El browser nativo conserva su montaje y política de ocultación bajo overlays.

## Elevación y movimiento

Nodos: sombra `0 4px 12px #0002`, sin sombra en enfoque; cabecera del nodo del mismo tono que la superficie. Dock/zoom `0 8px 24px #0005`; popovers `0 16px 40px #0006`; inspector compacto `-12px 0 35px #0004`. La selección es estado, no elevación decorativa.

Plegado de ancho y drawer: 160ms ease-out. Atmósfera: 180ms ease-out. Se conservan transiciones existentes de presencia y herramientas. Reduced-motion desactiva las transiciones nuevas, además del límite global existente de .01ms. No se anima la transformación de xterm ni se desmonta al alternar navegación.

## Evidencia y límite de verificación

`test/workspace-canvas.mjs` declara integración Electron real, host y PTY aislados, fixtures SYNTHETIC y perfiles en `/tmp/opencode`. Escribe exclusivamente evidencia de esta card en `.test-artifacts/canvas` (ignored): `desktop.png`, `collapsed.png`, `narrow.png`, `drawer.png`, `focused.png`, `checks.json`. Capturas esperadas: 1520×980, 1100×760 y 800×700; el mínimo de BrowserWindow se ajusta solo en el test.

El test cubre continuidad de sesión/PID/texto/geometría, ganancia de espacio, preferencia tras reload/cambio de proyecto, escritura real por teclado, enfoque/retorno, inspector/paleta, cierres del drawer, breakpoint, reduced-motion, errores de página y separación de controles. Los checks los ejecuta Phantom; esta documentación no acredita su resultado ni aprobación visual. La sesión coordinadora revisa las capturas de forma independiente. Ledgers anteriores no verifican esta revisión.

No hay nuevos raster shipping: las capturas son evidencia de desarrollo, no assets de identidad. `assets/phantom.svg` sigue siendo vector de producto; el sidebar utiliza Blocks de Lucide.
