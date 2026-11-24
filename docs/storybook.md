# Storybook oficial de Phantom Workspace

## Abrir y construir

Requiere Node >=24 y las dependencias del lockfile. Para un entorno exclusivamente web, `npm ci --ignore-scripts` evita los instaladores nativos de Electron y node-pty; la app de escritorio tiene su propio procedimiento de instalación.

```sh
npm run storybook
npm run build-storybook
npm run inventory:storybook
node --test test/storybook-inventory.test.mjs
npm run test:storybook
```

El modo de desarrollo escucha en **127.0.0.1:6006**. El build escribe `storybook-static/`, ignorado por Git. El smoke necesita el Chromium de Playwright instalado en el entorno. No deja un servidor persistente: sirve el build en un puerto efímero, recorre su índice completo y cierra navegador y servidor en `finally`, con un plazo total.

## Recorrido

- **Catálogo / Inventario**: buscar archivo, símbolo o escenario; filtrar por familia; abrir stories reales; consultar todos los archivos del repositorio y las exclusiones.
- **Fundamentos / Tokens reales**: propiedades CSS computadas después de cargar los estilos de producción. Colores, superficies, radios, sombras y movimiento conservan sus nombres originales.
- **Fundamentos / Medidas**: tipografía, espaciado, targets, altura, padding, radio, sombra y transición medidos en controles reales. El ancho del contexto se puede variar desde Controls.
- **Primitivas–Fondos**: doce familias con componentes de producción, incluidos Canvas, terminal xterm, ChatCard, dock, orquestador, Repository, Cards, Skills, Configuración, móvil y voz.
- **Docs**, **Controls** y **Accessibility**: fuente del escenario, propiedades editables donde aplican y resultados del addon a11y. El addon expone incidencias; la existencia del catálogo y sus capturas no acreditan conformidad AA.

- **Propuestas**: laboratorio de diseño exploratorio, de primitivas a pantalla completa (material, controles, compositor, hilo, sesión, dock y cabecera del rail). Cada story tiene variantes en Controls y una comparativa lado a lado, con datos marcados SYNTHETIC. Sus estilos viven solo en `src/stories/proposals.css` (clases `.px-`); no cambia producción ni se registra en `catalog.mjs` hasta que una variante se apruebe.

Las propuestas de consolidación están separadas del estándar vigente. `DESIGN.md` sigue siendo la referencia de diseño; el catálogo no cambia contratos de producción.

## CSS y assets

`productionStyles()` en `scripts/storybook-inventory.mjs` carga primero las tres hojas compartidas de `main.jsx` (styles, tools, empty-state), recorre con AST las importaciones estáticas de `src/App.jsx` y deriva el orden de sus capas, incluidas las dependencias de componentes. Vite genera un módulo **solo de imports CSS**: no se importa ni monta App. Se conservan las capas studio/activity/canvas/terminal/chat/sidebar/shell/panels y el cierre de menús del grafo real. Los assets originales se empaquetan por imports y `staticDirs`.

`src/stories/catalog.css` contiene únicamente el escenario del catálogo: tamaños de panel, scroll, matriz y muestras. La configuración Vite de Storybook limita los selectores globales `:root`, `body` y `*` de `mobile.css` a `.mobile-app`, porque el cliente móvil y el escritorio tienen raíces independientes en producción. Así se conserva la paleta del cliente sin contaminar las stories de escritorio. La hoja original permanece intacta.

El decorador aporta `.app-shell` a las stories de escritorio y ajusta solo el layout exterior del escenario para permitir su scroll y aislamiento. `ClienteMovil` queda fuera de ese contexto: usa la raíz y estilos propios de MobileApp. El inventario conserva la tabla semántica y apila sus celdas etiquetadas en pantallas compactas.

`Panel` de `src/stories/decorators.jsx` conserva `<Panel>{children}</Panel>` y admite `width`, `height`, `host` (`catalog`, `canvas`, `inspector`, `sheet`) y `plugin`. Los hosts añaden la estructura real de nodo/herramienta, inspector o configuración; `plugin` añade `.plugin-surface`. El ancho se limita al espacio disponible. Por ejemplo, `<Panel width={380} host="canvas" plugin>…</Panel>` permite revisar un panel estrecho sin reducir el viewport de escritorio. Estos wrappers aportan contexto y dimensiones; las correcciones de controles pertenecen a producción.

## Añadir o ampliar escenarios

1. Importar el componente real en el archivo de su familia dentro de `src/stories/`. Los exports CSF deben ser estáticos, por ejemplo `export const Vacio = { ...ConDatos, parameters: { host: { scenario: 'empty' } } };`.
2. Darle sus props y el contexto estructural que utiliza en producción. ProjectSwitcher/Spaces requieren `.project-rail`; los plugins necesitan `.plugin-surface`; la terminal necesita `VoiceProvider`. Un contenedor del catálogo no reemplaza al componente.
3. Añadir la fuente a `catalog.mjs`: familia, escenario principal, selector de **DOM de producción** y límite concreto cuando exista. El inventario valida el ID contra los exports CSF y el build, y exige que la story referencie un import real de esa fuente.
4. Para estados privados accesibles, usar props de selección o un `play` que interactúe con controles reales. `ContratoCard`, `NuevaCard`, `Tablero`, `DetalleSkill`, `NuevaSkill`, `DetalleConvencion`, `RamaSeleccionada` y `Aprendizaje` muestran ese patrón.
5. Construir y ejecutar inventario y smoke. Una nueva fuente JSX/TSX fuera del catálogo sin entrada explícita falla. Un error atrapado por un boundary de producción tampoco debe aceptarse como escenario correcto: el smoke registra errores de consola, errores de página y llamadas a métodos desconocidos.

No registrar una tarjeta con el nombre del componente como cobertura. **Renderizado** significa que una composición ejecutable monta esa fuente; no significa que todos sus subcomponentes o ramas hayan sido ejecutados. Los símbolos privados se listan por AST con línea, exportación y enlace a las composiciones de su fuente, manteniendo explícita la cobertura individual no acreditada. Los hooks, registros de iconos, constantes y aliases no se cuentan como superficies independientes.

## Fixtures y aislamiento

`fixtures.js` usa nombres, rutas `/synthetic/…`, fechas fijas y datos de ejemplo. `host-mock.js` tiene un registro explícito de métodos; cualquier método desconocido rechaza con error y queda registrado. Las lecturas son clones, y las mutaciones soportadas solo alteran memoria o emiten callbacks sintéticos.

El `beforeEach` instala un host nuevo, limpia el almacenamiento del origen del catálogo y asigna un workspace distinto por montaje para aislar los borradores conservados por los hooks. El cleanup elimina listeners y resuelve las lecturas pendientes. Los componentes conservan sus propios desmontajes de polling, observers, xterm y audio. Docs usa iframes separados para no compartir hosts entre ejemplos simultáneos.

Se bloquean fetch externos y `/api/`, la apertura de ventanas y el micrófono antes de pedir permiso. El portapapeles es local a la fixture. El smoke añade bloqueo de red independiente. Ningún método se reenvía al host real. Una acción aún no modelada muestra el error del mock en lugar de ejecutar una operación real.

Estados disponibles:

| Caso | Ejemplos |
|---|---|
| Con datos | Chat, Cards, Skills, Repository, Ramas, Sitios, Bitácora |
| Vacío | Panel, ChatVacio, CentroVacio |
| Cargando | ChatCargando, CentroCargando, ResourceState |
| Error | ChatError, CentroError, ErrorNotice, micrófono aislado |
| Deshabilitado / desconectado | Controles, ChatDesconectado, botones dependientes del host |
| Selección | Grafo, RamaSeleccionada, ContratoCard, DetalleSkill, Apariencia |
| Atención / trabajo / éxito | ChatAtencion, ChatTrabajando, ActivityNotch, trazas y ramas |
| Texto largo / compacto | TextoLargo, Proyectos, Ramas; recorrido a 390 px y paneles estrechos dentro de escritorio como aceptación del conjunto |
| Teclado / movimiento reducido | Switch por Space, paleta y canvas reales; segunda captura con reduced motion |

### Límites de integración

- **Terminal**: motor xterm real, snapshot ANSI y callbacks sintéticos; no se crea un proceso PTY.
- **BrowserPanel**: barra, preview vacío y lector reales. WebContentsView solo existe en Electron; no se finge una página nativa ni una captura.
- **Voz**: captura, dictado, destinos y estados visuales reales. La transcripción/nivel del indicador son sintéticos; grabar produce el error local de micrófono aislado. No evalúa ASR.
- **VideoReview**: selección de proyecto/render real, sin material audiovisual verificado en la fixture. Los estados de reproducción y anotación de un render verificado pertenecen a las pruebas nativas existentes.
- **MobileApp**: formulario real sin credenciales ni pairing contra un servidor. Las vistas privadas Session/Question autenticadas no se declaran cubiertas. MobileSettings y AndroidGatewaySettings sí tienen escenarios propios.
- **App/WorkspaceUI**: inventariados, sin bootstrap/persistencia de la aplicación. Canvas, inspector y dock tienen composiciones directas; esto no se presenta como cobertura de App.
- **Remotion**: las dos plantillas TSX de `scripts/remotion-template/` están registradas como externas al renderer de Workspace, con su motivo.

## Comprobaciones

El inventario usa `@babel/parser`, incluido y fijado por el lockfile de Storybook, para JSX/TSX, declaraciones, imports y exports. No usa regex para contar funciones. La detección de nombres de custom properties en CSS sí es lexical; sus **valores** se leen del navegador, no se deducen del texto.

`inspectRepository()` devuelve todas las stories declaradas por AST, sin retirar escenarios para ajustar una cifra. `analyzeStories()` deriva IDs y referencias de imports, incluyendo stories heredadas, funciones y aliases locales. `validateStoryIndex(stories, index)` compara los IDs exactos de tipo story, ignora entradas Docs y señala IDs ausentes, ajenos o duplicados; un total coincidente no basta. El comando de inventario aplica esta comparación al build actual. Se conservan los siete tests de baseline y se añaden casos de discrepancias de IDs y análisis CSF.

El smoke de `test/storybook-smoke.mjs` es responsabilidad del hijo `verification` y su ejecución completa es aceptación del conjunto integrado. Su contrato es recorrer **todos los IDs de tipo story de `index.json`**, cotejarlos con el AST, esperar render y `play`, comprobar contenido, selectores de todas las fuentes del catálogo, errores de página/consola y métodos de fixture desconocidos. Incluye geometría de formularios, foco visible y acciones alcanzables en paneles compactos dentro de 1440×900, además del viewport de 390 px. El recorrido también ejercita el centro de mando, teclado, canvas, dictado y aislamiento al cambiar de story en el mismo iframe. Las capturas de escritorio y compacto en `.test-artifacts/` son evidencia del recorrido, no comparación visual automática contra un baseline aprobado. Esta documentación describe el alcance requerido; no acredita que el smoke ampliado haya pasado.

Comprobaciones adicionales del contrato: `npm run build`, `node --test test/design-tokens.test.mjs`, `docker compose config --quiet` y `docker compose build storybook`. Los resultados y el cierre de aceptación los comunica el controlador.

## Docker y descubrimiento en Sitios

```sh
docker compose config --quiet
docker compose build storybook
docker compose up -d storybook
docker compose port storybook 80
docker compose logs -f storybook
docker compose stop storybook
docker compose down
```

`Dockerfile.storybook` construye con Node 24 y `npm ci --ignore-scripts`; la etapa final sirve únicamente el catálogo estático con Nginx. Compose publica `127.0.0.1:${STORYBOOK_PORT:-0} → 80`: por defecto Docker asigna un puerto libre; para elegir uno, define `STORYBOOK_PORT` antes de operar Compose. Declara `app_protocol: http`, healthcheck de `/index.json`, `restart: "no"` y `x-phantom` con ciclo `ephemeral`, propósito y card de origen. No tiene `name` ni `container_name` fijos, mounts de usuario ni socket Docker. `.dockerignore` excluye dependencias, artefactos y secretos sin retirar fuentes, fixtures o assets.

Phantom descubre el Compose de esta raíz desde **Sitios** o **Servicios → Todos los proyectos**. La consulta no inicia contenedores. Los comandos anteriores son referencia para el controlador/padre, que arranca y registra después de aceptar el cambio; el executor no inicia servicios. La URL publicada se obtiene del binding efectivo (`docker compose port storybook 80`), no se presume 6006 ni se reutiliza un servicio ajeno observado allí. El smoke existente sirve su propio build en un puerto efímero y no necesita este preview arrancado.
