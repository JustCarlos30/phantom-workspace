# Plugins en el workspace

El acceso «Abrir Centro de Plugins» de la barra lateral abre o enfoca un panel
`plugins`. También está disponible desde creación de herramientas, el selector
del inspector y la paleta (Ctrl/Cmd K).

El Centro consulta `plugins.list`; permite activar Phantom por proyecto,
guardar preferencias y consultar conexión/modelos explícitamente. Cards y
Skills se declaran en `shared/plugins.mjs`; sus acciones aparecen en la paleta
cuando las preferencias del proyecto indican que está activado. Los paneles
ya existentes siguen siendo accesibles desde la lista y la paleta desactivados.

Los tipos `phantom-cards` y `phantom-skills` comparten el mismo contenido en
canvas e inspector. El wrapper consulta el registro antes de montar contenido
nativo; desactivado muestra una explicación y «Abrir Centro». Desactivar
conserva datos, configuración y referencias. Actualizar estado vuelve a consultar
el registro. Las preferencias actualizadas del workspace también lo recargan.

Los nodos guardan `pluginId` y `panelId`. Leer el detalle desde un panel guarda
`cardId` o la `ref` exacta de Skill sin descartar otros datos del nodo. El
inspector no tiene nodo y su selección es temporal. Abrir una referencia enfoca
un nodo del mismo tipo y referencia si existe; abrir el Centro reutiliza su nodo.
Las instancias se identifican por workspace, tipo y nodo (o inspector).

Cards ofrece lista/tablero, filtros, creación, reemplazo y controles explícitos;
Skills ofrece biblioteca, detalle y publicación de versiones. La autoridad y
validación nativas siguen en Phantom; ver `plugins-api.md`. Abrir estas vistas
no crea una sesión PTY. La disponibilidad depende del host y su configuración;
el registro habilitado no demuestra conexión ni ejecución satisfactoria.

Las superficies usan las variables dark actuales, formularios fluidos y scroll
interno; el tablero tiene desplazamiento horizontal. No se han observado checks
ni capturas de esta integración durante esta entrega; los ejecuta el controlador.
