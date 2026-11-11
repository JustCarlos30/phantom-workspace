---
name: Phantom Workspace
description: Atlas de estudio — a recoverable desktop project table.
colors:
  accent: "#345bd5"
  accent-soft: "#edf1ff"
  bg: "#e8edf2"
  surface: "#fff"
  surface-2: "#f4f6f9"
  ink: "#202b3b"
  muted: "#627084"
  line: "#d8dfe8"
  danger: "#b43b48"
  success: "#28765f"
  warning: "#946216"
  rail: "#202c44"
  rail-active: "#34435f"
  terminal-bg: "#131d2c"
  terminal-chrome: "#172335"
  terminal-foreground: "#e1e8f2"
  note: "#fffef9"
  mission-bg: "#eaf2ee"
  mission-ink: "#55705f"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.035em"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  panel-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "calc(11px * var(--map-label-scale,1))"
    fontWeight: 600
    lineHeight: 1.1
  tool-button:
    fontFamily: "system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.65
  terminal:
    fontFamily: '"DejaVu Sans Mono", "Liberation Mono", monospace'
    fontSize: "13px"
    lineHeight: 1.24
rounded:
  badge: "3px"
  inline: "4px"
  field: "5px"
  icon: "6px"
  button: "7px"
  menu: "8px"
  dock: "9px"
  node: "10px"
  dialog: "11px"
  overlay: "12px"
spacing:
  compact: "4px"
  field-gap: "5px"
  tool-button-gap: "6px"
  control-gap: "8px"
  form-gap: "10px"
  inset: "12px"
  content: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "35px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "35px"
  icon-button:
    textColor: "{colors.muted}"
    rounded: "{rounded.icon}"
    size: "29px"
  tool-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.tool-button}"
    rounded: "{rounded.field}"
    padding: "6px 10px"
  tool-button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.tool-button}"
    rounded: "{rounded.field}"
    padding: "6px 10px"
  tool-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "7px 9px"
    width: "100%"
  project-item-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "10px 8px"
    width: "100%"
  tool-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  mission-chip:
    backgroundColor: "{colors.mission-bg}"
    textColor: "{colors.mission-ink}"
    rounded: "{rounded.inline}"
    padding: "3px 5px"
  canvas-node:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.node}"
---

# Design System: Phantom Workspace

## Studio actual: preset Gengar

La apariencia vigente se implementa en `src/studio.css`: grafito (`#15171c`), superficies opacas (`#202329`, `#292d35`) y acento Iris (`#8b9dff`). Las secciones minerales históricas que siguen no describen esta capa visual actual.

Gengar es el fondo predeterminado para preferencias nuevas y al restablecer Apariencia. Las selecciones válidas guardadas se conservan. El preset combina el arte oficial local `assets/gengar.png`, importado mediante Vite sin red en runtime, con bruma violeta sobria a la derecha del canvas. El arte escala con el espacio disponible, dejando libre el centro; la miniatura muestra el mismo recurso. Procedencia: `assets/gengar-source.md`.

La intensidad controla conjuntamente arte y atmósfera; el modo foco reduce esa capa al 12% de su intensidad. Una imagen personal tiene prioridad sobre el arte del preset. La decoración no recibe eventos de puntero y las superficies de trabajo siguen siendo opacas. Aurora, Marea, Brasa y Grafito permanecen disponibles en Apariencia.

## Overview

**Creative North Star: "Atlas de estudio"**

A recoverable project table: an ink-blue project rail anchors a mineral canvas, with precise white panel frames and dark working terminals. Density is that of a desktop tool; compact controls and readable context take precedence over decorative composition. The signature is spatial return: enter a focused panel, then return to its map without replacing the underlying camera or panel identity.

This is a code-led record of the shipped world. `src/styles.css`, `src/tools.css`, `src/App.jsx`, the components, and the input/edit/save hooks are the implementation authority; the frontmatter records their reusable values. The confirmed direction comes from `.impeccable/surfaces/workspace.md`, with durable identity and input constraints in `PRODUCT.md`. No comparison images supplied the visual authority. `assets/phantom.svg` is the shipping vector brand asset; the rail currently renders its Blocks SVG icon. There are no shipping raster assets: browser thumbnails are runtime captures, and review screenshots are development evidence, not reusable brand imagery.

**Key Characteristics:**
- Mineral map, ink-blue rail, white tool surfaces, dark terminal work area.
- Native system typography for interface text; monospace for terminal and code.
- Compact bordered controls with cobalt selection and visible keyboard focus.
- Persistent project and panel identities with an explicit map-to-focus return.
- First-party tool forms shared between canvas panels and the nonmodal inspector.

Evidence boundary: the five current images in `.impeccable/review/` (`desktop.png`, `narrow.png`, `focused-terminal.png`, `tools.png`, `browser-native.png`) were directly inspected for this record. The latest `desktop-checks.final.json` records 34 passed / 0 failed, build `2026-11-11T07:46:06.456Z`, completed `2026-11-11T07:46:35.774Z`. The supplied reviewer finish verdict is **SHIP scoped to FR01/FR02/FR03, all resolved**, retaining the external CLI seed-metadata-format limitation in `direction-provenance.md`. This is not whole-product exhaustive UX approval or observed human visual approval. The older `E2E-final-report.md` still describes the superseded 32/2 run; the newer JSON and current focus-restoration code take precedence.

## Colors

Cool, low-chroma structural surfaces distinguish orientation from operation; cobalt marks action and selection rather than filling the workspace. Frontmatter values are normative; not every isolated literal in the CSS is promoted to a reusable token.

### Primary
- **Cobalt / accent:** primary actions, selected node border and outline, links, caret, keyboard focus and selected tool tabs.
- **Cobalt wash / accent-soft:** hover and active icon/dock controls, tool tabs, and selected command results.

### Neutral
- **Mineral / bg:** canvas and desktop-required/recovery background.
- **White / surface:** header, inspector, tool panels, controls and popovers.
- **Cool paper / surface-2:** secondary controls, code blocks, badges and dialog action areas.
- **Blue ink / ink:** primary interface text; **Slate / muted:** secondary labels and source context; **Seam / line:** tool dividers and field borders.
- **Rail ink / rail** and **Rail selection / rail-active:** project navigation context, independent of cobalt canvas selection.
- **Terminal depth / terminal-bg**, **Terminal chrome / terminal-chrome**, and **Terminal foreground:** xterm work area, location strip/overview, and terminal glyphs respectively. The ANSI palette and cursor/selection colors remain in `TerminalPanel.jsx`; they are terminal semantics, not additional UI action accents.
- **Note paper / note:** editable note body, distinct from white tool chrome.

### Semantic states
- **Danger:** destructive actions, error text and invalid inline-name border. **Success:** reference/mission context and success feedback. **Warning:** unavailable tools and caution notices. Status dots also have explicit lighter colors for contrast on the dark rail/terminal; retain their accompanying text.
- **Mission paper / mission-bg** and **Mission ink / mission-ink:** compact mission membership chip; tool badges instead use neutral paper/slate.
- Browser and inline-name errors use the actual pale error pair (`#fff0ef` / `#a13640`); connection banners use (`#fff3ee` / `#943a35`). These are local treatments, not a replacement semantic palette.

**The Selection Is State Rule.** Use cobalt to identify action, selection and keyboard ownership; retain labels and status text alongside colored indicators.

## Typography

**Body Font:** shell native stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`); tool surfaces explicitly use `system-ui, sans-serif`.
**Label/Mono Font:** code and terminal stacks are separate, as recorded in frontmatter.

There is no branded display font, imported Inter, or marketing type ramp. The earlier Inter detector warning was corrected to the native stacks. Do not derive a display-face prescription from the functional empty-state heading.

### Hierarchy
- **Headline:** functional empty-state heading; desktop-required heading is a local variant (25px, 600, -.03em).
- **Title:** tool section headings; the shell brand is a separate 15px/650 treatment with -.02em tracking.
- **Body:** tool prose and controls; tool paragraphs cap at 72ch. Shell base is 13px without a global line-height; note and empty-state prose use 1.8.
- **Label:** tool field labels; project names use 12px/650, panel names use the recorded scaled panel-title role.
- **Supporting text:** tool hints and badges (11px); shell paths/status and key hints (9–10px); shell controls mostly 11–12px. Sentence case is normal interface copy, not a system of uppercase kickers.
- **Code / terminal:** preserve their different line-heights. xterm measures physical glyph cells; never infer its layout from proportional interface text.
- **Map title compensation:** `--map-label-scale` is `min(2.4, max(1, 1 / zoom))` in overview and 1 in focus. It scales header titles/icons within the transformed canvas, rather than enlarging terminal content.

## Layout

The app fills the window with document scrolling disabled; scrolling belongs to tool content, lists and terminal viewports. The shell has a desktop minimum width (580px). The default project rail is 202px, the header 75px high, and the remaining body is a flex canvas plus optional inspector. Canvas dots are a radial pattern (0.65px dot, 20px grid), not a raster texture. New panels are placed by `findPanelPlacement`; default terminal/tool geometry is 640×400, browser 800×520, note 420×340.

The camera starts at (64,64), zoom 1. Manual zoom clamps to .15–1.8; fit-all caps at 1. Header drag moves panels; Shift adds header selections; a corner handle resizes. Pointer resizing minima are 400px for terminal width, 320px otherwise, and 240px height; keyboard resizing advances by 24px and uses a 400px width minimum. The spacing vocabulary is compact and mixed, not a strict invented modular grid: recurring gaps/insets are recorded above; tools use 16px content padding, 24px section separation, 10px form gaps, and 7px 9px field padding.

Focus replaces the visible geometry, not stored panel coordinates: inset (24px left, 55px top), width `max(320, canvasWidth - 48)`, height `max(240, canvasHeight - 145)`. Other nodes remain mounted but hidden. Focus removes canvas dots, retains a 42px return strip, and hides map navigation/index controls. Camera and pre-focus selection survive a round trip within the current UI session. Persisted layout is distinct from transient focus/selection.

### Responsive desktop
- At **min-width 1450px**, rail becomes 220px, inspector 370px, header side padding 28px, and the creation-dock label appears.
- At **max-width 1270px**, save-state text hides, header padding becomes 18px, map descriptive text hides, inspector becomes 325px, and dock/zoom controls tighten.
- At **max-width 1100px**, rail becomes 180px; inspector overlays the right side of the workspace body (350px, full body height) rather than consuming canvas width. Search label hides and the path caps at 340px.
- At **max-width 850px**, rail becomes an off-canvas 220px drawer with scrim and close control; header becomes 65px with 13px side padding. Breadcrumb context collapses, path caps at 280px, empty headings shrink to 22px, and picker width becomes 370px.
- At **max-height 650px**, empty-state position/icon/type and picker density compress; heading becomes 21px.
- Tool CSS has a **max-width 600px** adaptation: 12px content padding and tighter overlays. This does not remove the shell minimum or establish mobile product support. The current narrow screenshot is desktop (1100×760), not mobile verification.

## Elevation & Depth

Depth combines tonal separation, fine borders and soft ambient shadows. Nodes are quiet at rest; floating controls/popovers and modal surfaces sit higher. There are no hard-offset shadows in the observed vocabulary.

### Shadow Vocabulary
- **Node rest:** `0 4px 12px #202c440a`.
- **Node focus:** `0 8px 24px #202c4410`.
- **Creation dock:** `0 5px 20px #202c4420`; **map controls:** `0 3px 12px #202c4412`.
- **Popover:** `0 12px 36px #202c4426` (`--shadow-popover`), shared by picker, panel index, attention and context menu.
- **Tool overlay:** `0 18px 64px rgb(15 25 43 / .25)`; **app dialog:** `0 20px 70px #0f1b3555`.
- **Narrow inspector:** `-12px 0 35px #202c441c`.

**The Quiet Frame Rule.** Preserve tonal boundaries and soft ambient elevation; node selection is an outline, not an elevated decorative card.

Layers are purposeful: selected/focused nodes (2/5), return strip (10), dock (12), header/inspector (20/21), canvas popovers (24–25), rail (30), attention/menu (46/47), narrow rail scrim/drawer (61/62), app modal/close progress (80/95), toasts (100), tool palette/voice overlay (1000). Native browser content is a separate Electron view; CSS z-index alone cannot obscure it.

Focus return animates for 220ms and the narrow rail for 180ms, both `cubic-bezier(.16,1,.3,1)`. Tool buttons transition background/border for 140ms ease-out; loading uses a 1s linear spinner. Reduced motion collapses shell animation/transition duration to .01ms and disables tool-button transitions.

## Shapes

Compact gently rounded rectangles carry precision without pill-shaped everything. Nodes/picker use node radius; dock/index/attention use dock radius; fields/tool controls use field radius; shell text buttons use button radius. Tool badges have badge radius, mission chips inline radius. The generic `--radius:12px` declaration exists, but components mostly set explicit radii; it is not a universal component radius.

Frames normally have a 1px seam. Nodes use `#c7d0dd`; selection adds a cobalt 1px outline at offset 0. Node contents clip to the frame. Focused nodes remove the selection outline, use `#cbd5e2` border, and retain node rounding. Icons are stroked SVGs, not text glyph substitutes; the shipping app icon is vector artwork.

## Components

### Buttons and navigation

Shell text buttons are 35px high, padded 0 13px, weight 550, with a `#ced7e2` border. Secondary hover uses `#f6f8fc` / `#a7b5ca`; primary hover uses `#284abe`. Shell icon buttons are 29px squares, with slate text, a `#e9eef5` hover and cobalt-wash active state. In node headers the later rule makes them 32px high with compensated 24px width.

Tool buttons are a separate compact primitive: minimum height 32px, 6px 10px padding, field radius, 12px/1.4 weight 500. Secondary hover changes to secondary paper and muted border; press changes to cobalt wash. Primary hover is `color-mix(in srgb, var(--accent), #000 13%)`. Danger tone changes text to danger. Disabled shell controls use opacity .42/default cursor; tool buttons use .55/not-allowed.

Project navigation is a vertical list with identity initials, name, truncated path and active marker; default row text `#c5d2e4`, hover `#29374f`, active rail-selection background/white text. The creation dock is 45px high with 35px actions; the panel list provides a text-search route by name, type or mission and can recover hidden terminal views. The command palette uses Ctrl/Cmd+K, selected-result wash and keyboard navigation; the list uses Ctrl/Cmd+Shift+F.

### Fields and inline editing

Tool fields are labelled, full-width, minimum height 34px, 1px seam, field radius; textareas resize vertically with 1.6 line-height. Error notices are bordered in currentColor with source error/retry controls; unavailable-source warnings explain configuration rather than displaying invented results. Loading, empty, unavailable, error and busy are distinct states in `ToolPanels.jsx`.

Focus-visible is a cobalt 2px outline: shell buttons/links/tab stops offset 3px, shell fields offset -1px, tool content controls offset 3px. The note field uses -3px. xterm's helper textarea/screen outlines are intentionally suppressed; terminal focus is its own cursor/input-ownership behavior, not a generic text-field ring.

Project and panel names edit in place, including panel context-menu Rename. Project input is 27px high/240px wide maximum; panel input is 31px high with compensated type; both use inline radius and `#a6b9ef` border. Enter commits and returns focus to the replacement name button after React refs are ready; blur commits without pulling focus back; Escape cancels and restores origin focus, and the ensuing blur cannot save. Names are trimmed, nonempty and limited to 512 characters. Save makes the field readonly; validation/save errors stay inline with `aria-invalid` and an alert. Explicit flush/close prepares outstanding names. Renaming the project does not move or replace its canonical folder identity.

### Canvas, terminal and browser

**Input ownership:** Terminal writes require an active writable stream and actual focus inside that xterm; inspector fields and name inputs never proxy keystrokes into a PTY.

Canvas navigation ignores editing targets, including `.xterm`. Ctrl/Cmd+Shift+Enter explicitly toggles panel focus; ordinary terminal Space, Escape, Ctrl+C, `0` and letters remain terminal input. The inspector is nonmodal: opening it does not globally block terminal input, clicking the visible terminal reclaims its input, and inspector controls retain their own focus. Transient blocking surfaces (palette, voice, menu, picker, panel list, attention, mission dialog, rail drawer, folder chooser, close progress, disconnected transport) block terminal ownership. Escape from inside xterm does not close the inspector. The native browser is hidden under the inspector as well as blocking overlays.

xterm retains mounted session identity through map/focus. Location and state text stay visible; below .45 overview zoom, a noninteractive status summary covers microscopic terminal output. xterm padding is on the xterm element (8px 8px 4px 12px), not its measured host; FitAddon uses layout pixels and does not scale physical columns from canvas transforms. Terminal errors/exits expose reconnect/new-session actions. Hiding a terminal view preserves the session; stopping its process is a separate action with history retained.

Browser panels have a 41px toolbar, 27px address field, explicit HTTP(S) navigation and visible inline errors. Only focused, unobscured panels show the native WebContentsView. Overview uses a settled-page runtime capture at .28 opacity with title, capture URL and focus action; absence is explicitly labelled. The transient cache holds at most 12 previews and is not serialized in workspace JSON. `browser-native.png` depicts a test page owned by that fixture, not Phantom palette/type authority.

### First-party tool panels and persistence

The inspector and canvas tool panels render the same `ToolContent`: Tasks, Context, Sessions/Missions, Git, Services, Docker, Workflows, Playwright, Playground and Settings. Forms, rows, tables, badges, source details and code blocks are native first-party UI. Tool content scrolls independently; rows/forms wrap; long identifiers truncate with full-value title/copy while prose and source data wrap. Tool errors are isolated by an identity-keyed boundary (`workspace:type:node-or-inspector`) with a reset action that rereads the source rather than launching work.

Local notes, draft/checklist state, layout, camera and references belong to workspace persistence; Phantom remains authoritative for native cards/decisions/skills. Source IDs/paths and unknown revisions remain explicit. UI patches overlay the last snapshot and debounce at 350ms; failed saves remain queued in the live window, expose errors and retry on reconnect. Folder/project switches await flush. Close performs a save handshake, shows saving progress and keeps failure visible; UI-boundary retry preserves the model and queue. This is not a claim that unacknowledged edits survive arbitrary renderer termination.

Verified lifecycle semantics in the final ledger: warm UI reopen reconnects to the same live session/PID; deliberate host shutdown restores exited history without launching a shell; daemon loss restores lost history/context without launching a shell. Relaunch is explicit. Focus, selection and popover visibility are transient UI state, not a promise to restore every open interaction after reboot.

## Do's and Don'ts

### Do:
- **Do** use the shipped mineral, ink-blue, white and cobalt roles with native interface typography.
- **Do** keep camera/layout identity separate from temporary focus geometry and visible names separate from canonical paths.
- **Do** share first-party tool primitives between canvas panels and the nonmodal inspector.
- **Do** preserve keyboard focus ownership, explicit terminal relaunch and visible source/save failures.
- **Do** consult the final JSON ledger and scoped review verdict before quoting verification status.

### Don't:
- **Don't** turn runtime browser captures, fixture page styling or development screenshots into shipping identity assets.
- **Don't** let canvas navigation or inspector fields consume or forward ordinary terminal keystrokes.
- **Don't** describe a local draft/reference as a native Phantom object or an unknown revision as verified.
- **Don't** infer mobile readiness, exhaustive UX approval or human visual approval from the desktop evidence.
- **Don't** promote sidecar preview tonal ramps into application tokens; they are synthesized panel metadata only.

Not canonized or repaired: the external concept CLI emits replay metadata in a format different from the installed guide's SEED REFERENCE contract; provenance is documented, not fabricated. The older E2E prose is stale relative to the final ledger. Neither limitation becomes a visual rule; no unrelated craft-floor defect or aspirational feature is introduced as house style.
