# Plugins first-party: contrato host/UI v1

Los manifiestos de `shared/plugins.mjs` son datos JSON serializables y validados,
compartidos por renderer y host. El registro inicial contiene **un plugin
`phantom`**, con dos paneles (`cards`, `skills`). No instala ni ejecuta código
externo. Para extenderlo se añade un manifiesto first-party, un adaptador host
revisado y sus rutas/allowlist explícitas; el manifiesto por sí solo no concede
permisos ni registra handlers ejecutables.

## Manifiesto y preferencias

Un manifiesto contiene exactamente:

```json
{
  "id": "phantom",
  "version": "1.0.0",
  "name": "Phantom",
  "description": "Cards y Skills nativas de Phantom.",
  "configuration": {
    "phantomPath": {"type":"string","default":"","label":"CLI Phantom (ruta absoluta)"},
    "phantomData": {"type":"string","default":"","label":"Datos Phantom (fuera del proyecto)"},
    "model": {"type":"string","default":"","label":"Modelo OpenCode"}
  },
  "panels": [
    {"id":"cards","name":"Cards","nodeType":"phantom-cards"},
    {"id":"skills","name":"Skills","nodeType":"phantom-skills"}
  ],
  "actions": [
    {"id":"phantom.cards","name":"Abrir Cards","panelId":"cards"},
    {"id":"phantom.skills","name":"Abrir Skills","panelId":"skills"}
  ]
}
```

Las acciones abren/enfocan el panel declarado; no son comandos de shell.
`validatePluginManifest` rechaza campos desconocidos, valores ejecutables,
ciclos, versiones inválidas, IDs duplicados y referencias a paneles inexistentes.
`PLUGIN_MANIFESTS`, `PHANTOM_PLUGIN`, `defaultPlugins`,
`validatePluginPreferences` y `validatePluginConfig` son exports reutilizables.

Las preferencias persistidas pertenecen a cada proyecto:

```json
{"plugins":{"phantom":{"enabled":false,"config":{"phantomPath":"","phantomData":"","model":""}}}}
```

El Centro empieza explícitamente desactivado tanto en proyectos nuevos como al
migrar estados anteriores. Desactivar conserva configuración, paneles y refs.
No desactiva las herramientas legacy `tasks`/`context`, ni las llamadas
`phantom.*` legacy sin marcador de plugin.

Los tres campos de configuración son strings; `""` hereda `settings.phantomPath`,
`settings.phantomData` o `settings.model`, respectivamente. Los overrides no
reescriben esos ajustes globales. Las rutas no vacías deben ser absolutas,
sin controles/NUL; `phantomData` debe quedar fuera del proyecto, también tras
resolver symlinks y ancestros existentes. No es necesario que la instalación
exista para guardar una ruta: `plugins.status` comunica la indisponibilidad.
Un patch de configuración mezcla campos: omitir un campo lo conserva, `""`
elimina su override. Cambiar modelo no ejecuta ningún modelo.

La carga/import valida preferencias. Una importación de snapshot anterior sin
`workspace.plugins` conserva las preferencias actuales del mismo ID y ruta
canónica; una importación que sí contiene `plugins` aplica sus valores validados.
La escritura habitual del canvas usa `workspace.update` (nombre/cámara) y
`node.update`, por lo que no puede pisar preferencias desde una ficha vieja.

## API fija de plugins

Invocaciones normales del bridge host (`invoke(method, payload)`). Todos los
timestamps `observedAt` son strings ISO-8601. IDs/proyectos o payloads inválidos
rechazan la invocación; un backend ausente devuelve `available:false` en las
consultas de disponibilidad. Los campos adicionales se rechazan.

### `plugins.list`

Payload: `{workspaceId}`. Respuesta:

```json
{
  "items": [{
    "id":"phantom","name":"Phantom","version":"1.0.0",
    "description":"Cards y Skills nativas de Phantom.",
    "enabled":false,
    "config":{"phantomPath":"","phantomData":"","model":""},
    "panels":[{"id":"cards","name":"Cards","nodeType":"phantom-cards"},{"id":"skills","name":"Skills","nodeType":"phantom-skills"}],
    "actions":[{"id":"phantom.cards","name":"Abrir Cards","panelId":"cards"},{"id":"phantom.skills","name":"Abrir Skills","panelId":"skills"}],
    "source":"builtin"
  }],
  "observedAt":"2026-11-11T00:00:00.000Z"
}
```

`config` contiene preferencias guardadas, no valores globales resueltos.

### `plugins.update`

Payload: `{workspaceId,id:"phantom",patch:{enabled?,config?}}`.
`enabled` es booleano; `config` admite solo `phantomPath`, `phantomData`, `model`.
Devuelve **la ficha** de `items[0]` anterior, sin envoltorio `items` ni timestamp.
Valida antes de persistir; un error de guardado se propaga al cliente.

```js
await invoke('plugins.update', {
  workspaceId, id: 'phantom',
  patch: { enabled: true, config: { model: 'provider/model' } }
});
await invoke('plugins.update', {
  workspaceId, id: 'phantom', patch: { enabled: false }
});
```

### `plugins.status`

Payload: `{workspaceId,id:"phantom"}`. Disponible también desactivado.
Respuesta exacta: `{available,reason?,source:"phantom",cli?,version?,observedAt}`.
Comprueba acceso real al catálogo nativo, no solo existencia del archivo.
`cli` es la ruta canónica y `version`, si existe, procede del `package.json`
de esa instalación (no de la versión del plugin).

Descubrimiento: override de proyecto no vacío, ajuste global no vacío,
`PHANTOM_CLI`; después `~/.local/lib/node_modules/phantom-harness/bin/phantom.mjs`
y el fallback hermano histórico `../../harness_engineer/bin/phantom.mjs` relativo
al adaptador. Una ruta explícita inexistente no cae silenciosamente a otra
instalación. El error indica candidatos y cómo configurar la ruta.

`phantomData` vacío hereda la configuración global o el home nativo de Phantom
(`PHANTOM_HOME`, `XDG_STATE_HOME`/home). El host no abre, copia ni sobreescribe
la base nativa; la CLI la gestiona. En tests se pasa siempre `--data` temporal.

### `plugins.models`

Payload: `{workspaceId,id:"phantom"}`. Disponible también desactivado.
Respuesta: `{available,models:[strings],reason?,observedAt}`.
Ejecuta `settings.opencodePath || "opencode"` con argv `["models"]`, cwd del
proyecto, `shell:false`, timeout y salida limitados. Devuelve el catálogo real
`provider/model`, deduplicado; no hay catálogo ficticio. Una salida inválida,
vacía o un fallo devuelve `available:false`, `models:[]` y `reason`.

## Paneles recuperables y operaciones nativas

Los tipos aceptados incluyen `plugins`, `phantom-cards`, `phantom-skills`.
Para los paneles Phantom, persistir:

```js
await invoke('node.create', {
  workspaceId, type: 'phantom-skills', title: 'Skills',
  data: { pluginId: 'phantom', panelId: 'skills', ref: skill.ref }
});
```

Cards usa `panelId:"cards"`. El host completa estos identificadores si se omiten
al crear un panel tipado; la carga recupera estados antiguos por tipo.
`plugins` es el Centro, sin `panelId`. Se persisten nodos y su geometría,
preferencias del plugin y referencias explícitas en `node.data` (`cardId`, `ref`,
`pluginId`, `panelId`) al abrir paneles referenciados. Los filtros, búsqueda,
vista lista/tablero, selección local y formularios son estado React transitorio;
no se guardan automáticamente en `node.data`. La desactivación no elimina nodos.
La UI debe ofrecer configuración/reactivación en un panel desactivado.

**Toda escritura desde las nuevas superficies debe incluir
`pluginId:"phantom"`** en `phantom.create`, `phantom.update` y `phantom.control`.
El host rechaza esas escrituras si el plugin está desactivado para el proyecto.
El marcador es el contrato de la nueva superficie, no una autorización contra
clientes legacy: las llamadas históricas sin marcador siguen operativas.
Las lecturas no requieren activación. Todas las rutas nuevas están en la
allowlist desktop y pasan por el router host existente.

```js
await invoke('phantom.list', {workspaceId, pluginId:'phantom', topic:'tasks'});
await invoke('phantom.list', {workspaceId, pluginId:'phantom', topic:'skills', allVersions:true});
await invoke('phantom.detail', {workspaceId, topic:'tasks', id:taskId});
await invoke('phantom.detail', {workspaceId, topic:'skills', id:ref.id, ref});
await invoke('phantom.create', {workspaceId, pluginId:'phantom', kind:'card', input: {
  goal:'Objetivo', lane:'coordinated', scope:['README.md'],
  checks:[{name:'acceptance',argv:['node','--version']}]
}});
await invoke('phantom.update', {workspaceId, pluginId:'phantom', kind:'card',
  id:taskId, replace:true, input:newContract});
await invoke('phantom.update', {workspaceId, pluginId:'phantom', kind:'skill',
  id:ref.id, ref, revision:ref.version, input:newVersionManifest});
```

La CLI valida contratos/manifiestos nativos. Las Cards son inmutables: update
requiere `replace:true` y devuelve `semantic:"replacement"`, `replaces` y
`relatedRef`; no edita la Card original. Skills publica una nueva versión
inmutable con `semantic:"new-version"`. La referencia completa
`{id,scope,version,sha256}` identifica el contenido leído; no reemplazarla por
un ID mutable. Detail Skills devuelve el objeto nativo, incluyendo
`manifest.body`, `manifest.resources` y `ref`; una SHA distinta se rechaza.
Las operaciones soportan `idempotencyKey`; un resultado incierto no se reintenta
ciegamente. El journal del adaptador solo registra operaciones propias, sin
duplicar el estado ni los registros nativos de Phantom.

### Eventos y evidencias de Cards

`phantom.detail` tasks devuelve el objeto nativo completo. Para eventos y
evidencia adicional, usar:

```js
const {events, observedAt} = await invoke('phantom.events', {workspaceId, id:taskId});
// {id: taskId, source:'phantom', events:[objetos nativos sin transformar], observedAt}
```

El adaptador consulta primero `show` y verifica ownership mediante el workspace
canónico y la familia real de worktrees Git; solo entonces ejecuta
`events <id> --json`. No admite tareas ajenas aunque se conozca su ID. Los
errores se propagan, nunca se convierten en un historial exitoso vacío.

### Control y seguimiento

`phantom.control` conserva acciones `run`, `stop`, `cancel`, `recover`, `verify`.
Payload: `{workspaceId,pluginId:"phantom",id,action,model?}`. `run` usa el modelo
explícito, o el override de proyecto/global; si falta, rechaza la operación.
Lanza Node con argv, sin shell. `stop` requiere un controlador vivo poseído por
este host y envía SIGINT; un PID persistido no concede autoridad para detenerlo.

`phantom.controllers {workspaceId}` devuelve `{items:[descriptores],observedAt}`
para el backend actual. Retiene descriptores en `workspace.phantomControllers`
y marca `lost` los procesos que ya no posee tras reinicio. Un descriptor tiene
`id`, `taskId`, `workspaceId`, `workspacePath`, `backend`, `action`, `source`,
`status`, `createdAt`, `output` y, cuando se observan, `pid`, `exitCode`, `signal`,
`endedAt`, `error`, `timeout`, `truncated`. La salida es limitada; durante la
ejecución emite `tool.output` y `tool.status`.

**`descriptor.status:"completed"` solo significa que el proceso controlador
terminó con código 0.** El estado de la Card siempre se lee de `phantom.detail`
o `phantom.list`; no debe inferirse `completed` para una Card a partir del
descriptor. Recuperación/verificación pueden terminar dejando la tarea
bloqueada o necesitando intervención según su estado nativo real.

La UI consulta la fuente completa de `phantom.detail`, incluidos los runs nativos
en orden cronológico. `run` y `cancel` solo se ofrecen en `ready`/`blocked`.
Sin controlador vivo observado, `recover` requiere que el último run esté
`running`/`recovering`; una tarea fallida finalizada no basta. `verify` requiere
tarea `blocked` y procedencia del último run: `recovery.state:"reconciled"` o
`mode:"verification"`, `status:"failed"` y `recoveryOf` string. Store.begin nativo
solo crea un run de verificación tras validar reconciliationOrigin; esa cadena
es evidencia nativa, no un estado de tarea inventado. Un controlador propio
`starting`/`running` habilita `stop` y bloquea las demás acciones incompatibles.
La UI exige modelo explícito o configuración observada para habilitar `run`;
no presupone un modelo global. Error o indisponibilidad de detalle/controladores
impide accionar con observaciones incompletas. «Origen de consulta: Phantom»
identifica la consulta, no declara revisión ni hash: los ausentes siguen desconocidos.

## Pruebas declaradas

`test/plugins.test.mjs` cubre validación, aislamiento, persistencia, reactivación,
import de snapshots anteriores, errores y rutas reales del host. Las pruebas
nativas descubren la CLI instalada y pasan su ruta explícita y `--data` en un
directorio temporal externo al repositorio. Crean contratos temporales y
versiones Skills sin ejecutar modelos; comparan eventos con la CLI real y
rechazan ownership ajeno. Si la CLI no está instalada, la prueba nativa informa
esa ausencia; los casos de indisponibilidad siguen ejercitándose.
