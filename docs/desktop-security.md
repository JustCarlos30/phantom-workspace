# Frontera de privacidad de escritorio

## Frontera existente

La UI de Electron usa `sandbox: true`, `contextIsolation: true` y
`nodeIntegration: false`. El preload expone el puente de invocaciones; el proceso
principal valida el emisor y el contrato IPC. El host se ejecuta por separado con
Node del sistema, conserva el estado privado y atiende las integraciones. Separar
estos procesos no equivale a aislarlos de otros procesos del mismo usuario.

## Proyección de settings

`host/public-settings.mjs` es un helper sin arranque de servicios ni efectos al
importarlo. `state.get` y el retorno de `settings.update` proyectan únicamente
`settings`: recorren objetos y arrays JSON, incluidos arrays de arrays, sin mutar
el original. Conservan posiciones y valores públicos (también `null`, booleanos y
números). Las claves de prototype se copian como propiedades de datos propias,
sin invocar setters ni redirigir la escritura al prototype.

Se eliminan campos cuyos nombres coinciden con la cobertura previa (`secret`,
`token`, `password`, `credential`, `authorization`, `api.?key`) y con nombres
normalizados quitando separadores y diferencias de mayúsculas: `privateKey`,
`signingKey`, `clientSecret`, `accessToken`, `refreshToken` y `passphrase`, además
de las familias anteriores. El filtro se basa en nombres: no puede reconocer
secretos arbitrarios guardados bajo nombres benignos ni dentro de strings públicos.

`storage.export` limita sus settings a las preferencias portátiles existentes:
`theme` y `language` como strings; `fontSize` y `terminalFontSize` como números
finitos positivos. Omite objetos, arrays y tipos inválidos, incluso si contienen
secretos bajo nombres benignos. No convierte valores ni incluye configuración de
runtime. Los consumidores revisados no necesitan objetos en estas preferencias;
el tamaño de terminal de la UI se guarda por nodo, no en estos settings globales.

La protección es de salida: las credenciales permanecen en el estado privado y en
su persistencia para que las integraciones sigan accediendo a su configuración.
No cambia la semántica de importación. Tampoco censura chats, notas ni historial:
son contenido del usuario y pueden contener información sensible, incluida en las
exportaciones según sus opciones. Los rechazos de tipo de estas preferencias no
necesitan interpolar sus valores; la exportación simplemente omite tipos inválidos.

## Límites

Esta proyección no cifra archivos ni implementa protección frente a root o a
procesos del mismo usuario. Los permisos locales del directorio y del socket no
constituyen esa defensa.

El equipo tiene `/dev/tpm0` y `/dev/tpmrm0` y `npm run probe:tpm` sella y abre un
secreto sintético con `systemd-creds` (`host+tpm2`, PCR7), pero ninguna clave ni
credencial de Phantom usa el TPM. No se declara TPM, HSM ni KMS implementado:
KMS/HSM requieren un proveedor real, una política y pruebas de integración. El
diagnóstico y lo que falta para usar el TPM están en `docs/desktop-tpm.md`.

## Pruebas del cambio

`test/public-settings.test.mjs` cubre la proyección, las variantes de nombres,
la ausencia de mutación, las claves de prototype y los tipos portátiles. Se importa
desde `test/host-server.test.mjs`, que añade casos RPC con fixtures aislados para
los retornos de settings, la persistencia privada, el acceso de integraciones,
la importación y la exportación maliciosa y normal. La ejecución y el resultado de
los checks corresponden al controlador; este documento no acredita checks pasados.
