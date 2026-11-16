export const RAMP = ' .:-=+*#%@';

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
    kind: i < 3 ? ['jelly', 'butterfly', 'ghost'][i] : (() => { const n = random(); return n < .45 ? 'jelly' : n < .8 ? 'butterfly' : 'ghost'; })(),
    x: random() * cols, y: random() * rows, scale: 3 + random() * 2,
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
    const radius = .9 + .1 * Math.sin(wave);
    const ellipse = Math.hypot(x / radius, y / .65);
    if (y <= 0 && ellipse <= 1) return ellipse > .76 ? .95 : .38;
    if (y > 0 && y < 1.9) {
      for (let i = 0; i < 5; i++) {
        const strand = (i - 2) * .32 + .12 * Math.sin(y * 4 - wave * 2 + i);
        if (Math.abs(x - strand) < .065) return .8 * (1 - y / 2.2);
      }
    }
    return 0;
  }
  if (kind === 'butterfly') {
    if (Math.abs(x) < .065 && Math.abs(y) < .8) return .95;
    const width = .12 + .88 * Math.abs(Math.cos(wave * 5));
    const upper = Math.hypot((Math.abs(x) / width - .58) / .62, (y + .38) / .65);
    const lower = Math.hypot((Math.abs(x) / width - .4) / .43, (y - .46) / .43);
    const edge = Math.min(upper, lower);
    return edge < 1 ? edge > .75 ? .9 : .5 : 0;
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
  creatures.forEach((creature, index) => {
    const { x, y, scale, kind, phase, speed } = creature;
    for (let row = Math.max(0, Math.floor(y - scale * 2)); row < Math.min(rows, Math.ceil(y + scale * 2)); row++) {
      for (let col = Math.max(0, Math.floor(x - scale * 3)); col < Math.min(cols, Math.ceil(x + scale * 3)); col++) {
        const value = density(kind, (col - x) * .5 / scale, (row - y) / scale, t, phase, speed);
        const cell = row * cols + col;
        if (value > field[cell]) { field[cell] = value; tint[cell] = index + 1; }
      }
    }
  });
  const chars = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => RAMP[Math.round(field[row * cols + col] * (RAMP.length - 1))]).join(''));
  return { chars, tint };
}
