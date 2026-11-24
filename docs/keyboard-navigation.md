# Navegación por teclado

## Flujo e interfaz

La implementación de navegación del trabajo paralelo conecta `App.jsx` con los comandos de `workspace-commands.mjs` en captura, antes de xterm. `dispatchWorkspaceKey` en `inputOwnership.js` consume únicamente coincidencias y llama al comando; no escribe en el PTY. Canvas conserva sus gestos, herramientas y controles locales. Los handlers anteriores de creación, paleta, índice, entrada y encuadre se sustituyen por ese despacho común.

| Acción | Atajo inicial |
| --- | --- |
| Paleta | Ctrl+K |
| Cambiar proyecto | Ctrl+Shift+P |
| Buscar paneles | Ctrl+Shift+F |
| Dictado por voz | Ctrl+Shift+M |
| Elegir vecino | Flechas, con el foco en el lienzo y modo navegación |
| Siguiente / anterior sesión | Ctrl+PageDown / Ctrl+PageUp |
| Entrar al panel seleccionado | Enter |
| Salir al mapa desde el contenido, incluido xterm | Ctrl+Shift+Escape |
| Ver todos los paneles del espacio actual | 0, en navegación |
| Volver al último enfoque de trabajo | Ctrl+Shift+Enter |
| Configurar atajos | Ctrl+, o botón «Configurar atajos» |
| Crear terminal / navegador / nota / zona | Ctrl+Shift+T / Ctrl+Shift+B / Ctrl+Shift+N / Ctrl+Shift+Z |

El contrato de navegación establece que seleccionar un vecino o sesión mantiene el foco DOM en el canvas y encuadra el panel mediante la cámara segura existente. Las flechas no cambian de panel dentro de un editor, un control o xterm. Entrar es explícito: monta/enfoca xterm, o enfoca el campo del panel. Salir conserva seleccionado el panel de trabajo y devuelve el foco al lienzo. El shell de la aplicación expone `data-keyboard-mode="navigation"|"interaction"`.

La selección, el panel enfocado y el último enfoque se conservan por proyecto durante la vida de la ventana. Los vecinos y el ciclo de sesiones excluyen zonas, vistas ocultas y espacios inactivos. Volver al último enfoque puede revelar su espacio. El encuadre general solo utiliza el espacio actual. Los commits pendientes de cámara llevan el ID de espacio de su Canvas, para que un desmontaje no guarde la cámara anterior en el espacio recién abierto.

Los atajos usan el hook global `useWorkspaceShortcuts`, con persistencia local en `phantom:workspace:shortcuts`. Los conflictos, los valores inválidos y las vías de recuperación se validan en el núcleo/hook. `null` desactiva comandos opcionales; la salida y la configuración conservan un acorde modificado. IME, Dead/Process y AltGraph no se interceptan. Los overlays retienen su teclado y bloquean la entrada tardía del terminal.

`Abrir ventana` sigue en el menú nativo, sin acelerador: Ctrl+Shift+N queda para crear nota. `shared/keyboard-reservations.mjs` comparte con el menú las reservas de cerrar, salir, edición, recarga, pantalla completa y herramientas de desarrollo por plataforma. El configurador las rechaza con el nombre de la acción reservada; las herramientas de desarrollo conservan su reserva también en la distribución empaquetada. Esta validación no detecta reservas del compositor. Dictado pertenece a `COMMANDS` y al despacho de App; VoiceProvider ya no instala un listener independiente. La paleta, la configuración y el botón de dictado muestran el binding vigente, incluida su desactivación.

## Componentes del trabajo paralelo

La conexión usa las interfaces acordadas de controls, ya presentes en este snapshot:

- `ProjectPicker({open,onClose,projects,active,onSelect,onOpenFolder,busy})`: `active` es el workspace y `onSelect` recibe un ID.
- `ShortcutSettings({open,onClose,bindings,onSetBinding,onReset,conflicts})`: «Editar» abre un campo de texto; se escribe el acorde y Enter guarda.
- `CommandPalette({open,onClose,workspace,onAction,bindings})`: los nuevos comandos emiten `{type: COMMAND.id}`. Elegir un panel desde la paleta lo selecciona en el mapa; Enter permite entrar después.

La conexión en App y Canvas pertenece al hermano navigation. El padre integra esa implementación con este E2E antes de ejecutar el recorrido conjunto.

## Checks del controlador

Prueba conductual de ownership prevista por la entrega navigation:

```sh
node --test src/hooks/keyboard-integration.test.mjs
```

Su contrato cubre el despachador usado por App junto con el stream de terminal y el guard de escritura: captura antes del PTY, salida modificada, flechas/Enter/Escape de xterm, comandos globales y sesiones, edición/IME/AltGraph, overlays, desconexión, foco DOM, rebinding, desactivación y recuperación ante conflictos. Esa prueba depende de la integración de navigation. La cobertura añadida comprueba despacho único de dictado, reasignación a paleta y bloqueo por overlays/IME; `workspace-commands.test.mjs` cubre sus duplicados y las reservas nativas.

Regresiones declaradas:

```sh
node --test src/hooks/panel-shortcuts.test.mjs src/hooks/input-ownership.test.mjs src/hooks/canvas-camera.test.mjs src/hooks/panelFraming.test.mjs
```

Checks de sintaxis de esta entrega, a ejecutar por Phantom:

```sh
node --check test/keyboard-navigation.mjs
node --check desktop/main.mjs
```

## Job Electron con PTY real

El servicio `keyboard-e2e` de `compose.yaml` pertenece al perfil `keyboard-test` y declara `x-phantom.lifecycle: ephemeral`. `Dockerfile.keyboard-test` instala Node 24, dependencias de Electron/Playwright y Xvfb, instala las dependencias y compila la aplicación dentro de la imagen. La instalación requiere red para imágenes y dependencias. No publica puertos ni monta perfiles o secretos. Storybook conserva su servicio.

El padre ejecuta el job por el controlador de Entorno tras la publicación conjunta:

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env run keyboard-e2e --timeout 900
```

El arranque prepara únicamente los permisos del directorio de evidencia montado, elimina los grupos suplementarios y baja a UID/GID `node` antes de iniciar D-Bus/Xvfb y el test. Electron se lanza con `chromiumSandbox: true` y el helper `chrome-sandbox` con propietario root y modo 4755; no hay flags de desactivación ni un servidor de desarrollo. El host PTY usa el Node del contenedor y el renderer compilado de `dist/`.

`test/keyboard-navigation.mjs` usa el bridge real y dos carpetas sintéticas. Solo el setup crea proyectos, paneles, espacios y dos PTY `/bin/sh` por IPC; después la navegación y configuración usan `page.keyboard`, sin clicks, `fill`, focos programáticos ni reemplazo del bridge. Las recargas del harness comprueban persistencia; las lecturas por IPC/DOM son observaciones de resultados. El recorrido incluye:

1. Selector de proyecto → índice de paneles → vecino → Enter → `printf` con marcador dividido para distinguir ejecución de eco → marcador visible en xterm → salida modificada → otro vecino.
2. Comparación del historial antes/después de salir y navegar, identidad del PTY, selección sin montar xterm y encuadre seguro.
3. Fit/return, siguiente/anterior sesión, edición normal de nota, cancelación del selector y memoria de selección/enfoque por proyecto.
4. Cambio de atajo desde la UI de configuración, persistencia tras cambiar de proyecto y recargar, ejecución del nuevo acorde y ausencia del anterior.
5. Acción nueva de la paleta hacia el selector.
6. Ctrl+Shift+N crea nota y el menú conserva Abrir ventana sin acelerador; reasignar dictado permite que la paleta use su acorde anterior sin abrir dos superficies, muestra el nuevo binding y ejecuta dictado desde paleta y teclado.

Evidencia: `/tmp/phantom-keyboard-e2e/run-*/result.json`, screenshots numerados y captura de fallo. Es la única ruta persistente del job y está montada en la misma ruta del host. El ledger contiene teclas, foco previo, checks, consola, errores y limpieza; el proceso devuelve código distinto de cero ante fallo de cualquier etapa o de limpieza. El test solicita detener sus terminales y host, elimina y comprueba el cierre del grupo de Electron y borra el perfil/fixtures temporales, conservando evidencia. La limpieza por PID valida la identidad del host y el directorio del shell sintético antes de señalarlos. Los límites de ejecución y limpieza también producen fallo.

## Estado y límites

Esta entrega restaura el test, el job y la documentación; no contiene una ejecución observada de los checks ni del job. El resultado aceptado requiere los registros del controlador, especialmente la compilación conjunta y el recorrido Electron. Un fallo de instalación, sandbox o arranque se registra como fallo; no se convierte en un E2E aprobado.

La captura descrita reside en el renderer de Workspace. El recorrido cubre xterm y editores DOM; no acredita la recepción de estos comandos dentro de un `WebContentsView` de navegador nativo ni los acordes que reserve Wayland/compositor. Los atajos iniciales evitan Meta. La memoria de navegación no se persiste entre reinicios; la configuración global de atajos sí.
