// Fantasma · estados v4: la primera capa de actuación, aprobada con fantasma-mirada-v4 (★ 2026-10-08).
// Vive fuera del núcleo (ghost.js). Una extensión puede importar estos estados, copiarlos y sumar los suyos,
// pero no los cambia aquí: si un estado aprobado necesita otro comportamiento, se propone al dev primero.
//
// shape: forma que sostiene · body: lo que sostiene el cuerpo (BODY) · blink: cada cuánto parpadea (s) · slow: slow blinks
// gaze(n): el siguiente dart y cuánto sostiene · dart: × duración del dart (lentos = sueño) · ptr: sigue al mouse
// act: gesto de cuerpo al entrar (ACT) · beats: escena de una vez · loop: lo que repite mientras dura
// next: [estado, s] vuelve solo · later: [s, forma, body] cambia tras s segundos · cs/ca: tamaño/visibilidad del brillo
// cursorAfter: activa el ojo-cursor al acabar la llamada, sin apagar seguimiento ni recordatorios.
//
// Ojo: los loops usan R() al cargar el módulo (igual que v4). stage.js se importa antes para que en render
// (?render) Math.random ya tenga semilla y el video salga idéntico a v4.
// stage.js omitted: local seeded replay; no DOM.
import { R, pick } from "./motion.js";

/* fallo2 por defecto: triste-cansado (antes enojado). Forma triste, suspiro en vez de berrinche/resoplo, parpadeos lentos y mirada abajo.
   Sin R() al cargar el módulo (no mueve la semilla de los demás); el azar va en gaze(), que corre en el Rig. Va antes de STATES porque STATES.fallo2 lo usa */
export const FALLO2_TRISTE = {
  label: "falló otra vez (triste)", shape: "triste", act: "suspiro", body: { dy: .35, arm: 24, bob: .4, T: 1.2, breath: 1.3, ola: .4 }, blink: [4, 6], blinkKind: "lento",
  beats: [
    [0, { gaze: [0, .3], hold: 1 }], [.9, { blink: "pesado" }], [1.5, { gaze: [-.3, .4], hold: 1.2 }], [3, { gaze: [0, .45], hold: 3 }],
  ],
  loop: { every: [4.5, 6], beats: [[0, { act: "suspiro" }], [.55, { blink: "lento" }], [.7, { gaze: [0, .45], hold: 3 }]] },
  gaze: n => ({ to: n % 2 ? [-.2, .5] : [.05, .45], hold: R(2, 3.5) }),
};

/* ───────── actuación por estado de Laguna (anim-20) ───────── */
export const STATES = {
  esperando: {
    label: "esperando", shape: "neutro", body: {}, cs: 1.25, blink: [2, 4], slow: [10, 16], slowKind: "gato", ptr: true, turnBlink: true,
    gaze: n => ({ to: n % 3 === 2 ? [R(-.15, .15), R(-.05, .1)] : [0, 0], hold: R(1.6, 3.2) }),
  },
  asoma: {   // se asoma o se va: el cuerpo de esperando, mirada fija a la derecha (a la cámara), sin darts; un parpadeo suave al asomarse
    label: "asoma", shape: "neutro", body: {}, cs: 1.25, blink: [6, 9],
    beats: [[.45, { blink: "normal" }]],
    gaze: () => ({ to: [.5, -.05], hold: 9 }),
  },
  leyendo: {
    label: "leyendo", shape: "concentrado", body: { dy: -.1, arm: 10, bob: .6, T: .85 }, blink: [10, 15],
    gaze: n => { const f = n % 3, line = Math.floor(n / 3) % 3; return { to: [-.25 + .25 * f, .1 + .12 * line], hold: R(.24, .34) }; },
  },
  buscando: {
    label: "buscando", shape: "neutro", body: { dy: -.05, arm: 5, bob: .7, T: .8 }, blink: [3, 5],
    gaze: n => ({ to: [(n % 2 ? 1 : -1) * R(.3, .5), R(-.3, .3)], hold: R(.1, .18) }),
  },
  pensando: {
    label: "pensando", shape: "concentrado", body: { dy: -.08, bob: .7 }, blink: [7, 11], turnBlink: true,
    gaze: () => ({ to: pick([[.3, -.4], [-.3, -.4], [.45, -.15], [-.45, -.15], [0, -.45]]), hold: R(.8, 1.5) }),
  },
  termino: {
    label: "terminó ✓", shape: "contento", act: "termino", body: {}, cs: 1.25, blink: [3, 5], next: ["esperando", 1.4],
    gaze: () => ({ to: [0, -.05], hold: 9 }),
  },
  fallo: {
    label: "falló ×", shape: "triste", act: "fallo", body: { dy: .4, arm: 26, bob: .4, T: 1.2, breath: 1.2, ola: .35 }, blink: [5, 8],
    beats: [
      [0, { eye: "sorpresa", eyeFor: .5, ca: [0, 2.6], gaze: [0, -.15], hold: .6 }],    // el take: «¿eh?», mirada en shock
      [.6, { gaze: [0, .35], hold: 1.1 }], [1.15, { blink: "pesado" }],                // se desinfla, parpadeo pesado
      [1.75, { gaze: [-.45, .3], hold: .85 }],                                          // mira a otro lado: culpa
      [2.6, { gaze: [-.05, -.2], hold: 1.6, cs: [1.35, 2.2] }],                         // te vuelve a mirar: puppy eyes, el brillo vuelve grande
      [4.2, { gaze: [0, .45], hold: 3 }],
    ],
    loop: { every: [4.5, 6.5], beats: [[0, { act: "suspiro" }], [.55, { blink: "lento" }], [.7, { gaze: [R(-.2, .2), .45], hold: 3 }]] },
    gaze: n => ({ to: n % 2 ? [-.25, .5] : [0, .5], hold: R(2, 3.5) }),
  },
  fallo2: FALLO2_TRISTE,   // triste-cansado (aprobado 2026-10-16); el enojado queda como FALLO2_ENOJADO
  /* te necesita: ojos atentos (más altos, brillo grande, entran con anticipación). Llama una vez, te busca (sigue al mouse; sin mouse mira al frente y de vez en cuando se asoma),
     recuerda con toques chicos con tope de 3 (anti-Clippy) y al irse reacciona a que llegaste */
  necesita: {
    label: "te necesita", shape: "atento", cursorAfter: 1.3, act: "llamar", cs: 1.3, blink: [3, 5], body: { dy: -.3, arm: -10, bob: .5, T: .75, ola: 1.2 }, ptr: true,
    loop: { every: [4, 6], max: 3, beats: [[0, { act: "toque" }], [.1, { gaze: [0, -.08], hold: 1.6 }]] },
    gaze: n => (n % 3 === 2 ? { to: [(n % 2 ? 1 : -1) * R(.15, .25), -.05], hold: R(.45, .6) } : { to: [0, -.08], hold: R(2.2, 3.4) }),
    exit: { act: "atendido", eye: "contento", eyeFor: .55 },
  },
  idle: {
    label: "idle largo", shape: "somnoliento", body: { dy: .15, arm: 12, bob: .8, T: 1.3, breath: 1.4, ola: .6 }, slow: [2.5, 4], slowKind: "lento", dart: 3,
    gaze: () => ({ to: [R(-.3, .3), R(.05, .3)], hold: R(1.5, 3) }),
    later: [7, "cerrado", { dy: .5, arm: 25, bob: .8, T: 1.7, breath: 1.8, ola: .4 }],
  },
};

/* fallo2 enojado (el de antes de 2026-10-16): berrinche + resoplo. Ya no está en STATES; el lab de animación lo trae con la perilla fallo2 apagada */
export const FALLO2_ENOJADO = {
    label: "falló otra vez", shape: "enojado", act: "berrinche", body: { dy: .2, arm: 20, bob: .5, T: .9 }, blink: [1.5, 3], blinkKind: "rapido",
    beats: [
      [0, { gaze: [0, .1], hold: .3 }], [.12, { blink: "rapido" }], [.3, { gaze: [0, -.12], hold: .6 }],
      [.95, { gaze: [.35, .35], hold: .5 }], [1.45, { gaze: [-.3, .35], hold: .6 }], [2.05, { blink: "rapido" }], [2.3, { blink: "rapido" }],
    ],
    loop: { every: [3, 4.5], beats: [[0, { act: "resoplo" }], [.2, { blink: "rapido" }], [.3, { gaze: [R(-.35, .35), R(.25, .4)], hold: 1.5 }]] },
    gaze: n => ({ to: [(n % 2 ? 1 : -1) * R(.15, .3), R(.2, .4)], hold: R(.5, 1.1) }),
  };

/* guion de 37 s: cada estado una vez */
export const SCRIPT = [
  [0, "esperando"], [2.5, "leyendo"], [7.5, "buscando"], [10.5, "pensando"], [14.5, "termino"], [17.5, "fallo"],
  [21.5, "fallo2"], [25, "necesita"], [28, "idle"], [37, "fin"],
];
export const SCRIPT_DUR = 37;
