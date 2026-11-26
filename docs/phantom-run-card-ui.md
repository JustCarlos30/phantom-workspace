# Tarjeta de encargo Phantom (PhantomRunCard)

## Resultado

- Cabecera discreta `PHANTOM` con el único estado real del encargo (`delegateView().stateLabel`).
- Título del objetivo visible con wrap (sin elipsis), debajo de la cabecera.
- Resumen solo con datos registrados: `N de M checks pasados` (o `M checks sin resultado` si no hay resultados) y el tiempo. No se afirma aprobación sin resultado.
- `Detalles de ejecución`, cerrado por defecto: pasos, fases, checks, intentos, salida, ID, modelo y fase. `state.line` solo se muestra como actividad actual mientras corre; nunca como resultado.
- Acciones: `Ver resultado` (encargo terminado) o `Abrir en Phantom` abren el panel `phantom-cards`; `Resolver bloqueo` aparece si hay bloqueo, con su motivo visible.
- En vida se conservan la actividad actual y `<progress>` (`state.live && state.total > 0`). `onTone`, polling y reintento no cambian.
- `Delegate` sigue sirviendo a `SubagentCard` con su fila por defecto; Phantom usa las props opcionales `head`, `summary` y `detailsLabel`. Estilos nuevos acotados bajo `.pc-phantom-run`.
- Completada no implica integrada; la tarjeta no muestra estado de integración.

## Stories

`EncargoPhantomCompletada`, `EncargoPhantomEnEjecucion`, `EncargoPhantomBloqueada`, `EncargoPhantomEstrecha` (360 px) en `Conversaciones`, con API fixture estable y datos sintéticos. La acción escribe el destino abierto en una línea local; los `play` cubren apertura/cierre de detalles y esa acción.

## Límites

- No se ejecutó revisión en navegador ni a 360/720 px por parte de este cambio; la legibilidad se basa en CSS (wrap, `min-width: 0`, `overflow-wrap`) y requiere revisión visual del padre.
- Los resultados de los checks se informan en la validación del controlador, no aquí.
