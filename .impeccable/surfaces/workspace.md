---
version: 1
slug: workspace
primary_target: src/App.jsx
related_targets: [src/styles.css, src/studio.css, src/components/Canvas.jsx, src/components/Appearance.jsx]
---

# Workspace espacial · estudio dark

Modo Operate. Carlos pide Dark + flujo completo, canvas y barras flotantes, orden, precisión y fluidez inspirados en Figma. Pide además un background personalizable y una identidad propia centrada en DX. Jornadas largas de desarrollo en escritorio: el fondo orienta y expresa pertenencia, el contenido operativo permanece opaco y legible.

## Direction contract

THESIS: un estudio personal para volver al trabajo; proyectos, paneles y comandos tienen rutas directas sin buscar en menús sucesivos.

OWN-WORLD: ciruela casi negra #0b0910, superficies #131019/#1c1725/#292133, texto #eee9f4 y secundarios #a69bb7. Violeta #a78bda como acento predeterminado, conservando elecciones por proyecto. Halo violeta visible y estático; trabajo #bb9af7 respira suavemente en el perímetro interior cada 4,8 s; selección mantiene contorno exterior sólido y teclado anillo local estático. Ámbar #e9b46a significa atención. Sans nativa, controles compactos, marcos precisos. Fondo atmosférico opcional y retícula espacial regulable; planos de lectura opacos, contenido tranquilo.

STORY: elegir carpeta → localizar panel en la navegación lateral → operar en mapa o enfocar → consultar herramientas a la derecha → volver al mismo mapa. Personalizar fondo y acento desde Apariencia, con preferencias locales por proyecto.

FIRST VIEWPORT: rail izquierdo con proyectos y lista compacta de paneles; cabecera reducida con identidad y comandos; canvas oscuro central. Franja inferior reservada de 196 px en mapa: navegación de 48 px sobre creación de hasta 104 px, separadas 12 px, y minimapa en columna lateral de 190 px separada 16 px. Las islas terminan a 16 px del borde; el área operativa se recorta antes de la franja. En foco la reserva baja a 134 px, el dock queda centrado y el panel usa y=72 px, laterales de 12 px y margen inferior de 16 px. Encuadre y minimapa miden el área operativa real; al reducir ventana se ajusta solo la cámara del trabajo visible, sin reorganizar paneles. Inspector no modal para contexto o apariencia. Fondo se atenúa al enfocar: el gesto distintivo es pasar del estudio personal al trabajo concentrado conservando identidad y cámara.

FORM: dirección fijada por Carlos: Figma moderno, dark y personalización orientada a DX; extensión Gengar más espectral aprobada: halo violeta visible, pulsos suaves mientras trabajan, «vivo sin circo». Implementación code-led sobre el mundo existente, sin nueva entrevista ni referencia seed aleatoria. Cabeceras más claras, hilo tranquilo y compositor con foco inequívoco; el estado proviene de fuentes reales. Movimiento reducido fija las señales; transparencia reducida elimina atmósfera y vidrio. El halo no añade bordes interiores ni amplía presupuestos.

FINISH: dirección documentada en DESIGN.md; arte Gengar existente conserva su procedencia, sin nuevos raster de producto. La primera implementación pasó cuatro checks, pero revisión de `/tmp/opencode/spectral-ui-GRaGQh/narrow-attention.png` encontró minimapa sobre Aprobar; `narrow-rest/working` y `selected-working` mostraron minimapa/toolbar sobre enviar/detener. La corrección conserva halo, pulsos, selección y presupuestos de bordes. `test/spectral-ui.mjs` prepara evidencia sintética aislada en Electron a 1520×980 y 1100×760 cruzando mapa/selección/foco y estados de conversación: hit-testing de nueve puntos, separación del chrome, activación real de Aprobar/enviar/detener con respuesta IPC local, teclado, minimapa, overflow y preferencias de accesibilidad. Checks y nuevas capturas pendientes de ejecución del controlador; inspección visual y cierre pertenecen al padre. No se declara nueva aprobación por haber implementado la corrección.
