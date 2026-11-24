// Siguiente sesión que necesita atención, en el orden de rows y de forma cíclica.
// rows: buildSessionRows(...).rows. Sin currentId válido empieza por la primera fila.
export function nextAttentionId(rows, currentId) {
  if (!Array.isArray(rows)) return null;
  const start = rows.findIndex(row => row?.id === currentId);
  for (let step = 1; step <= rows.length; step++) {
    const row = rows[(start + step) % rows.length];
    if (row?.needsYou === true) return row.id;
  }
  return null;
}
