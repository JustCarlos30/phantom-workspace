export { filterVideoInsights, normalizeSearch } from '../../shared/video-log.mjs';

export function videoLogMessage(state) {
  return ({ empty: 'La fuente está vacía. Añade aprendizajes en el archivo y pulsa Actualizar.', 'no-insights': 'No hay aprendizajes reconocidos. Revisa los encabezados de la fuente y pulsa Actualizar.' })[state] || '';
}
