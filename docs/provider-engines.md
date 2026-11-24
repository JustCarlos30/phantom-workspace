# Proveedores y motores: contrato de API

La política «solo proveedores habilitados» vive en `shared/execution-policy.mjs`; el host la aplica en
cada punto de entrada (chats, encargos, vinculación de sesión, plugin Phantom, `phantom.control`).
Sin ajustes el comportamiento es exactamente el anterior: solo Claude Code, harness `claude-code/sonnet`.
Nunca hay fallback silencioso: un cliente o modelo no habilitado devuelve un error accionable.

## Modelo de datos (ajustes globales)

Se guarda en `settings` (store global) con dos claves; la forma efectiva es la `policy`:

```json
{
  "providers": { "claude": { "enabled": true }, "opencode": { "enabled": false }, "codex": { "enabled": false } },
  "defaults": {
    "chat":    { "client": "claude", "model": null },
    "handoff": { "client": "claude", "model": null },
    "task":    { "client": "claude", "model": "claude-code/sonnet" },
    "judge":   { "client": "claude", "model": "claude-code/sonnet" }
  }
}
```

- Persistencia: `settings.providers` y `settings.executionDefaults` (= `defaults`). Solo contienen
  booleanos, clientes y modelos; `publicSettings` sigue filtrando cualquier clave con credenciales.
- `client`: `claude` | `opencode` | `codex`. `task` y `judge` solo admiten `claude` u `opencode`
  (motores del harness) y exigen modelo coherente con el cliente.
- `model: null` en `chat`/`handoff` = predeterminado de la propia CLI (comportamiento anterior).
  `chat` es la preselección de la UI para tarjetas nuevas; `handoff.client` es el agente por defecto de
  un encargo y `handoff.model`, si no es null, se añade como `--model` a ese cliente.
- `task.model` es el predeterminado del harness (`phantom.control run`, `plugins.models.defaultModel`).
  `judge` es el modelo que la UI propone para jueces de contratos; el host lo valida como el resto.

## Reglas

| Regla | Efecto |
| --- | --- |
| Enrutado (`engineOf`) | `claude-code/<m>` o alias/nombre Claude → motor `claude-code`; cualquier otro `proveedor/modelo` → `opencode`. |
| Claude jamás por OpenCode | `anthropic/…`, `…/claude…` o un nombre Claude por OpenCode/Codex se rechaza siempre. |
| Modelos no Claude | Exigen `providers.opencode.enabled`. |
| Clientes | Chat y encargo exigen el cliente habilitado; `none` (terminal vacía) siempre se admite en encargos. |
| Contratos | Contrato, juez e hijos (recursivo) se validan contra la política al crear (`phantom.create`) y al ejecutar. |
| Precedencia | contrato → payload → configuración del plugin → `defaults.task.model`. |
| Deshabilitar | No se puede deshabilitar un proveedor que es predeterminado de un área: cambia el predeterminado en la misma llamada. |
| Historial | Hilos, sesiones y registros de motores deshabilitados siguen legibles; solo enviar/ejecutar se rechaza. |

## Acciones del host

### `providers.list` `{ force?: boolean }`

Detección real con caché de 30 s (`force: true` la salta). La política y `enabled` se leen en vivo.

```json
{
  "observedAt": "ISO",
  "policy": { "providers": {…}, "defaults": {…} },
  "providers": [
    { "id": "claude", "label": "Claude Code", "engine": "claude-code", "enabled": true,
      "status": "available", "binary": { "path": "claude", "version": "2.1.328 (Claude Code)" },
      "session": { "available": true, "plan": "max" } },
    { "id": "opencode", "label": "OpenCode", "engine": "opencode", "enabled": false,
      "status": "available", "binary": { "path": "opencode", "version": "1.2.3" },
      "session": { "available": true, "credentials": [{ "name": "Anthropic", "source": "credentials", "method": "oauth" }, { "name": "OpenRouter", "source": "environment" }] },
      "models": { "available": true, "count": 42 } },
    { "id": "codex", "label": "Codex", "engine": null, "enabled": false,
      "status": "unavailable", "reason": "No se encontró «codex»", "binary": { "path": "codex", "version": null },
      "session": { "available": false, "reason": "…" } }
  ]
}
```

- `status`: `available` (binario responde a `--version`), `unavailable` (binario ausente, con `reason`),
  `error` (binario presente que falló o no respondió a tiempo, con `reason`).
- `session` de Claude/Codex sale de `host/limits.mjs` (misma lectura que los límites del plan); su
  `reason` puede ser de red o de sesión vencida. La de OpenCode sale de `opencode auth list`; solo se
  conservan nombre de proveedor y método, nunca valores de variables ni tokens.
- `models.count` de OpenCode cuenta `opencode models` sin modelos Claude.
- Rutas: `settings.claudePath`, `settings.opencodePath`, `settings.codexPath` (o el binario en PATH).

### `providers.configure` `{ providers?, defaults? }`

Parches parciales: `providers: { opencode: { enabled: true } }`, `defaults: { task: { client: "opencode", model: "openai/gpt-5" } }`.
Valida forma y coherencia de toda la política resultante y persiste en una transacción. Devuelve
`{ policy }`. Un error no persiste nada. Habilitar un proveedor no exige que esté instalado; su uso
fallará con el motivo observado (p. ej. «No se encontró «opencode»»).

`settings.update` con `providers` (objeto) o `executionDefaults` aplica la misma validación. Un `providers` que no es objeto (forma heredada) se guarda sin validar, pero toda ejecución nueva se rechaza con `ExecutionPolicyError` hasta corregirlo con `providers.configure`.

### `providers.models` `{ provider: "claude"|"opencode"|"codex", force?: boolean }`

```json
{ "provider": "opencode", "engine": "opencode", "enabled": true, "available": true,
  "items": [{ "id": "openai/gpt-5", "group": "openai", "variants": ["high"], "engine": "opencode" }],
  "excluded": 3, "observedAt": "ISO" }
```

- `claude`: catálogo estático (`claude-code/fable|opus|sonnet|haiku`), sin procesos.
- `opencode`: `opencode models --verbose` (timeout 20 s) parseado con `openCodeModels`; `excluded` = modelos
  Claude retirados. `codex`: `codexModels` (app-server); los ítems llevan `client: "codex"`.
- Fallo o catálogo vacío: `{ available: false, reason, items: [] }`. Caché de 60 s solo para éxitos.

### Acciones existentes condicionadas

| Acción | Comportamiento |
| --- | --- |
| `node.create` / `chat.configure` | `provider` debe estar habilitado; el modelo se valida por cliente (Claude solo en `claude`). |
| `chat.send` / `chat.models` | Rechazan si el cliente del hilo está deshabilitado; el catálogo OpenCode/Codex excluye Claude. |
| `terminal.agent.handoff` | `agent` por defecto = `defaults.handoff.client`; `opencode` → `opencode --prompt "…"`, `codex` → `codex "…"`. |
| `terminal.agent.update` `providerSessionId` | Con OpenCode habilitado vincula una sesión de `opencode.sessions` de este workspace (`provider: "opencode"`); vaciarla siempre se admite. |
| `plugins.models` (`phantom`) | `models`/`items` de motores habilitados, `defaultModel` = `defaults.task.model`, `engine` del predeterminado, `engines`, y `unavailable.opencode` si su listado falla. |
| `plugins.update` (`phantom`) | `config.model` debe estar permitido por la política. |
| `phantom.control` `run` | Descriptor con `requestedModel`, `modelSource`, `engine` (`claude-code`/`opencode`) y `client`. |

El bootstrap de terminal (`POLICY_HINTS.engine`) describe la política vigente: motores habilitados,
modelo predeterminado del harness y juez, y el bloqueo sin fallback.

## Errores

Todos son `ExecutionPolicyError` (`code: "EXECUTION_POLICY"`), en español y con la acción a tomar:

| Caso | Mensaje (resumen) |
| --- | --- |
| Modelo no Claude con OpenCode deshabilitado | «El modelo «X» no es Claude Code (dónde). OpenCode no está habilitado: … habilita OpenCode en Configuración > Agentes; si no, usa «claude-code/sonnet»…» |
| Claude por otro proveedor | «El modelo «X» es Claude (dónde): Claude se ejecuta solo con Claude Code, nunca por OpenCode ni Codex…» |
| Claude Code deshabilitado | «El modelo «X» es de Claude Code, que está deshabilitado… Habilita Claude Code en Configuración > Agentes…» |
| Cliente deshabilitado | «El agente «codex» no está habilitado para ejecuciones nuevas. Habilita Codex en Configuración > Agentes; mientras tanto usa Claude Code…» |
| Predeterminado incoherente | «El predeterminado de Tareas usa el agente «opencode» no está habilitado…», «…no corresponde a Claude Code…» |
| Forma inválida | «Proveedor desconocido», «Área desconocida», «… admite solo { enabled: true\|false }» |

`dónde` indica el origen: `contract`, `payload`, `config`, `contrato`, `juez del contrato`,
`hijo ID`, `juez del hijo ID/NIETO`, `chat`, `predeterminado de …`.

## Pendiente fuera de este alcance

- `desktop/security.mjs` (lista de métodos permitidos al renderer) y la UI de Configuración > Agentes.
- `src/hooks/plugin-model.mjs` aún marca como bloqueado todo contrato no Claude; debe consultar la
  política (o el descriptor `engine`) para reflejar OpenCode habilitado.
