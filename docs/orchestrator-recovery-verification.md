# Recuperación del Orquestador global: verificación

Alcance de este tramo («mount»): montaje en `src/App.jsx`, pestaña «Agentes» en `PhantomChat.jsx`, avisos de escritorio con cambio de proyecto, `DESIGN.md` y pruebas asociadas.

## Qué se hizo

- `OrchestratorHub` se monta una sola vez en `App.jsx` (`hubOpen`), sin `key` por workspace y fuera de `PhantomChat`; el borrador vive en `useVoiceDraft('orchestrator-hub')`, así que cambiar de proyecto con el hub abierto no lo remonta ni lo pierde.
- Entradas: botón de cabecera (`OrchestratorHubButton`), entrada del riel encima de la lista (`OrchestratorRailEntry`), acción `openOrchestrator`, Ctrl ⇧ Espacio (dentro del chat de Phantom sigue cerrándolo) y el botón «Abrir orquestador» de la pestaña local «Agentes».
- Los contadores salen de `useOrchestratorInbox`, el mismo origen que la sección.
- `createNavigation` (en `src/hooks/useDesktopAlerts.js`) unifica la navegación entre proyectos: filas del hub y clics de avisos de escritorio cambian al proyecto correcto y solo entonces enfocan el nodo (`session`) o abren Incorporaciones (`branches`). Sustituye a la espera fija de 50 ms de los datos previos. Si el cambio falla, el destino se descarta.
- `useReadyBranches` se mantiene; `useDesktopAlerts` se añade a su lado.
- Corrección del rechazo previo: el botón «Te necesitan» conserva `rail-attention` y `needs-you` como clases separadas (la línea con `rail-attention${…}` de los datos previos no se aplicó). Regresión: `test/orchestrator-hub-mount.test.mjs`.

## composer-ux / voice-layout / project-identity: sin cambios

Revisados; no requieren cambios semánticos porque siguen verificando comportamiento vigente que este tramo no toca:

- `composer-ux.test.mjs`: geometría, menús, foco y voz del compositor de `ChatCard`/`PhantomChat`; su fixture monta `PhantomChat` sin `onOpenOrchestrator` (prop opcional) y no usa la pestaña renombrada.
- `voice-layout.test.mjs`: reglas CSS del compositor y que los selectores no dependan de `messages.length`; ninguna cambia.
- `project-identity.test.mjs`: la isla/botón del riel colapsado con `ProjectMark` (el regex de `App.jsx` sigue casando) y estilos de discos de proyecto.

## Pruebas añadidas o actualizadas

- `test/orchestrator-hub-mount.test.mjs`: pruebas de texto sobre el montaje (sin key, fuera del chat, atajo, acción, cabecera/riel/pestaña, clases de «Te necesitan») y pruebas de comportamiento de `createNavigation` con callbacks reales: mismo proyecto inmediato; otro proyecto cambia primero y ejecuta una sola vez al ser activo; fila con cambio + panel hace un único cambio; fallo del cambio descarta el destino; un destino posterior sustituye al pendiente.
- `test/agent-observability-ui.test.mjs` + `test/fixtures/agent-observability.jsx`: pestaña «Agentes» y botón «Abrir orquestador» renderizados con Chromium.
- `test/phantom-tab-badge.test.mjs`: etiqueta «Agentes».

## Checks observados

Este ejecutor no tiene shell y no observó ninguna ejecución de pruebas. El resultado de `node --test test/*.test.mjs src/hooks/*.test.mjs` lo informa el controlador de Phantom; no se registra aquí ningún resultado.

## Límites

- Los datos de los fixtures (hub, observabilidad, pruebas de avisos) son sintéticos; no hay lectura contra hosts o proyectos reales.
- El hook `useDesktopAlerts` y el montaje completo de `App.jsx` no tienen prueba de React renderizada: la navegación se prueba sobre `createNavigation` y el cableado en `App.jsx` por texto.
- No se probaron notificaciones nativas del sistema operativo ni su clic: solo se acredita que se invoca `desktop.notify`/`desktop.badge` con carga validada por `desktop/security.mjs`. No se afirma integración ni prueba física.
- Permisos globales (responder permisos desde el hub para cualquier proyecto) no están implementados: la fila de permiso solo trae el proyecto y el nodo al frente.
- Los scripts de escritorio fuera de la suite (`test/sidebar-desktop.mjs` asume `.rail-head + .rail-attention`; `test/voice-desktop.mjs` busca la pestaña `/^Orquestador/`) no se actualizaron por quedar fuera del alcance y pueden requerir ajuste.
- La aceptación de este tramo es independiente del merge; no se modificaron permisos de integración ni el merge guard.
