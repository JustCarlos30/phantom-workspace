// Fantasma · estados v6 (extensión de fantasma-base-v2 ★). No edita ghost.js ni states-v4.js:
// importa los estados aprobados y SUMA dos nuevos (escribiendo, delegando), formas y gestos con nombre nuevo.
// terminó, pensando y falló son los de la base, tal cual.
// stage.js omitted: local seeded replay; no DOM.
import { R } from "./motion.js";
import { SHAPES, ACT, decay } from "./ghost.js";
import { STATES as BASE_STATES } from "./states-v4.js";

/* ───────── formas nuevas (solo se suman; las aprobadas no cambian) ───────── */
Object.assign(SHAPES, {
  escribe: { h: 1.5, lift: .25, label: "escribiendo" },            // más abierto que «concentrado»: produce, no lee
  mareado: { h: 2, R: { h: 1, dy: -.15 }, label: "mareado" },      // un ojo grande y uno chico…
  mareado2: { h: 1, dy: -.15, R: { h: 2, dy: 0 }, label: "mareado" }, // …y se alternan
});

/* ───────── gestos nuevos ───────── */
/* tecleo: ráfaga de toques alternados, la mano sube (−) y pega (+). Un solo canal: brazos */
function tecleo(n = 8, gap = .11) {
  const R_ = [[0, 0]], L_ = [[0, 0]], dy = [[0, 0]];
  for (let i = 0; i < n; i++) {
    const t0 = .05 + i * gap, arm = i % 2 ? L_ : R_;
    arm.push([t0, 0], [t0 + .035, -14], [t0 + .08, 3], [t0 + .1, 0]);
    dy.push([t0 + .035, 0], [t0 + .08, .035], [t0 + .1, 0]);
  }
  const end = .05 + n * gap + .15;
  R_.push([end, 0]); L_.push([end, 0]); dy.push([end, 0]);
  return { dur: end, armR: R_, armL: L_, dy };
}
Object.assign(ACT, {
  tecleo: tecleo(8), tecleo_corto: tecleo(4),
  /* encarga: se echa para atrás, lanza el brazo derecho («ve») y regresa. El subagente sale de esa mano */
  encarga: {
    dur: 1.4,
    dx: [[0, 0], [.2, -.15], [.42, .3], [.8, .22], [1.4, 0]],
    dy: [[0, 0], [.2, .12], [.42, -.25], [.8, -.1], [1.4, 0]],
    sq: [[0, 0], [.2, -.06], [.36, .05], [.6, 0]],
    armR: [[0, 0], [.2, 15], [.42, -40], [.85, -36], [1.4, 0]],
    armL: [[0, 0], [.2, 6], [.5, 10], [1.4, 0]],
    lob: [[0, 0], [.4, .7], [1.2, 0]],
  },
  /* asiente: «va bien» cuando revisa a sus subagentes */
  asiente: { dur: .55, dy: [[0, 0], [.12, .12], [.28, -.05], [.55, 0]], sq: [[0, 0], [.12, -.04], [.3, 0]] },
  /* clics */
  mareo: { dur: 2.4, tilt: decay(1.4, 1.1), dy: [[0, 0], [.15, -.15], [.5, .1], [2.4, 0]], armR: [[0, 0], [.2, -30], [1.2, -10], [2.4, 0]], armL: [[0, 0], [.2, 20], [1.2, 5], [2.4, 0]], lob: [[0, 0], [.2, 1], [1.6, 0]] },
  esconde: {
    dur: 60,                                             // se queda abajo hasta que el sketch lo saca
    dy: [[0, 0], [.08, -.2], [.35, 1.5]], sq: [[0, 0], [.08, .06], [.3, -.1], [.5, -.06]],
    armR: [[0, 0], [.1, -30], [.35, 22]], armL: [[0, 0], [.1, -30], [.35, 22]], lob: [[0, 0], [.35, 1], [1, 0]],
  },
  sale: { dur: 1.1, dy: [[0, 1.5], [.25, 1.6], [.55, -.35], [.8, .05], [1.1, 0]], sq: [[0, -.06], [.25, -.1], [.45, .07], [.7, 0]], armR: [[0, 22], [.45, -20], [1.1, 0]], armL: [[0, 22], [.45, -20], [1.1, 0]], lob: [[0, 0], [.6, 1], [1.1, 0]] },
});
/* gestos con dirección (se arman en el momento: dir = −1 si el clic vino de la derecha) */
export const respingo = dir => ({ dur: .7, dx: [[0, 0], [.08, .45 * dir], [.7, 0]], dy: [[0, 0], [.08, -.3], [.35, .05], [.7, 0]], sq: [[0, 0], [.08, .07], [.3, -.04], [.6, 0]], armR: [[0, 0], [.08, -35], [.7, 0]], armL: [[0, 0], [.08, -35], [.7, 0]] });
export const aparta = dir => ({ dur: 3.2, dx: [[0, 0], [.15, -.15 * dir], [.45, 1.6 * dir], [2.2, 1.5 * dir], [3.2, 0]], tilt: [[0, 0], [.45, -4 * dir], [2.2, -3 * dir], [3.2, 0]], armR: [[0, 0], [.45, 25], [2.6, 25], [3.2, 0]], armL: [[0, 0], [.45, 25], [2.6, 25], [3.2, 0]], lob: [[0, 0], [.45, 1], [1.2, 0]] });

/* la mirada de «escribiendo» sigue al caret: el sketch conecta ESCRIBE.frac con los complementos */
export const ESCRIBE = { frac: () => .5 };

/* ───────── estados ───────── */
const { esperando, pensando, termino, fallo, fallo2 } = BASE_STATES;
export const STATES = {
  esperando,
  /* v6 · pensando refinado (anim-23): el desvío de mirada por esfuerzo dura ~3.5 s con UN dart, no seis.
     Mira arriba a la derecha, a sus ideas (los puntos), y de vez en cuando busca una vez al otro lado. El parpadeo va con
     cada cambio de foco (turnBlink): es puntuación entre pensamientos. Lo demás es el pensando aprobado de la base */
  pensando: {
    ...pensando,
    gaze: n => (n % 2 === 0 ? { to: [R(.34, .42), R(-.42, -.34)], hold: R(3, 4) } : { to: [R(-.34, -.2), R(-.46, -.38)], hold: R(1.3, 1.9) }),
  },
  /* escribiendo: mira hacia abajo, a lo que escribe; la mirada avanza a la derecha a pasitos (el caret) y regresa
     al inicio del renglón (retorno de carro). Ráfagas de tecleo con pausas. Cada tanto levanta la vista: relee */
  escribiendo: {
    label: "escribiendo", shape: "escribe", body: { dy: -.05, arm: 18, bob: .55, T: .9 }, blink: [6, 10],
    act: "tecleo_corto", beats: [[1.3, { act: "tecleo" }], [3.0, { act: "tecleo" }]],
    loop: { every: [1.3, 2.4], beats: [[0, { act: "tecleo" }]] },
    gaze: n => {
      if (n % 17 === 16) return { to: [0, -.05], hold: .7 };            // relee: te mira
      return { to: [.3 + .2 * ESCRIBE.frac(), .32], hold: R(.28, .5) };   // v2: mira el caret de lo que escribe (a su derecha)
    },
  },
  /* delegando: lanza el encargo con el brazo, el subagente sale de esa mano y se va a un lado a trabajar.
     El fantasma lo vigila (mira y se inclina hacia él) y de vez en cuando te mira y asiente: «va bien» */
  delegando: {
    label: "delegando", shape: "neutro", act: "encarga", body: { dy: -.05, bob: .8, T: 1.05 }, blink: [3, 5], turnBlink: true, cs: 1.1,
    loop: { every: [4.5, 6.5], beats: [[0, { gaze: [0, -.05], hold: 1 }], [.25, { act: "asiente" }], [1.1, { gaze: [.45, .05], hold: 2 }]] },
    gaze: n => (n % 4 === 3 ? { to: [.15, -.05], hold: R(.6, .9) } : { to: [R(.38, .48), R(-.02, .12)], hold: R(1.4, 2.6) }),
  },
  termino: { ...termino, label: "completado ✓" }, fallo: { ...fallo, label: "error ×" }, fallo2: { ...fallo2, label: "error otra vez" },
};
export const NUEVOS = ["escribiendo", "delegando"];

/* guion: un turno de trabajo completo */
export const SCRIPT = [
  [0, "esperando"], [2, "pensando"], [6, "escribiendo"], [12, "delegando"], [19.5, "termino"], [22.5, "pensando"],
  [25, "escribiendo"], [28.5, "fallo"], [34, "fin"],
];
export const SCRIPT_DUR = 34;
