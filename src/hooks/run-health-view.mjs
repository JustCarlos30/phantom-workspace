const duration = value => {
  const seconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`;
};

export function runHealthView(value) {
  const health = (Array.isArray(value) ? value : [value]).filter(Boolean);
  const looping = health.some(item => item.looping);
  const stalled = health.some(item => item.stalled);
  const level = looping ? 'alert' : stalled ? 'warn' : 'ok';
  const current = health.map(item => item.current).filter(Boolean).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const empty = !health.length || (!current && !looping && !stalled && health.every(item => !item.phase || item.phase === 'idle'));
  if (empty) return { line: 'Esperando eventos de Phantom', level: 'ok', warning: '' };
  const children = health.reduce((sum, item) => ({ done: sum.done + (item.children?.done || 0), total: sum.total + (item.children?.total || 0) }), { done: 0, total: 0 });
  const idleMs = health.reduce((maximum, item) => Math.max(maximum, Number(item.idleMs) || 0), 0);
  const activity = current ? [current.tool, current.target].filter(Boolean).join(' · ') : health.some(item => item.phase === 'verifying') ? 'Verificando' : 'Trabajando';
  const parts = [activity];
  if (children.total > 0) parts.push(`hijos ${children.done}/${children.total}`);
  if (idleMs > 0) parts.push(`sin actividad ${duration(idleMs)}`);
  const line = parts.join(' · ');
  const warning = looping ? 'Posible bucle de actividad' : stalled ? 'Encargo sin actividad reciente' : '';
  return { line, level, warning };
}
