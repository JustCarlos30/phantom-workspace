// Matemática de movimiento que se repetía en cada artifact (Fantasma v3-v5, Entorno de estados).
// Todo es función del tiempo que le pasas: nada lee Date.now() ni performance.now(), así renderiza igual siempre.
import tokens from "./tokens.js";

export { tokens };
export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const frac = x => x - Math.floor(x);
export const smooth = u => u * u * (3 - 2 * u);

/* azar con semilla: en modo render stage.js reemplaza Math.random con esto, así el video sale idéntico */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let activeRandom = rng(20261012);
export const R = (a, b) => a + seededMath.random() * (b - a);
export const pick = list => list[Math.floor(seededMath.random() * list.length)];
export function wpick(list, not) {   // [[nombre, peso]]; nunca el mismo dos veces seguidas
  const c = list.filter(b => b[0] !== not), L = c.length ? c : list;
  let r = seededMath.random() * L.reduce((a, b) => a + b[1], 0);
  for (const b of L) { r -= b[1]; if (r < 0) return b[0]; }
  return L[L.length - 1][0];
}

/* ruido de valor 2D, suave, para ritmos que no marchan en bucle perfecto */
function hash(x, y) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1; }
export function noise(x, y = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/* curvas: nada lineal */
export const easeOut = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
export const easeIn = x => Math.pow(clamp(x, 0, 1), 2.2);
export const eio = (x, a = .4) => { x = clamp(x, 0, 1); return x < a ? x * x / a : 1 - (1 - x) * (1 - x) / (1 - a); };   // ida rápida, llegada lenta
export function bez(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx, cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => { x = clamp(x, 0, 1); let t = x; for (let i = 0; i < 6; i++) { const d = dX(t); if (Math.abs(d) < 1e-6) break; t = clamp(t - (X(t) - x) / d, 0, 1); } return Y(t); };
}
export const curve = {};
for (const [k, v] of Object.entries(tokens.curve)) curve[k] = bez(...v);

/* pose a pose: claves [u, valor]; dos claves iguales seguidas = hold */
export function keyed(keys, u, ea = .4) {
  for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) {
    const [u0, v0] = keys[i - 1], [u1, v1] = keys[i];
    return v0 === v1 || u1 === u0 ? v0 : v0 + (v1 - v0) * eio((u - u0) / (u1 - u0), ea);
  }
  return keys[keys.length - 1][1];
}

/* resortes con nombre: forma, contenido, gesto (lienzo.json). Pasa {k, z} para uno propio */
export class Spring {
  constructor(kind, v = 0) { this.set(kind); this.v = v; this.t = v; this.vel = 0; }
  set(kind) { const s = typeof kind === "string" ? tokens.spring[kind] : kind; this.k = s.k; this.z = s.z; return this; }
  to(t) { this.t = t; return this; }
  snap(v) { this.v = this.t = v; this.vel = 0; return this; }
  step(dt) {
    const c = 2 * this.z * Math.sqrt(this.k), n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { this.vel += (this.k * (this.t - this.v) - c * this.vel) * h; this.v += this.vel * h; }
    return this.v;
  }
  get settled() { return Math.abs(this.t - this.v) < 1e-3 && Math.abs(this.vel) < 1e-3; }
}
/* cuánto tarda un resorte en asentarse (al 0.1 %), para tablas y recetas */
export function settleTime(s, from = 0, to = 1) {
  const sp = new Spring(s, from).to(to); let t = 0, quiet = 0;
  while (t < 5) { sp.step(1 / 240); t += 1 / 240; quiet = Math.abs(sp.v - to) < 1e-3 * Math.abs(to - from || 1) ? quiet + 1 : 0; if (quiet > 24) return t - 24 / 240; }
  return t;
}

/* color */
export const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const C = tokens.color;
export const RGB = Object.fromEntries(Object.entries(C).filter(([, v]) => v.startsWith("#")).map(([k, v]) => [k, hex(v)]));
export const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
export const rgba = (c, a = 1) => `rgba(${c.map(Math.round).join(",")},${clamp(a, 0, 1).toFixed(3)})`;

// Scope synchronous replay randomness without touching the host Math.random.

export const seededMath = Object.create(Math);
seededMath.random = () => activeRandom();
export function withRandom(random, callback) {
  const previous = activeRandom; activeRandom = random;
  try { return callback(); } finally { activeRandom = previous; }
}
