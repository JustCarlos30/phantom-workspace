// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FANTASMA · BASE CANÓNICA
// Base canónica: no se edita en extensiones; una extensión importa esto y agrega estados/gestos.
// Si una extensión necesita cambiar el núcleo, se propone al dev primero.
//
// Extraído de fantasma-mirada-v4 (★ elegida 2026-10-08, «va perfecto») sin cambiar comportamiento
// ni números. Silueta: fantasma-silueta-v4 (★). Método: vault anim-19, anim-20, anim-21.
// Todo en u (módulo entero por tamaño: 112→14 px, 32→4, 24→3, 16→2).
//
// Nada aquí lee el DOM: los parámetros afinables llegan en un objeto `P` con `.v(key)`
// (el de /lib/panel.js sirve tal cual; params.json de esta carpeta = el de v4).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { seededMath as Math, Spring, C, clamp, lerp, noise, R, TAU, keyed, eio, easeOut } from "./motion.js";

const PI = Math.PI;
export const RAD = PI / 180;

/* ───────── silueta (fantasma-silueta-v4 · nota 2026-10-08-silueta-final…) ─────────
   Documentación de los números que drawGhost dibuja literal. Un solo radio en todo: 1u.
   Origen (0,0) = esquina de arriba a la izquierda del cuerpo. */
export const SILUETA = {
  cuerpo: { w: 6, h: 7 },                       // 6u × 7u incluidos los lóbulos
  radio: 1,                                      // esquinas de arriba r 1u (el «domo» rígido), lóbulos r 1u, brazo r 1u
  lados: [1, 6],                                 // lados rectos de y = 1u a y = 6u
  lobulos: { x: [0.75, 2.25, 3.75, 5.25], y: 6, r: 0.75, orilla: "pixel", cascada: { retraso: .12, k: 120, z: .75 } },   // 4 semicírculos de abajo (preset dobladillo-4, 2026-10-16)
  // lobulos.orilla ("pixel", defecto): con lod.snap y u ≤ 6 los lóbulos se dibujan por filas de píxeles enteros, sin grises de suavizado (quítala = vectorial)
  // lobulos.cascada { retraso (s por lóbulo, izq→der), k, z } (defecto): cada lóbulo sigue ola/flotado con retraso creciente (Rig); quítala = ola de hoy
  domo: "pixel",                                 // ("pixel", defecto): con lod.snap y u ≤ 6 (y lobulos.orilla "pixel") el domo (esquinas de arriba) y los brazos se pintan por píxeles enteros; quítala = vectorial
  // pellizco: { w, h } opcional (sin defecto): bulto centrado que sube desde el borde de arriba; a u chico cae al píxel
  // brazo.angulo opcional (grados, sin defecto = 0): se suma a la pose del brazo; brazo.pivote[1] = y del pivote
  brazo: { pivote: [5.5, 4], r: 1, largo: 1.5, y: [3, 5], sale: 1 },   // pivote ½u dentro; sale 1u por lado → 8u en total
  ojo: { w: 1, h: 2, cx: [2, 4], y: [3, 5], hueco: 1 },                // ojos B (cursor): 1u × 2u, hueco 1u
  pivotes: { squash: 4, squashTermino: 6.5, tilt: [3, 6.5] },
  tamanos: { 112: 14, 32: 4, 24: 3, 16: 2 },     // px de alto (8u de caja) → u en px
};

/* ───────── el ojo como parámetros (anim-20) ─────────
   w ancho · h alto · lift cuánto sube el borde de abajo · cin/cout esquina de arriba cortada (adentro = enojo,
   afuera = tristeza) · dome cabeza redonda (contento) · dx dy offset. Todo en u; todo se interpola. */
export const KEYS = ["w", "h", "lift", "cin", "cout", "dome", "dx", "dy"];
export const BASE = { w: 1, h: 2, lift: 0, cin: 0, cout: 0, dome: 0, dx: 0, dy: 0 };
export const SHAPES = {
  neutro: { label: "neutro" },
  sorpresa: { h: 2.5, label: "sorpresa" },
  concentrado: { h: 1, lift: .5, label: "concentrado" },
  somnoliento: { h: 1, label: "somnoliento" },
  contento: { h: 1.25, lift: .75, dome: 1, label: "contento" },
  triste: { h: 1.5, lift: -.5, cout: .5, label: "triste" },
  enojado: { h: 1.5, cin: .5, label: "frustrado" },
  cerrado: { h: .5, lift: .25, label: "cerrado" },
  sospecha: { R: { h: 1 }, label: "duda" },                            // el ojo derecho distinto
  atento: { h: 2.25, label: "atento" },                              // te necesita: más alto = más energía, sin corte
  cursor: { label: "caret" },
};
export const shapeEye = (name, side) => {
  const s = SHAPES[name] || SHAPES.neutro, o = { ...BASE };
  for (const k of KEYS) if (s[k] != null) o[k] = s[k];
  if (s.R && side > 0) Object.assign(o, s.R);
  return o;
};
export const shapePair = name => [shapeEye(name, -1), shapeEye(name, 1)];   // [izquierdo, derecho]
export const lerpE = (a, b, x) => { const o = {}; for (const k of KEYS) o[k] = lerp(a[k], b[k], x); return o; };

/* ───────── recetas de transición (tabla de anim-20) ───────── */
export const RECIPES = {
  tween: { label: "tween 200 ms, ease-out", dur: .2, eye: (a, b, τ) => lerpE(a, b, easeOut(τ / .2)) },
  lento: { label: "tween lento 320 ms: la tristeza es lenta", dur: .32, eye: (a, b, τ) => lerpE(a, b, eio(τ / .32, .5)) },
  anticipa: {
    label: "anticipación: aplasta 70 ms, salta a 2.7 en 80, asienta en 100", dur: .25,
    eye: (a, b, τ) => {
      const A = { ...b, h: 1.6, w: 1.1 }, B = { ...b, h: 2.7, w: .95 };
      return τ < .07 ? lerpE(a, A, easeOut(τ / .07)) : τ < .15 ? lerpE(A, B, easeOut((τ - .07) / .08)) : lerpE(B, b, eio((τ - .15) / .1));
    },
  },
  contento: {
    label: "squash 60 ms y tween 150 ms al domo", dur: .21,
    eye: (a, b, τ) => { const S = { ...a, h: a.h * .75, w: a.w * 1.15 }; return τ < .06 ? lerpE(a, S, easeOut(τ / .06)) : lerpE(S, b, easeOut((τ - .06) / .15)); },
  },
  duda: { label: "asimétrico: el ojo derecho 2 cuadros tarde, 200 ms", dur: .27, delay: [0, .067], eye: (a, b, τ) => lerpE(a, b, eio(τ / .2)) },
  swap: { label: "parpadeo-swap 40/80/120 ms con ensanche", dur: .12, swap: .06, close: [[0, 0], [.04, 1], [.08, 1], [.12, 0]] },
  cierra: { label: "slow blink: medio a 50 %, a 70 % y cierre de 300 ms", dur: 1.05, swap: .9, close: [[0, 0], [.12, .5], [.26, .15], [.42, .7], [.58, .4], [.88, 1], [1.05, 0]] },
  despierta: { label: "abre en 300 ms y parpadea doble", dur: .74, eye: (a, b, τ) => lerpE(a, b, eio(τ / .3)), close: [[0, 0], [.32, 0], [.38, 1], [.42, 1], [.52, 0], [.58, 1], [.62, 1], [.74, 0]] },
  v3: { label: "v3: todo escondido en un parpadeo", dur: .27, swap: .07, close: [[0, 0], [.067, 1], [.1, 1], [.27, 0]] },
  lineal: { label: "esp32: lineal 500 ms", dur: .5, eye: (a, b, τ) => lerpE(a, b, clamp(τ / .5, 0, 1)) },
};
/* task = cambio de pensamiento o de tarea: solo ahí el cambio se esconde en un parpadeo */
export function pickRecipe(P, from, to, task) {
  const m = P.v("transiciones");
  if (m === "v3") return "v3";
  if (m === "esp32") return "lineal";
  if (to === "cursor" || from === "cursor") return "swap";
  if (to === "cerrado") return "cierra";
  if (from === "cerrado") return "despierta";
  if (to === "sorpresa" || to === "atento") return "anticipa";
  if (to === "contento") return "contento";
  if (to === "triste" || to === "enojado") return "lento";
  if (to === "sospecha") return "duda";
  return task ? "swap" : "tween";
}

/* la pista de forma: de dónde viene, a dónde va, con qué receta. sample() es puro: se puede leer a cualquier t */
export class EyeTrack {
  constructor(name, P) { this.name = name; this.a = null; this.P = P; }
  go(to, t, task = false) {
    if (to === this.name) return null;
    const cur = this.sample(t);
    this.a = { from: cur.pair, fromName: cur.shown, to, r: pickRecipe(this.P, this.name, to, task), t0: t };
    this.name = to;
    return this.a.r;
  }
  sample(t) {
    const a = this.a;
    if (!a) return { pair: shapePair(this.name), k: 0, shown: this.name, settled: true };
    const r = RECIPES[a.r], τ = t - a.t0, to = shapePair(a.to);
    const pair = [0, 1].map(i => {
      const ti = clamp(τ - (r.delay?.[i] || 0), 0, r.dur);
      return r.swap != null ? (τ < r.swap ? a.from[i] : to[i]) : r.eye(a.from[i], to[i], ti);
    });
    const k = r.close ? keyed(r.close, clamp(τ, 0, r.dur)) : 0;
    const shown = τ < (r.swap ?? r.dur / 2) ? a.fromName : a.to;
    return { pair, k, shown, settled: τ > r.dur };
  }
  tick(t) { if (this.a && t - this.a.t0 > RECIPES[this.a.r].dur + .1) this.a = null; }
}

/* ───────── parpadeos: cierra en ~100 ms, abre en ~200 (abrir es más lento) ───────── */
export const BLINKS = {
  normal: { label: "parpadeo", keys: [[0, 0], [.1, 1], [.133, 1], [.333, 0]] },
  rapido: { label: "rápido (nervios)", keys: [[0, 0], [.067, 1], [.167, 0]] },
  lento: { label: "lento (cansancio)", keys: [[0, 0], [.18, 1], [.3, 1], [.7, 0]] },
  pesado: { label: "pesado", keys: [[0, 0], [.16, 1], [.55, 1], [.95, 0]] },
  gato: { label: "slow blink de gato", keys: [[0, 0], [.3, .5], [.5, .25], [.8, .7], [1.1, .5], [1.4, .62], [2.4, .62], [2.8, 0]] },
};
export const blinkDur = k => BLINKS[k].keys.at(-1)[0];

/* caret (te necesita): ▮ / ▁ como el cursor de terminal, pero cada cambio con rampa (nunca pop).
   τ = tiempo desde que el caret se asentó: siempre arranca encendido. 0 = ▮ · 1 = ▁ */
export function caretOff(P, τ) {
  const per = P.v("caret_periodo"), r = Math.max(.001, P.v("caret_rampa")), x = Math.max(0, τ) % (2 * per);
  return x < per ? 0 : eio(Math.min(1, (x - per) / r)) * (1 - eio(clamp((x - 2 * per + r) / r, 0, 1)));
}

/* el ojo que se dibuja: forma + párpado + perspectiva barata */
export function composeEye(P, e, k, side, gx, cursorOff) {
  const pz = P.v("perspectiva") ? .2 * clamp(gx / .5, -1, 1) * side : 0;   // el ojo del lado al que mira crece
  const h0 = lerp(e.h, .5, +cursorOff || 0) * (1 + pz), b0 = -e.lift;
  const line = b0 - h0 * .3;                                             // el párpado cierra hacia el tercio de abajo
  return {
    w: e.w * lerp(1, P.v("ensanche"), k), h: lerp(h0, .2, k), b: lerp(b0, line + .1, k),
    cin: e.cin * (1 - k), cout: e.cout * (1 - k), dome: e.dome * (1 - k), x: e.dx, y: e.dy,
  };
}
/* polígono en u, origen en el centro del borde de abajo en reposo. El borde de arriba es una recta
   entre los dos cortes más el domo: así cualquier par de formas se interpola sin saltos */
export function eyePts(E, side, n = 14) {
  const hw = E.w / 2, top = E.b - E.h, mc = Math.max(0, E.h - .25);
  const cL = Math.min(mc, side < 0 ? E.cout : E.cin), cR = Math.min(mc, side < 0 ? E.cin : E.cout);
  const pts = [[-hw, E.b]];
  for (let i = 0; i <= n; i++) {
    const x = -hw + E.w * i / n, d = E.dome * (hw - Math.sqrt(Math.max(0, hw * hw - x * x)));
    pts.push([x, Math.min(E.b - .05, top + lerp(cL, cR, i / n) + d)]);
  }
  pts.push([hw, E.b]);
  return pts;
}
/* a tamaño chico solo se lee el píxel entero: cortes de menos de 1 px y domos de ½u a 16 px se pierden */
export function snapEye(E, u) { const px = v => (v * u < 1 ? 0 : Math.round(v * u) / u); return { ...E, cin: px(E.cin), cout: px(E.cout), dome: u <= 2 ? 0 : E.dome }; }

/* ───────── tabla por tamaño (LOD): no es un rig escalado (anim-19) ─────────
   u = 4 (32 px): lóbulos sí · u = 3 (24 px) y u = 2 (16 px): sin lóbulos. Nunca tilt ni squash; brazos en 3 poses;
   todo al píxel. Brillo al píxel: 2 px a 32, 1 px a 24, nada a 16 (en grande: brillo_tam × emoción).
   Los tamaños chicos se muestrean a 12 fps (Rig.small). */
export const LOD = {
  4: { snap: true, tilt: false, squash: false, lobes: true, armPoses: true },
  3: { snap: true, tilt: false, squash: false, lobes: false, armPoses: true },
  2: { snap: true, tilt: false, squash: false, lobes: false, armPoses: true },
};
export const GLINT_PX = { 4: 2, 3: 1 };          // px del brillo por u cuando lod.snap
/* notch de 20 pt (reto.js): u = 5 a escala ½ → 5 px de dispositivo por u. Misma tabla que LOD[4]; añadida, no cambia las demás */
LOD.notch = { ...LOD[4] };
GLINT_PX[5] = 2;
/* u = 5 (40 px) y u = 6 (48 px): como LOD[4] con brillo de 2 px. Añadidos; los demás no cambian */
LOD[5] = { ...LOD[4] }; LOD[6] = { ...LOD[4] };
GLINT_PX[6] = 2;
export const SMALL_FPS = 12;
export const ARM_POSES = [-45, 0, 25];            // con lod.armPoses: < −22° → −45 · > 14° → 25 · si no 0

/* brazos al píxel (domo = "pixel"): cada brazo es círculo r 1u ∪ cápsula rígida, rotada; se muestrea el centro de cada píxel (sin alfa parcial).
   ex = px de contorno (ensancha con un disco). Se pinta en px: el origen es la esquina del cuerpo, sin tilt ni squash */
function pixArms(ctx, u, X, Y, ex, arms) {
  const S = SILUETA, LA = S.brazo.largo, BW = S.cuerpo.w, PY = S.brazo.pivote[1], A0 = S.brazo.angulo || 0, px0 = X(BW) - (LA - S.brazo.sale), py0 = Y(PY);
  const m = Math.ceil((LA + 1) * u) + ex + 1, W = Math.ceil(BW * u) + 2 * m, H = Math.ceil(py0 * u) + 2 * m, mk = new Uint8Array(W * H);
  const hit = (side, a, cx, cy) => {   // centro del píxel en px del cuerpo → local del brazo (u)
    const x = (side > 0 ? cx : BW * u - cx) / u - px0, y = cy / u - py0, r = (a + A0) * RAD, c = Math.cos(r), s = Math.sin(r);
    const lx = x * c + y * s, ly = -x * s + y * c, rt = .5 * clamp(Math.abs(a) / 15, 0, 1);
    if (lx * lx + ly * ly <= 1) return true;
    if (lx < 0 || lx > LA || ly < -1 || ly > 1) return false;
    if (rt && lx > LA - rt && ly < -1 + rt) return (lx - LA + rt) ** 2 + (ly + 1 - rt) ** 2 <= rt * rt;
    if (lx > LA - 1 && ly > 0) return (lx - LA + 1) ** 2 + ly * ly <= 1;
    return true;
  };
  for (const [side, a] of arms) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (hit(side, a, i - m + .5, j - m + .5)) mk[j * W + i] = 1;
  ctx.save(); ctx.scale(1 / u, 1 / u);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let on = mk[j * W + i];
    for (let dy = -ex; !on && dy <= ex; dy++) for (let dx = -ex; dx <= ex; dx++) {
      if (dx * dx + dy * dy > ex * ex) continue;
      const ii = i + dx, jj = j + dy;
      if (ii >= 0 && jj >= 0 && ii < W && jj < H && mk[jj * W + ii]) { on = 1; break; }
    }
    if (on) ctx.fillRect(i - m, j - m, 1, 1);
  }
  ctx.restore();
}

/* ───────── el fantasma, dibujado con transformaciones afines (anim-19: piezas enteras, path regenerado) ─────────
   G = pose del rig (Rig.G, Rig.small o stillRig). lod = entrada de LOD (+ body / eye: colores). P = parámetros. */
export function drawGhost(ctx, ox, oy, u, G, lod = {}, P) {
  const sq = lod.squash === false ? 0 : G.sq, sy = 1 + sq, sx = 1 / sy, pv = G.pv;
  const X = x => 3 + (x - 3) * sx, Y = y => pv + (y - pv) * sy;
  let rx = G.rx, ry = G.ry;
  if (lod.snap) { rx = Math.round(rx * u) / u; ry = Math.round(ry * u) / u; }
  const tilt = lod.tilt === false ? 0 : G.tilt;
  ctx.save();
  ctx.translate(ox, oy); ctx.scale(u, u); ctx.translate(rx, ry);
  ctx.translate(3, 6.5); ctx.rotate(tilt * RAD); ctx.translate(-3, -6.5);
  ctx.fillStyle = lod.body || C.texto;

  /* brazos: pieza rígida detrás del cuerpo, articulación = círculo r 1u con el pivote ½u adentro */
  const K = lod.contorno;   // opcional { px, color }: contorno de píxeles enteros alrededor de brazos y cuerpo (el notch no lo usa)
  const LA = SILUETA.brazo.largo, BW = SILUETA.cuerpo.w, BR = SILUETA.radio, A0 = SILUETA.brazo.angulo || 0, PY = SILUETA.brazo.pivote[1];
  const SL = SILUETA.lobulos, N = SL.x.length, lob = lod.lobes === false ? SL.x.map(() => 0) : G.lobes;
  const orilla = lod.snap && u <= 6 && SL.orilla === "pixel";
  const domo = orilla && SILUETA.domo === "pixel";   // domo y brazos al píxel (sin tilt/squash en LOD: el cuerpo está alineado a la rejilla)
  for (const pasada of K ? [0, 1] : [1]) {   // pasada 0 = contorno (trazo grueso), 1 = relleno
  const llena = pasada ? () => ctx.fill() : () => ctx.stroke();
  if (!pasada) { ctx.fillStyle = ctx.strokeStyle = K.color; ctx.lineWidth = 2 * K.px / u; ctx.lineJoin = "round"; } else ctx.fillStyle = lod.body || C.texto;
  const ex = pasada ? 0 : K.px;
  if (domo) pixArms(ctx, u, X, Y, ex, [[1, G.armR], [-1, G.armL]].map(([side, ang]) => [side, lod.armPoses ? (ang < -22 ? -45 : ang > 14 ? 25 : 0) : ang]));
  else for (const [side, ang] of [[1, G.armR], [-1, G.armL]]) {
    let a = ang;
    if (lod.armPoses) a = a < -22 ? -45 : a > 14 ? 25 : 0;
    ctx.save();
    if (side < 0) { ctx.translate(BW / 2, 0); ctx.scale(-1, 1); ctx.translate(-BW / 2, 0); }
    ctx.translate(X(BW) - (SILUETA.brazo.largo - SILUETA.brazo.sale), Y(PY)); ctx.rotate((a + A0) * RAD);
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); llena();
    const rt = .5 * clamp(Math.abs(a) / 15, 0, 1);
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(LA - rt, -1); if (rt) ctx.arc(LA - rt, -1 + rt, rt, -PI / 2, 0); ctx.lineTo(LA, 0); ctx.arc(LA - 1, 0, 1, 0, PI / 2); ctx.lineTo(0, 1); ctx.closePath(); llena();
    ctx.restore();
  }

  /* cuerpo: esquinas de arriba r 1u, lados rectos y lóbulos que se trasladan sin deformarse */
  const por = (v, i) => (Array.isArray(v) ? v[i] : v), mu = SILUETA.muesca, pz = SILUETA.pellizco;
  ctx.beginPath(); ctx.moveTo(X(0), Y(0) + BR);
  if (domo) {
    /* domo al píxel: las esquinas de arriba van por filas (sin alfa parcial); el cuerpo es un rectángulo desde y = r. Con contorno el relleno se ensancha en vez de trazar */
    const e = pasada ? 0 : K.px / u, yb = Y(Math.min(...SL.x.map((_, i) => por(SL.y, i))));
    ctx.moveTo(X(0) - e, Y(0) + BR); ctx.lineTo(X(BW) + e, Y(0) + BR); ctx.lineTo(X(BW) + e, yb + e); ctx.lineTo(X(0) - e, yb + e);
    ctx.closePath(); ctx.fill();
    const Rp = BR * u, Wp = BW * u, Rx = Rp + (pasada ? 0 : K.px);
    ctx.save(); ctx.scale(1 / u, 1 / u);
    for (let j = pasada ? 0 : -K.px; j < Rp; j++) {
      const dy = Rp - (j + .5); if (Math.abs(dy) >= Rx) continue;
      const x0 = Math.round(Rp - Math.sqrt(Rx * Rx - dy * dy));
      ctx.fillRect(x0, j, Wp - 2 * x0, 1);
    }
    if (pz && pz.w > 0 && pz.h > 0) {   // pellizco: rectángulo en px enteros sobre el borde de arriba
      const pw = Math.round(pz.w * u), ph = Math.round(pz.h * u), pl = Math.round(Wp / 2 - pw / 2);
      ctx.fillRect(pl - (pasada ? 0 : K.px), -ph - (pasada ? 0 : K.px), pw + 2 * (pasada ? 0 : K.px), ph + (pasada ? 0 : K.px));
    }
    ctx.restore();
  } else {
  ctx.arc(X(0) + BR, Y(0) + BR, BR, PI, 1.5 * PI);
  if (pz && pz.w > 0 && pz.h > 0) {
    /* pellizco: bulto centrado que nace del borde de arriba; con snap su ancho, alto y borde izquierdo caen al píxel */
    const sn = lod.snap ? v => Math.round(v * u) / u : v => v, pw = sn(pz.w), ph = sn(pz.h), pl = sn(BW / 2 - pw / 2);
    ctx.lineTo(X(pl), Y(0)); ctx.lineTo(X(pl), Y(0) - ph); ctx.lineTo(X(pl + pw), Y(0) - ph); ctx.lineTo(X(pl + pw), Y(0));
  }
  ctx.arc(X(BW) - BR, Y(0) + BR, BR, 1.5 * PI, 2 * PI);
  }
  if (domo) { /* base y lóbulos: la base ya está en el rectángulo */ }
  else if (orilla) { const yb = Y(Math.min(...SL.x.map((_, i) => por(SL.y, i)))); ctx.lineTo(X(BW), yb); ctx.lineTo(X(0), yb); }   // base recta; los lóbulos van aparte, por filas
  else for (let i = N - 1; i >= 0; i--) {
    const cx = X(SL.x[i]), cy = Y(por(SL.y, i)) + (lob[i] || 0), r = por(SL.r, i);
    if (mu && mu.lobo === i) {
      /* muesca: rectángulo w × h que sube desde la base del lóbulo; el arco se parte en dos */
      const hw = Math.min(mu.w / 2, r * .95), yb = Math.sqrt(r * r - hw * hw), yt = cy + Math.max(r - mu.h, 0), th = Math.atan2(yb, hw);
      ctx.arc(cx, cy, r, 0, th); ctx.lineTo(cx + hw, yt); ctx.lineTo(cx - hw, yt); ctx.lineTo(cx - hw, cy + yb); ctx.arc(cx, cy, r, PI - th, PI);
    } else ctx.arc(cx, cy, r, 0, PI);
  }
  if (!domo) { ctx.closePath(); llena(); }
  if (orilla) {
    /* lóbulos al píxel: una fila de 1 px por renglón, borde = redondeo de la mitad de cada fila (sin alfa parcial). Se pinta en px (escala 1/u) */
    const yb = Math.round(Y(Math.min(...SL.x.map((_, i) => por(SL.y, i)))) * u);
    ctx.save(); ctx.scale(1 / u, 1 / u);
    for (let i = 0; i < N; i++) {
      const cxp = X(SL.x[i]) * u, cyp = Math.round((Y(por(SL.y, i)) + (lob[i] || 0)) * u), Rp = por(SL.r, i) * u + ex;
      if (cyp > yb) ctx.fillRect(Math.round(cxp - Rp), yb, Math.round(cxp + Rp) - Math.round(cxp - Rp), cyp - yb);   // si el lóbulo baja, rellena el hueco
      for (let j = 0; j + .5 < Rp; j++) {
        const hw = Math.sqrt(Rp * Rp - (j + .5) * (j + .5)), x0 = Math.round(cxp - hw), x1 = Math.round(cxp + hw);
        const corte = mu && mu.lobo === i && j >= Math.round(Math.max(por(SL.r, i) - mu.h, 0) * u) + ex;
        if (corte) {
          const mitad = Math.min(mu.w / 2, por(SL.r, i) * .95) * u;
          const izq = Math.max(x0, Math.min(x1, Math.round(cxp - mitad) + ex));
          const der = Math.max(izq, Math.max(x0, Math.min(x1, Math.round(cxp + mitad) - ex)));
          ctx.fillRect(x0, cyp + j, izq - x0, 1); ctx.fillRect(der, cyp + j, x1 - der, 1);
        } else ctx.fillRect(x0, cyp + j, x1 - x0, 1);
      }
    }
    ctx.restore();
  }
  }

  /* ojos: parámetros compuestos; a tamaño chico cada vértice cae en un píxel entero */
  /* caret: en la base va del color del ojo; el cian lo pone la capa de arriba (isla/notch), no el fantasma */
  ctx.fillStyle = G.eyeCol === "caret" && P.v("caret_color") === "cian" ? C.cian : (lod.eye || C.abismo);
  const q = lod.snap ? (v, r) => Math.round((v + r) * u) / u - r : v => v;
  [-1, 1].forEach((side, i) => {
    let E = G.eyesC[i]; if (lod.snap) E = snapEye(E, u);
    const mx = lod.snap ? 0 : G.micro[0], my = lod.snap ? 0 : G.micro[1];
    const ex = X(3 + side) + G.gx + E.x + mx - side * (G.verg || 0), eb = Y(5) + G.gy + E.y + my;   // vergencia: los dos hacia adentro
    ctx.beginPath();
    eyePts(E, side, lod.snap ? 6 : 14).forEach(([x, y], j) => { const px = q(ex + x, rx), py = q(eb + y, ry); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
    /* brillo = reflejo de la luz, hijo del ojo (anim-21). Misma esquina en los dos ojos (no en espejo). Su lugar es
       una fracción de la caja del ojo: el squash mueve su lugar, no su tamaño. Lo tapan el párpado y las cejas por
       recorte y se apaga con la geometría (nunca pop). Se mueve en el mismo cuadro que el ojo */
    const s = lod.snap ? (GLINT_PX[u] || 0) / u : P.v("brillo_tam") * (G.cs ?? 1);
    if (P.v("brillo") && G.eyeCol !== "caret" && s > 0) {
      const mc = Math.max(0, E.h - .25), cL = Math.min(mc, side < 0 ? E.cout : E.cin), cR = Math.min(mc, side < 0 ? E.cin : E.cout);
      const hw = E.w / 2, xr = -hw + P.v("brillo_x") * (E.w - s);
      const over = x => lerp(cL, cR, (x + hw) / E.w) + E.dome * (hw - Math.sqrt(Math.max(0, hw * hw - x * x)));   // cuánto baja el borde de arriba en x
      const top = E.b - E.h + Math.max(over(xr), over(xr + s)), avail = E.b - top;
      let ca = clamp((avail - 1.6 * s) / (.4 * s), 0, 1) * (G.caEmo ?? 1);
      if (lod.snap) ca = ca >= .5 ? 1 : 0;                                // al píxel no hay alfa: está o no está
      if (ca > .02) {
        const par = lod.snap ? [0, 0] : G.par || [0, 0];
        let bx = ex + xr + par[0], by = eb + top + P.v("brillo_y") * Math.max(0, avail - s) + par[1];
        if (lod.snap) { bx = q(bx, rx); by = q(by, ry); }
        ctx.save(); ctx.clip(); ctx.globalAlpha = ca; ctx.fillStyle = lod.body || C.texto; ctx.fillRect(bx, by, s, s); ctx.restore();
      }
    }
  });
  ctx.restore();
}

/* Titi de 16 pt en el notch: la pantalla es retina, así que se pinta a 32 px (u=4, LOD 4) y se reduce ×½.
   Con u=2 la mirada movía el ojo ≤1 px y no había brillo: no se veían las pupilas */
export function titi16(ctx, x, y, G, P) {
  ctx.save(); ctx.translate(x, y); ctx.scale(.5, .5); drawGhost(ctx, 0, 0, 4, G, LOD[4], P); ctx.restore();
}

/* ───────── gestos del cuerpo (solo cuerpo: los ojos los manda el estado) ─────────
   Claves [s, valor] pose a pose con holds (keyed); dy/dx en u, sq = squash con área constante, brazos y tilt en grados,
   lob = cuánto se suma a la ola. pv = pivote del squash (por defecto 4u). */
export const decay = (f, d, from = 0) => τ => τ < from ? 0 : Math.sin((τ - from) * TAU * f) * Math.exp(-(τ - from) * d);
export const ACT = {
  termino: {
    dur: 1.6,
    dy: [[0, 0], [.2, .35], [.26, .35], [.55, -1.5], [.7, -1.5], [1.0, 0], [1.6, 0]],
    sq: [[0, 0], [.2, -.1], [.26, -.1], [.36, .08], [.55, 0], [.98, 0], [1.04, -.07], [1.25, 0]],
    armR: [[0, 0], [.2, 15], [.42, -45], [.75, -45], [1.02, 8], [1.6, 0]],
    armL: [[0, 0], [.2, 15], [.42, -45], [.75, -45], [1.02, 8], [1.6, 0]],
    lob: [[0, 0], [1.0, 0], [1.08, 1], [1.4, 0]], pv: 6.5,
  },
  /* falló: respingo → se desinfla → mira a otro lado (culpa) → te vuelve a mirar. La base del estado lo hunde */
  fallo: {
    dur: 3.2,
    dy: [[0, 0], [.06, -.25], [.3, -.2], [.6, -.15], [1.2, .15], [3.2, 0]],
    sq: [[0, 0], [.06, .06], [.25, .03], [.6, 0], [1.1, -.07], [1.6, -.04], [3.2, 0]],
    armR: [[0, 0], [.06, -25], [.4, -20], [.7, 0], [1.2, 8], [3.2, 0]], armL: [[0, 0], [.06, -25], [.4, -20], [.7, 0], [1.2, 8], [3.2, 0]],
    tilt: [[0, 0], [1.7, 0], [1.9, -3], [2.5, -3], [2.75, 1.5], [3.2, 0]],
    lob: [[0, 0], [1.0, 0], [1.15, .6], [1.6, 0]],
  },
  /* suspiro: inhala (sube, se estira), sostiene, exhala largo (se desinfla) */
  suspiro: {
    dur: 1.8,
    dy: [[0, 0], [.5, -.18], [.7, -.18], [1.4, .08], [1.8, 0]],
    sq: [[0, 0], [.5, .05], [.7, .05], [1.3, -.06], [1.8, 0]],
    armR: [[0, 0], [.5, -8], [.7, -8], [1.3, 6], [1.8, 0]], armL: [[0, 0], [.5, -8], [.7, -8], [1.3, 6], [1.8, 0]],
    lob: [[0, 0], [1.0, 0], [1.3, .5], [1.8, 0]],
  },
  /* berrinche: anticipa, dos saltitos con los brazos bombeando, y la sacudida */
  berrinche: {
    dur: 2.0,
    dy: [[0, 0], [.15, .15], [.3, -.45], [.45, .1], [.6, -.35], [.75, .1], [.95, 0]],
    sq: [[0, 0], [.15, -.1], [.3, .08], [.45, -.07], [.6, .08], [.75, -.07], [.95, 0]],
    armR: [[0, 0], [.15, 10], [.3, -45], [.45, 25], [.6, -45], [.75, 25], [1.0, 20], [2.0, 0]],
    armL: [[0, 0], [.15, 10], [.3, -40], [.45, 25], [.6, -40], [.75, 25], [1.0, 20], [2.0, 0]],
    tilt: decay(5, 3.5, .9), lob: [[0, 0], [.3, 1], [.95, 1], [1.3, 0]],
  },
  /* resoplido: aire de golpe por abajo, la sábana se agita */
  resoplo: {
    dur: .7,
    dy: [[0, 0], [.1, -.08], [.25, .06], [.6, 0]], sq: [[0, 0], [.1, .06], [.25, -.08], [.6, 0]],
    tilt: [[0, 0], [.25, -2], [.6, 0]], lob: [[0, 0], [.25, 1.3], [.7, 0]],
  },
  llamar: {
    dur: 1.3, caret: "on",
    dy: [[0, 0], [.16, .25], [.4, -.6], [.62, -.1], [1.3, 0]],
    sq: [[0, 0], [.16, -.08], [.3, .07], [.5, 0], [.62, -.04], [.8, 0]],
    armR: [[0, 0], [.16, 10], [.38, -40], [.8, -15], [1.3, 0]], armL: [[0, 0], [.16, 10], [.38, -40], [.8, -15], [1.3, 0]],
  },
  /* toque: el recordatorio chico de «te necesita» (un saltito sin anticipación grande, brazos a medias) */
  toque: {
    dur: .9, caret: "on",
    dy: [[0, 0], [.1, .1], [.26, -.32], [.45, -.05], [.9, 0]],
    sq: [[0, 0], [.1, -.05], [.22, .05], [.4, 0], [.48, -.03], [.65, 0]],
    armR: [[0, 0], [.1, 6], [.26, -26], [.6, -8], [.9, 0]], armL: [[0, 0], [.1, 6], [.26, -26], [.6, -8], [.9, 0]],
    lob: [[0, 0], [.4, .5], [.9, 0]],
  },
  /* atendido: llegaste. Respiro de alivio: sube un poco, suelta el aire y baja los brazos */
  atendido: {
    dur: 1.1,
    dy: [[0, 0], [.12, -.18], [.22, -.18], [.6, .08], [1.1, 0]],
    sq: [[0, 0], [.12, .05], [.22, .05], [.55, -.05], [1.1, 0]],
    armR: [[0, 0], [.12, -22], [.22, -22], [.65, 6], [1.1, 0]], armL: [[0, 0], [.12, -22], [.22, -22], [.65, 6], [1.1, 0]],
    lob: [[0, 0], [.5, .6], [1.1, 0]],
  },
  cosquillas: {
    dur: 1.2,
    dy: [[0, 0], [.1, -.2], [1.2, 0]],
    tilt: decay(6, 2.5), lob: [[0, 0], [.1, 1], [1.0, 0]],
    wig: τ => ({ sq: .05 * decay(5, 3)(τ), armR: -18 - 14 * decay(6, 2)(τ), armL: -18 + 14 * decay(6, 2)(τ) }),
  },
};

/* prisa (opcional, no cambia los demás): flotar con prisa hacia un lado. dx en u, tilt en grados hacia donde va, dir ±1; el cuerpo no se estira
   (sin sq) y no hay piernas: los lóbulos solo suben la ola y, con lobulos.cascada, la arrastran con retraso. ACT.prisa = la de dir +1; el lab la reemplaza */
export const prisa = ({ dx = .4, tilt = 3, dir = 1, dur = 1.4 } = {}) => ({
  dur,
  dx: [[0, 0], [.22, dir * dx], [dur - .5, dir * dx], [dur, 0]],
  tilt: [[0, 0], [.22, dir * tilt], [dur - .5, dir * tilt], [dur, 0]],
  lob: [[0, 0], [.22, 1], [dur - .5, 1], [dur, 0]],
});
ACT.prisa = prisa();

/* lo que sostiene el cuerpo en un estado (cada estado sobreescribe lo que necesita):
   dy hundimiento (u) · arm ángulo base (°) · bob × flotación · T × periodo · breath × respiración · ola × ola */
export const BODY = { dy: 0, arm: 0, bob: 1, T: 1, breath: 1, ola: 1 };

/* resortes del rig con nombre (los de P vienen de params.json: cuerpo k170 ζ.85 · lóbulos k120 ζ.75 · brazos k220 ζ.85) */
export const RIG_SPRINGS = {
  tilt: "contenido", baseDy: { k: 40, z: 1 }, baseArm: { k: 60, z: .95 },
  bob: "contenido", T: "contenido", breath: "contenido", ola: "contenido",
};

/* rig quieto: para alfabetos, laboratorios y láminas (sin cuerpo en movimiento) */
export function stillRig(P, pair, k, shown, t = 0, settled = true) {
  const cursorOff = shown === "cursor" && settled ? caretOff(P, t) : 0;
  return {
    t, rx: 0, ry: 0, sq: 0, pv: 4, tilt: 0, lobes: SILUETA.lobulos.x.map(() => 0), armR: 0, armL: 0, gx: 0, gy: 0, micro: [0, 0],
    eyesC: pair.map((e, i) => composeEye(P, e, k, i ? 1 : -1, 0, cursorOff)), eyeCol: shown === "cursor" ? "caret" : null,
  };
}
export const trackRig = (P, track, t) => { const s = track.sample(t); return stillRig(P, s.pair, s.k, s.shown, t, s.settled); };

/* dart: 80 % del recorrido en el primer cuadro, 2–3 cuadros en total; crece con la amplitud */
export const out4 = x => 1 - Math.pow(1 - clamp(x, 0, 1), 4);

/* ───────── el rig: estado + update ─────────
   new Rig(P, { states, script, autoScript, onState })
   · states: tabla de estados (states-v4.js es la primera capa aprobada) · script: guion [[s, estado]…, [s, "fin"]]
   · autoScript: arranca el guion en setup() (el render lo usa) · onState(k): aviso para la UI
   Orden por cuadro: guion → beats/loop del estado → mirada (darts) → cabeza sigue a los ojos → cuerpo → lóbulos →
   brazos (2 cuadros tarde) → ojos (forma + párpado) → brillo. Ojos primero, cuerpo después. */
export class Rig {
  constructor(P, o = {}) {
    this.P = P; this.states = o.states; this.SCRIPT = o.script || []; this.autoScript = !!o.autoScript; this.onState = o.onState || (() => {});
    this.G = null; this.S = null; this.small = null;
  }
  setup() {
    const P = this.P;
    this.S = {
      rootX: new Spring(P.v("cuerpo"), 0), rootY: new Spring(P.v("cuerpo"), 0), tail: new Spring(P.v("lobulos"), 0),
      armR: new Spring(P.v("brazos"), 0), armL: new Spring(P.v("brazos"), 0), tilt: new Spring(RIG_SPRINGS.tilt, 0),
      baseDy: new Spring(RIG_SPRINGS.baseDy, 0), baseArm: new Spring(RIG_SPRINGS.baseArm, 0),
      bob: new Spring(RIG_SPRINGS.bob, 1), T: new Spring(RIG_SPRINGS.T, 1), breath: new Spring(RIG_SPRINGS.breath, 1), ola: new Spring(RIG_SPRINGS.ola, 1),
    };
    this.G = {
      t: 0, state: "esperando", stT: 0, sn: 0, act: null, eyes: new EyeTrack("neutro", P), eyeHold: null, lastRecipe: null,
      blinks: [], nextBlink: 2, nextSlow: 12, nextGaze: .5, gz: { from: [0, 0], to: [0, 0], t0: 0, dur: .07 }, micro: [0, 0], nextMicro: 0, beatI: 0, loopN: 0, caretT0: 0, nextLoop: Infinity, loopBeats: [], csOv: null, caOv: null, cs: 1, caEmo: 1, par: [0, 0], verg: 0, nearT: -99,
      rx: 0, ry: 0, sq: 0, pv: 4, tilt: 0, lobes: SILUETA.lobulos.x.map(() => 0), armR: 0, armL: 0, gx: 0, gy: 0, k: 0, eyesC: shapePair("neutro").map((e, i) => ({ ...e, b: 0, x: 0, y: 0 })), eyeCol: null,
      bobPh: 0, brPh: 0, olaPh: 0, ptr: null, ptrT: -99, trail: [], hist: [], vyHist: [], script: this.autoScript ? { t0: 0, i: 0 } : null, layout: null,
    };
    this.small = null;
  }
  blink(kind, at = this.G.t) { this.G.blinks.push({ t0: at, kind }); }
  act(name) { this.G.act = { name, t0: this.G.t }; }
  setState(k, task = true) {
    const G = this.G, st = this.states[k]; if (!st) return;
    const prev = this.states[G.state];
    G.beatI = 0; G.loopN = 0; G.nextLoop = st.loop ? G.t + R(...st.loop.every) + 4 : Infinity; G.loopBeats = []; G.csOv = G.caOv = null;
    G.state = k; G.stT = G.t; G.sn = 0; G.nextGaze = G.t + .05; G.eyeHold = null;
    G.lastRecipe = G.eyes.go(st.shape, G.t, task) || G.lastRecipe;
    if (st.act) this.act(st.act);
    if (prev?.exit && prev !== st) this.beat(st.act ? { ...prev.exit, act: null } : prev.exit, G.t);   // salida: el estado viejo reacciona
    for (const [d, kind] of st.enter || []) this.blink(kind, G.t + d);
    G.nextBlink = G.t + (st.blink ? R(...st.blink) : 0); G.nextSlow = G.t + (st.slow ? R(...st.slow) : 0);
    this.onState(k);
  }
  /* un beat: efectos de una escena actuada (forma de ojo, mirada, parpadeo, brillo, gesto) */
  beat(e, t) {
    const G = this.G;
    if (e.eye) G.eyeHold = { name: e.eye, until: t + (e.eyeFor ?? 1) };
    if (e.gaze) { this.dart(e.gaze, t); G.nextGaze = t + (e.hold ?? 1); }
    if (e.blink) this.blink(e.blink, t);
    if (e.cs) G.csOv = { v: e.cs[0], until: t + e.cs[1] };
    if (e.ca) G.caOv = { v: e.ca[0], until: t + e.ca[1] };
    if (e.act) this.act(e.act);
  }
  gazeAt(t) { const z = this.G.gz, e = out4((t - z.t0) / z.dur); return [lerp(z.from[0], z.to[0], e), lerp(z.from[1], z.to[1], e)]; }
  dart(to, t, slow = 1, turnBlink = false) {
    const cur = this.gazeAt(t), amp = Math.hypot(to[0] - cur[0], to[1] - cur[1]);
    if (amp < .02) return;
    this.G.gz = { from: cur, to, t0: t, dur: clamp(.05 + amp * .08, .066, .133) * slow * this.P.v("dart") };
    if (turnBlink && amp > .5 && Math.random() < .4) this.blink("normal", t);   // cambio grande de dirección: parpadeo
  }
  startScript() { this.G.script = { t0: 0, i: 0 }; this.onState(this.G.state); }
  stopScript() { this.G.script = null; }
  runScript(t) {
    const G = this.G, sc = G.script, SCRIPT = this.SCRIPT; if (!sc) return;
    while (sc.i < SCRIPT.length && t - sc.t0 >= SCRIPT[sc.i][0]) {
      const [, name] = SCRIPT[sc.i++];
      if (name === "fin") { G.script = null; this.onState(G.state); return; }
      this.setState(name);
    }
  }

  update(dt, t) {
    const P = this.P, S = this.S, STATES = this.states;
    let G = this.G;
    G.t = t; this.runScript(t);
    if (STATES[G.state].next && t - G.stT >= STATES[G.state].next[1]) this.setState(STATES[G.state].next[0], false);   // terminó vuelve en tween
    S.rootX.set(P.v("cuerpo")); S.rootY.set(P.v("cuerpo")); S.tail.set(P.v("lobulos")); S.armR.set(P.v("brazos")); S.armL.set(P.v("brazos"));
    const st = STATES[G.state], τs = t - G.stT, late = st.later && τs >= st.later[0];
    const m = { ...BODY, ...(late ? st.later[2] : st.body) }, ex = P.v("exagerar");
    let a = G.act, τ = a ? t - a.t0 : 0, A = a && ACT[a.name];
    if (A && τ > A.dur) { G.act = a = A = null; }
    const ch = k => (!A || !A[k] ? 0 : typeof A[k] === "function" ? A[k](τ) : keyed(A[k], τ));
    const wig = A?.wig ? A.wig(τ) : {};

    /* ritmos con fase acumulada: flotar con hold arriba y abajo (moving hold), respiración, ola continua */
    S.bob.to(m.bob).step(dt); S.T.to(m.T).step(dt); S.breath.to(m.breath).step(dt); S.ola.to(m.ola).step(dt);
    const per = P.v("periodo") * S.T.v;
    G.bobPh += dt * TAU / per; G.brPh += dt * TAU / (per * .9); G.olaPh += dt * TAU / (P.v("ola_periodo") * S.T.v);
    const sn = Math.sin(G.bobPh), held = Math.sign(sn) * Math.pow(Math.abs(sn), .55);
    const amp = P.v("flotacion") * S.bob.v, bobY = amp * held, bobX = amp * .3 * noise(t * .2, 19);

    /* escena actuada del estado: beats una vez, luego el loop sostenido (suspiro, resoplido) */
    if (!late) {
      while (st.beats && G.beatI < st.beats.length && τs >= st.beats[G.beatI][0]) this.beat(st.beats[G.beatI++][1], t);
      if (st.loop && t >= G.nextLoop && !A) {
        G.nextLoop = t + R(...st.loop.every);
        if (!st.loop.max || G.loopN < st.loop.max) { G.loopN++; G.loopBeats = st.loop.beats.map(([d, e]) => [t + d, e]); }   // tope: anti-Clippy
      }
      while (G.loopBeats.length && t >= G.loopBeats[0][0]) this.beat(G.loopBeats.shift()[1], t);
    }
    /* mirada: darts. El mouse manda solo donde el estado mira al usuario */
    if (st.ptr && !late && G.ptr && t - G.ptrT < 2.5) {
      if (Math.hypot(G.ptr[0] - G.gz.to[0], G.ptr[1] - G.gz.to[1]) > .06) this.dart(G.ptr, t, 1, true);
      G.nextGaze = t + 1;
    } else if (t >= G.nextGaze) {
      const g = st.gaze(G.sn++); this.dart(g.to, t, (late ? 3 : st.dart || 1), st.turnBlink); G.nextGaze = t + g.hold;
    }
    [G.gx, G.gy] = this.gazeAt(t);
    if (P.v("microsacadas") && t > G.nextMicro) { G.micro = [R(-.05, .05), R(-.035, .035)]; G.nextMicro = t + R(.5, 1); }
    if (!P.v("microsacadas")) G.micro = [0, 0];

    /* cuerpo: la cabeza sigue a los ojos (llegan primero); la base del estado se hunde lento */
    const base = S.baseDy.to(m.dy).step(dt), baseArm = S.baseArm.to(m.arm).step(dt);
    G.ry = S.rootY.to(base + ch("dy") * ex).step(dt) + bobY; G.rx = S.rootX.to(ch("dx") * ex + G.gx * .25).step(dt) + bobX;
    G.tilt = S.tilt.to(G.gx * 3 + ch("tilt") * ex).step(dt);
    if (typeof A?.tilt === "function") G.tilt = S.tilt.v = ch("tilt") * 7 * ex + G.gx * 3;
    G.sq = clamp(ch("sq") * ex + (wig.sq || 0) * ex + P.v("respiracion") * S.breath.v * Math.sin(G.brPh), -.12, .12);
    G.pv = A?.pv ?? 4;
    S.tail.to(G.ry).step(dt);
    const lag = clamp((S.tail.v - G.ry) * .5, -.25, .25), olaA = P.v("ola") * S.ola.v * (1 + ch("lob") * 1.2);
    const casc = SILUETA.lobulos.cascada;
    if (casc) {
      /* cascada (opcional): cada lóbulo es un resorte {k, z} que persigue la MISMA señal (flotado + ola) leída i·retraso segundos antes; se mueven lóbulos enteros, el contorno no se deforma */
      const NL = SILUETA.lobulos.x.length, ret = casc.retraso ?? .12, h = (G.cas ??= []);
      h.push({ t, v: lag + olaA * Math.sin(G.olaPh) });
      while (h.length > 2 && h[1].t < t - ret * NL - .1) h.shift();
      const at = tt => { if (tt <= h[0].t) return h[0].v; for (let j = 1; j < h.length; j++) if (tt <= h[j].t) return lerp(h[j - 1].v, h[j].v, (tt - h[j - 1].t) / (h[j].t - h[j - 1].t || 1)); return h.at(-1).v; };
      const sp = (S.cas ??= []);
      G.lobes = Array.from({ length: NL }, (_, i) => clamp((sp[i] ??= new Spring({ k: 120, z: .75 }, 0)).set({ k: casc.k ?? 120, z: casc.z ?? .75 }).to(clamp(at(t - i * ret), -.3, .3)).step(dt), -.3, .3));
    } else G.lobes = SILUETA.lobulos.x.map((_, i) => clamp(lag * (i === 1 ? .7 : 1) + olaA * Math.sin(G.olaPh - i * P.v("desfase")), -.3, .3));
    G.vyHist.push(S.rootY.vel); if (G.vyHist.length > 3) G.vyHist.shift();
    const drag = clamp(G.vyHist[0] * 9, -14, 14), lim = v => clamp(v, -55, 30);
    G.armR = S.armR.to(lim(baseArm + ch("armR") * ex + (wig.armR || 0) * ex + drag)).step(dt);
    G.armL = S.armL.to(lim(baseArm + ch("armL") * ex + (wig.armL || 0) * ex + drag)).step(dt);

    /* ojos: forma (pista con receta) + párpado (parpadeos) */
    const want = G.eyeHold && t < G.eyeHold.until ? G.eyeHold.name : late ? st.later[1] : st.cursorAfter != null && τs >= st.cursorAfter ? "cursor" : st.shape;
    if (want !== G.eyes.name) G.lastRecipe = G.eyes.go(want, t, false) || G.lastRecipe;
    const smp = G.eyes.sample(t); G.eyes.tick(t);
    if (st.blink && !late && t > G.nextBlink) { this.blink(st.blinkKind || "normal", t); G.nextBlink = t + R(...st.blink) / P.v("parpadeos"); }
    if (st.slow && !late && t > G.nextSlow) { this.blink(st.slowKind, t); G.nextSlow = t + R(...st.slow); }
    G.blinks = G.blinks.filter(b => t - b.t0 < blinkDur(b.kind));
    const kB = G.blinks.reduce((mx, b) => (t >= b.t0 ? Math.max(mx, keyed(BLINKS[b.kind].keys, t - b.t0)) : mx), 0);
    G.k = Math.max(smp.k, kB);
    /* caret ▮ / ▁ con rampa; durante un gesto que llama (caret: "on") se queda encendido y el ciclo vuelve a empezar */
    if (smp.shown !== "cursor" || !smp.settled || A?.caret === "on") G.caretT0 = t;
    const cursorOff = smp.shown === "cursor" ? caretOff(P, t - G.caretT0) : 0;
    G.eyesC = smp.pair.map((e, i) => composeEye(P, e, G.k, i ? 1 : -1, G.gx, cursorOff));
    G.eyeCol = smp.shown === "cursor" ? "caret" : null; G.shown = smp.shown;
    /* brillo: emoción por tamaño (ternura +25 % en ~1 s) y visibilidad (shock: se apaga en ~200 ms); nunca en un cuadro */
    const shock = G.eyeHold?.name === "sorpresa" && t < G.eyeHold.until;
    G.cs += ((G.csOv && t < G.csOv.until ? G.csOv.v : st.cs ?? 1) - G.cs) * (1 - Math.exp(-dt / .35));
    G.caEmo += ((shock || (G.caOv && t < G.caOv.until && G.caOv.v === 0) ? 0 : st.ca ?? 1) - G.caEmo) * (1 - Math.exp(-dt / .07));
    /* parallax: en el dart el brillo se queda 15 % atrás y se asienta 1–2 cuadros después */
    const z = G.gz, pf = P.v("parallax") ? Math.pow(1 - clamp((t - z.t0) / (z.dur + .066), 0, 1), 2) * .15 : 0;
    G.par = [-(z.to[0] - z.from[0]) * pf, -(z.to[1] - z.from[1]) * pf];
    G.verg += ((P.v("vergencia") && st.ptr && t - G.nearT < .3 ? .25 : 0) - G.verg) * (1 - Math.exp(-dt / .08));

    /* pose para tamaños chicos: muestreada a 12 fps */
    if (!this.small || Math.floor(t * SMALL_FPS) !== this.small.fk) this.small = { ...G, lobes: [...G.lobes], eyesC: G.eyesC.map(e => ({ ...e })), fk: Math.floor(t * SMALL_FPS) };
    G.trail.push([G.rx, G.ry]); if (G.trail.length > 45) G.trail.shift();
    G.hist.push({ ry: G.ry, gx: G.gx, gy: G.gy, eh: G.eyesC[0].h, k: G.k }); if (G.hist.length > 150) G.hist.shift();
  }
}
