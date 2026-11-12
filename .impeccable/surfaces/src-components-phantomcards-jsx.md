---
version: 1
slug: "src-components-phantomcards-jsx"
primary_target: "src/components/PhantomCards.jsx"
related_targets: ["src/components/PhantomSkills.jsx","src/plugins.css"]
---

# Paneles Phantom · Cards y Skills

Modo Operate. Paneles del plugin Phantom en el canvas y el inspector: Cards (tareas/contratos nativos) y Biblioteca de Skills. Usuario: Carlos, jornadas largas con varios agentes. Tarea principal: saber qué necesita su decisión, vigilar lo que corre y abrir el contrato legible; crear Cards y publicar Skills a un clic. Restricciones: Phantom es la autoridad (estado nativo, sin progreso inventado), Cards y versiones de Skills son inmutables (reemplazo/versión explícitos), JSON solo tras «Ver fuente». Supuestos sin respuesta del usuario: vigilar y crear por igual; Skills de Phantom siguen en panel propio con el lenguaje del catálogo.

## Direction contract

THESIS: abrir el panel responde «¿qué necesita de mí ahora?». Rechaza la lista plana de JSON y el kanban genérico como vista principal.

OWN-WORLD: Dark studio sin cambios: grafito #15171c, planos #202329/#292d35, iris #8b9dff selección y en curso, ámbar #edbf79 para lo bloqueado, menta #8ad8b6 completado. Tarjetas de decisión grandes teñidas de ámbar, filas de cola compactas con punto de estado, monogramas como el catálogo de Skills.

STORY: ver bloqueadas arriba con su única acción posible → mirar lo que corre con su última salida → abrir una Card como contrato legible (objetivo, siguiente paso, checks, scope, ejecuciones) → actuar o crear reemplazo. En Skills: buscar, leer instrucciones formateadas, publicar o versionar.

FIRST VIEWPORT: cabecera con nombre, frescura de lectura, búsqueda, Mesa/Tablero y «Nueva Card» primaria. Zona «Espera tu decisión» con tarjetas grandes en rejilla; zona «Corriendo ahora» con filas vivas; zona «En cola y recientes» compacta. Al elegir una Card, el contrato ocupa la columna derecha. Movimiento firma: una Card que cambia de zona queda iluminada con «Cambió de estado» hasta que la abres.

FORM: «Mesa del ahora», candidata 5 de mi lista ordenada, asignada por la tirada (re-roll 1). seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
