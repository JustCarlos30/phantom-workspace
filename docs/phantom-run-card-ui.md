# Tarjeta de encargo Phantom (PhantomRunCard)

## Resultado

- Cabecera discreta `PHANTOM` con el único estado real del encargo (`delegateView().stateLabel`).
- Título del objetivo visible con wrap (sin elipsis), debajo de la cabecera.
- Resumen solo con datos registrados: `N de M checks pasados` (o `M checks sin resultado` si no hay resultados) y el tiempo. No se afirma aprobación sin resultado.
- `Detalles de ejecución`, cerrado por defecto: pasos, fases, checks, intentos, salida, ID, modelo y fase. `state.line` solo se muestra como actividad actual mientras corre; nunca como resultado.
- Acciones: `Ver resultado` (encargo terminado) o `Abrir en Phantom` abren el panel `phantom-cards`; `Resolver bloqueo` aparece si hay bloqueo, con su motivo visible.
- En vida se conservan la actividad actual y `<progress>` (`state.live && state.total > 0`). `onTone`, polling y reintento no cambian.
- `Delegate` sigue sirviendo a `SubagentCard` con su fila por defecto; Phantom usa las props opcionales `head`, `summary` y `detailsLabel`. Estilos nuevos acotados bajo `.pc-phantom-run`.
- Alineación: la regla genérica `.pc-subagent > :not(.pc-subagent-head)` daba `margin-left: 60px` a `.pc-phantom-head`, y `.pc-subagent > .pc-progress` (posterior) dejaba margen y ancho con descuento de 60px. Se añadieron, tras esa regla, `.pc-subagent.pc-phantom-run > .pc-phantom-head { margin: 0 }` (el inset lo da su `padding` con `--row-px`) y `.pc-subagent.pc-phantom-run > .pc-progress` con margen lateral `--row-px` y `width: calc(100% - 2 * var(--row-px))`, al mismo inset que el cuerpo. Reglas comunes de SubagentCard sin cambios.
- Completada no implica integrada; la tarjeta no muestra estado de integración.

## Tonos

El tono sale de `delegateView().tone` y se expresa solo con tinta y una marca compacta junto al estado (`.pc-delegate-mark`, cuadrada de 6 px, `background: currentColor`), nunca con fondo teñido. La marca es una marca compacta según DESIGN.md, no una superficie.

| Tono | Marca | Tinta del estado | Ejemplo de estado |
|---|---|---|---|
| `live` | cuadrada llena, lima | `--working` | En curso / Verificando |
| `attention` (bloqueo o pregunta) | cuadrada llena, ámbar | `--attention` | Bloqueada / Espera tu respuesta |
| `error` | cuadrada llena, roja | `--danger` | Falló |
| `done` | cuadrada llena, verde | `--success` | Completada |
| `stopped` / `unknown` | cuadrada hueca (aro `inset 0 0 0 1px currentColor`) | `--muted` | Cancelada / Lista / Estado no disponible |

- Terminada, detenida o desconocida: el título baja a `--muted` y el bloque se lee cerrado bajo su estado; en vivo, atención y error el título queda en `--ink`.
- `SubagentCard` comparte las tintas: su glifo y su estado toman el mismo color por tono (también verde en `done`), y `stopped`/`unknown` quedan en `--muted`.
- `--pc-del` ya no es un rojo propio (`#d99098`): es alias de `--danger`; errores de pasos, diffs y salidas usan `--danger`.
- Detalle técnico (ID, modelo, fase, motivo): rejilla `dt`/`dd` (`max-content` / `minmax(0, 1fr)`), etiquetas `--ink-3`, valores `--muted`, ambos `--t-support`; el código usa `--t-code`.

## Pasos y salidas

- Filas de paso: alto `--activity-row-height` sin separación extra entre filas; glifo en la columna `--icon-col` con el color del estado (lima en curso, ámbar en espera, rojo error, `--ink-3` hecho). Jerarquía: etiqueta (`--t-control`, `--ink` en curso y `--muted` hecha) > detalle (`--t-support`, `--muted`) > estado (`--t-micro`). En la lista de pasos de un encargo, hecho es un check `--success`, espera «en espera» ámbar.
- Salidas (`.tv-scroll`): pozo `--well-terminal` con `--terminal-ink`, aro de 1 px `--divider` por `box-shadow` (no borde), radio `--r-row`, padding `--s-2`/`--s-3`, scroll interno con alto máximo (consola `min(40vh, 360px)`, resto `min(60vh, 520px)`). La consola usa `--t-terminal-preview` y el prompt `$` en `--muted`; tablas y demás cuerpos `--t-code`. El error ya no tiñe el pozo: solo su etiqueta va en `--danger`.
- El output cuelga de la columna de texto de la fila: `margin: 0 var(--row-px) var(--s-3) var(--divider-inset)` (16 + 32 + 12 px), igual que el cuerpo de los subagentes y su `<progress>`.

## Stories

`EncargoPhantomCompletada`, `EncargoPhantomEnEjecucion`, `EncargoPhantomBloqueada`, `EncargoPhantomEstrecha` (360 px) en `Conversaciones`, con API fixture estable y datos sintéticos. La acción escribe el destino abierto en una línea local; los `play` cubren apertura/cierre de detalles y esa acción.

## Límites

- No se ejecutó revisión en navegador ni a 360/720 px por parte de este cambio ni del rediseño de tonos/pozos; la legibilidad se basa en CSS (wrap, `min-width: 0`, `overflow-wrap`) y requiere revisión visual del padre.
- Los resultados de los checks se informan en la validación del controlador, no aquí.
