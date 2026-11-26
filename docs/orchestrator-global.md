# Orquestador global único (PROPUESTA)

> **Estado: propuesta, no implementada. Pendiente de aprobación de Carlos.**
> Nada de lo descrito aquí existe en el código. Hoy solo existe `orchestrator.send` (un orquestador por proyecto; ver `host/README.md`).

## Objetivo

Una sola sesión de orquestador para todos los proyectos, a la que se le habla en lenguaje natural («incorpora la rama X en el proyecto Y») sin abrir la terminal de cada proyecto.

## Dónde corre

- En un **directorio neutro del host** (p. ej. `<dataDir>/orchestrator-global/`), vacío salvo su propia memoria de sesión.
- **Sin checkout** de ningún proyecto: no puede editar código ni ejecutar Git sobre un repositorio por accidente.
- **Sin `PHANTOM_MERGE_TOKEN`** ni ninguna credencial de incorporación o publicación en su entorno. Su entorno se construye desde una lista permitida, no heredando el del host.
- Lee el estado de todos los proyectos por RPC de solo lectura (`state.get`, `merge.status`, `phantom.list`).

## Cómo pediría una incorporación

1. Carlos dice «incorpora la rama X en el proyecto Y».
2. El orquestador global **no incorpora**: identifica la solicitud ya encolada por `submit` (la rama la envía su sesión de trabajo, no el orquestador) y la pide al controlador nativo de incorporaciones mediante un RPC nuevo del host, p. ej. `merge.request {workspaceId, requestId}`.
3. El RPC **solo acepta solicitudes que ya existen en la cola** creada por `submit`; rechaza ramas sueltas, ids desconocidos y cualquier clave extra.
4. El controlador nativo aplica sus reglas actuales (merge guard, comprobaciones, token propio). El orquestador global nunca recibe ese token.
5. **Nunca push**: el RPC no publica ni empuja a ningún remoto; `branch.publish` sigue siendo decisión del usuario.

## Qué no cambia

- Quién puede incorporar y el merge guard permanecen como están.
- No se da token de merge a nadie nuevo.

## Preguntas abiertas para Carlos

- ¿Sustituye a los orquestadores por proyecto o convive con ellos?
- ¿Proveedor y permisos de la sesión global (modo chat, aprobación manual)?
- ¿Forma exacta y auditoría del RPC `merge.request`?

Nada se implementará hasta que Carlos apruebe esta propuesta.
