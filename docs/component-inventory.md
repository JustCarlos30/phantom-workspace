# Inventario del sistema UI

Fuente reproducible: `scripts/storybook-inventory.mjs` + `src/stories/catalog.mjs`. La matriz **Catálogo → Inventario** se genera del árbol actual en cada build, con búsquedas, enlaces, todas las exportaciones y declaraciones capitalizadas (incluidas privadas), líneas y motivos de exclusión. El mapa completo clasifica también los archivos que no son JSX. Dependencias, `.git` y artefactos generados se excluyen explícitamente.

**Inventario completo de `src/components`, 12 familias.** El total vigente de fuentes y stories se deriva del AST y se muestra en la matriz y en `npm run inventory:storybook`; no se fija un total de aceptación. Cada fila siguiente declara un import real y un selector de su UI para el smoke. La cobertura es de fuente/composición, no un porcentaje de ramas ni una aprobación del smoke. Los símbolos que no se ejercitan individualmente conservan ese estado en la matriz; ni documentación, providers ni registros se suman como componentes visuales adicionales.

Los enlaces presuponen el servidor de desarrollo local en el puerto 6006. Compose asigna un puerto libre por defecto; usa su URL efectiva con los mismos IDs o la búsqueda de Storybook. Un servicio ya existente en 6006 no acredita que sirva el build actual.

| Familia | Fuente (`src/components/`) | Escenario principal |
|---|---|---|
| Primitivas | EmptyState.jsx | [Panel](http://127.0.0.1:6006/?path=/story/primitivas--panel) |
| Primitivas | CopyButton.jsx | [Controles](http://127.0.0.1:6006/?path=/story/primitivas--controles) |
| Primitivas | PluginPrimitives.jsx | [Controles](http://127.0.0.1:6006/?path=/story/primitivas--controles) |
| Primitivas | Presence.jsx | [Presencia](http://127.0.0.1:6006/?path=/story/primitivas--presencia) |
| Identidad | AgentIdentity.jsx | [Agente](http://127.0.0.1:6006/?path=/story/identidad--agente) |
| Identidad | Glyphs.jsx | [Marcas](http://127.0.0.1:6006/?path=/story/identidad--marcas) |
| Identidad | ShellIcons.jsx | [Iconos](http://127.0.0.1:6006/?path=/story/identidad--iconos) |
| Identidad | GengarMascot.jsx | [Mascota](http://127.0.0.1:6006/?path=/story/identidad--mascota) |
| Identidad | TitiGhost.jsx | [Titi](http://127.0.0.1:6006/?path=/story/identidad--titi) |
| Navegación | Canvas.jsx | [Lienzo](http://127.0.0.1:6006/?path=/story/navegación--lienzo) |
| Navegación | Minimap.jsx | [Minimapa](http://127.0.0.1:6006/?path=/story/navegación--minimapa) |
| Navegación | Spaces.jsx | [Espacios](http://127.0.0.1:6006/?path=/story/navegación--espacios) |
| Navegación | ProjectSwitcher.jsx | [Proyectos](http://127.0.0.1:6006/?path=/story/navegación--proyectos) |
| Navegación | SidebarPanels.jsx | [Paneles](http://127.0.0.1:6006/?path=/story/navegación--paneles) |
| Navegación | RailUsage.jsx | [Límites](http://127.0.0.1:6006/?path=/story/navegación--limites) |
| Navegación | ToolPicker.jsx | [Herramientas](http://127.0.0.1:6006/?path=/story/navegación--herramientas) |
| Navegación | CommandPalette.jsx | [Comandos](http://127.0.0.1:6006/?path=/story/navegación--comandos) |
| Navegación | Inspector.jsx | [Inspector contextual](http://127.0.0.1:6006/?path=/story/navegación--inspector-contextual) |
| Navegación | ProjectPicker.jsx | [Selector](http://127.0.0.1:6006/?path=/story/navegación--selector) |
| Navegación | ShortcutSettings.jsx | [Atajos](http://127.0.0.1:6006/?path=/story/navegación--atajos) |
| Actividad | ActivityNotch.jsx | [Resumen](http://127.0.0.1:6006/?path=/story/actividad--resumen) |
| Actividad | ActivityTrace.jsx | [Trazas](http://127.0.0.1:6006/?path=/story/actividad--trazas) |
| Actividad | PlanPhases.jsx | [Plan](http://127.0.0.1:6006/?path=/story/actividad--plan) |
| Conversaciones | TerminalPanel.jsx | [Terminal](http://127.0.0.1:6006/?path=/story/conversaciones--terminal) |
| Conversaciones | TerminalCard.jsx | [Tarjeta terminal](http://127.0.0.1:6006/?path=/story/conversaciones--tarjeta-terminal) |
| Conversaciones | ChatCard.jsx | [Chat](http://127.0.0.1:6006/?path=/story/conversaciones--chat) |
| Conversaciones | TouchedFiles.jsx | Sin escenario (se ve dentro de Tarjeta terminal y Chat con un worktree) |
| Conversaciones | PhantomChat.jsx | [Dock](http://127.0.0.1:6006/?path=/story/conversaciones--dock) |
| Conversaciones | PhantomOrchestrator.jsx | [Orquestador](http://127.0.0.1:6006/?path=/story/conversaciones--orquestador) |
| Conversaciones | OrchestratorHub.jsx | [Orquestador global](http://127.0.0.1:6006/?path=/story/conversaciones--orquestador-global) |
| Herramientas | ToolPanels.jsx | [Código](http://127.0.0.1:6006/?path=/story/herramientas--codigo) |
| Herramientas | Environment.jsx | [Entorno](http://127.0.0.1:6006/?path=/story/herramientas--entorno) |
| Herramientas | PluginPanels.jsx | [Plugin panel](http://127.0.0.1:6006/?path=/story/herramientas--plugin-panel) |
| Herramientas | PluginCenter.jsx | [Centro](http://127.0.0.1:6006/?path=/story/herramientas--plugins-centro) |
| Herramientas | Plugins.jsx | [Compatibilidad](http://127.0.0.1:6006/?path=/story/herramientas--plugins-compatibilidad) |
| Herramientas | CommandCenter.jsx | [Centro de mando](http://127.0.0.1:6006/?path=/story/herramientas--centro-de-mando) |
| Herramientas | ToolOutput.jsx | [Salida](http://127.0.0.1:6006/?path=/story/herramientas--salida) |
| Phantom | PhantomCards.jsx | [Cards](http://127.0.0.1:6006/?path=/story/phantom--cards) |
| Phantom | PhantomSkills.jsx | [Skills](http://127.0.0.1:6006/?path=/story/phantom--skills) |
| Phantom | SkillsCatalog.jsx | [Catálogo Skills](http://127.0.0.1:6006/?path=/story/phantom--catalogo-skills) |
| Phantom | PhantomConvencions.jsx | [Convenciones](http://127.0.0.1:6006/?path=/story/phantom--convenciones) |
| Phantom | MemoryCard.jsx | [Memoria](http://127.0.0.1:6006/?path=/story/phantom--memoria) |
| Phantom | SkillsMarkdown.jsx | [Markdown Skills](http://127.0.0.1:6006/?path=/story/phantom--markdown-skills) |
| Git | Repository.jsx | [Repositorio](http://127.0.0.1:6006/?path=/story/git--repositorio) |
| Git | Branches.jsx | [Ramas](http://127.0.0.1:6006/?path=/story/git--ramas) |
| Git | RepoGraph.jsx | [Grafo](http://127.0.0.1:6006/?path=/story/git--grafo) |
| Git | Incorporaciones.jsx | [Cola](http://127.0.0.1:6006/?path=/story/git--cola) |
| Git | IntegrationReview.jsx | [Revisión](http://127.0.0.1:6006/?path=/story/git--revision) |
| Git | MergePath.jsx | [Camino](http://127.0.0.1:6006/?path=/story/git--camino) |
| Contenido | Markdown.jsx | [Texto](http://127.0.0.1:6006/?path=/story/contenido--texto) |
| Contenido | MarkdownTable.jsx | [Tabla](http://127.0.0.1:6006/?path=/story/contenido--tabla) |
| Contenido | BrowserPanel.jsx | [Navegador](http://127.0.0.1:6006/?path=/story/contenido--navegador) |
| Contenido | References.jsx | [Referencia](http://127.0.0.1:6006/?path=/story/contenido--referencia) |
| Contenido | ResearchReader.jsx | [Lector](http://127.0.0.1:6006/?path=/story/contenido--lector) |
| Contenido | GlobalSites.jsx | [Sitios](http://127.0.0.1:6006/?path=/story/contenido--sitios) |
| Contenido | VideoReview.jsx | [Revisión video](http://127.0.0.1:6006/?path=/story/contenido--revision-video) |
| Contenido | VideoLog.jsx | [Bitácora](http://127.0.0.1:6006/?path=/story/contenido--bitacora) |
| Ajustes | Settings.jsx | [Configuración](http://127.0.0.1:6006/?path=/story/ajustes--configuracion) |
| Ajustes | Appearance.jsx | [Apariencia](http://127.0.0.1:6006/?path=/story/ajustes--apariencia) |
| Ajustes | MobileSettings.jsx | [Móvil](http://127.0.0.1:6006/?path=/story/ajustes--movil) |
| Ajustes | AndroidGatewaySettings.jsx | [Android](http://127.0.0.1:6006/?path=/story/ajustes--android) |
| Ajustes | MobileApp.jsx | [Cliente móvil](http://127.0.0.1:6006/?path=/story/ajustes--cliente-movil) |
| Ajustes | PhoneQr.jsx | [Código QR](http://127.0.0.1:6006/?path=/story/ajustes--codigo-qr) |
| Voz | VoiceActivity.jsx | [Indicador](http://127.0.0.1:6006/?path=/story/voz--indicador) |
| Voz | VoiceCapture.jsx | [Captura](http://127.0.0.1:6006/?path=/story/voz--captura) |
| Voz | VoiceDictation.jsx | [Dictado](http://127.0.0.1:6006/?path=/story/voz--dictado) |
| Voz | VoiceProvider.jsx | [Lanzador](http://127.0.0.1:6006/?path=/story/voz--lanzador) |
| Fondos | AsciiField.jsx | [ASCII](http://127.0.0.1:6006/?path=/story/fondos--ascii) |
| Fondos | PixelField.jsx | [Píxeles](http://127.0.0.1:6006/?path=/story/fondos--pixeles) |

## Composiciones internas y huecos explícitos

- **Cards**: mesa, tablero, contrato y formulario nuevo montan DeskCard, StatusPill, CardDetail y CardForm mediante las vías reales de selección. No se acredita cada acción de ejecución/reemplazo ni cada CheckEvidence.
- **Skills**: catálogo, detalle y formulario nuevo; referencia/manifiesto sintéticos válidos. Los recursos y el versionado se exploran desde controles reales; la publicación nativa no está conectada.
- **ChatCard**: estados vacío, cargando, error, datos, trabajo, permiso pendiente y desconexión; Message, Markdown y controles reales. Los subagentes/handoffs privados no están todos ejercitados individualmente.
- **Compositores ChatCard/PhantomChat**: `Conversaciones/Compositor320`, `Compositor480`, `Compositor640`, `CompositorExpandido` y sus variantes `Dock` montan la UI real (carpeta, permisos, modelo y effort en la barra) con carpeta/modelo largos. `PermisosProyecto`, `PermisosProyectoError` y `PermisosProyectoGuardados` permiten guardar/quitar con el checkbox real sobre persistencia sintética. `Voz/CompositorGrabando`, `CompositorTranscribiendo`, `CompositorRevision` y sus variantes `Dock` usan recorder/compositor reales con MediaStream generado y ASR sintético; Controls permite 320/480/640/960 px. `test/composer-ux.test.mjs` declara cuatro pruebas de permisos, error/reintento, geometría/teclado y voz; toda salida generada (PNG, JSON e informe Markdown) va a `.test-artifacts/`. Estado de verificación: [compositor](composer-ux-verification.md). Los escenarios declarados no acreditan ejecución, revisión visual ni audio nativo.
- **Observabilidad de agentes** (`PhantomOrchestrator`: secciones Agentes y Supervisor, detalle de agente; `SubagentCard` con «Ver detalle e historial»): leen solo `agent.traces.list|detail` y `supervisor.read|configure|refresh`. `test/agent-observability-ui.test.mjs` monta `ChatCard`, `PhantomChat` y `PhantomOrchestrator` productivos con CSS real y un backend que usa los módulos reales `agent-traces` y `workspace-supervisor` sobre un directorio temporal (proveedor = fixture, sin Claude ni red). Las stories del catálogo no tienen host: muestran los estados «no disponible»/error, no historial. Ver [agent-observability.md](agent-observability.md); sin total de pruebas fijado aquí.
- **Orquestador global** (`OrchestratorHub`, `OrchestratorHubButton`, `OrchestratorRailEntry`; datos de `useOrchestratorInbox` sobre `buildInbox`): «Se rompió» y «Te necesita» por proyecto, línea por proyecto con el supervisor (sin coste) y composer con `orchestrator.send`; el borrador es global y sobrevive al cambio de proyecto. Stories `Conversaciones/OrquestadorGlobal*` (datos, 320 px, vacío, cargando, error, sin conexión, accesos) con tres proyectos SYNTHETIC del escenario `orchestrator-hub` de `host-mock.js`. `test/orchestrator-hub-ui.test.mjs` lo monta con su CSS real en Chromium headless (bundle esbuild + `page.setContent`, sin servidor; fixture `test/fixtures/orchestrator-hub.jsx`, mismo host sintético), incluye entrada malformada, error y desconexión; capturas en `/tmp/phantom-orchestrator-recovery/`, fuera del árbol Git. Aún no está montado en `App.jsx`.
- **TouchedFiles**: insignia y panel lateral de archivos tocados (lista + diff, persistente) (sondeo `repo.changes`, diff `repo.diff` contra la base). Aún no tiene historia propia; el mock de Storybook no devuelve `repo.changes`, así que no se renderiza sin worktree y host real.
- **Canvas**: nota editable, selección, navegación, minimapa y encabezado reales. Terminal, browser, referencias y herramientas también tienen escenarios independientes; eso no acredita todas las combinaciones internas de CanvasNode.
- **Repository**: pantalla de repositorio e historial reales. Ramas tiene selección/detalle; no se declara cobertura individual del editor de archivos privados ni de escrituras Git.
- **ToolPanels**: Trabajo, Borradores, Misiones, Procesos, Servicios, Docker, Secuencias, Navegador automático y Código. Primitivas duplicadas comparables en Controles.
- **ActivityNotch**: resumen, bandeja y estados de terminal. **Presence** es infraestructura de transición, no una tarjeta visual. **VoiceProvider** es contexto montado con su launcher.
- **Iconos**: Glyphs y ShellIcons renderizan marcas y variantes; helpers de elección y registries no son superficies. `PanelIcons.js` y los hooks JS están en el mapa completo como soporte, fuera del recuento de fuentes JSX.
- **Titi**: `GengarMascot.jsx` conserva su nombre de archivo histórico, pero monta el rig actual con `.titi-mascot[data-identity="hero"]`. La story Mascota mantiene su cobertura visible; TitiGhost tiene además su composición de moods.
- **App.jsx / WorkspaceUI / WorkspaceErrorBoundary**: integración de entrada/persistencia excluida. WorkspaceUI y el boundary no se exportan; las composiciones directas de Canvas/Inspector/dock no se contabilizan como render de App.
- **main.jsx**: bootstrap con createRoot, no importable como muestra sin arrancar la app. **.storybook/preview.jsx**: configuración, sin componente visual propio.
- **scripts/remotion-template/{Root,Storyboard}.tsx**: plantillas para otro runtime; exclusiones explícitas y símbolos AST disponibles.
- **MobileApp.Session / Question**, reproducción de video verificado, WebContentsView y audio real: límites descritos en [la guía](storybook.md#límites-de-integración). El formulario móvil, selector de video, chrome de browser y UI de voz sí son reales y están renderizados.

La matriz conserva la lista completa de símbolos por fuente y no convierte inferencias AST en cobertura renderizada. Un símbolo capitalizado puede ser constante, alias o helper; el inventario lo indica como candidato que requiere interpretación semántica.

## Oportunidades priorizadas — propuestas, no estándar nuevo

| Prioridad | Oportunidad | Próximo paso concreto |
|---|---|---|
| P1 | Button/Field/ErrorNotice/DataView/ResourceState duplicados | Comparar props, errores, retry y semántica accesible de ToolPanels y PluginPrimitives antes de elegir un contrato compartido. |
| P1 | Dos CopyButton | Resolver `text` frente a `value`, feedback y fallos de portapapeles; migrar consumidores por separado. |
| P1 | Grandes componentes privados | Extraer límites testeables de ChatCard, Canvas, Repository y ToolPanels en un encargo de producción específico; añadir escenarios de ramas que hoy no son accesibles directamente. |
| P2 | Estados de recursos | Unificar vocabulario y preservación de datos stale, sin ocultar fuentes/errores ni mezclar estado nativo y controlador. |
| P2 | Densidad y accesibilidad | Revisar capturas compactas, foco/teclado y resultados a11y por escenario; corregir incidencias observadas antes de afirmar AA. |
| P2 | Tokens locales y valores repetidos | Usar Fundamentos/Medidas para comparar valores computados con DESIGN, sin promocionar automáticamente cada literal CSS a token. |
| P3 | Integraciones nativas | Mantener suites separadas para PTY, WebContentsView, ASR, video verificado y móvil autenticado; el catálogo no las sustituye. |
