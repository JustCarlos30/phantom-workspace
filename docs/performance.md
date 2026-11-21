# Rendimiento y cobertura de Phantom Workspace

Este documento describe qué cubre hoy el banco, qué falta y cómo obtener una línea base. **No contiene mediciones**: los resultados se capturan ejecutando los comandos en la máquina objetivo.

## Comandos reproducibles

```bash
npm run bench:core                      # ejecución por defecto (3 repeticiones, < 60 s)
node test/perf-core.mjs --quick         # rápida (< 20 s)
node test/perf-core.mjs --samples 300 --repetitions 5 --warmup 30
node test/perf-core.mjs > a.json; node test/perf-core.mjs > b.json
node test/perf-core.mjs --compare a.json b.json   # ratios b/a de p50, sin umbrales
node --test test/perf-core.test.mjs test/perf-state.test.mjs test/perf-events.test.mjs test/socket-output.test.mjs
node test/canvas-perf.mjs               # UI; requiere entorno gráfico (ver límites)
```

## Inventario y matriz

| Área | Fuente | Existente | Ejecutado por este banco | Pendiente |
|---|---|---|---|---|
| Estado (Store) | `test/perf-state.test.mjs` (coalescing, tamaño de `state.json`, rollback) | Sí, con umbrales de regresión gruesa | Sí: `test/perf-core.mjs` (latencia de transacción y flush, carga, bytes, CPU, RSS, event loop) | Estado con historial de terminal real; transacción sin clonado total (solo candidato) |
| Eventos | `test/perf-events.test.mjs` (hub/tails) | Sí | No | Latencia de entrega con muchos suscriptores |
| Transporte | `test/socket-output.test.mjs` (backpressure, socket simulado) | Sí | No | Sockets reales, clientes lentos, WebSocket del gateway |
| UI | `test/canvas-perf.mjs` (6 s pan/zoom y terminales, GL por software) | Sí, manual | No | Ejecución en GPU real; métricas de frames por dispositivo |
| Gateway externo | — | No | No | Carga, latencia y concurrencia; requiere entorno representativo |
| Docker / Mongo | `compose.yaml` | No hay banco | No | Requiere servicios compose |
| Carga mixta | — | No | No | Estado + eventos + transporte + UI simultáneos |
| Larga duración | — | No | No | Horas de sesión con series temporales de RSS |

## Qué mide `test/perf-core.mjs`

Usa el `Store` real sobre directorios temporales privados (`os.tmpdir()`, nunca datos del usuario), con escalas `small` (1×20 nodos) y `heavy` (5 proyectos × 170 nodos). No lanza procesos, contenedores, agentes ni servidores. Salida JSON con `schemaVersion: 1`.

- `transactionMs` y `flushMs`: por separado, con `count`, `p50`, `p95`, `max` (ms).
- `loadMs`: construcción de `Store` desde disco.
- `eventLoopDelayMs`: histograma de `monitorEventLoopDelay` (resolución 10 ms) activo solo durante la fase medida, cediendo el loop entre muestras.
- `cpu`: `process.cpuUsage` de la fase medida (proceso completo).
- `rss`: snapshots en puntos de cesión; **no es el pico real**. `processMaxRss` es el pico de todo el proceso Node desde su inicio.
- `persistedStateBytes`, `config`, `environment` (Node, plataforma, CPU), `date`.
- Métricas no disponibles se emiten como `null` con `reason`.
- El warmup se ejecuta antes y no entra en las muestras.

## Límites

- Es un núcleo sintético, no end-to-end: no representa UI, red ni agentes.
- Una sola corrida no demuestra una fuga de memoria; haría falta una serie larga con tendencia.
- `canvas-perf.mjs` usa GL por software: no refleja una GPU real.
- Los resultados dependen de la carga de la máquina; compare corridas en el mismo equipo y repita.

## Casos propuestos (presupuesto propuesto, no garantía)

| Caso | Carga | Duración | Métricas | Recursos |
|---|---|---|---|---|
| Reposo | Estado heavy abierto, sin mutaciones | 10 min | CPU, RSS en serie, retraso del loop | 1 proceso host |
| Normal | 1 proyecto activo, ~5 mutaciones/s, 2 terminales | 10 min | p95 de transacción/flush, loop p95, bytes | host + UI |
| Cargado | heavy, ráfagas de mutaciones y salida de terminal continua | 5 min | p50/p95/max, backpressure, CPU | host + UI, GPU real |
| Sostenido | Mezcla normal + cargado | 2–4 h | tendencia de RSS, tamaño de estado, loop max | máquina dedicada |

Los presupuestos numéricos se fijan solo después de capturar una línea base en el equipo representativo; hasta entonces son hipótesis a validar.

## Decisiones sobre Rust

Migrar cualquier parte a Rust queda condicionado a (1) un perfil que muestre un cuello de botella real en esa parte (p. ej. clonado/validación en `Store.transaction` o flush síncrono, hoy solo candidatos) y (2) una suite de paridad funcional que el reemplazo pase sin cambios. Sin ambas, no se justifica.
