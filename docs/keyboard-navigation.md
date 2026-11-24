# Navegación por teclado

## Flujo e interfaz

Esta sección describe el contrato de integración con el trabajo paralelo de navegación. La implementación conjunta y su ejecución deben contrastarse con los checks del controlador; este documento no acredita que hayan pasado.

`App.jsx` despacha los comandos de `workspace-commands.mjs` en captura, antes de xterm. `dispatchWorkspaceKey` en `inputOwnership.js` consume únicamente coincidencias y llama al comando; no escribe en el PTY. Canvas conserva sus gestos, herramientas y controles locales. Los handlers anteriores de creación, paleta, índice, entrada y encuadre se sustituyen por ese despacho común.

| Acción | Atajo inicial |
| --- | --- |
| Paleta | Ctrl+K |
| Cambiar proyecto | Ctrl+Shift+P |
| Buscar paneles | Ctrl+Shift+F |
| Elegir vecino | Flechas, con el foco en el lienzo y modo navegación |
| Siguiente / anterior sesión | Ctrl+PageDown / Ctrl+PageUp |
| Entrar al panel seleccionado | Enter |
| Salir al mapa desde el contenido, incluido xterm | Ctrl+Shift+Escape |
| Ver todos los paneles del espacio actual | 0, en navegación |
| Volver al último enfoque de trabajo | Ctrl+Shift+Enter |
| Configurar atajos | Ctrl+, o botón «Configurar atajos» |
| Crear terminal / navegador / nota / zona | Ctrl+Shift+T / B / N / Z |

La selección de un vecino o sesión mantiene el foco DOM en el canvas y encuadra el panel mediante la cámara segura existente. Las flechas no cambian de panel dentro de un editor, un control o xterm. Entrar es explícito: monta/enfoca xterm, o enfoca el campo del panel. Salir conserva seleccionado el panel de trabajo y devuelve el foco al lienzo. El modo se expone mediante `data-keyboard-mode="navigation"|"interaction"`; el E2E observa este atributo en `.app-shell` y el foco DOM.

La selección, el panel enfocado y el último enfoque se conservan por proyecto durante la vida de la ventana. Los vecinos y el ciclo de sesiones excluyen zonas, vistas ocultas y espacios inactivos. Volver al último enfoque puede revelar su espacio. El encuadre general solo utiliza el espacio actual. Los commits pendientes de cámara llevan el ID de espacio de su Canvas, para que un desmontaje no guarde la cámara anterior en el espacio recién abierto.

Los atajos usan el hook global `useWorkspaceShortcuts`, con persistencia local en `phantom:workspace:shortcuts`. Los conflictos, los valores inválidos y las vías de recuperación se validan en el núcleo/hook. `null` desactiva comandos opcionales; la salida y la configuración conservan un acorde modificado. IME, Dead/Process y AltGraph no se interceptan. Los overlays retienen su teclado y bloquean la entrada tardía del terminal.

`shared/keyboard-reservations.mjs` comparte con el menú nativo de `desktop/main.mjs` los aceleradores de cerrar, salir, edición, recarga, pantalla completa y herramientas de desarrollo por plataforma (Ctrl en Linux/Windows, Meta en macOS; rehacer es Ctrl+Y fuera de macOS). El configurador los rechaza con el nombre de la acción reservada; las herramientas de desarrollo conservan su reserva también en la distribución empaquetada. `Abrir ventana` sigue en el menú sin acelerador y rehacer no usa Ctrl+Shift+Z, de modo que Ctrl+Shift+N y Ctrl+Shift+Z quedan para crear nota y zona. Esta validación no detecta reservas del compositor ni del sistema operativo.

## Componentes del trabajo paralelo

La conexión usa las interfaces acordadas, cuyos archivos y CSS pertenecen a controls:

- `ProjectPicker({open,onClose,projects,active,onSelect,onOpenFolder,busy})`: `active` es el workspace y `onSelect` recibe un ID.
- `ShortcutSettings({open,onClose,bindings,onSetBinding,onReset,conflicts})`.
- `CommandPalette({open,onClose,workspace,onAction,bindings})`: los nuevos comandos emiten `{type: COMMAND.id}`. Elegir un panel desde la paleta lo selecciona en el mapa; Enter permite entrar después.

`ProjectPicker` y `ShortcutSettings` están presentes en esta base. El E2E utiliza sus controles accesibles: el selector filtra por nombre/ruta; «Editar atajo: Siguiente sesión» abre un campo textual, donde se escribe `Ctrl+Alt+Y` y se guarda con Enter. La compilación conjunta requiere publicar también la integración de navigation.

## Checks del controlador

Check de sintaxis declarado para esta entrega:

```sh
node --check test/keyboard-navigation.mjs
```

Prueba conductual de ownership prevista en la integración, sin búsquedas de texto fuente:

```sh
node --test src/hooks/keyboard-integration.test.mjs
```

Su cobertura declarada es el despachador usado por App junto con el stream real de terminal y el guard de escritura: captura antes del PTY, salida modificada, flechas/Enter/Escape de xterm, comandos globales y sesiones, edición/IME/AltGraph, overlays, desconexión, foco DOM, rebinding, desactivación y recuperación ante conflictos.

Regresiones declaradas:

```sh
node --test src/hooks/panel-shortcuts.test.mjs src/hooks/input-ownership.test.mjs src/hooks/canvas-camera.test.mjs src/hooks/panelFraming.test.mjs
```

## Job Electron con PTY real

El servicio `keyboard-e2e` de `compose.yaml` pertenece al perfil `keyboard-test` y declara `x-phantom.lifecycle: ephemeral`. `Dockerfile.keyboard-test` instala Node 24, dependencias de Electron/Playwright y Xvfb, instala las dependencias y compila la aplicación dentro de la imagen. La instalación requiere red para imágenes y dependencias. No publica puertos ni monta perfiles o secretos. Storybook conserva su servicio.

El padre ejecuta el job por el controlador de Entorno, tras la publicación conjunta:

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env run keyboard-e2e --timeout 900
```

El arranque prepara únicamente los permisos del directorio de evidencia montado y baja a UID/GID `node` antes de iniciar D-Bus/Xvfb y el test. El helper `chrome-sandbox` conserva propietario root y modo 4755, pero el sandbox de Chromium se desactiva únicamente en este job (`chromiumSandbox: false`): con los permisos por defecto del contenedor no puede crear namespaces ("Failed to move to new namespace", "Zygote process exited prematurely"). El límite de aislamiento es el contenedor: sin red ni secretos, usuario `node` no root y fixtures sintéticas. No hay un servidor de desarrollo. El host PTY usa el Node del contenedor y el renderer compilado de `dist/`.

`test/keyboard-navigation.mjs` usa el bridge real y dos carpetas sintéticas. Solo el setup crea proyectos, paneles, espacios y dos PTY `/bin/sh` por IPC; después la navegación y configuración usan `page.keyboard`, sin clicks, `fill`, focos programáticos ni reemplazo del bridge. Las recargas del harness comprueban persistencia; las lecturas por IPC/DOM son observaciones de resultados. El recorrido incluye:

1. Selector de proyecto → índice de paneles → vecino → Enter → `printf` con marcador dividido para distinguir ejecución de eco → marcador visible en xterm → salida modificada → otro vecino.
2. Comparación del historial antes/después de salir y navegar, identidad del PTY (PID y descriptor estándar apuntando a `/dev/pts/N`), selección sin montar xterm y encuadre seguro.
3. Fit/return, siguiente/anterior sesión, edición normal de nota, cancelación del selector y memoria de selección/enfoque por proyecto.
4. Cambio de atajo desde la UI de configuración, persistencia tras cambiar de proyecto y recargar, ejecución del nuevo acorde y ausencia del anterior.
5. Acción nueva de la paleta hacia el selector.
6. Salida desde el navegador embebido: el setup crea un panel `browser` sintético con `about:blank` (sin red). Se elige con el índice y se entra con Enter; la prueba espera a que la `WebContentsView` esté visible y, con `app.evaluate` en el proceso principal, envía `Ctrl+Shift+Escape` (`keyDown` + `keyUp`) por `webContents.sendInputEvent` de esa vista, no por `page.keyboard`. Un listener temporal de `before-input-event` registra lo que Electron entregó; si la tecla no llega a la vista, el test falla con un mensaje que lo indica. Después exige, sin clicks, que el panel deje de estar enfocado, siga seleccionado y el modo sea Navegación, es decir, que el puente `browser.key` → `KeyboardEvent` devolvió el foco al mapa.

Única evidencia persistente: `/tmp/phantom-keyboard-e2e/run-*/result.json`, screenshots numerados y captura de fallo. El directorio está montado en la misma ruta del host para conservarlo después de retirar el job. El ledger contiene teclas, foco previo, checks, PID/TTY, consola, errores y limpieza; el proceso devuelve código distinto de cero ante cualquier etapa fallida, interrupción o fallo de limpieza. El test solicita detener sus terminales y host, elimina y comprueba el cierre del grupo de Electron y borra el perfil/fixtures temporales, conservando evidencia. Las comprobaciones de `/proc` para limpieza se restringen a los PID del fixture y validan su identidad antes de señalarlos.

## Estado y límites

Esta entrega restaura y revisa el test E2E, compose, Dockerfile y documentación; no contiene una ejecución observada de los checks ni del job. El resultado aceptado requiere los registros del controlador, especialmente la compilación conjunta y el recorrido Electron. Un fallo de instalación, sandbox o arranque se registra como fallo; no se convierte en un E2E aprobado.

La captura descrita reside en el renderer de Workspace. El recorrido cubre xterm y editores DOM. Para el navegador nativo solo cubre la salida al mapa con `leave-panel` (`Ctrl+Shift+Escape`) desde una `WebContentsView` con `about:blank`, con la tecla inyectada por `sendInputEvent`; no acredita otros comandos dentro de la vista, páginas remotas ni los acordes que reserve Wayland/compositor o el sistema operativo (la inyección no pasa por el teclado físico). Esa comprobación se añadió sin que el ejecutor la observara correr: la ejecuta el padre. Los atajos iniciales evitan Meta. La memoria de navegación no se persiste entre reinicios; la configuración global de atajos sí.
