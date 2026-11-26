import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { validateAgent, validatePlan } from './agents.mjs';
import { defaultPlugins, validatePluginPreferences, validatePluginPanel } from '../shared/plugins.mjs';
import { validateUsage, recordUsage } from '../shared/project-usage.mjs';
import { validateReference, validateComments } from './references.mjs';
import { prunePhantomControllers } from '../integrations/phantom.mjs';
import { PERMISSION_MODES } from './chat-permissions.mjs';

export const MAX_HISTORY = 256 * 1024;
export const NODE_TYPES = ['terminal','browser','note','tasks','context','git','services','docker','mission','workflows','playwright','playground','plugins','phantom-cards','phantom-skills','video-log','convencions-base','convencions-project','command-center','zone','incorporaciones','skills-catalog','branches','repo','reference'];
export const dataHome = () => path.resolve(process.env.PHANTOM_WORKSPACE_HOME || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'phantom-workspace'));
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function object(value) { assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object'); return value; }
export function text(value, name = 'text', max = 65536) { assert(typeof value === 'string' && value.length <= max, `Invalid ${name}`); return value; }
export function canonicalFolder(value) {
  text(value, 'folder path', 4096); assert(value.trim() && path.isAbsolute(value), 'Folder path must be nonempty and absolute');
  const canonical = fs.realpathSync(value); assert(fs.statSync(canonical).isDirectory(), 'Workspace path is not a folder'); return canonical;
}
export function atomicJSON(filename, value) {
  const tmp = `${filename}.${randomUUID()}.tmp`;
  let fd;
  try { fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(tmp, filename); const dir = fs.openSync(path.dirname(filename), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
  finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const arrays = ['nodes','tasks','contextRefs','missions','workflows','services','attention'];
function insideFolder(root, value) {
  let ancestor = path.resolve(value), suffix = [];
  for (;;) { try { ancestor = fs.realpathSync(ancestor); break; } catch (error) { if (error.code !== 'ENOENT') throw error; suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); } }
  const relative = path.relative(root, path.join(ancestor, ...suffix));
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function validateHistory(input, workspaces) {
  assert(Array.isArray(input) && input.length <= 100, 'Invalid terminal history');
  const ids = new Set(); let total=0;
  for(const s of input) {
    object(s);assert(uuid(s.id) && !ids.has(s.id), 'Invalid terminal session ID');ids.add(s.id);
    assert(workspaces.some(w=>w.id===s.workspaceId), 'Unknown terminal workspace');assert(uuid(s.nodeId),'Invalid terminal node ID');
    assert(['running','lost','exited'].includes(s.status),'Invalid terminal status');
    assert(Number.isInteger(s.cols)&&s.cols>=2&&s.cols<=500&&Number.isInteger(s.rows)&&s.rows>=1&&s.rows<=300,'Invalid terminal dimensions');
    assert(Number.isSafeInteger(s.seq)&&s.seq>=0,'Invalid terminal sequence');text(s.snapshot,'terminal snapshot',MAX_HISTORY);total+=Buffer.byteLength(s.snapshot);assert(total<=8*1024*1024,'Terminal history too large');
  }
  return input;
}
// Incorporaciones: per-project switch, the orchestrator's plan and the integration queue.
export function validateIntegration(value) {
  object(value); assert(typeof value.enabled === 'boolean', 'Invalid integration.enabled');
  if (value.plan !== undefined) text(value.plan, 'integration plan', 4000);
  if (value.checks !== undefined) { text(value.checks, 'integration checks', 1000); assert(!/[\x00\n\r]/.test(value.checks), 'Invalid integration checks'); }
  assert(Array.isArray(value.queue) && value.queue.length <= 500, 'Invalid integration queue');
  for (const item of value.queue) {
    object(item); for (const key of ['id', 'nodeId', 'title', 'branch', 'headOid']) text(item[key], `integration ${key}`, 512);
    assert(['queued', 'merging', 'merged', 'conflict', 'failed', 'rejected', 'withdrawn'].includes(item.status), 'Invalid integration status');
  }
  return value;
}
export function validateSessionDefaults(value) {
  object(value);
  assert(Object.keys(value).every(key => key === 'permissionMode') && Object.hasOwn(value, 'permissionMode') && PERMISSION_MODES.includes(value.permissionMode), 'Invalid sessionDefaults');
  return value;
}
export function validateState(input, { clone = true } = {}) {
  const state = clone ? structuredClone(object(input)) : object(input);
  assert(state.schemaVersion === 1, 'Unsupported schemaVersion'); object(state.settings);
  assert(Array.isArray(state.workspaces) && state.workspaces.length <= 1000, 'Invalid workspaces');
  const ids = new Set(), paths = new Set();
  for (const w of state.workspaces) {
    object(w); assert(uuid(w.id) && !ids.has(w.id), 'Invalid or duplicate workspace ID'); ids.add(w.id);
    text(w.name, 'workspace name', 512); text(w.path, 'workspace path', 4096); text(w.canonicalPath, 'canonical path', 4096);
    assert(path.isAbsolute(w.path) && path.isAbsolute(w.canonicalPath), 'Workspace paths must be absolute');
    // Missing folders remain restorable; existing aliases resolve to one identity.
    let canonical = path.resolve(w.canonicalPath);
    try { canonical = canonicalFolder(w.path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    assert(!paths.has(canonical), 'Duplicate canonical workspace path'); paths.add(canonical); w.canonicalPath = canonical;
    try { validateUsage(w.usage); } catch (e) { assert(false, e.message); }
    w.plugins = validatePluginPreferences(w.plugins);
    if (w.sessionDefaults !== undefined) validateSessionDefaults(w.sessionDefaults);
    if (w.plugins.phantom.config.phantomData) assert(!insideFolder(w.canonicalPath, w.plugins.phantom.config.phantomData), 'Integration state must be outside workspace');
    object(w.camera); for (const key of ['x','y','zoom']) assert(Number.isFinite(w.camera[key]), 'Invalid camera'); assert(w.camera.zoom > 0 && w.camera.zoom <= 10, 'Invalid zoom');
    if (w.spaces !== undefined) {
      // Spaces: named views of one project, each with its own camera. Nodes opt in via data.spaceId.
      assert(Array.isArray(w.spaces) && w.spaces.length <= 50, 'Invalid spaces'); const spaceIds = new Set();
      for (const s of w.spaces) { object(s); assert(uuid(s.id) && !spaceIds.has(s.id), 'Invalid space ID'); spaceIds.add(s.id); text(s.name, 'space name', 80); object(s.camera); for (const key of ['x','y','zoom']) assert(Number.isFinite(s.camera[key]), 'Invalid space camera'); assert(s.camera.zoom > 0 && s.camera.zoom <= 10, 'Invalid space zoom'); }
    }
    for (const key of arrays) {
      assert(Array.isArray(w[key]) && w[key].length <= 10000, `Invalid ${key}`); const seen = new Set();
      for (const item of w[key]) { object(item); assert(uuid(item.id) && !seen.has(item.id), `Invalid ${key} ID`); seen.add(item.id); }
    }
    for (const n of w.nodes) { assert(NODE_TYPES.includes(n.type), 'Invalid node type'); object(n.data); if(n.data.agent !== undefined) validateAgent(n.data.agent); if (n.data.plan !== undefined) { assert(n.type === 'terminal', 'Plan only on terminal nodes'); validatePlan(n.data.plan); } text(n.title, 'node title', 512); for (const k of ['x','y','width','height']) assert(Number.isFinite(n[k]) && Math.abs(n[k]) <= 1e7, 'Invalid node geometry'); assert(n.width > 0 && n.height > 0, 'Invalid node size'); }
    for (const n of w.nodes) validatePluginPanel(n.type, n.data);
    for (const n of w.nodes) if (n.type === 'reference') validateReference(n.data);
    if (w.comments !== undefined) validateComments(w.comments, w.nodes);
    if (w.integration !== undefined) validateIntegration(w.integration);
    for (const n of w.nodes) if (n.data.role !== undefined) assert(n.type === 'terminal' && n.data.role === 'orchestrator', 'Invalid terminal role');
    assert(w.nodes.filter(n => n.data.role === 'orchestrator').length <= 1, 'Only one orchestrator session per project');
    for (const t of w.tasks) { assert(['draft','checklist','phantom'].includes(t.kind) && ['todo','doing','done'].includes(t.status), 'Invalid task'); text(t.title, 'task title', 512);text(t.description,'task description'); assert(Array.isArray(t.refs) && t.refs.length<=1000, 'Invalid refs'); }
    for (const key of ['missions','workflows','attention','contextRefs']) for (const item of w[key]) text(item.title, 'title', 512);
    for (const item of w.missions) {text(item.notes,'mission notes');text(item.nextAction,'next action');assert(Array.isArray(item.refs)&&item.refs.length<=1000,'Invalid mission refs');}
    for (const item of w.contextRefs) {text(item.kind,'context kind',128);if(item.path!==undefined)text(item.path,'context path',4096);}
    for (const item of w.attention) text(item.source,'attention source',512);
    for (const item of w.workflows) {assert(Number.isInteger(item.version) && item.version>=1 && item.version<=1000000 && Array.isArray(item.steps) && item.steps.length<=1000, 'Invalid workflow');text(item.description,'workflow description');}
  }
  assert(state.activeWorkspaceId === null || ids.has(state.activeWorkspaceId), 'Invalid active workspace');
  if(state.terminalHistory!==undefined) validateHistory(state.terminalHistory,state.workspaces);
  assert(Buffer.byteLength(JSON.stringify(state)) <= 16 * 1024 * 1024, 'State too large');
  return state;
}
export const ATTENTION_LIMIT = 300;
export function pushAttention(workspace, item) {
  workspace.attention.push(item);
  if (workspace.attention.length > ATTENTION_LIMIT) workspace.attention.splice(0, workspace.attention.length - ATTENTION_LIMIT);
}
// Pins whose panel is gone (closed by an older version without cleanup) are
// dropped on load so one stale comment cannot make the whole state unreadable.
export function dropOrphanComments(input) {
  for (const w of Array.isArray(input?.workspaces) ? input.workspaces : []) {
    if (!Array.isArray(w?.comments) || !Array.isArray(w.nodes)) continue;
    const ids = new Set(w.nodes.map(n => n?.id));
    w.comments = w.comments.filter(c => c?.nodeId === null || c?.nodeId === undefined || ids.has(c.nodeId));
  }
  return input;
}
export class Store {
  constructor(dir = dataHome()) {
    this.dir = path.resolve(dir); fs.mkdirSync(this.dir, {recursive:true, mode:0o700}); fs.chmodSync(this.dir, 0o700);
    this.filename = path.join(this.dir, 'state.json');
    this.state = fs.existsSync(this.filename) ? validateState(dropOrphanComments(JSON.parse(fs.readFileSync(this.filename, 'utf8')))) : {schemaVersion:1,activeWorkspaceId:null,workspaces:[],settings:{},lastSavedAt:null};
    // A restart cannot establish whether an in-flight delivery reached the chat.
    // Keep the brief and expose uncertainty rather than silently delivering again.
    let interrupted = false;
    for (const w of this.state.workspaces) interrupted = prunePhantomControllers(w, undefined, this.dir) || interrupted;
    for (const w of this.state.workspaces) for (const c of w.comments || []) if (c.handoff?.status === 'sending') {
      c.handoff = { ...c.handoff, status: 'uncertain', error: 'Host reiniciado durante el envío. Revisa el chat de Phantom antes de volver a pedirlo.', updatedAt: new Date().toISOString() }; interrupted = true;
    }
    for (const w of this.state.workspaces) if (w.attention.length > ATTENTION_LIMIT) { w.attention = w.attention.slice(-ATTENTION_LIMIT); interrupted = true; }
    if (interrupted) this.persist();
  }
  // Writes are grouped: persist() marks the state dirty and one atomic write follows within 100 ms.
  persist() {
    this.pending = true;
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; try { this.flush(); } catch (e) { console.error(e.message); } }, 100); this.timer.unref?.(); }
    if (!this.exitHook) { this.exitHook = () => { try { this.flush(); } catch { /* Nothing left to report at exit. */ } }; process.on('exit', this.exitHook); }
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.pending) return;
    this.state.lastSavedAt = new Date().toISOString(); atomicJSON(this.filename, this.state); this.pending = false;
  }
  close() { this.flush(); if (this.exitHook) { process.off('exit', this.exitHook); this.exitHook = undefined; } }
  getWorkspace(id) { const w = this.state.workspaces.find(w => w.id === id); assert(w, 'Workspace not found'); return w; }
  activate(w) { recordUsage(this.state, w); this.state.activeWorkspaceId = w.id; return w; }
  open(folder) {
    const canonicalPath = canonicalFolder(folder);
    let w = this.state.workspaces.find(w => w.canonicalPath === canonicalPath);
    if (!w) { const now = new Date().toISOString(); w = {id:randomUUID(), name:path.basename(canonicalPath) || canonicalPath,path:canonicalPath,canonicalPath,createdAt:now,updatedAt:now,camera:{x:0,y:0,zoom:1}}; for (const key of arrays) w[key] = []; this.state.workspaces.push(w); }
    w.plugins ??= defaultPlugins(); return this.activate(w);
  }
  transaction(fn) { const before = structuredClone(this.state); try { const result = fn(); validateState(this.state, { clone: false }); this.persist(); return result; } catch (e) { this.state = before; throw e; } }
}
