# Prerrequisito TPM local de Phantom

Este diagnóstico comprueba exclusivamente un roundtrip sintético de sellado con
`systemd-creds`, solicitando explícitamente TPM2 y PCR7. No implementa una clave TLS
hardware no exportable ni acredita defensa frente a root. No cierra el proyecto
de escritorio/móvil ni constituye una garantía bancaria.

## Ejecución manual segura

Desde la raíz del proyecto, con el usuario habitual:

```sh
node scripts/desktop-tpm-probe.mjs
```

No acepta argumentos. Importar el módulo no ejecuta el diagnóstico. La API
`probeDesktopTPM({ runner })` permite un runner de pruebas; la CLI siempre utiliza
`/usr/bin/systemd-creds`, sin shell, con estos argv fijos:

```text
--user --no-ask-password --name=phantom-capability-probe --with-key=tpm2 --tpm2-pcrs=7 encrypt - -
--user --no-ask-password --name=phantom-capability-probe --refuse-null decrypt - -
```

Se generan 32 bytes aleatorios sintéticos, se pasan por stdin y se recoge stdout
mediante pipes privados. Cada proceso tiene timeout de 20 segundos y límite de
1 MiB por salida. Se comparan longitud y contenido, y se ponen a cero los buffers
accesibles de datos, cifrado y diagnósticos al terminar, también ante fallos. Esto
no garantiza borrar copias internas de Node, del sistema operativo o de systemd.
No se escriben credenciales en archivos ni se imprimen datos, cifrado, claves,
entorno o stderr del proceso. Solo se emite JSON con estado, etapa y razón fija;
salida 0 significa roundtrip correcto, salida 1 indica fallo.

No hay fallback a host, null o auto, reintentos con menor protección, elevación,
cambios de permisos, grupo tss, políticas polkit, Secure Boot o estado persistente
del TPM. La prueba no instala paquetes, hace enroll/reset ni cambia el arranque
automático. Puede usar la mediación legítima que systemd ya tenga disponible.

## Evidencia y bloqueos pendientes

- El controlador padre informó systemd 262 con soporte TPM2, presencia de
  `/dev/tpm0` y `/dev/tpmrm0`, ausencia de acceso directo para uid 1000 y ausencia
  de tpm2-tools/proveedor TPM de OpenSSL. Son datos aportados, no mediciones de
  este script.
- La lectura solicitada de
  `/usr/share/polkit-1/actions/io.systemd.credentials.policy` y la búsqueda del
  manual local de systemd-creds fueron denegadas por la herramienta por estar
  fuera del ámbito permitido. Sigue pendiente revisar política y help/documentación
  local; no se presume que autoricen este uso.
- El resultado hardware real y las pruebas unitarias quedan pendientes de los
  checks del controlador. Los casos nuevos se importan desde
  `test/desktop-security.test.mjs` para participar en el check existente.
- Si falla la autorización, `authorization-denied` es una clasificación acotada,
  no el diagnóstico completo. Conservar como evidencia el stderr del check
  hardware independiente del controlador y reportar su causa exacta. Otros
  mensajes pueden quedar como `subprocess-failed`; no deducir éxito ni una causa
  específica de esa etiqueta. No repetir reparaciones sin un cambio externo.
  No recomendar permisos globales ni ejecutar toda la app como root.

## Límites y siguiente camino

`systemd-creds decrypt` devuelve plaintext al host: sellar una credencial no es
firmar TLS con una clave que nunca sale del hardware. Incluso un roundtrip
correcto solo acredita la operación solicitada en ese equipo y momento.
Para TLS no exportable hace falta un proveedor OpenSSL TPM2/PKCS11 o un broker
de firma aislado con política propia; su diseño, autorización y verificación
son trabajo posterior. No se cambian listeners ni identidades existentes.

Antes de adoptar PCR7 para credenciales duraderas o actualizar PCR/política,
firmware o Secure Boot, definir y probar recuperación: copia recuperable por una
vía independiente autorizada, responsables y procedimiento de restauración o
reemisión de identidad. Cambios de firmware o de política de arranque pueden
impedir abrir credenciales selladas. Este probe es efímero y no configura esa
recuperación ni modifica el arranque.
