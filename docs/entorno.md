# Entorno: convención de feedback ejecutable

Todo lo que se ejecuta para dar feedback (preview visual, servicio largo como gateway o API Node, entorno dev completo por perfil, job puntual como e2e o migración) vive como servicio de `compose.yaml` del repositorio, tiene dueño y se limpia según su ciclo de vida.

## Ciclo de vida

Se declara en la extensión de servicio `x-phantom`:

```yaml
x-phantom: {lifecycle: ephemeral|persistent, purpose: "una línea", card: "ID de la card"}
```

Sin `x-phantom` el servicio es `ephemeral`.

| Ciclo | Dueño | Limpieza |
| --- | --- | --- |
| `ephemeral` | La terminal que lo arrancó | Se elimina (`compose rm -sf SERVICIO`, o `down` del perfil) cuando esa terminal sale o se cierra. |
| `persistent` | El proyecto | Sobrevive a la card y nunca se baja solo. Se administra desde Entorno → Docker. |

## Reglas

- La app nunca genera `compose.yaml`: lo escribe el agente dentro de su tarea, según lo que la card declare.
- Puertos publicados solo en `127.0.0.1`; todo servicio lleva `healthcheck`.
- `launch` sigue existiendo para lo no contenerizable; no se bloquea y no hay diálogo emergente.
- Un agente solo baja lo suyo y lo `ephemeral`. Lo `persistent` y lo de otra terminal viva se rechazan para el agente.
- Una card nueva reutiliza los servicios `persistent` existentes y enlaza la card de origen.

## Comandos del agente

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env list
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env up SERVICIO | --profile PERFIL
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env run JOB [--timeout S]
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env down [SERVICIO]
```

Flujo: `env list` → si falta, añadir el servicio a `compose.yaml` en el diff de la tarea → `env up` / `env run` → mostrar resultado (browser en el canvas si hay URL; `exitCode` y logs si es job) → `env down` de lo efímero al terminar. La skill es `phantom-entorno` (acciones `env.service`, `env.job`, `env.up`).

## UI

Entorno → Docker lista cada servicio del compose con ciclo de vida, dueño (terminal o "Proyecto"), propósito y card, antigüedad, y los botones Abrir y Detener y eliminar (`env.down`). Estados: cargando, error, Docker no disponible y sin compose.

## Plantilla propuesta para la skill global `card.prepare`

Estado: preparada, no publicada. Añadir a la plantilla de card cuando el cambio necesite feedback ejecutable:

```markdown
## Entorno

- Servicios o jobs: <nombre, qué muestra o prueba>
- Ciclo de vida por servicio: <nombre: ephemeral | persistent>
- Cambios en compose.yaml: <servicios nuevos o modificados; "ninguno" si reutiliza>
- Permisos y escalamiento: <puertos, volúmenes, red, imágenes, secretos; lo que exceda esto se escala>
- Reutiliza: <servicios persistent existentes y card de origen>
- Resultado esperado: <URL en el canvas | exitCode 0 y logs>
```

Si la card no necesita feedback ejecutable, la sección se omite.
