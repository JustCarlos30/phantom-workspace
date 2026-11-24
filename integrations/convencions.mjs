import { validateConvencionsSnapshot, CONVENCIONS_CONTRACT_VERSION } from '../shared/convencions.mjs';
import { validatePluginPreferences } from '../shared/plugins.mjs';

// Isolated future MCP connection point. Deliberately no CLI discovery, command,
// filesystem convention storage, or fallback examples. Not renderer-configurable.
export async function readConvencions(workspace, { readSnapshot } = {}) {
  const owner = { id: workspace.id, canonicalPath: workspace.canonicalPath ?? workspace.path };
  const envelope = (state, reason) => ({ contractVersion: CONVENCIONS_CONTRACT_VERSION, workspaceId: owner.id, repository: owner.canonicalPath, state, available: false, reason, observedAt: new Date().toISOString(), bases: [], project: null });
  const enabled = () => validatePluginPreferences(workspace.plugins).convencions.enabled;
  if (!enabled()) return validateConvencionsSnapshot(envelope('disabled', 'Convencions está desactivado en este proyecto.'), owner);
  if (!readSnapshot) return validateConvencionsSnapshot(envelope('unavailable', 'Backend Convencions aún no disponible. Falta conectar las operaciones de lectura por MCP; activar el plugin no conecta el backend ni adopta convenciones.'), owner);
  const result = await readSnapshot({ contractVersion: CONVENCIONS_CONTRACT_VERSION, workspaceId: owner.id, repository: owner.canonicalPath });
  if (workspace.id !== owner.id || (workspace.canonicalPath ?? workspace.path) !== owner.canonicalPath) throw new Error('Convencions: el proyecto cambió durante la lectura');
  if (!enabled()) return validateConvencionsSnapshot(envelope('disabled', 'Convencions se desactivó durante la lectura.'), owner);
  return validateConvencionsSnapshot(result, owner);
}
