# Phantom Workspace

<!-- impeccable:product-schema 1 -->

## Platform

web

App de escritorio Linux con interfaz web dentro de Electron. Mobile queda para una etapa posterior.

## Stack

Delegado por Carlos: «tienes todo para darte, delega todo lo que necesites para tener esta versión completa». Elección inicial: Electron, React, xterm.js y host Node separado con PTY. Las pruebas de terminal y browser pueden obligar a corregir decisiones concretas. Canvas DOM con geometría propia; Electron WebContentsView para navegador enfocado y miniatura/restauración del panel en overview. Node >=24 ya es requisito de Phantom; el paquete incluirá un runtime Node para el host.

## Users and purpose

Carlos organiza trabajo por carpeta y misión. Quiere recuperar sesiones, contexto, pendientes y herramientas en un espacio tipo Figma. Tiene terminales mezcladas, MD/skills dispersos, tareas sin contexto y pérdida de continuidad al cerrar o apagar.

## Confirmed capabilities

Terminales reales; canvas por carpeta; browser interno; cards, decisiones y skills Phantom; dossiers de sesión; radar Git; sitios/servicios; Docker; voz; workflows; Playwright y playgrounds. La app los integra por incrementos funcionales. Phantom conserva su autoridad; la app mantiene disposición, referencias, borradores/checklists y notas.

## Operating principles

- Preferencia visual confirmada por Carlos: experiencia dark moderna inspirada en Figma, canvas protagonista, barras flotantes, orden y fluidez; fondo y acento personalizables por proyecto con identidad propia centrada en DX.

- Proyecto y sesión conservan identidad a través de paneles y herramientas.
- Teclado dentro del terminal pertenece al terminal; movimiento por cabecera y navegación explícita.
- Host vivo permite reconectar; reboot recupera historial/contexto, con relanzamiento explícito.
- Fuentes, estados y fallos visibles; datos reales, sin simular procesos en producción.
- Herramientas externas ausentes se explican y se pueden configurar; no se fabrican resultados.

## Source of scope

El [War Room](../harness_engineer/war-room/terminal-canvas/README.md) y [backlog](../harness_engineer/war-room/terminal-canvas/backlog.json) definen el alcance. Carlos autorizó implementación y delegación en este turno. La validación de uso prolongado y sus decisiones posteriores se registrarán como evidencia, no se presumen realizadas.
