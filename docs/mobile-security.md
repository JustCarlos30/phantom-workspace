# Acceso móvil seguro: base de protocolo v2

## Estado y modelo de confianza

Esta entrega implementa servidor, protocolo y controles de escritorio. **No es la app nativa final ni implementa biometría en un navegador.** `/mobile` sólo informa de la migración; `MobileApp` legado tampoco ofrece operaciones. `/api/pair` y `/api/rpc` dejaron de existir. No hay downgrade.

Amenazas contempladas: observación/modificación de LAN, suplantación del host, códigos o tokens robados, sitios web maliciosos y DNS rebinding, dispositivos sin aprobar, cruces de nodo/workspace, replay concurrente, payload cambiado, respuesta perdida, permisos reducidos/revocación durante I/O, abuso de pairing, agotamiento de memoria y fallos de auditoría. El propietario confía en su escritorio y vincula la app oficial por un canal independiente. El escritorio, su perfil privado y el sistema operativo deben estar bajo su control. Un atacante con control del host o con acceso al proceso/clave privada queda fuera de esa frontera.

Una terminal remota **no es un sandbox**. Puede ejecutar con todos los permisos reales del usuario/proceso; un chat puede ordenar herramientas con los permisos reales del agente. Incluso lectura puede revelar texto sensible presente en la conversación/pantalla autorizada. El catálogo omite nodos no concedidos; no entrega env, cwd, pid, rutas internas, credenciales ni metadatos del motor. No existen capacidades remotas de gestión, Git, host, configuración o archivos. Las respuestas de permisos sólo admiten `allow`/`deny`, nunca “siempre”.

## Identidad, TLS y bootstrap

El único listener es HTTPS, mínimo TLS1.2, máximo/preferido TLS1.3. No hay puerto HTTP de control, CORS amplio ni verificación de certificados accept-all. Se requiere `/usr/bin/openssl`; el host invoca `execFile` con argv, sin shell. Genera certificado autofirmado SHA256 EC P256, válido 365 días con SAN IP para la dirección elegida. Guarda `<IPv4>.key/.crt` en `dataDir/mobile-identity` (700); archivos600. Comprueba pareja, tipo/curva, firma propia, SAN y fechas antes de escuchar. Un par parcial, inválido o caducado falla: **nunca se regenera silenciosamente**. Si no existe ninguno de los dos archivos, se crea la primera identidad. Las identidades son por dirección; cambiar de dirección o regenerar exige nueva vinculación.

Sólo las APIs locales de escritorio entregan `{hostId,fingerprint,certificate,address,expiresAt}` y la URL HTTPS. `fingerprint` es SHA256 del certificado X509 DER completo, en hexadecimal minúsculo de 64 caracteres; `hostId` es esa misma huella, estable mientras no cambie el certificado. `certificate` es PEM público. No se entrega clave privada. `mobile.identity {regenerate:true,address}` requiere listener apagado, borra accesos y crea nueva identidad. Reiniciar conserva identidad y auditoría, pero no dispositivos/tokens: acceso apagado.

El propietario verifica la huella **desde el escritorio**, comparte `{version:2,url,hostId,fingerprint,certificate,address,expiresAt}` por canal fuera de banda y la app fija ese certificado antes de enviar secretos. No usar el certificado recibido de la propia conexión sin compararlo. El código de vinculación se comparte aparte: 32 bytes aleatorios base64url sin padding (43 caracteres), un uso, máximo120s. No es identidad del host. “Generar nuevo código” sustituye el anterior.

## Transporte y convenciones wire

- Base: origen HTTPS exacto anunciado; todos los endpoints siguientes usan `POST /api/v2/<ruta>`, `Content-Type: application/json` exacto. No query strings.
- `GET /mobile` devuelve HTML fijo; cualquier otro GET, asset, ruta fuente o query es404. No lectura de assets por petición.
- Host debe ser literalmente IPv4:puerto del listener. Origin ajeno es403. Las APIs nativas rechazan **cualquier** Origin y Sec-Fetch-Mode: páginas de navegador no se vinculan ni operan. Ausencia de Origin no concede permisos: pairing exige código y prueba; login exige firma; lectura exige sesión creada por firma; cada mutación exige otra firma.
- Sin cookies, secretos en URL o CORS. Cabeceras no-store, no-referrer, nosniff y CSP restrictiva sin scripts/frames.
- JSON UTF-8, objeto de primer nivel, body máximo65536 bytes, profundidad máxima12 y presupuesto estructural. Campos desconocidos se rechazan en cada formato. No algoritmos elegibles por cliente ni `biometricVerified`.
- Base64url RFC4648 URL-safe **sin padding**, sin espacios, forma canónica por decode/re-encode. Clave: SPKI DER P256, máximo128 bytes, tipo EC/curva prime256v1 y exportación DER idéntica al input. No PEM/JWK/RSA/P384. Firma: ECDSA SHA256 sobre bytes, DER canónico de secuencia de dos INTEGER positivos mínimamente codificados, máximo72 bytes. No P1363. Se admite high-S o low-S; cada nonce sólo se consume una vez, por lo que la maleabilidad de representación no permite replay.
- Timestamps: enteros epoch en milisegundos; IDs de desafío/dispositivo son UUID servidor. `requestId` de acción lo elige la app: string1–128, sólo `[A-Za-z0-9_-]`, nuevo por decisión de usuario; nunca reutilizar para una acción distinta.
- Éxito200 JSON según endpoint. Error `{error:"mensaje en español"}`:400 formato/permisos cambiados/ligadura de nodo cambiada,401 firma/credencial/desafío inválido/caducado/consumido,403 origen/método/alcance/capacidad,404 ruta/recibo inexistente,409 requestId ya reservado,413 tamaño,429 límites,503 auditoría no disponible. Errores internos no devuelven cuerpos/texto del motor.

## Desafíos y bytes exactos que firma el cliente

Respuesta de cualquier emisión:

```json
{"challengeId":"UUID","bytes":"BASE64URL_UTF8_JSON","expiresAt":1794590000000}
```

`bytes` codifica el JSON compacto producido por `JSON.stringify` de este sobre (el orden de campos mostrado es el orden del servidor):

```json
{"version":2,"hostId":"CERT_SHA256_HEX","fingerprint":"CERT_SHA256_HEX","challengeId":"UUID","nonce":"RANDOM_32_BYTES_BASE64URL","expiresAt":1794590000000,"kind":"action","deviceId":"UUID","workspaceId":"WORKSPACE_ID","nodeId":"NODE_ID","sessionId":null,"method":"chat.send","payload":{"nodeId":"NODE_ID","text":"Hola"},"requestId":"APP_REQUEST_ID","permissionVersion":1}
```

`kind` es `pair`, `login` o `action`. `nonce` son32 bytes aleatorios, distinto de `challengeId`. TTL60s; no renovación. Para `pair`: nodeId/sessionId null, method `pair`, payload `{publicKey,name}`, requestId UUID servidor, permissionVersion0. Para `login`: nodeId/sessionId null, method `login`, payload `{}`, requestId UUID servidor, versión de permisos actual. Para acción: nodo resuelto del payload, sessionId sólo en terminal o null, método/payload/requestId originales y versión actual.

**Canonicalización: no hay reserialización del cliente.** El servidor conserva sobre, payload y bytes originales. Payload retiene la semántica y orden de propiedades del parser/`JSON.stringify` de Node (incluido su orden de claves enteras). La app decodifica base64url, verifica el sobre contra el host/dispositivo/workspace/nodo/método/parámetros/requestId que espera, muestra la acción y firma **esos bytes exactos**. Nunca firma la cadena base64url, un hash hexadecimal, una reconstrucción JSON, un objeto reordenado o un body alternativo. La app no puede añadir campos al sobre. No hay normalización Unicode adicional. UTF-8 compacto sin salto final.

Servidor: `crypto.verify('sha256', bytesOriginales, {key:publicKey,dsaEncoding:'der'}, firmaDER)`. El endpoint de ejecución sólo recibe challengeId y firma: no hay manera de reemplazar los parámetros guardados. Verifica dispositivo, host, workspace, expiración, versión de permisos, nodo/sesión actuales y grants antes del efecto. Consumo síncrono del desafío antes de verificar firma: incluso prueba incorrecta consume ese intento. Otro dispositivo no puede consumir ni ejecutar el reto. Reducción/cambio de permisos invalida todos los desafíos del dispositivo. Revocación borra dispositivo, sesiones y retos.

## Flujos y formatos exactos

### 1. Vincular, probar y aprobar

1. Escritorio activa listener y comparte bootstrap verificado + código separado.
2. App genera clave P256 protegida y envía:

   `POST /api/v2/pair` → `{code,name,publicKey}`. Nombre obligatorio1–80 sin controles. PublicKey base64url SPKI DER. Código correcto se consume una vez tras validar formatos y límites. Respuesta `{deviceId,challengeId,bytes,expiresAt}`. No token.
3. App firma reto y envía `POST /api/v2/pair/prove` → `{deviceId,challengeId,signature}`. Respuesta `{deviceId,state:"pending",requiresDesktopApproval:true}`. Antes de probar el estado es `proving`. Solicitudes sin aprobar se limpian tras120s.
4. Escritorio muestra nombre, SHA256 SPKI DER del dispositivo, huella host y capacidades. El dueño compara y selecciona nodos. Cada nodo seleccionado empieza sólo con `read`; ninguno está seleccionado automáticamente. Principal y nodos role `orchestrator` requieren `acknowledgeAgentAuthority:true` y advertencia de permisos reales. `mobile.approve {id,grants:[{nodeId,capabilities}],acknowledgeAgentAuthority?:false}` aprueba sólo estado pending. `grants:[]` es válido y no permite leer nodos. No se concede ejecución automáticamente.
5. Cambios posteriores con `mobile.permissions` tienen el mismo formato, sólo approved; lectura obligatoria en cada grant. Aumentan permissionVersion. `mobile.revoke {id}` revoca inmediatamente. Todos son métodos locales, no endpoints de red.

### 2. Iniciar sesión / desbloquear lectura

`POST /api/v2/login/challenge` → `{deviceId}` (sólo approved); devuelve desafío login. `POST /api/v2/login` → `{deviceId,challengeId,signature}`; devuelve `{token,expiresAt,idleExpiresAt}`. Sesión máxima3600000ms; idle600000ms. Un login nuevo invalida tokens anteriores del mismo dispositivo. El token aleatorio de32 bytes se indexa por hash, sólo en memoria. Cliente debe conservarlo de forma privada y efímera, nunca en URL/logs.

Las siguientes rutas requieren `Authorization: Bearer TOKEN`. Lectura y consultas no actualizan `authenticatedAt`. Una acción firmada admitida sí lo actualiza, pero no prolonga expiresAt absoluto. Cuando se bloquea o caduca, repetir login con desafío firmado; no es necesario volver a aprobar mientras el dispositivo siga autorizado y el host no se haya reiniciado. No hay endpoint de estado de solicitudes sin firmar: la app puede solicitar login/challenge mientras el dueño aprueba, respetando límites.

### 3. Lecturas

`POST /api/v2/read` → `{method,payload?:{}}`, respuesta `{result}`. Sólo:

| method | payload (workspaceId opcional en todos) | result |
|---|---|---|
| `sessions.list` | `{}` | `{workspace:{id,name},sessions:[{nodeId,title,kind,provider,terminals:[{id,status,createdAt}]}]}` |
| `terminal.list` | `{}` | `[{id,nodeId,status,createdAt}]` |
| `chat.get` | `{nodeId}` | `{provider,running,truncated,messages:[{id,role,status,parts}]}` |
| `terminal.attach` | `{sessionId}` | `{status,seq,lines?,text?}` |

Sólo nodos con grant read del workspace activado, incluido catálogo. Sesiones de terminal resueltas a nodo autorizado. Después de tail async se revalidan token y permisos antes de responder. Terminal devuelve captura textual reciente (40 líneas), sin crear procesos ni resize. Chat muestra hasta100 mensajes/40 partes, proyectando type/id/text/name/tool/detail/status/reason; question incluye preguntas y opciones públicas acotadas, sin estado privado del motor. Campos ausentes pueden omitirse. Vista con presupuesto180000 unidades de texto/estructura antes de serializar (puede producir413); el historial completo permanece en escritorio. No cola remota ni metadatos internos del proveedor.

### 4. Mutaciones por acción

`POST /api/v2/action/challenge` → `{method,payload,requestId}`, respuesta desafío action. Requiere grant de esa capacidad específica en el nodo. Payloads (workspaceId opcional, debe coincidir):

| method / capability | payload |
|---|---|
| `chat.send` | `{nodeId,text}` texto1–32000 no vacío |
| `chat.stop` | `{nodeId}` |
| `terminal.write` | `{sessionId,data}` data1–16000 |
| `terminal.stop` | `{sessionId}` |
| `chat.permission.answer` | `{nodeId,requestId,decision}` decisión allow/deny; requestId1–128 del prompt |
| `chat.question.answer` | `{nodeId,requestId,answers}` null para omitir o mapa máximo20: claves1–4000, valor string1–4000 o array máximo20 de esos strings |

La app verifica sobre y presenta la operación exacta. El usuario autentica una nueva firma. `POST /api/v2/action` → **`{challengeId,signature}`**, respuesta `{receipt:{requestId,state:"completed"}}`. No `deviceId`, payload, método ni boolean biométrico adicional en este endpoint.

Se consumen desafíos y se reserva requestId de forma síncrona antes de cualquier await. Se valida firma, scope y grants vigentes; se exige auditoría fsync de admission antes de invocar la operación. Hasta256 recibos por dispositivo, sin expulsarlos al renovar token. Fallos también reservan ID: no ejecutar otra vez automáticamente. Otro challenge con requestId reservado devuelve409. Si dos desafíos se emitieron para el mismo requestId, sólo uno puede reservarlo/ejecutarlo. A los256 hay que revocar/vincular nuevamente tras resolver recibos pendientes; nuevos logins no resetean esa protección.

### 5. Respuesta perdida y recibos

`POST /api/v2/receipt` → `{requestId}`, respuesta `{receipt}`. Sólo el propio dispositivo con token desbloqueado. Estado `pending`, `completed` o `uncertain`; puede contener reason `audit-admission-failed`, `audit-unavailable-after-effect` o `effect-failed-or-uncertain`. Nunca contiene resultado del proveedor ni cuerpo de acción.

Si la respuesta se pierde, consultar recibo y vista autorizada; **no repetir automáticamente la acción con nueva firma/ID**. `uncertain` exige revisar escritorio: el efecto pudo ocurrir antes del fallo del motor/auditoría final. Si falla admission, no se invocó efecto y el ID queda reservado. Si falla registrar finalización, el efecto ya invocado no se deshace y el recibo señala incertidumbre, sin habilitar reintento. Una acción invocada antes de revocar/apagar puede terminar: la revocación impide futuras admisiones y cierra conexiones, no revierte efectos.

## Auditoría y límites

`dataDir/mobile-audit/events.jsonl`, `.1`, `.2`: directorio700, archivos600; rotación al alcanzar256KiB (un evento puede sobrepasar ligeramente el umbral antes de la siguiente rotación), tres archivos. Sólo timestamp, deviceId, workspaceId, nodeId, method, outcome, reason, requestId; strings acotados y sin controles. Eventos de vinculación/prueba/aprobación/grants/revocación/login/acciones/rechazos. Nunca código, token, clave privada/pública, conversaciones, comandos ni cuerpos. UI muestra últimos100 y permisos efectivos. La auditoría es local, no es un ledger inmutable contra dueño/root; si se borra la identidad cambian vínculos. Errores de lectura/escritura son visibles, admission fallida deniega mutación. La revocación de seguridad sigue invalidando accesos aunque no pueda registrar el evento; devuelve error visible de auditoría.

32 sockets,8 peticiones activas,64KiB body,8 dispositivos,64 sesiones,128 retos (60s),256 recibos por dispositivo y2048 buckets máximos. Limpieza cada segundo y antes de petición: retos/tokens expirados, solicitudes sin aprobar y buckets. Recibos duran hasta revocar/stop, cota total2048. HTTP timeouts: request10s, headers5s, keepalive2s, sockets15s,100 requests/socket y32 headers.

Buckets de ventana60s independientes: pairing/proof10 por IP, login30 por IP y desafíos login15 por device; operación/read/receipt120 por device y600 por IP. IP real `socket.remoteAddress`; X-Forwarded-For ignorado. Abuso pairing de una IP no consume presupuesto de otra IP ni de RPC autenticada. Cota global de memoria/concurrencia aún puede rechazar tráfico durante agotamiento real compartido; no es protección contra saturación del enlace físico.

## Biometría del futuro cliente oficial

Android: clave EC P256 no exportable Keystore (hardware-backed cuando esté disponible), autenticación por uso con BiometricPrompt/CryptoObject y `Signature` SHA256withECDSA, sin ventana reutilizable para mutaciones. iOS: clave Secure Enclave P256 con control de acceso por uso y evaluación biométrica del sistema. El cliente deberá configurar políticas por acción, tratar cambios de enrolamiento/invalidez como necesidad de volver a vincular y documentar capacidades reales de hardware. Este servidor no elige política biométrica del teléfono ni permite que un boolean la sustituya.

**Sin attestation remota el backend sólo demuestra posesión de la clave vinculada.** Un cliente modificado podría usar una clave software y firmar sin huella; el servidor no puede distinguirlo sólo por ECDSA. Por eso el despliegue previsto es app oficial instalada y vinculada por el propietario, certificado fijado desde escritorio y sin fallback JavaScript para ejecutar. Una clave hardware tampoco protege un teléfono desbloqueado comprometido, coacción física, suplantación visual o acciones aprobadas sin leer. No hay claims bancarios ni certificación OWASP.

## Pruebas declaradas

`test/mobile.test.mjs`: fixtures temporales, HTTPS real con CA/SAN validados; firma inválida, replay/concurrencia, tamper, reducción de permisos, revocación in-flight, idle no renovado por polling, auditoría sin secretos/fallo sin efecto, aislamiento IP, pin equivocado, TLS antiguo y HTTP/legacy rechazados. Amplía cobertura conservando garantías de auth/scope/límites/lifecycle; no ejecuta shell ni toca perfiles reales.

`test/mobile-browser.mjs`: valida certificado completo con Node y usa en Chromium sólo allowlist SPKI de esa fixture (sin excepción global ni `ignoreHTTPSErrors`). Comprueba migración sin controles a390/360px y renderiza el componente real MobileSettings mediante build Vite y bridge local de prueba en `/tmp`; aprueba sólo lectura, ajusta y revoca. No simula huella. Capturas/resultados `/tmp/phantom-mobile-secure-evidence`. El controlador ejecuta suite/build/browser y reporta resultados; la presencia de pruebas no acredita que hayan pasado.
