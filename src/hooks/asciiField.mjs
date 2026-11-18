export const GLYPHS = "_-~,.'/\\():uvw{}S$%&|!;=+";
export const OCEAN_COLORS = ['#090c12', '#0c1118', '#10171a'];
export const SHADES = 24;
export const CREATURE_SCHEMES = [
  ['#25efff', '#8055ff', '#ff48cc'],
  ['#ffd24a', '#ff754d', '#ff479b'],
  ['#baff48', '#20edba', '#328aff'],
  ['#ff43ce', '#ff883b', '#fff04d'],
  ['#51ffcf', '#329aff', '#b865ff'],
  ['#ff627e', '#e94fff', '#655aff'],
];

export function creatureGradient(creature) {
  const scheme = CREATURE_SCHEMES[((Math.floor(creature.hue * CREATURE_SCHEMES.length) % CREATURE_SCHEMES.length) + CREATURE_SCHEMES.length) % CREATURE_SCHEMES.length];
  return Array.from({ length: SHADES }, (_, i) => {
    const position = i / (SHADES - 1) * (scheme.length - 1);
    const segment = Math.min(scheme.length - 2, Math.floor(position));
    const mix = position - segment;
    return `#${[1, 3, 5].map(offset => {
      const a = (parseInt(scheme[segment].slice(offset, offset + 2), 16) / 255) ** 2.2;
      const b = (parseInt(scheme[segment + 1].slice(offset, offset + 2), 16) / 255) ** 2.2;
      return Math.round((a + (b - a) * mix) ** (1 / 2.2) * 255).toString(16).padStart(2, '0');
    }).join('')}`;
  });
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    let n = state += 0x6d2b79f5;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

export function createCreatures({ cols, rows, seed }) {
  if (cols <= 0 || rows <= 0) return [];
  const random = seededRandom(seed);
  const count = Math.max(4, Math.min(18, Math.round(cols * rows / 700)));
  return Array.from({ length: count }, (_, i) => {
    const scale = 3 + 8 * ((i + random()) / count) ** 2;
    const depth = (scale - 3) / 8;
    const x0 = random() * cols;
    const phase = random() * Math.PI * 2;
    return { kind: 'jelly', x0, x: x0 + scale * .45 * Math.sin(phase * .35),
      y: random() * rows, scale, depth, phase, speed: .8 + random() * .5, hue: random() };
  });
}

const contraction = phase => ((1 + Math.cos(phase)) / 2) ** 4;

export function stepCreatures(creatures, dt, { cols, rows }) {
  if (cols <= 0 || rows <= 0) return [];
  return creatures.map(creature => {
    const { speed, phase, scale, x0 } = creature;
    const nextPhase = phase + dt * speed;
    const velocity = (.65 + (scale - 3) * .55) * (1 + 1.8 * contraction(phase));
    const y = creature.y - dt * velocity;
    return { ...creature, phase: nextPhase,
      x: x0 + scale * .45 * Math.sin(nextPhase * .35),
      y: y < -scale * 4 ? rows + scale * (1 + .5 * (1 + Math.sin(nextPhase))) : y };
  });
}

export function renderFrame(creatures, t, { cols, rows }) {
  cols = Math.max(0, Math.floor(cols));
  rows = Math.max(0, Math.floor(rows));
  const field = Array.from({ length: rows }, () => Array(cols).fill(' '));
  const tint = new Uint8Array(cols * rows);
  const shade = new Uint8Array(cols * rows);
  const level = new Uint8Array(cols * rows);
  if (!cols || !rows) return { chars: field.map(row => row.join('')), tint, shade, level };
  creatures.map((creature, index) => ({ creature, index }))
    .sort((a, b) => a.creature.scale - b.creature.scale)
    .forEach(({ creature, index }) => {
      const { x, y, scale, phase } = creature;
      const pulse = contraction(phase);
      const radius = 1.08 - .28 * pulse;
      const height = .95 + .12 * pulse;
      const put = (nx, ny, char, brightness) => {
        const col = Math.round(x + nx * scale * 2), row = Math.round(y + ny * scale);
        if (col < 0 || col >= cols || row < 0 || row >= rows) return;
        const cell = row * cols + col;
        field[row][col] = char;
        tint[cell] = index + 1;
        shade[cell] = Math.round(Math.max(0, Math.min(1, (ny + height) / (3.2 + height))) * (SHADES - 1));
        level[cell] = brightness;
      };
      const anatomy = creature.hue * Math.PI * 2;
      const strands = 7 + 2 * Math.floor(scale / 3);
      for (let i = 0; i < strands; i++) {
        const root = (i / (strands - 1) * 2 - 1) * radius * .94;
        const length = 2.7 + .85 * (.5 + .5 * Math.sin(i * 2.3 + anatomy));
        const frequency = 2.8 + .5 * Math.sin(i + anatomy);
        for (let ny = .05; ny <= length; ny += .5 / scale) {
          const progress = ny / length;
          const wave = ny * frequency - t * 1.2 - phase + i * .8;
          const amplitude = .025 + ny * .055;
          const nx = root * (1 - .12 * progress) + amplitude * Math.sin(wave);
          const slope = -root * .12 / length + .055 * Math.sin(wave) + amplitude * frequency * Math.cos(wave);
          let char = Math.abs(slope) < .13 ? '|' : slope > 0 ? '\\' : '/';
          if (Math.abs(slope) < .045 && ny > .6) char = Math.sin(wave) > 0 ? ')' : '(';
          if (progress > .65) char = "!;:'."[Math.min(4, Math.floor((progress - .65) / .35 * 5))];
          put(nx, ny, char, Math.max(1, Math.round(7 * (1 - progress))));
        }
      }
      for (let arm = 0; arm < 4; arm++) {
        const length = 1.8 + .5 * (.5 + .5 * Math.sin(arm * 2 + anatomy));
        for (let ny = .1; ny < length; ny += .5 / scale) {
          const progress = ny / length;
          const wave = ny * (8 + Math.sin(arm + anatomy)) - t * .9 - phase + arm * 1.7;
          const curl = (.08 + .035 * Math.sin(ny * 3 + anatomy)) * (1 - .5 * progress);
          const nx = (arm - 1.5) * .19 * (1 + .18 * ny) + curl * Math.sin(wave);
          const fringe = .035 * (1 - progress) * (1 + Math.cos(wave));
          const brightness = Math.max(2, Math.round(7 - 5 * progress));
          put(nx - fringe, ny, progress > .8 ? ';' : '{(S%'[Math.floor(ny * scale + arm) % 4], brightness);
          put(nx + fringe, ny, progress > .8 ? ':' : '})&~'[Math.floor(ny * scale + arm) % 4], brightness);
        }
      }
      for (let row = Math.ceil(y - height * scale); row < y; row++) {
        const ny = (row - y) / scale;
        const v = -ny / height;
        const section = Math.sqrt(Math.max(0, 1 - v * v));
        for (let col = Math.ceil(x - radius * section * scale * 2); col <= Math.floor(x + radius * section * scale * 2); col++) {
          const nx = (col - x) / (scale * 2);
          const u = nx / radius;
          const volume = Math.sqrt(Math.max(0, 1 - u * u - v * v));
          const light = Math.max(0, Math.min(1, .25 + .55 * volume - .22 * u + .18 * v));
          let ribDistance = Infinity;
          for (let rib = -3; rib <= 3; rib++) {
            const meridian = Math.sin(rib * Math.PI / 8 + .025 * Math.sin(v * 5 + anatomy)) * section;
            ribDistance = Math.min(ribDistance, Math.abs(u - meridian) * radius * scale * 2);
          }
          const texture = Math.abs(Math.sin((col - Math.round(x)) * 12.9898 + (row - Math.round(y)) * 78.233 + anatomy));
          const rib = ribDistance < .48;
          if (!rib && texture > .96) continue;
          const brightness = rib ? Math.round(5 + 2 * light) : Math.round(2 + 3 * light);
          const char = rib ? (u < -.1 ? '/' : u > .1 ? '\\' : ':')
            : ".,:;=+"[Math.min(5, Math.floor(light * 4 + texture * 2))];
          put(nx, ny, char, brightness);
        }
      }
      for (let nx = -radius; nx <= radius; nx += .5 / scale) {
        const ny = .025 + .075 * Math.cos(nx / radius * Math.PI * 8 + .2 * Math.sin(anatomy));
        put(nx, ny, 'uvw~'[Math.abs(Math.round(nx * scale * (1 + pulse))) % 4], 9);
      }
      for (let angle = 0; angle <= Math.PI; angle += 1 / (scale * 3)) {
        const nx = -radius * Math.cos(angle), ny = -height * Math.sin(angle);
        let char;
        if (Math.sin(angle) > .96) char = '_-~'[Math.floor(angle * scale) % 3];
        else if (Math.sin(angle) > .78) char = ",.'"[Math.floor(angle * scale) % 3];
        else if (Math.sin(angle) < .35) char = nx < 0 ? '(' : ')';
        else char = nx < 0 ? '/' : '\\';
        put(nx, ny, char, 9);
      }
    });
  return { chars: field.map(row => row.join('')), tint, shade, level };
}
