# Acceso móvil: modelo de seguridad y estado del «protocolo v2»

El contrato normativo del acceso por navegador está en `CONTRACT.md` (sección de
`host/mobile.mjs`); el gateway Android lo gestiona `phantom-mobile` desde
Configuración → Teléfono. Este documento resume las propiedades de seguridad y
registra qué se hizo con el borrador «protocolo v2» (app nativa con firma P-256 por
acción), que nunca llegó a main.

## Propiedades vigentes (main)

- Listener HTTPS opt-in (TLS ≥ 1.2) sólo en IPv4 LAN privada; Host y Origin exactos,
  sin CORS ni cookies; la huella del certificado se muestra en escritorio y viaja en
  el QR.
- Vinculación por QR: código de 256 bits, un uso, 120 s. El teléfono genera una
  llave P-256 propia; el escritorio muestra un código de comparación de 6 dígitos
  derivado de código + llave y sólo el dueño aprueba. Máximo 8 dispositivos.
- Cada RPC lleva bearer (8 h, sólo en memoria, indexado por hash) **y** firma ECDSA
  del dispositivo sobre hora, ruta y hash del cuerpo, con ventana de ±30 s y
  rechazo de firmas repetidas.
- Escrituras idempotentes por `requestId`; permisos de chat sólo `allow`/`deny`
  (nunca «siempre», y `allow` prohibido en modo `full`).
- Revocación y parada cortan al instante las conexiones TLS del dispositivo.
- Auditoría local con fsync: intención antes del efecto y resultado después; si no
  se puede escribir, la acción no se ejecuta. **Nuevo:** el escritorio la consulta
  con `mobile.audit` (Ajustes → Teléfono → «Actividad reciente»), con proyección
  fija de campos y sin códigos, tokens ni contenido.

Una terminal remota no es un sandbox: un teléfono autorizado actúa con los
permisos reales del usuario/agente dentro del workspace elegido.

## Decisión sobre cada pieza del borrador v2

| Pieza | Decisión | Motivo |
|---|---|---|
| `host/public-settings.mjs` y su test | ya en main | Idéntico byte a byte. |
| `host/mobile-audit.mjs` (rotación 3 archivos, listado) | portado parcialmente | Se conserva el formato y las garantías de main; se añade `list()` + `mobile.audit` + vista en Ajustes. |
| Validación estricta de peticiones | ya en main | Campos por método, tamaño, Origin/Host, respuestas a preguntas validadas en `host/chats.mjs`. |
| `host/mobile-identity.mjs` (certificado por IP, sin regenerar) | descartado | Sustituido por `host/mobile-tls.mjs`; la huella va en el QR y una regeneración obliga a volver a vincular. |
| `host/mobile-auth.mjs`, `/api/v2/*`, desafíos firmados por acción | descartado | Main ya firma cada RPC con la llave del dispositivo; el valor añadido del v2 (biometría por acción) depende de una app nativa con Keystore/Secure Enclave que no existe en este repo. |
| Permisos por nodo y capacidad | descartado aquí | El gateway Android ya ofrece permisos por proyecto; rediseñar el navegador cambiaría la UX de main. |
| Sesión con inactividad de 10 min | no adoptado | Sin login firmado separado, obligaría a re-vincular por QR; queda como decisión de producto. |
| `MobileApp`/`MobileSettings` del v2 (sólo migración) | descartado | Habrían roto el flujo QR/SAS y el chat del teléfono de main. |
| Diagnóstico TPM | terminado | `npm run probe:tpm`; ver `docs/desktop-tpm.md`. |
| Clave TLS en TPM, broker de firma, migración | bloqueado | Requiere paquetes, grupo `tss` o broker y decisiones del usuario: `docs/desktop-tpm.md`. |

## Pendiente fuera de este repo

Firma biométrica por acción (Android Keystore + BiometricPrompt/CryptoObject, iOS
Secure Enclave) corresponde al cliente nativo (`phantom-mobile`). Sin attestation
remota el host sólo puede comprobar posesión de la llave vinculada, no que se usó
biometría.
