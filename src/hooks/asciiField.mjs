export const RAMP = ' .:-=+*#%@';

export const AQUARIUM_PALETTE = ['#26e6ff', '#20efbb', '#ff50d8', '#a777ff', '#ffc34d', '#ff786b', '#b5f54c'];
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

export function creatureColor(hue, density) {
  const hex = AQUARIUM_PALETTE[Math.floor(hue * AQUARIUM_PALETTE.length) % AQUARIUM_PALETTE.length];
  const amount = Math.max(0, Math.min(1, density));
  return `#${[1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * amount * .5).toString(16).padStart(2, '0');
  }).join('')}`;
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

export function createBubbles({ cols, rows, seed }) {
  if (cols <= 0 || rows <= 0) return [];
  const random = seededRandom(seed);
  return Array.from({ length: Math.min(48, Math.max(6, Math.round(cols * rows / 480))) }, () => ({
    x: random() * cols, y: random() * rows,
    speed: .8 + random() * 1.8, phase: random() * Math.PI * 2,
    char: ['o', 'O', '.', '°'][Math.floor(random() * 4)],
  }));
}

export function stepBubbles(bubbles, dt, { cols, rows }) {
  if (cols <= 0 || rows <= 0) return [];
  return bubbles.map(bubble => {
    const phase = bubble.phase + dt;
    return { ...bubble, phase,
      x: wrap(bubble.x + (Math.sin(phase) - Math.sin(bubble.phase)) * .3, cols, 0),
      y: wrap(bubble.y - dt * bubble.speed, rows, 0),
    };
  });
}

export function createPlants({ cols, rows, seed }) {
  if (cols <= 0 || rows <= 0) return [];
  const random = seededRandom(seed);
  return Array.from({ length: Math.min(36, Math.max(2, Math.round(cols / 8))) }, () => ({
    x: random() * cols, height: Math.min(rows, 3 + Math.floor(random() * 7)),
    phase: random() * Math.PI * 2, color: '#52666a',
  }));
}

export function renderPlants(plants, time, { cols, rows }) {
  if (cols <= 0 || rows <= 0) return [];
  return plants.flatMap(plant => Array.from({ length: Math.min(rows, plant.height) }, (_, i) => ({
    x: Math.max(0, Math.min(cols - 1, Math.floor(plant.x + Math.sin(time * .7 + plant.phase + i * .45) * i * .2))),
    y: rows - 1 - i, char: i % 3 === 0 ? 'Y' : i % 2 ? '/' : '|', color: plant.color,
  })));
}

export function createCreatures({ cols, rows, seed }) {
  let state = seed >>> 0;
  const random = () => {
    let n = state += 0x6d2b79f5;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  const count = Math.max(3, Math.min(14, Math.round(cols * rows / 900)));
  return Array.from({ length: count }, (_, i) => ({
    kind: i < 4 ? ['jelly', 'butterfly', 'ghost', 'fish'][i] : ['jelly', 'butterfly', 'ghost', 'fish'][Math.floor(random() * 4)],
    x: random() * cols, y: random() * rows, scale: 6 + random() * 4, dir: random() < .5 ? -1 : 1,
    phase: random() * Math.PI * 2, speed: .6 + random() * .7, hue: random(),
  }));
}

const wrap = (value, size, margin) => ((value + margin) % (size + margin * 2) + size + margin * 2) % (size + margin * 2) - margin;

export function stepCreatures(creatures, dt, { cols, rows }) {
  return creatures.map(creature => {
    const { kind, speed, phase, scale } = creature;
    const nextPhase = phase + dt * speed;
    let dx, dy;
    if (kind === 'jelly') {
      const pulse = .5 + Math.max(0, Math.cos(phase)) * 1.8;
      dx = dt * speed * (.6 + Math.sin(phase) * .3);
      dy = -dt * speed * pulse;
    } else if (kind === 'butterfly') {
      dx = dt * speed + 4 * (Math.sin(nextPhase * 2) - Math.sin(phase * 2));
      dy = dt * .15 + 2 * (Math.sin(nextPhase * 3) - Math.sin(phase * 3));
    } else if (kind === 'fish') {
      dx = dt * speed * 5 * (creature.dir === -1 ? -1 : 1);
      dy = .6 * (Math.sin(nextPhase * 2) - Math.sin(phase * 2));
    } else {
      dx = dt * .35 + 2 * (Math.sin(nextPhase) - Math.sin(phase));
      dy = 1.5 * (Math.sin(nextPhase * .7) - Math.sin(phase * .7));
    }
    return { ...creature, phase: nextPhase, x: wrap(creature.x + dx, cols, scale * 4), y: wrap(creature.y + dy, rows, scale * 4) };
  });
}

function density(kind, x, y, time, phase, speed) {
  const wave = time * speed + phase;
  if (kind === 'jelly') {
    const radius = 1 + .14 * Math.sin(wave);
    const edge = Math.hypot(x / radius, Math.min(0, y) / .85);
    const hem = .08 + .065 * Math.cos(x / radius * 24);
    if (y <= hem && edge <= 1) {
      if (edge > .88 || y > hem - .09) return .98;
      if (Math.hypot(Math.abs(x) - .32, y + .3) < .13) return .9;
      const rib = Math.abs(Math.sin(Math.atan2(x / radius, -y + .08) * 7));
      return rib < .17 ? .8 : .22 + .4 * (1 - edge) + .09 * Math.cos(x * 17 + y * 9);
    }
    if (y > 0 && y < 3.05) {
      if (y < 2.2 && Math.abs(x) < .36 + .12 * Math.sin(y * 9 - wave)) {
        return .3 + .5 * (.5 + .5 * Math.sin(x * 26 + y * 15 - wave));
      }
      for (let i = 0; i < 9; i++) {
        const strand = (i - 4) * .23 + (.08 + y * .04) * Math.sin(y * 4 - wave * 2 + i);
        const distance = Math.abs(x - strand);
        if (distance < .065 - y * .012) return .15 + .7 * (1 - y / 3.1) * (1 - distance * 5);
      }
    }
    return 0;
  }
  if (kind === 'butterfly') {
    const ax = Math.abs(x);
    if (ax < .09 && Math.abs(y) < .85) return .65 + .3 * (.5 + .5 * Math.cos(y * 32));
    if (y < -.65 && y > -1.4 && Math.abs(ax - (.08 + .4 * (-y - .65) ** 1.5)) < .035) return .85;
    const wing = ax / (.22 + .78 * Math.abs(Math.cos(wave * 5)));
    const upper = y < .1;
    const angle = Math.atan2(y - (upper ? -.35 : .4), wing - .2);
    const radius = Math.hypot((wing - .25) / (upper ? 1.25 : .9), (y - (upper ? -.35 : .4)) / (upper ? .85 : .7));
    const boundary = 1 + .13 * Math.cos(angle * (upper ? 3 : 5));
    if (wing < .1 || radius > boundary) return 0;
    const edge = radius / boundary;
    const spot = Math.hypot((wing - (upper ? 1 : .7)) / .19, (y - (upper ? -.55 : .6)) / .2);
    if (spot < 1) return spot < .35 ? .98 : spot < .65 ? .25 : .9;
    if (edge > .86) return .95;
    if (Math.abs(Math.sin(angle * 9 + wing * 2)) < .15) return .8;
    return .2 + .48 * edge + .1 * Math.cos(wing * 14 + y * 8);
  }
  if (kind === 'fish') {
    const tailY = y - .12 * Math.sin(wave * 3) * Math.max(0, -x - .8);
    if (x < -1 && x > -2.05) {
      const spread = (-x - 1) * .8 + .08;
      if (Math.abs(tailY) < spread && Math.abs(tailY) > Math.max(0, (-x - 1.55) * 1.1)) return .35 + .6 * Math.abs(Math.sin(tailY * 14 + x * 6));
    }
    const body = Math.hypot(x / 1.25, y / (.55 * (1 + .2 * x)));
    if (body > 1) {
      if (x > -.65 && x < .45 && Math.abs(y) < .55 + .42 * Math.sin((x + .65) / 1.1 * Math.PI)) return .3 + .55 * Math.abs(Math.sin(x * 22 + y * 7));
      return 0;
    }
    const eye = Math.hypot(x - .8, y + .16);
    if (eye < .17) return eye < .055 ? 1 : eye < .115 ? 0 : .95;
    if (Math.abs(x - (.55 - y * y * .7)) < .045) return .95;
    if (body > .88) return .9;
    return .2 + .48 * (1 - body) + .22 * (.5 + .5 * Math.cos(x * 19 + Math.sin(y * 14)));
  }
  const bottom = .85 + .14 * Math.cos(x * 13 + wave * 2);
  const inside = y < 0 ? Math.hypot(x, y) < 1 : Math.abs(x) < 1 && y < bottom;
  if (!inside) return 0;
  const blink = ((wave % 5) + 5) % 5 > 4.75;
  if (Math.abs(Math.abs(x) - .36) < .16 && Math.abs(y + .25) < (blink ? .025 : .19)) return 0;
  if (Math.abs(x) < .57 && Math.abs(y - (.18 + .35 * (1 - (x / .57) ** 2))) < .09) return 0;
  return Math.abs(x) > .8 || y < -.78 || y > bottom - .16 ? .95 : .5;
}

export function renderFrame(creatures, t, { cols, rows }) {
  const field = new Float32Array(cols * rows);
  const tint = new Uint8Array(cols * rows);
  const shade = new Uint8Array(cols * rows);
  creatures.forEach((creature, index) => {
    const { x, y, scale, kind, phase, speed } = creature;
    for (let row = Math.max(0, Math.floor(y - scale * 2)); row < Math.min(rows, Math.ceil(y + scale * 3.2)); row++) {
      for (let col = Math.max(0, Math.floor(x - scale * 4.3)); col < Math.min(cols, Math.ceil(x + scale * 4.3)); col++) {
        const nx = (col - x) * .5 / scale * (kind === 'fish' && creature.dir === -1 ? -1 : 1);
        const ny = (row - y) / scale;
        const value = density(kind, nx, ny, t, phase, speed);
        const cell = row * cols + col;
        if (value > field[cell]) {
          field[cell] = value; tint[cell] = index + 1;
          let zone;
          if (kind === 'jelly') {
            zone = (ny + .85) / 3.9;
            if (Math.hypot(Math.abs(nx) - .32, ny + .3) < .13) zone = .95;
          } else if (kind === 'butterfly') {
            zone = Math.abs(nx) / (1.6 * (.22 + .78 * Math.abs(Math.cos((t * speed + phase) * 5))));
            if (value > .85) zone = 1 - zone * .3;
          } else if (kind === 'fish') {
            zone = (ny + .6) / 1.2;
            if (value > .85 || nx < -1 || Math.abs(ny) > .5) zone = 1 - zone * .6;
          } else zone = (ny + 1) / 2;
          zone += .018 * Math.sin(ny * 3 - t * .7 - phase);
          shade[cell] = Math.round(Math.max(0, Math.min(1, zone)) * (SHADES - 1));
        }
      }
    }
  });
  const chars = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => RAMP[Math.round(field[row * cols + col] * (RAMP.length - 1))]).join(''));
  return { chars, tint, shade };
}
