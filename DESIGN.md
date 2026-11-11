---
name: Phantom Workspace
description: Lienzo protagonista — estudio continuo dark grafito/iris.
colors:
  bg: "#15171c"
  surface: "#202329"
  surface-2: "#292d35"
  ink: "#eceef3"
  muted: "#a5adbb"
  line: "#373d48"
  accent: "#8b9dff"
  accent-soft: "color-mix(in srgb, var(--accent) 15%, var(--surface))"
  danger: "#ff9da8"
  success: "#8ad8b6"
  warning: "#edbf79"
  terminal-bg: "#151a23"
  note: "#24252b"
---

# Phantom Workspace · lienzo continuo

## Dirección y procedencia

Carlos fija lienzo protagonista, sidebar compacto y plegable, controles flotantes y mínimos bordes. Operate, code-led; seed: none (unavailable). La dirección está en `.impeccable/surfaces/workspace.md`; los valores efectivos proceden de `src/studio.css`, que se carga después de `src/styles.css`. Este registro reemplaza la descripción anterior del tema claro.

## Superficies y color

Fondo grafito continuo bajo cabecera, navegación y canvas; sin banda sólida ni divisor lateral desktop. La atmósfera existente Aurora/Marea/Brasa o Grafito y la imagen local opcional pertenecen ahora al shell completo. Su opacidad es intensidad × .45 en mapa y × .12 en enfoque, con transición de 180ms ease-out. No se añaden motivos ni gradientes nuevos. La retícula existente sigue en el canvas (24px) y desaparece al enfocar o desactivarla.

Terminal, notas, herramientas, inspector y popovers permanecen opacos. Los marcos de nodos usan `--line`, radio 8px y sombra `0 3px 12px #0002`; el enfoque elimina sombra, conserva marco y contenido. Cabeceras de nodo comparten `--surface` y eliminan la costura inferior. Selección y focus-visible usan el acento; estado y errores conservan texto además de color.

Iris es el acento predeterminado. Apariencia conserva Menta #7ddbb9, Ámbar #edbf79 y Rosa #e9a0bf, intensidad, retícula e imagen por proyecto (`phantom:studio:<id>`). Texto principal #eceef3 y secundario #a5adbb sobre superficies oscuras; acciones primarias usan texto #171b28. Los fondos personalizados se atenúan; no se usan como fondo del contenido operativo.

## Navegación y distribución

- Escritorio mínimo 580px; no es una adaptación mobile.
- Sidebar expandido 224px por defecto, plegado 56px: libera 168px sin cambiar cámara ni geometría persistida. Marca discreta, búsqueda, proyectos, paneles y pie ligero. Iconos conservan nombres accesibles y tooltips; proyectos usan iniciales e identidad completa accesible.
- La preferencia global `phantom:sidebar:collapsed` persiste localmente entre proyectos y recargas. Lectura/escritura toleran almacenamiento indisponible; la interacción continúa en memoria.
- Toggle siempre visible en cabecera con `aria-expanded`, `aria-controls` y título. Cabecera de 60px transparente con nombre editable, ruta, guardado/error y comandos.
- A ≤850px el sidebar es drawer temporal de 224px, independiente de la preferencia desktop. Oculto es inert y no visible. Al abrir recibe foco y limita Tab a sus controles; Escape, scrim o selección cierran y devuelven foco al disparador. Cruzar el breakpoint limpia el estado temporal.
- Inspector opaco tonal: lateral en escritorio amplio, superpuesto a ≤1100px. Es no modal para terminales; el browser nativo se oculta cuando está obstruido.
- Dock de creación flotante inferior, 50px de alto, radio 12px y acciones de 38px. Zoom separado arriba a la derecha, 36px de alto. Sombra flotante `0 8px 24px #0005`; popovers `0 16px 40px #0006`.
- Hit areas de iconos y acciones de navegación al menos 32px; filas de paneles y comandos 36px. Las listas y contenido operativo tienen su propio scroll.

## Tipografía y movimiento

Sans nativa para shell, system-ui para herramientas; monospace independiente para terminal/código. Nombres de panel compensan zoom con `min(2.4, max(1, 1 / zoom))`. No se cambia medición de celdas xterm. Controles compactos de 11–13px; rutas/estado de 9–10px.

Drawer: transform de 180ms ease-out; atmósfera: opacity de 180ms ease-out. El plegado desktop cambia ancho sin animar ni transformar xterm. `prefers-reduced-motion` elimina las transiciones nuevas y conserva el override global de .01ms para otras animaciones.

## Continuidad e input

Plegar navegación no cambia keys, cámara, selección, notas ni geometrías. No desmonta ni transforma adicionalmente xterm. Enfoque sigue usando geometría temporal; volver restaura el mismo mapa y selección. Drag, resize, renombrado, guardado y navegador nativo mantienen sus rutas existentes.

Solo el drawer abierto estrecho se comunica como overlay bloqueante. Sidebar desktop e inspector no bloquean el terminal. Escritura requiere foco real dentro de xterm y stream activo; teclas ordinarias pertenecen al terminal. Paleta, menús, diálogos y otros overlays conservan su política existente. No se cambian host, PTY ni procesos de producto.

## Evidencia y límites

`test/workspace-canvas.mjs` define integración Electron con host/perfil y carpetas SYNTHETIC aislados en `/tmp/opencode`. Capturas y checks se escriben exclusivamente en `.test-artifacts/canvas` (ignored): desktop.png, collapsed.png, narrow.png, drawer.png, focused.png y checks.json. No son assets de producto.

El controlador ejecuta build, regresiones, smoke y detector. La coordinación revisa capturas independientemente. Este documento registra implementación, no resultados de ejecución ni aprobación visual. El SVG de marca y las miniaturas runtime existentes no se convierten en nuevos rasters de identidad.
