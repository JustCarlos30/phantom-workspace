# Entorno: feedback ejecutable con compose

Todo lo que ejecutas para dar feedback vive como servicio de `compose.yaml` del repositorio, tiene dueño y se limpia según su ciclo de vida. `launch` queda solo para lo no contenerizable (no se bloquea).

## Cuándo aplica

- Preview visual de una UI (web estática o dev server).
- Servicio largo: gateway, API Node, base de datos de prueba.
- Entorno dev completo, agrupado en un perfil de compose.
- Job puntual: e2e, migración, seed.

Sin nada de esto que mostrar o probar, no uses esta skill.

## Ciclo de vida: `x-phantom`

Cada servicio declara su ciclo en la extensión `x-phantom`. Sin ella es `ephemeral`.

- `ephemeral`: pertenece a la terminal dueña y se elimina (`compose rm -sf SERVICIO`, o `down` del perfil) cuando esa terminal sale o se cierra.
- `persistent`: pertenece al proyecto, sobrevive a la card y nunca se baja solo. Se administra desde Entorno → Docker.

Campos: `lifecycle`, `purpose` (una línea) y `card` (ID o título de la card de origen).

## Sección "Entorno" de la card

Si la card necesita feedback ejecutable, debe declarar:

- Servicios y jobs que se usarán, con su ciclo de vida (`ephemeral` o `persistent`) por servicio.
- Cambios previstos en `compose.yaml`.
- Permisos y escalamiento explícitos: puertos, volúmenes, red, imágenes a descargar, secretos. Lo que exceda lo declarado se escala, no se asume.

La app nunca genera `compose.yaml`: lo escribes tú dentro de la tarea, según lo que la card declare.

## Pasos

Comandos (desde el CLI del agente):

```sh
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env list
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env up SERVICIO
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env up --profile PERFIL
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env run JOB --timeout 600
"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" env down SERVICIO
```

1. `env list`: comprueba si el servicio ya existe y de quién es.
2. Si falta, añádelo a `compose.yaml` dentro del diff de la tarea (que quede en el alcance escrito), con `x-phantom`, puerto publicado solo en `127.0.0.1` y `healthcheck`.
3. Servicios y perfiles: `env up SERVICIO` o `env up --profile PERFIL`. Jobs: `env run JOB`.
4. Muestra el resultado. Con URL, ábrela en un panel browser del canvas. Con job, informa `exitCode` y los logs (los últimos 16 KiB); un `exitCode` distinto de 0 o `timedOut` es fallo, no lo maquilles.
5. Al terminar, `env down SERVICIO` de lo `ephemeral`. Sin argumento baja todo lo efímero de tu terminal. Lo `persistent` no se baja; se deja a Entorno.

Solo puedes bajar lo tuyo: un servicio de otra terminal viva o uno `persistent` se rechaza.

## Iteración

Una card nueva reutiliza los servicios `persistent` existentes (los ve `env list`) en vez de crear otros, y enlaza la card de origen en `x-phantom.card` si cambia el propósito.

## Plantillas

Servicio Node:

```yaml
services:
  api:
    image: node:24-alpine
    working_dir: /app
    volumes: ["./:/app"]
    command: ["node", "server.mjs"]
    ports: ["127.0.0.1:3000:3000"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
      interval: 5s
      retries: 10
    x-phantom: {lifecycle: ephemeral, purpose: "API de la card", card: "ID"}
```

Web estática:

```yaml
  preview:
    image: nginx:alpine
    volumes: ["./dist:/usr/share/nginx/html:ro"]
    ports: ["127.0.0.1:8080:80"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1/"]
      interval: 5s
      retries: 10
    x-phantom: {lifecycle: ephemeral, purpose: "Preview visual", card: "ID"}
```

Gateway persistente:

```yaml
  gateway:
    build: ./gateway
    ports: ["127.0.0.1:4000:4000"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4000/health"]
      interval: 10s
      retries: 10
    x-phantom: {lifecycle: persistent, purpose: "Gateway del proyecto", card: "ID"}
```

Job e2e (perfil, sin puertos):

```yaml
  e2e:
    image: mcr.microsoft.com/playwright:v1.58.0-noble
    working_dir: /app
    volumes: ["./:/app"]
    command: ["npx", "playwright", "test"]
    profiles: ["e2e"]
    x-phantom: {lifecycle: ephemeral, purpose: "Pruebas e2e", card: "ID"}
```

Un job que depende de un servicio lo declara con `depends_on` y `condition: service_healthy`.

## Cierre

Reporta: servicios levantados, URL o `exitCode`, y qué quedó `persistent`. No afirmes que algo corre sin haberlo visto en `env list` o en el resultado del comando.
