---
name: Phantom Workspace
description: Dark studio — a personal spatial workspace with opaque working planes.
colors:
  accent: "#8b9dff"
  accent-soft: "color-mix(in srgb, var(--accent) 15%, var(--surface))"
  accent-mint: "#7ddbb9"
  accent-amber: "#edbf79"
  accent-rose: "#e9a0bf"
  bg: "#15171c"
  surface: "#202329"
  surface-2: "#292d35"
  ink: "#eceef3"
  muted: "#a5adbb"
  line: "#373d48"
  rail: "#1b1e24"
  terminal-bg: "#151a23"
  primary-ink: "#171b28"
  node-border: "#4a5260"
  note: "#24252b"
  danger: "#ff9da8"
  success: "#8ad8b6"
  warning: "#edbf79"
  error-bg: "#41282f"
  mission-bg: "#253c35"
  mission-ink: "#a4dec4"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-.025em"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  appearance-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    lineHeight: 1.7
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 600
  support:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
  micro:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "10px"
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
rounded:
  badge: "3px"
  inline: "4px"
  field: "5px"
  icon: "6px"
  button: "7px"
  preset: "8px"
  index: "9px"
  node: "10px"
  dialog: "11px"
  dock: "12px"
spacing:
  compact: "4px"
  field-gap: "5px"
  tool-gap: "6px"
  control-gap: "8px"
  form-gap: "10px"
  inset: "12px"
  content: "16px"
  appearance-inline: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "35px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    height: "35px"
  tool-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-ink}"
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
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "10px 8px"
    width: "100%"
  panel-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.support}"
    rounded: "{rounded.icon}"
  tool-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  canvas-node:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.node}"
  background-option:
    textColor: "{colors.ink}"
    typography: "{typography.support}"
    rounded: "{rounded.preset}"
    padding: "5px 5px 9px"
---

# Design System: Phantom Workspace

## Overview

**Creative North Star: "Dark studio"**

A personal development studio: graphite navigation and opaque working planes over an optional atmospheric canvas. Compact native controls keep projects, panels and commands within reach. Focusing a panel quiets the personal background while preserving spatial identity and the route back to the map.

This replaces the superseded light “Atlas de estudio” world at the user's request. `.impeccable/surfaces/workspace.md` records the pinned dark, Figma-inspired DX direction; it is code-led, not a randomly selected concept or comp reproduction. `src/styles.css` remains the layout/input base and imports `src/tools.css`; `src/App.jsx` imports `src/studio.css` after that base. **The shipping visual authority is the resulting cascade with `studio.css` overrides**, not the light literals left in the base. Appearance state comes from `src/hooks/useAppearance.js`, `src/components/Appearance.jsx` and their App integration. Frontmatter captures reusable values; the sidecar extends it with previews, depth and behavior.

**Key Characteristics:**
- Graphite shell, opaque tools, iris selection and optional personal atmosphere.
- Native interface sans with compact support text; monospace for terminal/code.
- Direct project/panel routes and separate floating creation and zoom controls.
- Project-local appearance and focus attenuation without camera replacement.

Evidence checked: `.impeccable/review/studio-desktop.png`, `studio-appearance.png` and `studio-focused.png` (1520×980), plus `studio-narrow.png` (1100×760), were opened for this documentation pass. They show synthetic fixture content, not product claims. `studio-checks.json` (2026-11-11T14:53:59.623Z) records seven checks with no recorded errors: real Electron/host/PTY navigation, reload persistence, valid/corrupt image handling and removal, project isolation, focus/camera/selection return, command-palette appearance access, and captures without renderer exceptions. These checks were read, not rerun here. `studio-review.md` ends **SHIP**, with its sole provenance fix resolved, scoped to studio theme, appearance/persistence and App integration. It is not whole-product approval. Supplied general-suite status is **84 passed / 1 failed / 3 skipped**, with the task-catalog failure reported unrelated. The old 34-pass light-world ledger does not verify this styling.

## Colors

### Primary
- **Iris / accent:** default action, selection, caret and keyboard-focus color. The preference can replace it with **Menta**, **Ámbar** or **Rosa**; the hook applies the chosen accent on the document root.
- **Accent wash / accent-soft:** a live mix of the current accent and opaque surface, used for selected panel rows, active controls and the first creation action. It is a CSS color mix, not surface transparency.
- **Primary ink:** dark text on filled accent actions; primary hover mixes the accent with white (12%).

### Neutral
- **Graphite / bg:** shell ground and canvas base; **Rail:** navigation/header context.
- **Working plane / surface:** opaque tool bodies, inspector, floating controls and popovers; **Raised plane / surface-2:** headers, active project and secondary treatments.
- **Light ink / ink**, **Slate / muted**, **Seam / line:** content, secondary context and fine dividers. **Node border:** map frame boundary before selection.
- **Terminal depth:** terminal well; terminal glyph/ANSI/cursor values belong to the terminal implementation rather than the appearance accent palette. **Note:** a slightly warmer dark editing plane.

### Semantic states
- **Success:** save/healthy feedback; **Warning:** caution/unavailable state; **Danger** with **Error ground:** destructive/error feedback. The mint accent and success green are distinct values.
- **Mission ground / mission ink:** compact membership marker. Preserve labels with status dots; color alone does not establish state.

**The Selection Is State Rule.** Use the current accent for action, selection and keyboard ownership; keep accompanying labels and status text.

## Typography

The shell inherits `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` at 13px; first-party tools explicitly use `system-ui, sans-serif` at 13px/1.5. No imported display face is introduced. The appearance headline is a functional interface heading, not a marketing/display prescription.

- **Headline:** appearance heading, as tokenized above; the retained canvas empty-state heading is 24px/600/1.25 with -.035em tracking, adapting to 22px at narrow widths and 21px at short heights.
- **Title:** tool section headings; the brand separately uses 15px/650 with -.02em tracking.
- **Body / appearance-body:** tool prose versus lighter, compact appearance explanation. Tool paragraphs cap at 72ch.
- **Label:** appearance legends/intensity and tool field labels.
- **Support (11px):** panel navigation, background options, session metadata, appearance footer and local-image row.
- **Micro (10px):** paths, upload help, accent names, grid explanation and pixel-unit hints. These are subordinate labels, not body-copy defaults.
- **Panel title:** inverse-zoom compensation, `min(2.4, max(1, 1 / zoom))`; focus resets the scale to 1. Terminal cells are measured independently, not enlarged through this title scale. Terminal type controls and code retain their implementation-owned monospace behavior.

## Layout

Full-window desktop shell, minimum width 580px; document scrolling is disabled, while lists, tools, terminal content and appearance scroll internally. The retained spatial model places/drags/resizes panels in a transformed map. Focus uses temporary visible geometry (24px left, 55px top; width `max(320, canvasWidth - 48)`, height `max(240, canvasHeight - 145)`), hiding other mounted panels without overwriting stored coordinates. Camera and pre-focus selection return within the UI session.

- Rail: 232px normally, 240px from 1450px; 210px at widths ≤1100px; 232px off-canvas drawer at ≤850px. Recent projects cap at 28% height; the panel list consumes remaining space and scrolls. Short windows (≤700px high) compress panel-row and rail spacing.
- Header: 64px high with 24px horizontal padding; ≤850px uses 13px horizontal padding. These studio overrides supersede base header heights and padding.
- Inspector: base 350px; 370px from 1450px; 325px at ≤1270px; at ≤1100px it overlays the canvas at 350px wide rather than shrinking the map. Nonmodal, with explicit close and contextual selector.
- Appearance: 24px 20px padding, two equal preset columns with 10px gap, 58px-high previews, 24px section separation. Four accent controls share a row with 26px circular swatches.
- Creation dock: centered at bottom 22px, 50px high, padding 5px 7px; actions 38px high. Zoom is separate at top 17px/right 20px, 32px high. Between 851–1100px with inspector open, dock centers in the uncovered width (`calc((100% - 350px) / 2)`), and zoom moves to right 362px. At ≤850px zoom is right 12px. Dock label hides at ≤1270px.
- Canvas grid: CSS radial dots (.7px, `#7d879a42`) every 24px; optional and absent in focus. No raster texture is shipped.
- Terminal chrome: 12px horizontal inset, toolbar minimum 48px and session bar minimum 34px, bordered 7px-radius working well. At terminal container widths ≤420px, directory becomes 11px, toolbar gap 8px and session context 10px. Terminal fitting/input measurement remains implementation-owned.

The 1100×760 evidence is narrow desktop, not mobile support. Retained base adaptations include tool padding at ≤600px and compact empty states/picker at ≤650px height.

## Elevation & Depth

Opaque tonal planes and fine seams carry most depth. Soft black shadows lift floating controls without making the working content translucent.

- **Node rest:** `0 6px 18px #0002`; **node focus:** `0 10px 30px #0003`.
- **Floating dock / zoom:** `0 8px 24px #0005` (`--shadow-float`).
- **Popover:** `0 16px 40px #0006` (`--shadow-popover`).
- **Palette / voice:** `0 18px 64px #0007`; **narrow inspector:** `-12px 0 35px #0004`.
- Retained local base shadows: app dialog `0 20px 70px #0f1b3555`, inline-name error `0 4px 14px #202c4420`, and canvas busy `0 4px 15px #202c441a`. These are not new studio shadow tokens.

**The Opaque Work Rule.** Personal atmosphere belongs behind the canvas; terminal and tool operating planes stay opaque.

Background intensity is 55% by default, adjustable 0–100%. Focus multiplies the background layer's opacity by .12 (default .066), rather than dimming text or panel content. Opacity transitions for 220ms `cubic-bezier(.16,1,.3,1)`; reduced motion removes this transition. The base also retains a 180ms drawer transition and 140ms ease-out tool-button color transitions, with reduced-motion overrides. Still captures do not prove frame pacing.

Native browser content is an Electron WebContentsView, not a CSS stacking layer: inspector and blocking overlays must obscure it through native-view policy.

## Shapes

Precise rounded rectangles, not universal pills. Frames retain 10px rounding and 1px borders; selected map panels add a 1px accent outline, while focused panels remove that selection outline and use the seam border. Dock rounding is 12px; presets 8px; shell buttons/terminal wells/upload 7px; panel rows/icon controls 6px; fields/tool controls 5px; badges 3px. Circular accent swatches communicate palette choice. Icons are stroked SVGs.

## Components

### Controls, navigation and fields

Shell actions retain 35px height, 0 13px padding and weight 550. Secondary hover uses the raised plane and muted border. Primary actions use accent fill/dark ink with the lighter hover mix. Shell icon controls are 29px squares; node-header controls retain compensated width and 32px height. Tool buttons remain a separate 12px/500/1.4 primitive, minimum 32px high, 6px 10px padding; disabled opacity is .55 (shell .42). Tool secondary press uses accent wash.

Project navigation retains name/path/initials and an active dot; the selected project uses raised graphite, not the old blue rail fill. Panel rows provide direct selection and a separate focus action; selected rows use accent wash. The map action and creation dock remain explicit routes. Tool fields are labelled, full width, minimum 34px high, padded 7px 9px with seam border. Error/loading/empty/unavailable states remain distinct and source-backed.

Keyboard focus remains a 2px current-accent outline: shell buttons/tab stops offset 3px, shell fields -1px, tool controls 3px, note field -3px. xterm owns cursor/input focus and suppresses generic helper-textarea/screen outlines.

### Appearance and local persistence

Available from the rail, contextual selector and command palette; it occupies the nonmodal inspector. Presets: **Aurora** (violet/teal), **Marea** (petroleum/blue), **Brasa** (warm graphite), **Grafito** (no atmosphere). Presets are CSS gradients, with intentionally illustrative preview gradients rather than pixel-identical miniature canvas crops. Selected options use an accent border, checkmark and `aria-pressed`. Accent options are named/checkmarked Iris, Menta, Ámbar and Rosa. Intensity has numeric output, grid has a labelled checkbox, and reset restores Aurora/Iris/grid on/55%/no image.

Preferences synchronously save to localStorage under `phantom:studio:${workspaceId || 'default'}` on this machine/browser profile, separate from host workspace JSON. Switching projects loads the target project's settings rather than copying the previous entry. Invalid JSON falls back to defaults; load validates preset/accent keys, boolean grid, finite intensity clamped 0–100, and image data URL shape/length. A failed localStorage write reports an error and does not apply the attempted state change. This is not cloud sync or a durability guarantee beyond local storage.

Optional uploads accept PNG/JPEG/WebP MIME types up to 2×1024×1024 bytes; `createImageBitmap` must decode the file before FileReader produces a data URL. Reload accepts only matching base64 image data URLs shorter than 2,800,000 characters. File type/size, read/decode and save failures have visible actionable errors; save failure also notifies through the hook. The file control disables while loading. The project-keyed appearance component invalidates outstanding requests on unmount; reset invalidates them too. Choosing a preset clears the image; removing the image preserves the selected preset. Local data images layer above the CSS atmosphere, cover/center the canvas and receive the same intensity/focus attenuation. No shipping raster assets were added; review screenshots and runtime browser captures are evidence/content, not brand assets.

### Spatial work and product constraints

Preserve camera/layout identity separately from temporary focus geometry and names separately from canonical project paths. Canvas navigation yields to editing targets including xterm. Terminal writes require an active writable stream and actual focus in that terminal; ordinary Space, Escape, Ctrl+C, `0` and letters remain terminal input. Ctrl/Cmd+Shift+Enter is the explicit panel-focus route. Inspector fields never proxy keystrokes into the PTY; the inspector is nonmodal and clicking a visible terminal can reclaim ownership. Blocking surfaces and disconnected transport still block terminal ownership; inspector/native-browser occlusion remains separate from terminal blocking.

Only focused, unobscured browser panels display the native view; overview captures and their missing states remain runtime content. Phantom remains authoritative for native cards/decisions/skills; workspace layout, references, drafts and notes remain app-owned. Keep source/save errors visible and relaunch explicit after exited/lost sessions; background customization does not change lifecycle semantics or promise recovery of unacknowledged edits.

## Do's and Don'ts

### Do:
- **Do** apply the studio override palette and current project accent over the retained layout base.
- **Do** keep working planes opaque and attenuate only the background when focusing.
- **Do** preserve camera identity, direct panel routes and nonmodal inspector input ownership.
- **Do** expose local appearance save/upload failures and retain named, checkmarked choices.
- **Do** quote the studio evidence and scoped verdict with their verification limits.

### Don't:
- **Don't** restore the superseded light palette from base CSS literals or old documentation.
- **Don't** treat optional local uploads, runtime captures or review screenshots as shipping identity assets.
- **Don't** redirect terminal keystrokes through canvas navigation or inspector fields.
- **Don't** infer mobile readiness, whole-product approval or a clean general suite from this packet.
- **Don't** promote sidecar preview ramps into application tokens; they are synthesized metadata only.

Not canonized or repaired: the reported unrelated task-catalog failure and concurrent TerminalPanel/Canvas/Presence changes are outside this documentation pass. The review's provenance finding is resolved, not an outstanding defect or a visual rule.
