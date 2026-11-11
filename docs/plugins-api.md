# Plugins first-party · contrato v1

El registro puro `shared/plugins.mjs` es importable desde UI y Node: `PLUGIN_MANIFESTS`,
`PHANTOM_PLUGIN`, `getPluginManifest(id)`, `validatePluginManifest(value)`,
`defaultPluginPreferences()`, `validatePluginConfig(id, value)`,
`validatePluginPreferences(value)` y `validatePluginPanelData(type, data)`.
Todos los manifiestos son JSON serializables y el registro está congelado.
Un manifiesto contiene exactamente `id`, `version` (semver), `name`, `description`,
`configuration`, `panels` y `actions`. Los campos de configuración declaran
`{type:'string',label,description,default,format?:'path'|'model'}`; cada panel
`{id,name,description,nodeType}`; cada acción `{id,name,description,panelId}`.
IDs y referencias deben ser válidos y únicos dentro de su categoría.

Para ampliar: declarar otro manifiesto validado, registrar su adaptador first-party,
su renderer y métodos explícitos en el host/allowlist desktop. El manifiesto no
contiene funciones, módulos, comandos ejecutables ni URLs para instalar código.
No hay instalación ni evaluación de código externo.

## Preferencias y paneles

Cada proyecto persiste en el Store de Workspace:

```json
{"plugins":{"phantom":{"enabled":false,"config":{"phantomPath":"","phantomData":"","model":""}}}}
```

Este es el default explícito, también para proyectos anteriores sin `plugins`.
Desactivar conserva configuración, paneles, selección y refs; no modifica objetos
nativos. Los métodos legacy `phantom.*` siguen disponibles sin activación.
`workspace.update` solo acepta `name` y `camera`: las preferencias se escriben por
`plugins.update`. Importar un snapshot antiguo que omite `workspace.plugins`
conserva las preferencias actuales del mismo proyecto canónico; un snapshot con
preferencias explícitas las restaura previa validación. Un proyecto nuevo empieza
desactivado. Persistencia/import rechazan configuración desconocida o inválida.

Tipos nuevos de nodo: `plugins` (Centro), `phantom-cards`, `phantom-skills`.
Los dos paneles de Phantom guardan `data.pluginId:'phantom'` y
`data.panelId:'cards'|'skills'`. `node.create` completa estos campos por tipo;
referencias explícitas incorrectas se rechazan. Los nodos antiguos sin ambos
campos se recuperan por tipo. `data` admite selección, filtros y refs nativas
serializables; desactivar el plugin no las elimina.

```json
{"method":"node.create","payload":{"workspaceId":"<uuid>","type":"phantom-skills","data":{"pluginId":"phantom","panelId":"skills","ref":{"id":"team/review","scope":"workspace","version":"1.0.0","sha256":"<sha256>"}}}}
```

## Métodos fijos

Todos requieren un `workspaceId` válido y explícito. Los métodos de `plugins`
rechazan campos extra; `id` debe ser `phantom` salvo en `plugins.list`.

* `plugins.list {workspaceId}` → `{items:[Plugin],observedAt}`.
* `plugins.update {workspaceId,id:'phantom',patch:{enabled?,config?}}` → `Plugin`.
  Patch parcial: `config` se fusiona por campo; no reemplaza los campos omitidos.
* `plugins.status {workspaceId,id:'phantom'}` →
  `{available,reason?,source:'phantom',cli?,version?,observedAt}`.
  Ejecuta la lectura nativa `list --json` contra la configuración efectiva;
  `version`, si existe, procede del package de esa instalación. La existencia del
  fichero por sí sola no implica disponibilidad. No ejecuta modelos.
* `plugins.models {workspaceId,id:'phantom'}` →
  `{available,models:[string],reason?,observedAt}`.
  Ejecuta `opencode models` (o `settings.opencodePath`) como comando argv sin shell,
  en el directorio del proyecto, con timeout y límite de salida. Devuelve IDs reales
  `provider/model`, sin catálogo sintético. Error, salida vacía o inválida produce
  `available:false`, `models:[]` y motivo.

`Plugin` contiene exactamente `{id,name,version,description,enabled,config,panels,actions,source:'builtin'}`.
`observedAt` es ISO-8601. Status y modelos funcionan con el plugin desactivado.
Un backend ausente se representa como no disponible; los errores de payload o
proyecto se rechazan, no se convierten en estados de disponibilidad.

```json
{"method":"plugins.update","payload":{"workspaceId":"<uuid>","id":"phantom","patch":{"enabled":true,"config":{"phantomPath":"/opt/phantom/bin/phantom.mjs","phantomData":"/var/tmp/project-phantom","model":"openai/gpt-5"}}}}
```

`phantomPath`, `phantomData` y `model` son strings, sin caracteres de control ni
espacios iniciales/finales. Paths no vacíos deben ser absolutos. `phantomData`
debe quedar fuera del proyecto incluso resolviendo ancestros symlink; puede no
existir aún. Un path CLI inexistente puede guardarse y se diagnostica por status.
Un string vacío significa heredar, nunca borrar configuración global:

* CLI: override del proyecto → `settings.phantomPath` → `PHANTOM_CLI` →
  `~/.local/lib/node_modules/phantom-harness/bin/phantom.mjs` → fallback hermano
  `../../harness_engineer/bin/phantom.mjs` relativo al adaptador.
  Una configuración explícita inválida no se sustituye silenciosamente.
* Datos: override → `settings.phantomData` → entorno/default nativo Phantom.
  Un override se pasa mediante `--data` al CLI nativo.
* Modelo: `phantom.control.model` no vacío → override del proyecto →
  `settings.model` → `settings.phantomModel`. `run` requiere un modelo efectivo.

## Cards, Skills, evidencia y controles

Las superficies nuevas llaman los métodos `phantom.*` existentes incluyendo
**`pluginId:'phantom'`**, opcionalmente `panelId:'cards'|'skills'`. Es obligatorio
que la UI nueva incluya el marcador en todas las escrituras/controles. El host
valida la habilitación para `phantom.create`, `phantom.update`, `phantom.control`
marcados. Lecturas siguen permitidas al desactivar. El marcador identifica la
superficie, no es una credencial; las herramientas legacy conservan su contrato.

```json
{"method":"phantom.create","payload":{"workspaceId":"<uuid>","pluginId":"phantom","panelId":"cards","kind":"card","input":{"goal":"Revisar documentación","lane":"coordinated","scope":["README.md"],"checks":[{"name":"docs","argv":["node","--version"]}]}}}
```

* `phantom.list {workspaceId,pluginId?,topic:'tasks'|'skills'|'memories',query?,allVersions?}`
  → `{available,items,reason?,observedAt}`. El `raw` conserva el objeto nativo.
* `phantom.detail {workspaceId,pluginId?,topic,id,ref?}` → objeto nativo.
  Tasks exponen contrato, checklist/evidencia presentes en el objeto; la secuencia
  de eventos se obtiene por separado.
* **`phantom.events {workspaceId,id,pluginId?,panelId?}`** →
  `{available:true,source:'phantom',id,items:[eventos nativos],observedAt}`.
  Verifica primero `show id` y ownership del workspace o familia Git worktree,
  después ejecuta `events id --json`. Un ID ajeno o un error nativo rechaza el RPC;
  no se fabrica una lista vacía exitosa. No hay filtro de evidencia destructivo.
* `phantom.create {workspaceId,pluginId?,kind:'card'|'skill'|'decision',input,idempotencyKey?}`
  y `phantom.update {...,id,revision?,ref?,replace?}` conservan validación nativa,
  idempotencia y errores de resultado incierto. Cards son inmutables: update exige
  `replace:true`, crea otra card y devuelve `semantic:'replacement',replaces,relatedRef`.
  Skills requieren nueva versión, `revision` leída y, si es ambiguo, la `ref` exacta.
  El detalle de Skills mantiene `manifest.body`, recursos y `ref` con SHA inmutable;
  no se sustituye una ref histórica por “latest”. Global Skills son de solo lectura.
* `phantom.control {workspaceId,pluginId?,id,action:'run'|'stop'|'cancel'|'recover'|'verify',model?}`
  usa el CLI real. `cancel` devuelve resultado nativo; los otros inicios devuelven
  descriptor de proceso persistido en `workspace.phantomControllers`.
  `tool.output` y `tool.status` notifican seguimiento, también consultable en
  `state.get`. `stop` solo interrumpe un proceso vivo propiedad de este host.
  Tras reiniciar, descriptores `running` pasan a `lost`, sin autoridad para matar PID.
  `descriptor.status:'completed'` significa exclusivamente salida 0 del proceso
  del CLI, **no card completada ni aceptación**; el estado de task siempre se lee
  de `phantom.detail`/list y sus eventos. No se ejecuta un modelo al listar,
  consultar estado, crear una card ni publicar una Skill.

El Store solo contiene preferencias, referencias UI y descriptores de procesos.
Los objetos, eventos y estados Phantom siguen en su almacenamiento nativo;
el adaptador no abre ni sobrescribe esa base. Los journals de escrituras existentes
guardan idempotencia, no una base paralela de tareas. La persistencia usa el contexto
del host directamente, sin invocaciones recursivas ni colas de RPC dependientes.
