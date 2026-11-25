# Estado de verificación del compositor

## Ejecución histórica acreditada

Recibo confirmado por el padre y recibido en este mandato, procedente de la tarea `task_d34fbe1b-60da-458b-a5db-17589e998624`, run `run_73d1e29d-eba8-45c1-bad5-48b3f9fb9aca`:

| Check | Resultado histórico |
| --- | --- |
| `project-permission-defaults` | 8/8 PASS |
| `frontend-build` | PASS |
| `composer-rendered-ux` | 4/4 PASS |
| `composer-rendered-repeat` | 4/4 PASS |

El juez acreditó req:1/2/3/4 como satisfechos; el objetivo quedó sin aceptar exclusivamente por cierre documental obsoleto. Estos resultados son evidencia histórica recibida del padre, no ejecuciones nuevas observadas en este workspace.

Se acreditaron ChatCard y PhantomChat (card/dock) a 320/480/640/960 px, guardar/quitar mediante checkbox real con `sessionDefaults:null`, errores y reintento, foco/teclado/menús, geometría y estados de voz sintéticos.

## Reposición y nueva ejecución del controlador

Repuesto el patch autorizado: preferencias explícitas persistentes por proyecto, precedencia de permisos explícitos sin alterar sesiones existentes, checkbox reversible, barra compartida de carpeta/modelo/effort y acciones de voz/envío, fixture renderizada, ambos tests y 17 escenarios Storybook adicionales.

El foco del checkbox se restaura al terminar el guardado si lo tenía y quedó en `body`; Escape en SessionChip consulta `details.open`. Las aserciones de foco incluyen superficie/ancho/paso y diagnóstico. Se conservan mediciones de overflow, solapes, hit-test y menús a todos los anchos declarados.

Los cuatro checks históricos ya están acreditados en el recibo anterior. La revalidación de esta reposición corresponde a una nueva ejecución de los mismos cuatro checks por el controlador, incluida la repetición UI con `--test-concurrency=1`; sus resultados se informan por separado. El ejecutor no ha ejecutado checks en este intento.

Las pruebas generan PNG, JSON e informe Markdown exclusivamente en `.test-artifacts/`: `composer-ux-verification.md`, `composer-geometry.json` y `composer-*.png`. No escriben documentación tracked; este documento se actualizó explícitamente desde el recibo histórico antes del snapshot. Un informe vacío o una ejecución fallida no acredita aceptación.

El job `composer-test` conserva Playwright v1.58.0-noble, ejecución ephemeral, sin puertos ni secretos, red desactivada al ejecutar y bind limitado al workspace.

## Popover del chip de sesión

El popover `.pc-session-pop` se renderiza en un portal a `document.body` con `position: fixed`, anclado al chip (no ya `absolute` dentro de `.pc-field`). `test/composer-ux.test.mjs` añade, para card y dock: con viewport de 720 px de alto, `scrollHeight <= clientHeight + 1`, rect dentro del viewport y esquinas sin recorte (`elementFromPoint`); clic dentro no cierra, clic fuera sí; y con el compositor sin espacio arriba el popover abre abajo o se ajusta, completo en el viewport. Estas pruebas se redactaron sin ejecutarse en este intento; las informa el controlador.

## Límites de la evidencia

Chromium headless y mediciones DOM acreditan la UI renderizada, no una revisión visual humana. MediaStream generado y ASR sintético ejercitan el recorder y los estados de voz, no micrófono físico ni reconocimiento nativo. No se acredita revisión visual humana ni reconocimiento nativo.
