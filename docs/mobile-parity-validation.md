# Phantom Mobile: vinculación y matriz de paridad (primera entrega)

Esta entrega no demuestra paridad total. Registra qué se cambió, qué evidencia existe y qué falta.
Decisión de origen: memoria `mobile-parity-integration-secure-pairing` (2026-11-20).

## Cambios de esta entrega (panel de escritorio)

| Cambio | Fuente | Prueba automatizada |
|---|---|---|
| El dispositivo pendiente muestra el SAS de seis dígitos (`device.sas`), separado de la huella. | `src/components/AndroidGatewaySettings.jsx` | `test/phone-pairing.test.mjs` (UI pendiente) |
| «Permitir» y «Aprobar» (permisos personalizados) quedan deshabilitados y no envían la llamada sin SAS válido (`/^\d{6}$/`). | idem | idem |
| El host rechaza `approve` de un pendiente sin SAS válido, aunque la UI se eludiera. | `host/android-gateway.mjs` | `test/android-gateway.test.mjs` |
| Estilo `.st-sas`. | `src/mobile-settings.css` | Ninguna. El CSS no está importado desde este scope; falta añadir el import en un archivo fuera de scope. |

No se tocaron: TLS, pinning, formato QR `phantom-pair:v2`, firmas, biometría ni permisos.

## Hipótesis a confirmar con el gateway externo

El gateway externo (`phantom-mobile`) debe devolver `sas` en cada dispositivo `pending` de `status`. `test/mobile.test.mjs` lo muestra en `pending[0].sas` para el flujo web, pero no lo comprobé en el CLI de Android. Si no lo devuelve, la UI muestra «—» y bloquea la aprobación. Eso es seguro, pero impide vincular.

## Matriz de paridad

| Área | Desktop (evidencia) | Gateway/móvil | Estado |
|---|---|---|---|
| Vinculación por QR, caducidad y renovación | `AndroidGatewaySettings.jsx`, `phone-pairing.mjs`, tests de QR | App externa | Desktop probado con tests. Escaneo físico **no probado**. |
| Comparación SAS | Mostrado y exigido (esta entrega) | La app muestra su SAS (según el contexto, sin verificar) | Sin prueba física. |
| Permisos por proyecto y nodo | `phone-permissions.mjs`, `DevicePermissions` | Validados en `host/android-gateway.mjs` | Cubierto por tests de host. |
| Chat principal, terminales, herramientas | Catálogo en `integrations/plugins.mjs` (no auditado función por función) | Gateway expone solo lo autorizado | **Brecha**: no hay casos de uso reales ejecutados en móvil. |
| Plugin Phantom (Cards, Skills) | Definido en la decisión `workspace-plugins-phantom-v1` | Sin cliente móvil compilado según la memoria | **Brecha** |
| Aspecto visual en teléfono | UI de escritorio vigente | Sin capturas | **Pendiente** |

La presencia de un botón o de una entrada de catálogo no cuenta como paridad.

## Contrato necesario para detectar la aprobación (handoff al gateway y la app)

1. La app consulta el estado de su propio dispositivo (por ejemplo, un endpoint autenticado con la clave del dispositivo) y recibe `pending`, `approved` o `revoked`.
2. Al pasar a `approved`, la app lanza el desbloqueo con biometría sin el botón «Ya lo aprobé».
3. La biometría debe seguir ligada a la clave de Android Keystore con BiometricPrompt/CryptoObject. Un booleano no sirve como autorización.
4. El host valida un desafío de un solo uso, sus parámetros y los permisos antes de ejecutar.

Este repositorio no implementa nada de esto. Es trabajo de handoff.

## Alcance de TLS

TLS con certificado fijado protege el tránsito entre teléfono y host. No protege los datos si el host está comprometido, porque un atacante con acceso al host puede leer el estado y actuar con su autoridad.

## Pendiente

- Prueba física con un Android real: QR, SAS, aprobación y revocación.
- Capturas visuales del panel y de la app, con entorno autorizado.
- Confirmar el campo `sas` con el gateway externo.
- Importar `mobile-settings.css` (fuera de scope).
- Auditar el catálogo de funciones contra el uso real en móvil.
