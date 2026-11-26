// Habla con el orquestador de un proyecto sin abrir su terminal.
// No toca permisos de incorporación ni el merge guard: solo entrega texto.
const KEYS = ['workspaceId', 'text'];
const MAX_TEXT = 8000;

export function validateOrchestratorSend(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Parámetros inválidos');
  for (const key of Object.keys(p)) if (!KEYS.includes(key)) throw new Error(`Clave desconocida: ${key}`);
  if (typeof p.workspaceId !== 'string' || !p.workspaceId) throw new Error('workspaceId inválido');
  if (typeof p.text !== 'string' || p.text.length < 1 || p.text.length > MAX_TEXT) throw new Error(`El texto debe tener entre 1 y ${MAX_TEXT} caracteres`);
  if (/[\x00-\x09\x0b-\x1f\x7f]/.test(p.text)) throw new Error('El texto contiene caracteres de control');
  return { workspaceId: p.workspaceId, text: p.text };
}

export async function deliverToOrchestrator({ store, terminals, chats, invoke }, params) {
  const { workspaceId, text } = validateOrchestratorSend(params);
  const w = store.getWorkspace(workspaceId);
  let node = w.nodes.find(n => n.type === 'terminal' && n.data?.role === 'orchestrator');
  let created = false;
  if (!node) {
    node = await invoke('node.create', { workspaceId, type: 'terminal', title: 'Orquestador', data: { role: 'orchestrator', chat: { provider: 'claude' }, launchState: 'creating' } });
    await invoke('terminal.create', { workspaceId, nodeId: node.id, cols: 120, rows: 32 });
    created = true;
  }
  if (node.data?.chat?.provider) {
    await invoke('chat.send', { workspaceId, nodeId: node.id, text });
    return { workspaceId, nodeId: node.id, mode: 'chat', created };
  }
  const session = terminals.sessions.find(s => s.id === node.data?.sessionId && s.nodeId === node.id && s.workspaceId === workspaceId && s.status === 'running');
  if (!session) throw new Error('La sesión del orquestador no está activa');
  terminals.write(session.id, text + '\r');
  return { workspaceId, nodeId: node.id, mode: 'pty', created };
}
