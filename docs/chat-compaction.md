# Compactación y continuidad de chats

## Integración de escritorio

El medidor de las cards y del chat principal conecta con el host mediante
`chat.compaction.capabilities`, `chat.compact` y `chat.continue`. Los tres métodos
están incluidos en `HOST_METHODS` de `desktop/security.mjs` y se reenvían al host
por `desktop/main.mjs`, tras validar el frame local autorizado y el payload JSON
con los límites existentes. El host valida proyecto, panel y campos de cada
operación. La allowlist del gateway móvil es independiente y no incorpora estos RPC.

Los checks los ejecuta Phantom. Este documento no acredita resultados de tests,
build, ejecución de modelos reales ni compatibilidad de una instalación concreta.

## Operaciones distintas

- **Compactar** solicita una operación nativa y verifica su resultado. Conserva
  el ID de sesión, el historial visible y los permisos de Phantom.
- **Continuar Codex con resumen** abre otra sesión después de que el usuario
  escriba y revise un resumen. Conserva el historial visible, el resumen, los IDs
  de origen/destino y los permisos. No se presenta como compactación.
- **Conversación nueva / limpiar** sigue siendo una acción separada que olvida
  el hilo local. Nunca se invoca como sustituto de compactar.

La acción parte del medidor existente, tanto en la card como en el chat principal.
No hay compactación automática añadida por turno. Las recomendaciones de contexto
no prueban que un proveedor haya compactado ni calculan ahorro.

## OpenCode

En cada consulta se inicia el servidor loopback del binario configurado, con
autenticación efímera. Se consulta `/doc` de esa instalación y se exige el esquema
de `POST /session/{sessionID}/summarize` con `providerID`, `modelID` y `auto`.
La consulta de capacidades no envía mensajes ni compacta.

La operación comprueba sesión, modelo permitido y catálogo de la instalación.
Lee `/config` y `/agent` para rechazar un override de modelo del agente
`compaction` que difiera del elegido; comprueba `/session/status` antes de enviar.
Solicita `summarize` con `auto:false`, nunca `/compact` como texto.

Para declarar éxito exige respuesta `true`, marcador de compactación nuevo y
resumen asistente nuevo, completo, sin error y con texto. El resumen debe estar
ligado al marcador por `parentID` y corresponder al proveedor/modelo solicitado.
Un HTTP exitoso o un resumen antiguo no bastan. Las herramientas y preguntas
solicitadas durante esta operación reciben denegación; no se amplían permisos.

`chats.json` conserva registros `compactions` con estado, fechas, sesión, modelo,
metadatos previos, origen y versión de capacidad, IDs nativos y texto del resumen
verificado. Solo después del éxito se retira la lectura de contexto anterior:
la próxima petición aportará una lectura nueva. No se atribuyen tokens ahorrados
al resumidor. Los turnos posteriores conservan el historial visible del hilo.

## Codex

Se ejecuta únicamente `codex exec --help` para comprobar la interfaz instalada.
La evidencia registra origen y SHA-256 de esa ayuda. La presencia de la palabra
`compact` no acredita un protocolo nativo utilizable; la ausencia tampoco prueba
que otras interfaces de Codex carezcan de compactación. El transporte de este
chat es `exec`: `app-server` no está integrado ni verificado aquí.

Por ello el flujo ofrece continuidad explícita, no una compactación simulada.
Exige resumen no vacío y acotado, sesión de origen y modelo permitido explícito
o previamente observado. Ese modelo se pasa al CLI de la sesión nueva, sin
`resume`; se conservan las instrucciones y la política de permisos vigentes.
Se vuelve a comprobar que hilo, sesión y configuración no cambiaron durante
el sondeo de capacidades.

El registro `continuations` se persiste antes del arranque e incluye el resumen,
modelo, evidencia de capacidad y sesión de origen. El éxito exige un ID de sesión
diferente, evento `turn.completed`, salida del proceso sin error y ausencia de
cancelación. Si no se confirma ningún ID nuevo se recupera la sesión de origen.
Si se conoce un ID nuevo pero el turno falla o se detiene, se conserva ese ID real
y el registro queda fallido o detenido, nunca exitoso.

## Exclusión y recuperación

El host rechaza compactación/continuidad con respuesta activa, otra operación
de contexto o cola pendiente. Durante el sondeo y compactación bloquea envíos,
limpieza y cambios de proveedor/modelo; detener cancela la operación y termina
su proceso. No se reintenta automáticamente el POST de compactación.

Fallos conservan historial y medición previa. Cancelar no revierte una posible
mutación ya realizada por el proveedor: el resultado se declara sin verificar.
Al reiniciar, los registros que seguían en curso quedan `interrupted`, con error
explícito; una continuidad aún sin sesión recupera su origen.

Otros proveedores muestran que la compactación explícita no está integrada.
Los proveedores deshabilitados conservan lectura del historial, pero el host
rechaza operaciones nuevas. Este flujo no ejecuta Claude ni modifica los motores
habilitados. Los métodos nuevos validan campos RPC; no se incorporan a un gateway
remoto ni se sustituyen sus controles de autorización.

## Evidencia y regresiones declaradas

Las regresiones añadidas usan CLIs sintéticos sin modelos, procesos locales y
HTTP/SSE reales: cubren éxito, evidencia persistida, resultado incompleto,
modelo divergente, API ausente, error HTTP, cancelación, cola y sesión ocupada,
rechazo por política y recuperación tras reinicio. Las pruebas del estado del
renderer cubren actualización de sesión, metadatos y conservación de mensajes.
Las regresiones de frontera desktop cubren la admisión de los tres RPC para cards
y chat principal, los límites JSON existentes y el rechazo de métodos ajenos.

Checks del contrato, pendientes de ejecución por el controlador:

```sh
node --test test/chats.test.mjs test/opencode-chat.test.mjs test/codex-context.test.mjs test/chat-permissions.test.mjs src/hooks/chatState.test.mjs src/hooks/context-view.test.mjs test/desktop-security.test.mjs
npm run build
```

El ledger citado en el mandato observa contextos altos y eventos ausentes;
la ausencia de un evento no demuestra ausencia de compactación real. No se ha
recalculado ese ledger ni se ha medido ahorro durante esta implementación.
