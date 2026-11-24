# TPM local de Phantom: diagnóstico y trabajo pendiente

Estado: **diagnóstico disponible, ninguna clave de Phantom usa el TPM.** La clave
TLS móvil (`mobile-tls/key.pem`), la auditoría y el estado privado siguen siendo
archivos 0600 del usuario. Nada de esto protege frente a root ni frente a otros
procesos del mismo usuario. No es una garantía bancaria.

## Diagnóstico

```sh
npm run probe:tpm        # equivale a: node scripts/desktop-tpm-probe.mjs
```

No acepta argumentos e importar el módulo no ejecuta nada. La API
`probeDesktopTPM({ runner })` admite un runner sólo para pruebas; la CLI siempre usa
`/usr/bin/systemd-creds`, sin shell, con argv fijos:

```text
--user --no-ask-password --name=phantom-capability-probe --with-key=host+tpm2 --tpm2-pcrs=7 encrypt - -
--user --no-ask-password --name=phantom-capability-probe --refuse-null decrypt - -
```

Sella 32 bytes aleatorios sintéticos por stdin, los abre y compara longitud y
contenido. Timeout de 20 s y límite de 1 MiB por salida; pone a cero los buffers
accesibles al terminar (no las copias internas de Node, del SO ni de systemd). No
escribe archivos ni imprime datos, cifrado, entorno o stderr: sólo JSON
`{ok,stage,reason}` con razón fija; salida 0 = roundtrip correcto.

`host+tpm2` exige **a la vez** el TPM y la clave de host de systemd: es igual o más
estricto que `tpm2` solo. No hay fallback a `host`, `null` ni `auto`, ni reintentos,
elevación, cambios de grupo `tss`, polkit, Secure Boot, enroll o reset.

### Evidencia en este equipo (2026-11-24)

- systemd 262.2 (Arch); `systemd-analyze has-tpm2` → `yes` (firmware, driver,
  system, subsystem y libtss2 presentes).
- `/dev/tpm0` (`tss:root 0660`) y `/dev/tpmrm0` (`root:tss 0660`); uid 1000 no está
  en el grupo `tss`: sin acceso directo al TPM.
- Con `--with-key=tpm2` en modo `--user` systemd responde
  `Selected key not available in --uid= scoped mode, refusing.` (era el bloqueo del
  borrador anterior). En modo de usuario systemd sólo ofrece claves con ámbito de
  usuario que combinan host y TPM.
- Con `--with-key=host+tpm2 --tpm2-pcrs=7` el roundtrip funciona sin contraseña ni
  privilegios: `{"ok":true,"stage":"roundtrip","reason":"systemd-host-tpm2-pcr7-roundtrip-only"}`.
  La mediación la hace el servicio de credenciales de systemd según su política
  polkit local; el probe no la modifica.

## Lo que el roundtrip NO acredita

`systemd-creds decrypt` devuelve el plaintext al proceso: sellar no es firmar con
una clave que nunca sale del hardware. Cualquier proceso del mismo usuario puede
pedir el mismo descifrado. El resultado sólo vale para este equipo y este momento.

## Pendiente (bloqueado; requiere decisiones o cambios del usuario)

Nada de esto está en el código distribuido. No se debe simular ni sustituir por
alternativas más débiles.

1. **Clave TLS móvil no exportable.** Necesita un proveedor de firma TPM:
   - OpenSSL 3 + `tpm2-openssl` (provider) o `tpm2-pkcs11`, instalados por el
     usuario, p. ej. `sudo pacman -S tpm2-openssl tpm2-tools`.
   - Acceso al TPM para el usuario del host: `sudo usermod -aG tss "$USER"` y nueva
     sesión, **o** un broker de firma aislado (servicio systemd con política propia)
     que sólo exponga «firmar handshake TLS» por un socket local. El grupo `tss` da
     acceso al TPM a todos los procesos del usuario; el broker es la opción
     recomendada, pero hay que diseñarlo, autorizarlo y probarlo.
   - Adaptar `host/mobile-tls.mjs` para crear la clave dentro del TPM y firmar a
     través del provider/broker. Node no carga providers OpenSSL externos por
     defecto: antes hay que verificar el soporte en el runtime empaquetado
     (`resources/runtime/node`).
2. **Migración de claves existentes.** La clave de `mobile-tls/key.pem` no se puede
   mover al TPM: hay que generar una identidad TPM nueva, mostrar la nueva huella y
   volver a vincular los teléfonos (QR nuevo). Decisión del usuario: cuándo hacerlo
   y si borrar la clave antigua.
3. **Secretos en reposo (opcional).** Sellar con `systemd-creds --user
   --with-key=host+tpm2` credenciales guardadas por Phantom es posible hoy, pero no
   protege frente al mismo usuario y añade riesgo de pérdida. Requiere decidir qué
   secretos y resolver antes el punto 4.
4. **Recuperación ante cambios de PCR7.** Actualizar firmware, claves de Secure Boot
   o shim cambia PCR7 e impide abrir lo sellado. Antes de sellar nada duradero:
   definir copia recuperable por vía independiente, responsable y procedimiento de
   reemisión (para TLS basta volver a vincular).
5. **Autenticación administrativa.** Enroll, grupo `tss`, políticas polkit de
   `io.systemd.credentials` y Secure Boot necesitan `sudo` y quedan fuera de
   Phantom: Phantom no pide ni guarda contraseñas de administrador ni se ejecuta
   como root.

## Pruebas

`test/desktop-tpm.test.mjs` (incluida en `npm test`) fija ejecutable, argv
`host+tpm2`/PCR7, pipes privados, límites y borrado de buffers; comprueba que un
fallo al sellar nunca reintenta con otra clave, que no se filtran diagnósticos del
hijo y que se detectan discrepancias de longitud o contenido. No usa el TPM real.
