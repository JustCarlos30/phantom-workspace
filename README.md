# Phantom Workspace

App de escritorio local para organizar **terminales, navegador, sesiones, tareas y contexto por proyecto**. Versión 0.1 para Linux x64.

## Catálogo oficial de componentes

```sh
npm run storybook
```

Abre **http://127.0.0.1:6006**. Storybook muestra los componentes reales en español, fundamentos computados, estados y una matriz buscable de fuentes y cobertura. Las 12 familias usan datos sintéticos y un host aislado. **Catálogo → Inventario** distingue escenarios renderizados, símbolos privados y límites nativos.

También está declarado como servicio Docker en `compose.yaml`, descubrible por **Sitios / Servicios**. Inicio manual: `docker compose up -d --build storybook`; parada: `docker compose down`; registros: `docker compose logs -f storybook`. El puerto se publica solo en loopback. La ejecución npm y Docker usan el mismo puerto: usa una a la vez.

Guías: [Storybook, fixtures y comprobaciones](docs/storybook.md) · [Mapa de componentes y propuestas](docs/component-inventory.md). El catálogo no inicia el host de escritorio ni ejecuta Git, PTY, agentes o micrófono real.

## Abrir

```sh
/home/carlosj/Carlos_World/phantom-workspace/launch.sh
```

También puedes abrir `Phantom Workspace.desktop` desde esta carpeta. El ejecutable empaquetado está en:

```text
out/Phantom Workspace-linux-x64/phantom-workspace
```

Incluye Electron, Node, Chromium de Playwright y Phantom 0.5. El paquete fue probado usando sus propios runtimes. Git, Docker, shells y Python para playgrounds usan las herramientas instaladas en el equipo.

## Primer recorrido

1. **Abrir carpeta** registra un proyecto; una carpeta sin Git también funciona.
2. Crea terminales, una nota y un navegador desde la barra inferior. Los paneles nuevos buscan espacio libre.
3. Arrastra una cabecera para ordenar; arrastra la esquina para cambiar tamaño. **Ctrl + rueda** sobre el fondo cambia zoom; **0** ajusta el mapa cuando el foco está en el canvas.
4. Enfoca un panel y usa **Volver al mapa** o **Ctrl + Mayús + Enter** para regresar. La lista permite encontrar paneles fuera de la cámara y recuperar vistas ocultas.
5. **Ctrl + K** abre la paleta. El inspector derecho ofrece contexto, tareas, sesiones, Git, servicios y otras herramientas junto a la terminal.

### Sitios globales

**Sitios** en la navegación lateral y en la paleta, y **Servicios → Todos los proyectos**, reúnen los servicios Compose con resumen de actividad, filtro por proyecto, búsqueda por nombre de proyecto o servicio y **Solo en marcha**. Busca `compose.yaml`, `compose.yml`, `docker-compose.yaml` o `docker-compose.yml` en cada raíz. Los proyectos sin Compose comparten una lista compacta con orientación para añadirlo; Phantom no genera Dockerfiles. La consulta no inicia servicios. **Iniciar** ejecuta Compose `up -d` para servicios que no están en marcha; **Detener** y **Reiniciar** usan `stop` y `restart` para los que están en marcha, sin borrar volúmenes. **Registro** se abre bajo el servicio ya creado y permite actualizarlo. Cada URL puede abrirse fuera y, desde el hub Servicios, también en el navegador interno con **Abrir aquí**. Los contenedores no dependen de la terminal ni de mantener abierta la vista.

La URL se muestra para puertos TCP publicados con `app_protocol: http` o `https`, o cuyo puerto interno es 80 o 443; no se presupone que otros puertos sean HTTP. Solo se muestran bindings efectivos de contenedores existentes. Se comprueba que el daemon sea local y que todos los contenedores del proyecto pertenezcan a la raíz y al archivo Compose detectado. Si hay varios proyectos Compose en una raíz o configuraciones adicionales, se indica el conflicto en vez de elegir o adoptar contenedores. Los proyectos todavía sin contenedores usan un nombre Compose estable derivado de su ruta. Los errores de un proyecto no ocultan los demás.

Las pruebas declaradas son `node --test test/sites.test.mjs test/integrations.test.mjs`, `npm run build` y `node test/sites-desktop.mjs`: la prueba Electron emplea perfil, repositorios y ejecutable Docker sintéticos y guarda su captura en `/tmp/phantom-sites-ui-*`. Los resultados corresponden al controlador.

### Dictado por voz

**Dictado por voz**, en la barra de proyectos, y **Ctrl/Cmd + Shift + M** abren el dictado global. Primero enfoca un campo editable o una terminal; el destino y la selección quedan fijados al abrirlo. Las letras normales y los atajos propios de escritura mantienen su comportamiento. La paleta **Ctrl + K** también ofrece Dictado y **Capturar voz o escribir intención**.

Pulsa **Grabar dictado**, después **Detener y transcribir**. Revisa la **Transcripción editable** y pulsa **Insertar en campo** o **Insertar en terminal**. En terminal se comprueba que la misma sesión siga conectada y admita escritura; los saltos de línea y controles se convierten en espacios y **no se envía Enter**. Cambiar de foco no cambia el destino. Si el campo cambió durante la captura, se conserva su borrador y se pide revisar la transcripción.

ChatCard, Phantom y orquestador tienen micrófono propio: añaden la transcripción al borrador, sin enviar mensajes. Sus borradores permanecen en esta ventana al cerrar/reabrir o cambiar de pestaña, separados por proyecto y conversación; recargar la ventana los descarta. Solo hay un dictado activo, desde el permiso del micrófono hasta el final de la transcripción. **Cancelar audio**, Escape o cerrar la captura descartan el resultado pendiente y liberan el micrófono; cambiar de proyecto o desmontar el destino también cancela la captura.

Las ondas violetas responden al nivel real de audio; **Transcribiendo** indica que el micrófono está apagado. Movimiento reducido conserva texto y nivel mediante opacidad, sin movimiento de ondas. El límite por fragmento es **2 minutos o 1 MiB**. Los errores muestran cómo recuperar permisos o configurar el proveedor existente; no se descarga ni se configura un runtime al dictar.

Prueba declarada: `node test/voice-desktop.mjs`, después del build, usa Electron y perfil aislados, audio WebAudio grabado por MediaRecorder y una transcripción **explícitamente sintética**. No evalúa precisión de reconocimiento ni usa el micrófono personal. Las capturas y el informe se escriben en `/tmp/opencode/voice-desktop-*` a 1520×980 y 1100×760. El controlador ejecuta los checks y comunica sus resultados.

### Plugin Phantom · Centro de mando

Abre **Plugins** en la barra de proyectos y pulsa **Activar Phantom**. La activación y la frecuencia se guardan por proyecto. **Abrir Centro de mando** crea o recupera su panel del canvas; también está disponible en **Ctrl + K** y en el selector del inspector. En Configuración puedes definir las rutas de la CLI y sus datos nativos; no se instala código externo ni hay marketplace.

El Centro consulta el catálogo de tareas/cards de la familia Git de worktrees y únicamente los eventos de la tarea seleccionada. Prioriza bloqueadas, después activas; conserva por separado el estado nativo y el del controlador local. El detalle muestra objetivo, alcance, checks, evidencias y hasta 100 eventos. La salida del controlador es la recibida realmente por este host, acotada a 64 KiB; no se deduce progreso porcentual. Un controlador terminado no implica que la tarea esté completada.

La consulta automática ocurre cada **4 segundos** (configurable entre 3 y 5), sin solicitudes solapadas y solo con el panel montado, visible y activo. Canvas e inspector comparten lector por proyecto. Los eventos `tool.output` y `tool.status` adelantan la siguiente lectura. Puedes pausar, reanudar o actualizar manualmente. Si falla la conexión se conserva la última lectura válida y se indica que está desactualizada; la reconexión vuelve a consultar. Desactivar detiene las consultas y conserva datos y paneles; el propio panel ofrece **Reactivar Phantom**. Las lecturas conservadas del catálogo viven en esta ventana, no constituyen un historial persistente. Sin CLI disponible se muestra un error recuperable; sin tareas se muestra el estado vacío.

El check `node test/command-center-desktop.mjs` usa fixtures sintéticos explícitos con Vite y `window.phantom` simulado. Cubre activación, salida real, bloqueo, búsqueda, pausa, desactivación, recuperación tras error y catálogo vacío, reconexión y ausencia de desbordamiento en escritorio y compacto. Sus capturas se escriben exclusivamente en `/tmp/opencode/phantom-command-center-review`, fuera del repositorio. `node --test test/command-center.test.mjs` cubre además persistencia, validación, autorización por familia y aislamiento de lecturas tardías; un flujo continuo de salida no debe aplazar indefinidamente el refresco.

### Revisión de videos e imágenes

Pega o arrastra un archivo al canvas y enfoca su panel. En video, **pausa**, indica sus **FPS explícitos** y usa **Frame anterior / siguiente** o la barra de tiempo. Los FPS los declara el usuario; no se detectan automáticamente. **Punto** o **Rectángulo** marcan exclusivamente el contenido visible, excluyendo cabecera, controles y bandas de ajuste. **Marcar centro** y **Ajustar región con teclado** permiten preparar coordenadas exactas sin arrastrar.

En el borrador describe el elemento (por ejemplo, «ala izquierda del pixel art»), elige **Este instante**, **Tramo** con final en segundos o **Todas las apariciones**, y añade una fuente editable opcional. Escribe `@phantom` para entregar el contexto al chat principal y su cola existente. Sin mención, se guarda como comentario local. La entrega conserva archivo y SHA-256, región normalizada, tiempo, frame base 0, FPS, alcance y los campos opcionales; el hilo permite copiar ese contexto. Las imágenes usan el mismo flujo sin tiempo ni FPS.

**Importar versión** copia un render nuevo y lo enlaza al anterior. **Comparar** muestra ambas versiones en el panel; cada video conserva controles independientes. No sincroniza automáticamente sus tiempos. El original conserva su archivo y hash y sus comentarios no se trasladan al render nuevo. Un archivo idéntico no se acepta como versión nueva. Los archivos viven en el almacén privado de referencias de cada proyecto.

El hilo muestra el estado real del handoff: enviando, entregado, en cola, fallido o acuse incierto. Entregado significa aceptado por el chat, no cambio realizado ni respuesta correcta del proveedor. Un fallo al guardar conserva texto y borrador en la vista abierta; vuelve a enviar. Si el comentario ya quedó guardado pero falló la entrega, **Reintentar envío** reutiliza el mismo hilo y brief. Una interrupción durante el envío deja acuse incierto: consulta el chat antes de formular una nueva solicitud. No hay reenvío automático de entregas inciertas. El usuario resuelve el comentario.

Límites: el paso de frame usa la rejilla nominal de los FPS declarados (redondeo al frame más próximo); no analiza VFR ni garantiza búsqueda al frame decodificado exacto de todos los codecs. Chromium debe poder decodificar el archivo. Se intenta adjuntar un PNG del frame (ancho máximo 960 px, hasta 900 000 caracteres base64); si el origen, el decoder o el tamaño lo impiden, el contexto registra el límite y conserva archivo/tiempo. No se amplían permisos de lectura ni CSP para capturarlo. El elemento y «todas las apariciones» expresan intención del usuario: no hay selección semántica ni seguimiento automático. Entregar contexto no modifica por sí mismo el ala ni la fuente editable. Los borradores conservados al fallar no sobreviven necesariamente a cerrar o recargar la ventana.

CLI (misma identidad, validación y comentarios que la UI):

```sh
node scripts/canvas.mjs review ID "Revisar el ala" --region 0.25,0.4,0.2,0.25 --time 1 --fps 24 --scope range --end 2 --element "ala izquierda" --editable-source "src/ave.aseprite"
node scripts/canvas.mjs add-version ID /ruta/al/render-nuevo.webm
node scripts/canvas.mjs comments --json
node scripts/canvas.mjs retry 1
```

`--region` usa fracciones 0–1 del contenido. `--scope` admite `instant`, `range`, `all`; en imagen usa `all`. Para entregar desde CLI como usuario añade `--author Tú` y una mención `@phantom` al texto. `--request-id UUID` hace idempotente el alta ante una respuesta perdida. La CLI no captura frames y deja ese límite explícito. Una respuesta del agente se añade con `reply N "…" --author Phantom`; no resuelve el hilo.

Pruebas declaradas: `node --test test/references.test.mjs test/canvas-cli.test.mjs test/video-review.test.mjs` y `node test/video-review-desktop.mjs` después de `npm run build`. El recorrido visual genera un ave pixel art sintética en WebM VP8, usa Electron/host aislados y un proveedor local inerte para llenar la cola; guarda capturas, resultados y salida del detector en `/tmp/opencode/video-review-*`. Su implementación no acredita una ejecución: los resultados los informa el controlador.

### Conexión móvil en la misma Wi-Fi

En el escritorio, abre **Configuración → Teléfono → Opciones avanzadas → Sin app: navegador del teléfono** y pulsa **Mostrar QR**. En la misma Wi-Fi: **escanea el QR → compara el código de seis dígitos → pulsa Vincular en el escritorio**. El navegador avisará del certificado: comprueba la huella mostrada por Phantom frente a la del navegador. En **Sin cámara** puedes copiar la dirección y pegar el código temporal; requiere la misma aprobación. La red y el puerto se eligen automáticamente; si hay varias interfaces puedes cambiarlos en el desplegable. No se configura ningún túnel ni firewall. Si la Wi-Fi aísla dispositivos, la conexión entre ellos no estará disponible.

La conexión usa exclusivamente **HTTPS**, con certificado local autofirmado y huella visible. El secreto del QR viaja en el fragmento de la dirección, que el teléfono borra al cargar; no llega al GET ni al Referer. Caduca a los dos minutos, sirve una sola vez y se renueva automáticamente en el panel. La solicitud de aprobación caduca en 60 segundos. El teléfono calcula localmente el código de comparación y crea una llave ECDSA P-256 privada no extraíble en IndexedDB. Cada petición RPC exige el bearer y una firma con esa llave, con ventana de 30 segundos y rechazo de firmas repetidas. Cada dispositivo obtiene acceso por ocho horas, revocable en Configuración → Teléfono. Desactivar o cerrar el host corta las conexiones y olvida códigos, pendientes y dispositivos. Reiniciar el host deja este acceso apagado; cerrar solo la ventana del escritorio conserva el host y su acceso activo.

La vista móvil es independiente del canvas: lista únicamente sesiones del proyecto autorizado, permite leer y enviar mensajes, parar un turno y responder permisos/preguntas explícitamente. La cola existente se ve pero se gestiona desde el escritorio. Conserva la posición de lectura y ofrece **Volver al final**. El texto y los detalles de herramientas se muestran como texto, sin vistas previas de archivos locales. El hilo está acotado a los últimos 200 mensajes y 100 partes por mensaje; respuestas de más de 2 MiB requieren consultar el escritorio.

Las terminales existentes ofrecen una pantalla reciente en texto (hasta 40 líneas de historial, o la pantalla alternativa acotada), entrada enviada exclusivamente con **Enviar** y **Parar** para terminar el proceso. La salida reemplaza la captura anterior; no se reproduce ni se reenvía entrada. Visitar/restaurar una sesión no crea procesos. No es un emulador táctil completo ni modifica el tamaño de la terminal del escritorio.

Las lecturas se actualizan cada dos segundos sin solaparse y se pausan al ocultar la página. Los errores detienen la consulta y ofrecen **Reconectar**; ninguna escritura se reintenta automáticamente. Si se pierde el acuse, consulta el hilo al reconectar antes de enviar de nuevo. Revocación, caducidad o pérdida de la llave en IndexedDB requieren otro emparejamiento. El bearer se conserva en `sessionStorage` de esa pestaña y junto a la llave en IndexedDB; viaja en `Authorization`, nunca en la dirección. No hay cookies ni secretos persistidos en el host. Hay límites de ocho dispositivos, cuatro solicitudes pendientes y 256 acciones por dispositivo; al agotarlos, revoca/empareja de nuevo según indique el error.

Pruebas declaradas: `test/mobile.test.mjs` usa hosts y builds sintéticos aislados, escuchando solo en loopback; cubre autenticación, caducidad, alcance, límites, rutas y acciones idempotentes. `node test/mobile-browser.mjs`, tras el build, usa Chromium a 390×844 y 360 px con el host/HTTP/autenticación reales y motores de conversación/terminal sintéticos, sin modelos ni shells. El script escribe capturas y resultados en `/tmp/phantom-mobile-evidence`. Los resultados de los checks corresponden al controlador.

#### App Android

Abre **Configuración → Teléfono** para vincular la app con el gateway del repo independiente `phantom-mobile`, sin usar la terminal. En **Opciones avanzadas** puedes guardar su ruta y consultar la versión de Node detectada (requiere **Node >= 26**). La ruta guardada tiene prioridad sobre `PHANTOM_MOBILE_REPO` y el repo hermano `../phantom-mobile`; `PHANTOM_MOBILE_NODE` permite seleccionar el binario Node del host.

1. Pulsa **Vincular teléfono** en Phantom.
2. Escanea el único QR con la app Phantom en Android: incluye la identidad del host y el código temporal, sin copiar datos. El teléfono debe estar en la misma red; puedes usar su hotspot si la Wi-Fi aísla clientes.
3. Pulsa **Permitir** en el escritorio tras leer los permisos. El clic reconoce explícitamente la autoridad del agente.

Puedes conceder lectura del chat principal, envío de mensajes, parada de turnos y lectura de herramientas del proyecto. El acceso al chat principal exige reconocer que el teléfono actuará con la autoridad del agente. **Actualizar permisos reemplaza los anteriores** por la selección del formulario; también puedes revocar dispositivos o detener el gateway. Los datos privados del gateway se guardan separados de los del escritorio. Al detener el host se detiene su gateway; al reiniciarlo se pierden las vinculaciones, pero se conserva la identidad TLS.

### Sesiones y cierre

- Cerrar la ventana conserva el host y sus sesiones. Volver a abrir conecta a los mismos procesos.
- **Ocultar vista** conserva el terminal; **Terminar proceso** lo detiene explícitamente y conserva historial.
- **Cerrar terminal (×)** termina el shell y sus procesos hijos y elimina el panel y sus sesiones, incluido el historial. Las terminales nuevas abren como paneles de 640 × 400 en el mapa; el botón de enfocar permite ampliarlas.
- **Detener host y salir** termina los procesos propios. Tras reiniciar el sistema o perder el host se recuperan la disposición y el historial guardado, con sesiones terminadas/perdidas; un shell nuevo se inicia explícitamente.
- El cierre espera que se guarden notas, nombres y posiciones pendientes. Si el disco/host no confirma, permite reintentar o cancelar.

La acumulación de salida de una terminal no corta la conexión compartida: el host conserva la pantalla y solicita a esa vista una captura actualizada al drenar el canal. Las demás terminales conservan su conexión.

### Una terminal, un worktree

- En un repositorio con commits, cada panel de terminal nuevo crea una rama `phantom/terminal-<id>` desde `HEAD` y un worktree independiente. Los cambios sin commit de la carpeta original no se copian.
- El shell arranca en ese worktree y su barra muestra la rama y la ruta. Relanzar una sesión del mismo panel reutiliza su worktree, también después de reiniciar el host.
- En carpetas sin Git, sin commits o sin Git instalado, abre una terminal normal e indica el motivo en la barra.
- Ocultar, detener o cerrar una terminal conserva los archivos y la rama del worktree. Los worktrees se almacenan en `worktrees/<workspace>/<panel>` dentro del directorio de estado de la app.
- Los paneles, menús, inspector, diálogos y avisos tienen entrada y salida breves. La preferencia del sistema de movimiento reducido sustituye desplazamientos por un fundido suave.
### Dependencias de terminales en worktrees

En proyectos Git, cada terminal crea o reutiliza su propio worktree. Si contiene `package.json` y `package-lock.json`, Phantom abre el shell en cuanto está creado el worktree y prepara sus dependencias en segundo plano con `npm ci --include=dev --no-audit --no-fund --foreground-scripts`. La terminal y los agentes están disponibles durante la instalación. Cada panel muestra el estado y la salida real de npm; los comandos del proyecto pueden necesitar que termine la instalación. La preparación puede tardar hasta cuatro minutos, con descargas y compilaciones nativas de npm. Hace falta npm en el PATH del host. La instalación es independiente por worktree: no se copia ni enlaza `node_modules` del proyecto original y la preparación no edita el manifest ni el lock.

Se omiten proyectos sin Git, sin Node, sin `package-lock.json` o con indicaciones de pnpm/yarn/bun (`packageManager`, locks o workspace pnpm). El soporte inicial no incluye `npm-shrinkwrap.json`: su presencia omite la preparación incluso si también hay package-lock. Un marcador dentro de `node_modules` permite reutilizar instalaciones completas que coincidan con package, lock, plataforma, arquitectura y ABI de Node; si cambia esa huella o faltan archivos se repara la instalación gestionada. Reconectar a una sesión viva o reiniciar el host no instala nada; después de reiniciar se solicita una sesión nueva explícitamente.

Si falla npm, la terminal permanece disponible y el panel muestra el error, una salida acotada y **Reintentar instalación**, sin reiniciar el shell ni el agente. La asignación del worktree se guarda **antes** de instalar; se conservan rama y cambios. Terminar la sesión o cerrar terminal/host cancela la instalación y termina los procesos npm y sus hijos. Una instalación manual preexistente sin marcador, un marcador ilegible o un `node_modules` enlazado se conservan y bloquean la preparación: mueve o elimina explícitamente `node_modules` para autorizar la instalación. Tras un corte abrupto durante la limpieza de npm puede ser necesaria esa misma recuperación si se perdió el marcador.

Para preparar este checkout mediante la misma API idempotente:

```sh
node scripts/setup-worktree.mjs
```

El script informa el resultado o falla con código de salida no cero; no instala al importarse ni crea metadata de preparación fuera de `node_modules`. Más detalles: [host/README.md](host/README.md#terminal-worktree-dependencies).

## Herramientas incluidas

### Revisión de video

Abre la raíz de un taller de videos como proyecto y elige **Herramientas → Revisión de video**. Selecciona un proyecto del taller y un render. Se requieren `bin/video.mjs`, `REVIEW.md` y el contrato de revisión v1: MP4, sidecar `exports/*.mp4.review.json` y snapshot conservado. Phantom comprueba el SHA256 antes de reproducir; un render antiguo sin asociación o con hash distinto exige renderizar de nuevo.

Pausa, avanza con ±1 frame (o ← → con foco en el visor), elige un frame o rango inclusivo y activa **Marcar zona** para arrastrar un rectángulo sobre el cuadro. Puedes asociar un elemento y guardar el comentario con la revisión abierta. El taller conserva las notas para `review list`; la lista permite saltar al frame y resolverlas, mostrando los estados obsoleto y resuelto por separado. V1 no incluye realtime multiusuario ni preview del árbol actual: se necesita un render.

| Herramienta | Funcionamiento |
|---|---|
| Terminales | PTY reales, xterm, snapshot ANSI, reconexión, salida acotada y backpressure. |
| Navegador | Navegación interna en foco; última captura etiquetada en overview. Contexto de navegación separado por proyecto. |
| Tareas | Borradores y checklists locales; consulta, creación y referencia de cards nativas Phantom. |
| Contexto | Búsqueda y lectura acotada de documentos, referencias fijadas, decisiones/memorias y skills de Phantom. |
| Skills | Catálogo visual de todas las Skills: carpeta del proyecto (`.claude/skills`, `.agents/skills`…), catálogo Phantom (el mismo que sirve su MCP) e instalaciones (Claude Code, plugins, Codex, OpenCode, agentes compartidos). Solo lectura; instrucciones renderizadas. |
| Misiones | Notas de continuidad, próxima acción y vínculos a paneles, tareas y ejecuciones. |
| Git | Cambios, ramas, worktrees y comparación con base elegida. «No integrada» no significa «lista para merge». |
| Servicios | URLs fijadas, servicios con proceso propietario y puertos Compose atribuidos al proyecto. |
| Docker | Contenedores propios, logs y acciones explícitas de iniciar/detener/reiniciar. Muestra ausencia o permisos insuficientes. |
| Workflows | Plantillas versionadas con tareas o pasos de playground que se ejecutan explícitamente. |
| Playground | Node, Python o shell en la carpeta seleccionada; ejecución, parada, salida y artefactos identificados. |
| Automatización | `automation.start` usa por defecto el navegador integrado visible. `mode: "isolated"` abre Chromium de Playwright separado y permite trazas reales. |
| Voz | Grabación explícita, transcripción local, texto editable e intención revisada para crear/encontrar trabajo. |

### Git y ramas listas para integrar

Con un proyecto abierto y el host conectado, Phantom consulta las ramas cada 20 s, también con la ventana oculta. Una rama está lista cuando no es la base, tiene trabajo `ready` y commits propios, no tiene cambios sin guardar ni errores, la comprobación de conflictos terminó sin conflictos y su terminal no está trabajando (también cuenta si no tiene terminal). La primera lectura muestra un único resumen dentro de la app; después avisa al quedar lista una rama o cambiar su commit, y vuelve a avisar si deja de estar lista y luego se recupera. Más de tres novedades se agrupan. La notificación del sistema se muestra solo con la ventana oculta o sin foco; al hacer clic abre **Ramas**.

La edición nativa avanzada de cards/skills/decisiones utiliza formularios JSON con validación de Phantom. Una card se reemplaza explícitamente cuando cambia el contrato; la original conserva su evidencia. Los modelos se ejecutan solo mediante una acción de run con configuración válida. Los tests de la app no consumen modelos comerciales.

## Tablero de referencias y comentarios

El canvas también es un tablero. Con el puntero sobre el lienzo:

- **Ctrl + V** pega lo que haya en el portapapeles: una imagen (captura, imagen copiada de una web o archivo copiado) crea una referencia; una URL crea una tarjeta de sitio con su título y su imagen de portada; una URL que es directamente una imagen se guarda como imagen con su fuente; cualquier otro texto crea una nota. También puedes **soltar** imágenes, videos y enlaces, o usar *clic derecho → Añadir imagen o video…*.
- Formatos: PNG, JPEG, WebP, GIF, AVIF (hasta 12 MB) y MP4, MOV, WebM (hasta 2 GB). El tipo se decide por el contenido del archivo. Los archivos se copian a `references/<proyecto>/` dentro de los datos de la app, con nombre por hash de contenido; no se escribe nada en la carpeta del proyecto.
- Cada referencia tiene una línea «¿Qué te gusta de esta referencia?». Es lo que un agente lee junto con el archivo.
- Las imágenes y videos conservan su proporción al redimensionar (Mayús la libera) y no se atenúan cuando otro panel está seleccionado.
- **C** activa la herramienta de comentarios: un clic deja un pin con su hilo sobre cualquier panel (el pin sigue al panel) o sobre el lienzo. Sobre un video, el comentario guarda el momento exacto: aparece en la línea de tiempo del panel y al abrirlo el video salta ahí. Los hilos se responden, se resuelven y se pueden copiar para un agente.
- Escribe **@phantom** (o @claude, @agente) en un comentario y el hilo se envía al chat de Phantom con el archivo, la posición del pin y el minuto. Si Phantom está ocupado, queda en su cola. El agente responde en el mismo hilo y tú decides cuándo resolverlo.

Los agentes usan el mismo tablero con `scripts/canvas.mjs`:

```sh
node scripts/canvas.mjs board "Investigación" --from refs.json   # [{ "image": ruta|URL | "url": sitio, "note", "source", "title" }]
node scripts/canvas.mjs add-image ./toma.png --note "encuadre" --zone "Investigación"
node scripts/canvas.mjs refs --zone "Investigación" --json       # archivo local, fuente, nota y comentarios abiertos
node scripts/canvas.mjs storyboard "Secuencia"                   # la zona como lista de tomas, de izquierda a derecha
node scripts/canvas.mjs storyboard "Secuencia" --remotion ~/videos/secuencia --seconds 3 --size 1080x1920
                                    # proyecto Remotion: npm install && npm run studio | npm run render
node scripts/canvas.mjs comments | reply 3 "Hecho" | resolve 3
```

En la exportación a Remotion cada referencia es una toma, en orden de lectura. Un video empieza en su primer comentario con minuto, y la nota sale como subtítulo (`--no-captions` la quita). Si vuelves a exportar a la misma carpeta, solo se reemplazan `src/shots.json` y `public/shots/`, así que tus cambios en `Storyboard.tsx` se conservan.

## Research en el canvas

`node scripts/canvas.mjs research "Tema" --from refs.json` crea o reutiliza un espacio `Research · Tema`: cada research tiene su propio espacio, Bandeja y panel **Lector**. El Lector abre las fuentes para triage; usa `mark ID inbox|liked|discarded` para mover su estado y **C** sobre una fuente para comentar. Sus acciones de comentarios permiten responder y resolver el hilo con `reply` y `resolve`; los atajos del canvas siguen disponibles: **Ctrl + K** abre la paleta y **0** ajusta el mapa.

Un comentario ligado a una URL conserva la URL, el título y, cuando está disponible, una captura PNG de la página que vio la persona. Límites: el Lector mantiene una sola página viva, algunos sitios con login o que bloquean la vista previa no se pueden mostrar, y no hay selección semántica de elementos de la página.

## Skills del producto

Las skills publicadas del producto viven en `skills/`. Para publicar una instalación global usa `phantom skill-publish skills/<id>/skill.json --global`; para comprobar qué skill corresponde a una acción usa `phantom skill-resolve <acción> --workspace RUTA`. Las versiones son inmutables: para cambiar una skill se publica una versión nueva.

## Navegador del agente y automatización

En una **terminal nueva creada por Phantom**, el agente descubre `PHANTOM_BROWSER_CLI`, `PHANTOM_BROWSER_ENDPOINT`, `PHANTOM_BROWSER_SESSION` y `PHANTOM_BROWSER_WORKSPACE`. La capacidad privada `PHANTOM_BROWSER_TOKEN` se hereda solo en esa terminal; no debe copiarse a prompts, logs ni archivos del proyecto. Las **cards en modo chat** (Claude · OpenCode · Codex) y el chat de Phantom reciben el mismo puente en cada turno: una identidad estable por card (sus paneles se reutilizan entre turnos) y una capacidad que solo vale mientras el turno está en curso y se revoca al terminar. Con la ventana abierta y ese proyecto activo:

```sh
node "$PHANTOM_BROWSER_CLI" help
node "$PHANTOM_BROWSER_CLI" context
node "$PHANTOM_BROWSER_CLI" preview http://127.0.0.1:5173/ --timeout-ms 15000
node "$PHANTOM_BROWSER_CLI" status
node "$PHANTOM_BROWSER_CLI" read --selector h1
node "$PHANTOM_BROWSER_CLI" fill --selector '#name' --value 'Ejemplo'
node "$PHANTOM_BROWSER_CLI" click --selector '#apply'
node "$PHANTOM_BROWSER_CLI" screenshot
node "$PHANTOM_BROWSER_CLI" console
```

`preview` y `open` esperan HTTP 2xx/3xx antes de crear/enfocar la vista y reutilizan el panel de la misma terminal y `--key` (predeterminada: `preview`). Read, click, fill y captura operan sobre el mismo WebContentsView visible y su sesión; los selectores son CSS, deben resolver un elemento para click/fill y no tienen auto-wait de Playwright. No existe ejecución de JavaScript arbitrario ni debugger público. Las capturas del CLI tienen nombres privados generados, límite de 8 MiB y retención por proyecto de 16 PNG/64 MiB.

**Abridores del sistema redirigidos.** Muchas skills y CLIs (p. ej. impeccable live, logins OAuth) abren URLs con `xdg-open` o `$BROWSER`, sin conocer este puente. En terminales de Phantom, `scripts/browser-shims/` va primero en `PATH` y `BROWSER` apunta a él: `xdg-open`, `sensible-browser`, `x-www-browser`, `www-browser`, `kde-open(5)` y `gio open` con una sola URL http(s) hacen `open` en el panel integrado. Si el puente falla, devuelven error (no abren el navegador externo a escondidas). Rutas, `mailto:` y otros subcomandos pasan al comando real con el `BROWSER` original. `PHANTOM_BROWSER_EXTERNAL=1` restaura el navegador del sistema.

La API del host acepta estos payloads para `automation.start` (no son subcomandos del CLI browser):

```json
{"workspaceId":"UUID_DEL_PROYECTO","sessionId":"UUID_TERMINAL_ACTIVA","url":"http://127.0.0.1:5173/","actions":[{"type":"fill","selector":"#name","value":"Ejemplo"},{"type":"click","selector":"#apply"}],"keepOpen":true}
```

```json
{"workspaceId":"UUID_DEL_PROYECTO","mode":"isolated","url":"http://127.0.0.1:5173/","headed":false,"actions":[{"type":"screenshot"}]}
```

El modo omitido es `integrated`: usa el puente del desktop y nunca llama a `chromium.launch`. `sessionId` se obtiene de `terminal.list`; puede omitirse si solo hay una terminal activa del proyecto. `key` comparte la identidad del panel con el CLI. Si faltan desktop, proyecto activo o credenciales de una terminal nueva, devuelve un error accionable, sin navegador externo de fallback. `headed:false` requiere `isolated`, que necesita Chromium instalado (`node node_modules/playwright/cli.js install chromium`).

Ambos modos conservan `automation.list`, `automation.stop`, estado/eventos y logs por run. En integrado, al completar se copia la captura al directorio del run y se recoge una instantánea de la consola retenida (hasta 100 mensajes, puede incluir mensajes anteriores del panel; no es streaming continuo). `keepOpen:true` conserva el controlador hasta Stop o `keepOpenMs`; de lo contrario lo libera al completar. **El panel integrado y su sesión permanecen abiertos en ambos casos**, también después de Stop/error; `panelRetained` lo identifica y `browserOpen` indica control vivo del run, no existencia física de esa vista. El cierre visual se hace desde el canvas. Stop y timeout no pueden cancelar un RPC del puente: esperan que termine el RPC pendiente antes de confirmar y no ejecutan más pasos; puede tardar hasta el límite de transporte de 75 s.

El puente integrado **no soporta trace Playwright**: el descriptor declara `traceSupported:false`, `automation.trace` devuelve error y no se inventa `trace.zip`. Para tests con aislamiento, headless, auto-wait y trace/visor usa explícitamente `mode:"isolated"`; ese modo cierra su navegador al completar salvo `keepOpen:true`. La disponibilidad HTTP de preview se comprueba una sola vez mediante el puente; el sondeo HEAD opcional de Servicios es diagnóstico puntual, no requisito adicional ni garantía de readiness de una aplicación. Este flujo utiliza Electron/Chromium; no establece ninguna causa de fallos observados en Firefox.

## Dictado local

En este equipo está preparado **faster-whisper base multilingüe, CPU/int8**, sin credenciales cloud. La app descubre su configuración en `voice-runtime/config.json` dentro de su directorio de estado. La transcripción puede equivocarse: siempre se muestra editable antes de convertirla en acción.

Para preparar otro perfil/equipo con Python3 y soporte venv:

```sh
npm run setup:voice
# Recomendado para dictado en vivo con GPU CUDA:
npm run setup:voice -- --model large-v3-turbo --device cuda --replace
# Alternativa de menor tamaño:
node scripts/setup-voice.mjs --model tiny
```

El instalador mantiene dependencias y modelos en el directorio propio de la app y respeta una configuración previa; `--replace` guarda una copia de la configuración anterior. Admite `tiny`, `base`, `small`, `medium`, `large-v3` y `large-v3-turbo`. Las descargas solo ocurren durante la instalación explícita; el dictado local trabaja offline, sin descargas implícitas.

En Ajustes → Dictado puedes elegir **Idioma del dictado** (Español, Inglés o Automático) y añadir **Vocabulario** de proyectos o términos (máximo 500 caracteres). En los detalles puedes ajustar **Pausa para cerrar frase (ms)** entre 300 y 2000 (por defecto 700) y **Sensibilidad de voz (VAD)** entre 0.2 y 0.8 (por defecto 0.5). Cambiar estos ajustes recrea el motor en el siguiente dictado.

**Interpretar comandos con** permite reglas locales (por defecto) o Claude. Claude requiere `ANTHROPIC_API_KEY` en el entorno del host; si falta o falla la petición, se usan las reglas locales. El modelo puede configurarse mediante `voiceIntentModel` (por defecto `claude-haiku-5-5`). La interpretación con Claude envía el texto dictado a su API; siempre produce un borrador para revisión, sin ejecutar acciones automáticamente. Ajustes permite otro comando local o un proveedor compatible configurado por el host. Las API keys no viajan al renderer. La prueba de audio usó voz sintética; el micrófono personal se utiliza al pulsar Grabar y conceder acceso.

## Datos y configuración

Estado predeterminado: `~/.local/state/phantom-workspace` (respeta `XDG_STATE_HOME`).

```text
state.json            Proyectos, disposición, referencias, tareas locales y preferencias
terminals.json        Historial acotado y descriptores de sesiones
worktrees/            Árboles Git independientes por workspace y panel de terminal
host.sock             Conexión privada al daemon
automation/           Playground, Playwright, logs y trazas por workspace/run
browser-artifacts/    Capturas del puente browser con retención acotada por proyecto
voice-runtime/        Motor y modelo local de voz
electron/             Perfil de la aplicación y contextos de navegador
```

`PHANTOM_WORKSPACE_HOME=/ruta/privada` permite aislar otro perfil. Phantom mantiene sus datos canónicos en su almacén habitual, configurable desde Ajustes. La app exporta/importa organización mediante JSON; exportar historial es opt-in. No mueve los documentos originales del proyecto.

## CLI Phantom: ejecuciones largas

Phantom Workspace carga automáticamente `scripts/phantom-fetch.mjs` mediante `--import` con ruta absoluta al iniciar los controladores `run`, `recover` y `verify` con Node, sin shell. Esto evita el límite de headers de Undici (300 s) mientras el agente sigue trabajando. Para iniciar el CLI manualmente con el mismo preload:

```sh
node --import /RUTA/phantom-workspace/scripts/phantom-fetch.mjs /RUTA/CLI.mjs run ID
```

Sustituye las rutas por las del preload y el archivo de entrada del CLI, e `ID` por el identificador de sesión. Solo los `POST` HTTP a loopback (`localhost`, `127.0.0.0/8`, `[::1]`) con ruta `/session/ID/message` usan `node:http`, sin timeout implícito de headers. La respuesta conserva un body en stream y la cancelación mediante `AbortSignal` hasta terminarlo. Las demás llamadas se delegan al `fetch` original. No requiere dependencias ni configuración global; se aplica únicamente al proceso iniciado con `--import`.

## Desarrollo y comprobaciones

```sh
npm ci
# Si npm bloquea los scripts nativos, revisarlos y habilitar estos dos:
npm install-scripts approve node-pty esbuild
npm rebuild node-pty esbuild
node node_modules/playwright/cli.js install chromium
npm run dev
```

```sh
npm test
node test/desktop-motion.mjs
PHANTOM_DESKTOP_SPIKE=1 PHANTOM_TEST_LOCAL_VOICE=1 npm test
npm run package
PHANTOM_TEST_EXECUTABLE="$PWD/out/Phantom Workspace-linux-x64/phantom-workspace" npm run test:desktop
```

Las pruebas desktop crean perfiles y repositorios sintéticos en `/tmp/opencode`; requieren un display. La prueba de voz real es opt-in y necesita el motor local preparado. Evidencia y límites: [VERIFICATION.md](VERIFICATION.md). [War Room](../harness_engineer/war-room/terminal-canvas/README.md).
