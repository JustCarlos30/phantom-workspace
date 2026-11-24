# Análisis de riesgo A: `.pt-glyph` y botones globales

Análisis solo lectura. Completa las dos reglas de riesgo A que `docs/proposals-integration-audit.md` §2 (líneas 142-143) dejó sin decidir. No se ha cambiado código. Este documento recomienda, pero **no decide**. Las decisiones que corresponden a Carlos están en «Decisiones abiertas».

---

## 1. `.pt-glyph` e insignias del rail

### Qué hace hoy producción

- `src/terminal.css:10-14` define `--hue-claude`, `--hue-opencode`, `--hue-codex` y `--hue-agent` como `var(--ink)`, y `--hue-shell` como `var(--muted)`. En la práctica, el «tinte por proveedor» ya es neutro: tinta o tinta secundaria.
- `src/terminal.css:18` define `.pt-glyph` así: `inline-grid`, `1.85em × 1.85em` (escala con el texto de la cabecera), `border-radius: var(--r-mark)` (4 px, `src/canvas-ui.css:7`), fondo `color-mix(var(--hue) 16%)` y color `var(--hue)`. `:19` fija el svg a `1.15em`.
- `src/terminal.css:20-23` asigna `--hue` mediante `[data-provider]`.
- `src/components/Glyphs.jsx:61-63` (`ProviderTile`) es el único productor de `.pt-glyph`, con `aria-hidden="true"`. Lo consumen **solo las cabeceras de tarjeta**: `src/components/TerminalCard.jsx:29` y `src/components/ChatCard.jsx:323`, dentro de `.pt-provider`, junto al nombre del proveedor. **El rail no usa `.pt-glyph`.**

### Qué propone el laboratorio

`src/stories/proposals-foundations.css:57-62`, bajo `.px-after`: un círculo de 32 px fijo, `border-radius: 50%`, fondo `--control-fill`, sin sombra, tinta `--ink`, `--t-micro` 600 y svg de 16 px. Se aplica a `.pt-glyph` y a `.px-fd-glyph` por igual. Resultado: una insignia neutra única, sin variación por proveedor ni por estado.

### Qué contradice de design-v2.md / DESIGN.md

- `design-v2.md:159-160`: `--badge-size: 32px` y `--glyph-primary: 18px`. El laboratorio usa un glifo de **16 px** (`--glyph-secondary`), no los 18 px del glifo primario de la insignia.
- `design-v2.md:162-164`: el rail lleva insignia **por estado** (gris con glifo en reposo; lima apagada `--badge-working` si trabaja; ámbar apagado `--badge-attention` si te necesita) o **por tipo** (paleta estable `--badge-*`). La propuesta del laboratorio no cubre ninguna de las dos variantes: siempre es gris y no tiene ganchos de estado ni de tipo. Si se adoptara como insignia del rail, cerraría la decisión de hecho, a favor de un «solo neutro» que ninguna de las dos opciones contempla.
- `design-v2.md:164` también pide reutilizar `ProviderGlyph`/`ShellIcons`. El laboratorio lo respeta, porque solo cambia el contenedor.
- Confusión de alcance: el laboratorio aplica a la **cabecera de tarjeta** (`.pt-glyph`) un tamaño pensado para el **rail** (32 px fijo). Hoy la cabecera escala en `em` para alinearse con su etiqueta (comentario en `Glyphs.jsx:60`). Un disco de 32 px dentro de una cabecera de una sola línea altera su altura y su alineación.

### Impacto

- **Superficies:** cabeceras de todas las tarjetas de terminal y de chat (`TerminalCard.jsx:29`, `ChatCard.jsx:323`), además de las stories que muestran `ProviderTile` (`Identity.stories.jsx:15`, `ProposalsFoundations.stories.jsx:113`). No afecta al rail, que no usa esta clase.
- **Presupuesto de bordes:** neutro. Ni la versión actual ni la propuesta tienen borde ni sombra (la propuesta declara `border: 0; box-shadow: none`), así que el contador no cambia.
- **Accesibilidad:** neutro. El elemento es `aria-hidden` y el nombre del proveedor va en texto al lado. Al pasar a `--control-fill` + `--ink` se pierde la diferencia shell (`--muted`) / agente (`--ink`). Es una pérdida pequeña, porque esa diferencia ya está en el texto y en `.pt-provider.is-*`.
- **Táctil 44 px:** no aplica. El elemento no es interactivo.

### Recomendación

**No integrar en `.pt-glyph`.** Las razones: cambia una superficie (cabeceras) distinta de la que pretende diseñar (rail), fija 32 px donde hoy se escala en `em`, y de paso cerraría la decisión estado/tipo.

La forma de la insignia, en cambio, sí es reutilizable: **integrar parcial** como clase nueva y propia del rail (por ejemplo `.badge`, como ya nombra `design-v2.md:159`), con 32 px, círculo, glifo de 18 px y el fondo según la variante que elija Carlos. Esto solo debe hacerse **después** de la Decisión 1.

### Plan si se integra (tras la decisión)

1. `src/canvas-ui.css` (`:root`): añadir `--badge-size: 32px`, `--badge-ink`, `--glyph-primary: 18px`, `--badge-neutral`, `--badge-working`, `--badge-attention` y, solo si se elige «por tipo», también `--badge-steel|mint|honey|coral|violet|petrol` (valores de `design-v2.md:151-158`).
2. `src/sidebar.css`: regla `.project-rail .badge` con círculo, `--badge-size` y `--badge-neutral`; variantes `[data-state="working"]` y `[data-state="attention"]` (por estado) o `[data-provider]` (por tipo); transición de 200 ms linear solo en `background-color` (`design-v2.md:143`).
3. Componente de fila del rail (el que hoy pinta el glifo de sesión en el rail; ubicar con `grep ProviderGlyph src/components`): envolver `ProviderGlyph` en `.badge` con `data-state` o `data-provider`. **No tocar** `ProviderTile` ni `src/terminal.css:18`.
4. `src/stories/proposals-foundations.css:57`: dejar de apuntar a `.pt-glyph`; el laboratorio solo debe estilar `.px-fd-glyph` y `.badge`.
5. Checks: `npm test` (incluye `test/design-tokens.test.mjs`), `node test/terminal-borders-smoke.mjs` (comprobar que el presupuesto no cambia), `npm run test:storybook` y la escena de `test/design-capture.mjs` «rail por estado/por tipo» con medida de círculo 32 / glifo 18 (`design-v2.md:436`).

---

## 2. `.tw-button`, `.button` e `.icon-button` globales

### Qué hace hoy producción

Hay varias capas en cascada sobre los mismos selectores:

- `src/canvas-ui.css:57` define `--control-size: 36px`.
- `src/canvas-ui.css:203-210`: `.tw-button`, `.button` e `.icon-button` están en una lista base compartida (con controles del rail, del dock, del navegador, del menú contextual, etc.).
- `src/canvas-ui.css:639-646`: `.button` de 34 px de alto, padding `0 14px`, `--r-ctl` (12 px), `--fill-2`, peso 550, `scale .98` al pulsar. `.icon-button` usa `--r-ctl`, hover `--fill-2`, y `.active` usa `--accent-soft`/`--accent`.
- `src/canvas-ui.css:779-781`: `.tw-button` usa `--r-ctl`, `--fill-2` y peso 550.
- `src/canvas-ui.css:1225-1240`: la primaria lleva `box-shadow: var(--shadow-key)`, es decir, sombra de tecla.
- `src/canvas-ui.css:1264-1269`: segunda pasada de `.button`/`.tw-button` con `--fill`, primaria con `--shadow-key` y `--primary-press`, y `.icon-button.active`.
- `src/canvas-ui.css:1293-1296`: `font: var(--t-control)`.
- `src/studio.css:52-55`: `.button { border-color: var(--hairline) }`, más hover y primaria.
- Táctil: el reparto es por familia, no global. `src/shell.css:149-151` (`--target: 44px` en cabecera), `src/sidebar.css:235-237`, `src/settings.css:176-178`, `src/chat.css:631` y `src/voice.css:51`. **No hay** regla `pointer: coarse` genérica para `.button`/`.tw-button`/`.icon-button`.

### Qué propone el laboratorio

`src/stories/proposals-foundations.css:65-79` (bajo `.px-after`):

- Texto (`.tw-button`/`.button`): píldora `--r-pill`, alto `--control-size` (36), padding `0 16px`, `border: 0`, `box-shadow: none`, `--control-fill`, peso 500.
- Primaria `.tw-primary`: `--on`/`--on-ink`, sin sombra de tecla.
- `.icon-button`: círculo de 36 px, transparente, `--muted`; hover `--control-fill`.
- Deshabilitado: fondo transparente y `--ink-3`.
- Foco visible: `outline 2px var(--on)`, offset 2.

### Qué contradice de design-v2.md / DESIGN.md

La propuesta casi siempre **alinea** producción con design-v2 en lugar de contradecirlo:

- `design-v2.md:113` pide controles sin borde ni sombra de tecla, secundario en círculo de 36 px y fantasma transparente hasta hover. Producción incumple con `--shadow-key` (`canvas-ui.css:1225,1266`) y con `border-color: var(--hairline)` (`studio.css:52`). El laboratorio cumple.
- `design-v2.md:123`: `--r-pill` para «primaria con texto». El laboratorio también lo aplica a la **secundaria con texto**, cosa que la norma no menciona: la secundaria se describe como círculo. Esta es una extensión no declarada.
- `design-v2.md:128`, deshabilitado: la norma pide **relleno `--control-fill`** con tinta `--ink-3`. El laboratorio usa **fondo transparente**, lo que contradice la norma.
- `design-v2.md:128` exige además conservar los 44 px efectivos con puntero grueso. El laboratorio no dice nada sobre esto, así que no lo empeora, pero tampoco lo aporta.
- `design-v2.md:282` (6·6): el acento significa «tú y tu acción». `--on` en la primaria y en el foco es coherente. `.icon-button.active` (`canvas-ui.css:646,1269`, `--accent-soft`) no aparece en el laboratorio; si se integra, debe conservarse.
- La primaria del dock mide 40 px con padding `0 18px` (`design-v2.md:128`). Una regla global de 36 px la rompería si el dock usa `.tw-button`/`.button`, salvo que se mantenga su override.

### Impacto

- **Superficies:** todas las familias. `.button`, `.tw-button` e `.icon-button` aparecen en inspector, diálogos, Configuración (fuera de `.st-btn`), plugins, navegador, notas, studio y dock. Como el selector es global y entra en una cascada de cuatro capas, el resultado depende del orden de carga (`canvas-ui.css` y `studio.css`).
- **Presupuesto de bordes:** **mejora**. Quitar `--shadow-key` y el `hairline` de `studio.css:52` resta contornos. Hay que actualizar `test/design-budget.json` a la baja y comprobarlo con `test/terminal-borders-smoke.mjs`.
- **Accesibilidad:** el foco de 2 px con `--on` es correcto (`design-v2.md:113`). Riesgos concretos:
  - el deshabilitado transparente sobre `--surface` puede quedar casi invisible frente al texto plano;
  - el `.icon-button` en reposo con `--muted` sobre transparente debe medirse para contraste 3:1 de objeto no textual;
  - perder `.active` dejaría sin estado los toggles.
- **Táctil 44 px:** fijar `height: var(--control-size)` con `min-height: 0` **anula** cualquier `min-height: 44px` heredado con menor especificidad. Hoy las reglas coarse son por familia y más específicas, así que sobrevivirían en sus familias, pero los `.button`/`.icon-button` sin regla coarse propia quedan en 34-36 px. Ese es el estado actual, y el laboratorio lo consolida en vez de corregirlo.

### Recomendación

**Integrar parcial**, con estos selectores:

1. **Sí:** retirar la sombra de tecla de la primaria en `.button.primary, .tw-button.tw-primary` (`canvas-ui.css:1225,1226,1266`) y el `border-color: var(--hairline)` de `.button` en `src/studio.css:52`. Es la norma `design-v2.md:113` y mejora el presupuesto.
2. **Sí:** foco visible común `:is(.tw-button, .button, .icon-button):focus-visible { outline: 2px solid var(--on); outline-offset: 2px }`.
3. **Sí:** `.icon-button` en círculo de 36 px (`width/height: var(--control-size); border-radius: 50%`), **conservando** `.icon-button.active`.
4. **Sí, con el valor de la norma:** deshabilitado con relleno `--control-fill` + `--ink-3` y sin hover (no transparente).
5. **Pendiente de decisión:** pasar `.button`/`.tw-button` **secundarios con texto** de `--r-ctl` (12 px) a `--r-pill`. La norma solo lo exige para la primaria.
6. **No:** `min-height: 0` global, ni alto fijo de 36 px sobre `.button`/`.tw-button` sin excepciones para el dock (40 px). En su lugar, añadir `@media (pointer: coarse) { :is(.tw-button, .button, .icon-button) { min-height: 44px; min-width: 44px } }` para separar área de interacción y diámetro pintado (`design-v2.md:128`).

### Plan si se integra

1. `src/canvas-ui.css`: consolidar las tres pasadas (`:639-646`, `:779-781`, `:1225-1240`, `:1264-1269`) en un único bloque final para `.button`, `.tw-button` e `.icon-button`, con los puntos 1-4 (y el 5 si Carlos lo aprueba). Conservar `.icon-button.active` y `--primary-press`. Añadir la regla coarse del punto 6.
2. `src/studio.css:52-53`: eliminar `border-color`/hover con `--hairline`/`--muted`.
3. `src/stories/proposals-foundations.css:65-79`: reducir el laboratorio a lo que no se haya integrado (o retirarlo) para que la story «después» no oculte la producción.
4. `test/design-budget.json`: bajar el recuento según lo que mida el smoke.
5. Checks: `npm test`, `node test/terminal-borders-smoke.mjs`, `node test/canvas-controls.mjs` (tamaños), `node test/spectral-ui.mjs`, `npm run test:storybook` y `test/design-capture.mjs` con puntero grueso y ventana 1100 × 760 (`design-v2.md:436`). Revisar a mano el dock (40 px), los diálogos y el inspector.

---

## Decisiones abiertas

**Necesitan a Carlos.** No se ha decidido ninguna en este análisis.

1. **Insignias del rail: por estado o por tipo** (`design-v2.md:164`). Bloquea cualquier trabajo de insignia. La recomendación de design-v2 es «por estado», pero está marcada explícitamente como pendiente de confirmación.
2. **¿Se confirma que `.pt-glyph` (cabecera de tarjeta) queda fuera de la reforma de insignias** y se crea una clase propia del rail? El análisis lo recomienda. Si Carlos quiere unificar cabecera y rail en un disco de 32 px, hace falta además decidir la altura de la cabecera.
3. **¿Los secundarios con texto pasan a píldora (`--r-pill`)?** design-v2 solo lo exige para la primaria. El laboratorio lo extiende a todos.
4. **Deshabilitado: ¿`--control-fill` (norma, `design-v2.md:128`) o transparente (laboratorio)?** Este análisis recomienda la norma.
5. **¿Se añade un objetivo táctil de 44 px global para `.button`/`.tw-button`/`.icon-button`,** o se mantiene el reparto actual por familia? Recomendado: global en `pointer: coarse`.
6. **Orden de trabajo:** cada regla en su propia card posterior (como prevé `proposals-integration-audit.md:205`), o las dos juntas. Recomendado por separado: la 2 (botones) no depende de la Decisión 1 y puede ir primero.
