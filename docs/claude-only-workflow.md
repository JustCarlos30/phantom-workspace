# Flujo exclusivo Claude Code

Decisión de Carlos (2026-11-19): toda ejecución **nueva** de Phantom Workspace usa Claude Code.
La política vive en un solo módulo compartido, `shared/execution-policy.mjs`, y el host la aplica
en cada punto de entrada; la UI solo la refleja.

## Política

| Concepto | Valor |
| --- | --- |
| Cliente (chats, encargos) | `claude` |
| Motor del harness | `claude-code` |
| Modelo predeterminado del harness | `claude-code/sonnet` |
| Modelos admitidos | alias `fable`, `opus`, `sonnet`, `haiku` o `claude-*`, con o sin prefijo `claude-code/` |

Un modelo vacío significa «usar el predeterminado»; cualquier valor explícito que no sea Claude
se rechaza con un error accionable. No hay fallback silencioso a otro motor.

## Antes y después

| Área | Antes | Después |
| --- | --- | --- |
| Config. del plugin Phantom | Etiqueta «Modelo OpenCode», valor vacío sin default | «Modelo Claude Code»; vacío = `claude-code/sonnet`; guardar un modelo no Claude falla |
| `plugins.models` | Ejecutaba `opencode models` | Catálogo estático Claude Code; no arranca ningún proceso |
| `phantom.control` `run` | Aceptaba cualquier modelo; el contrato podía quedar por encima del payload | Orden: contrato → payload → plugin → predeterminado; **todo** modelo declarado en contrato, juez e hijos (recursivo) debe ser Claude aunque el payload lo sea |
| `phantom.create` (card) | Sin validar modelos | Rechaza contratos con modelos no Claude |
| Chats nuevos / `chat.configure` | Claude, OpenCode o Codex | Solo Claude; `chat.send` y `chat.models` rechazan hilos heredados de otros motores |
| Encargos (handoff) | Heredaba el cliente del emisor; catálogo con `opencode --prompt` y `codex` | Predeterminado `claude`; solo `claude` o `none` (terminal vacía explícita); sin comando OpenCode/Codex |
| Vincular sesión de agente | Vinculaba sesiones OpenCode | No se vinculan sesiones nuevas; las existentes se leen y se pueden desvincular |
| Bootstrap de terminal | Sin regla de motor | Incluye `POLICY_HINTS.engine` (cliente, modelo predeterminado, bloqueo sin fallback) |
| UI | Selectores con OpenCode/Codex; modelo sin procedencia | Selectores solo Claude Code; la card muestra cliente, motor, modelo solicitado con origen y modelo observado |

## Procedencia en la UI

`executionFacts` (`src/hooks/plugin-model.mjs`) distingue:

- **Solicitado**: lo que una ejecución nueva pediría, con origen (`solicitud actual`, `contrato`,
  `configuración del plugin` o `predeterminado`).
- **Observado**: solo lo que registran los eventos de la card. Sin evidencia se muestra
  «Desconocido»; con evidencia se rotula «según eventos registrados, no confirma el runtime».
- **Bloqueado**: un contrato o configuración con modelo no Claude muestra el motivo y desactiva
  «Ejecutar».

El descriptor de controlador guarda `requestedModel`, `modelSource`, `engine` y `client`; nunca un
modelo «confirmado».

## Compatibilidad e historial

- Los contratos son inmutables: no se reescriben. Un contrato antiguo con otro motor queda
  bloqueado en ejecución con un error que pide registrar un contrato nuevo; su historial se conserva.
- Los hilos de chat OpenCode/Codex guardados siguen cargando y leyéndose; solo enviar o listar
  modelos se rechaza. Los parsers históricos (`applyOpenCodeEvent`, `applyCodexEvent`) se conservan.
- Un valor de modelo antiguo ya guardado en la configuración del plugin sigue siendo legible; al
  ejecutar se bloquea hasta que se reemplace por un modelo Claude.
- No se matan procesos existentes. Una terminal shell vacía no se convierte en sesión automática.
- La variable `OPENCODE_CONFIG_CONTENT` del bootstrap se mantiene solo para sesiones heredadas.

## Precedencia del modelo (corregida)

`resolveHarnessModel(payload, contrato, config)` sigue al runtime del harness: **contrato fijo →
payload → configuración del plugin → predeterminado**. El payload y la configuración solo sirven
cuando el contrato no fija modelo; solo el valor que se ejecutaría se valida (no Claude ⇒ error).
El origen (`contract`/`payload`/`config`/`default`) queda en `modelSource` del controlador y la UI lo
muestra; si el usuario escribe un modelo que el contrato ignora, la card lo avisa.
En el chat, el modelo guardado se valida antes de lanzar: `claude-code/x` se pasa a la CLI como `x`
y un modelo no Claude se rechaza sin crear mensaje ni proceso.

## Historial y «observado»

Un registro cuyo modelo no es Claude (p. ej. `openai/…`) se muestra con cliente y motor
«desconocido», nunca etiquetado como Claude. El modelo **observado** es «Desconocido» mientras no
haya evidencia del runtime: `model.requested` en eventos es una solicitud registrada, no una
confirmación, y la card lo indica como tal.

## Verificación desktop (`test/claude-only-desktop.mjs`)

Electron/Playwright con estado temporal aislado y una **CLI Phantom stub** que solo sirve JSON fijo a
la UI. Cubre selector de agente (solo Claude Code / Terminal vacía), card con modelo del contrato
sobre el escrito, observado «Desconocido», contrato antiguo bloqueado e historial OpenAI legible.
Escribe capturas y `results.json` en `/tmp/phantom-claude-only-evidence/`.
**Esto no acredita ejecución live del motor**: no se ejecuta ningún modelo. La observación real de
Claude Code 2.1.328/Sonnet y del juez Claude fue hecha por el padre en la tarea anterior.

## Evidencia copiada

Copias byte a byte (`cp`) de artefactos de ejecuciones previas; no son salidas de esta tarea.

| Archivo en `docs/` | Origen | Qué es |
| --- | --- | --- |
| `claude-only-ui-results.json` | `/tmp/phantom-claude-only-evidence/results.json` | Resultados del desktop con **fixture** (CLI Phantom stub). |
| `claude-only-settings.png` | `/tmp/phantom-claude-only-evidence/01-settings-agent-selector.png` | UI con fixture: selector de agente solo Claude Code / Terminal. |
| `claude-only-contract.png` | `/tmp/phantom-claude-only-evidence/02-card-contract-model-precedence.png` | UI con fixture: card con modelo fijo del contrato (Haiku) sobre el escrito. |
| `claude-only-history.png` | `/tmp/phantom-claude-only-evidence/04-card-history-readable.png` | UI con fixture: historial no Claude legible, cliente/motor «desconocido». |
| `claude-only-verification.json` | `artifacts/run_7a7a36c4-9b4b-46ce-b19e-25a1a4cc9557/verification-0.json` | Checks reales de la tarea anterior `task_fca6046f`. |

Diferencia de evidencia:

- **Capturas y `ui-results.json`**: muestran la UI con datos fijos de un stub. No prueban que Claude Code
  se ejecutó ni que el runtime usó el modelo mostrado.
- **`verification.json`**: registra ejecuciones reales de `npm test`, `npm run build` y desktop en
  `run_7a7a36c4`. El conteo **875 pass, 0 fail, 4 skipped** pertenece a ese run anterior, no al actual.
  El reporte de los checks de esta tarea queda en los artefactos del controlador, no en este documento.
- Ese run se hizo antes de incorporar `main` (confianza de Claude en `host/terminals.mjs` y
  `test/terminal-tail.test.mjs`); su resultado no cubre ese cambio.
- No se calcularon hashes de los copiados; la identidad con el origen es la de `cp`.

Estado: esta documentación no afirma despliegue ni integración externa; ambos siguen pendientes del
controlador nativo.

## Base con confianza de Claude

Esta base incluye la incorporación de `main` 8d6b764 (`host/claude-trust.mjs` y
`test/claude-trust.test.mjs`), que hereda la confianza ya autorizada de Claude Code en worktrees de Phantom.
La validación de esta base corresponde al controlador: suite completa, build y desktop. Esta nota no
declara un conteo actual de pruebas ni que la base esté desplegada.

## Límites

- Esta entrega cubre el host y la UI de Phantom Workspace. El harness externo y su MCP global se
  trabajan aparte (proyecto `harness_engineer`); la política del host no sustituye la del harness.
- No se ha hecho validación E2E en vivo ni despliegue: queda a cargo del padre tras la aceptación.
- Los resultados de `npm test`, `npm run build` y del desktop los ejecuta y reporta el controlador;
  este documento no los da por pasados. Evidencia previa del padre (run_a0335ebe): build y desktop
  pasaron; la suite tenía 8 fallos, todos en `test/opencode-chat.test.mjs`, corregidos en esta revisión.
- `test/opencode-chat.test.mjs`: el host rechaza OpenCode (dos pruebas de rechazo). La cobertura del
  transporte (rutas acotadas, reintentos, reconexión SSE, cancelación, rechazo de permisos) se movió
  a pruebas directas de `driveOpenCode` contra el fixture de protocolo lanzado sin pasar por el host;
  no hay bypass productivo. La memoria de permisos denegados por turno vive en `host/chats.mjs`
  (ruta retirada) y ya no se prueba a nivel host; solo se prueba la respuesta `reject` del transporte.
- `src/components/PhantomChat.jsx` ofrece solo Claude para elegir; un hilo heredado conserva su etiqueta.
- Los avisos «No se pudo guardar la referencia: Host: Invalid panelId» en Trabajo venían de
  `PluginPanels.jsx`: el inspector alojaba el panel sobre otro nodo (terminal) y escribía `panelId`
  en él. Ahora solo se guarda la selección si el nodo es del tipo del panel; la validación del host
  no cambió. El desktop comprueba la ausencia de avisos de error y que `.pc-execution` quede completa
  dentro del viewport antes de capturar.
- `host/chats.mjs` conserva el código de ejecución de OpenCode/Codex (inalcanzable para chats
  nuevos); retirarlo es una limpieza posterior, no parte de esta política.
