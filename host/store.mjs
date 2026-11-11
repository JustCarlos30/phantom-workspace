import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { validatePluginSettings } from '../src/plugins/registry.js';

export const MAX_HISTORY = 256 * 1024;
export const NODE_TYPES = ['terminal','browser','note','tasks','context','git','services','docker','mission','workflows','playwright','playground','command-center'];
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
export function validateState(input) {
  const state = structuredClone(object(input));
  assert(state.schemaVersion === 1, 'Unsupported schemaVersion'); object(state.settings);
  assert(Array.isArray(state.workspaces) && state.workspaces.length <= 1000, 'Invalid workspaces');
  const ids = new Set(), paths = new Set();
  for (const w of state.workspaces) {
    object(w); assert(uuid(w.id) && !ids.has(w.id), 'Invalid or duplicate workspace ID'); ids.add(w.id);
    if (w.plugins !== undefined) {
      object(w.plugins);
      for (const [id, settings] of Object.entries(w.plugins)) validatePluginSettings(id, settings);
    }
    text(w.name, 'workspace name', 512); text(w.path, 'workspace path', 4096); text(w.canonicalPath, 'canonical path', 4096);
    assert(path.isAbsolute(w.path) && path.isAbsolute(w.canonicalPath), 'Workspace paths must be absolute');
    // Missing folders remain restorable; existing aliases resolve to one identity.
    let canonical = path.resolve(w.canonicalPath);
    try { canonical = canonicalFolder(w.path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    assert(!paths.has(canonical), 'Duplicate canonical workspace path'); paths.add(canonical); w.canonicalPath = canonical;
    object(w.camera); for (const key of ['x','y','zoom']) assert(Number.isFinite(w.camera[key]), 'Invalid camera'); assert(w.camera.zoom > 0 && w.camera.zoom <= 10, 'Invalid zoom');
    for (const key of arrays) {
      assert(Array.isArray(w[key]) && w[key].length <= 10000, `Invalid ${key}`); const seen = new Set();
      for (const item of w[key]) { object(item); assert(uuid(item.id) && !seen.has(item.id), `Invalid ${key} ID`); seen.add(item.id); }
    }
    for (const n of w.nodes) { assert(NODE_TYPES.includes(n.type), 'Invalid node type'); object(n.data); text(n.title, 'node title', 512); for (const k of ['x','y','width','height']) assert(Number.isFinite(n[k]) && Math.abs(n[k]) <= 1e7, 'Invalid node geometry'); assert(n.width > 0 && n.height > 0, 'Invalid node size'); }
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
export class Store {
  constructor(dir = dataHome()) {
    this.dir = path.resolve(dir); fs.mkdirSync(this.dir, {recursive:true, mode:0o700}); fs.chmodSync(this.dir, 0o700);
    this.filename = path.join(this.dir, 'state.json');
    this.state = fs.existsSync(this.filename) ? validateState(JSON.parse(fs.readFileSync(this.filename, 'utf8'))) : {schemaVersion:1,activeWorkspaceId:null,workspaces:[],settings:{},lastSavedAt:null};
  }
  persist() { this.state.lastSavedAt = new Date().toISOString(); atomicJSON(this.filename, this.state); }
  getWorkspace(id) { const w = this.state.workspaces.find(w => w.id === id); assert(w, 'Workspace not found'); return w; }
  open(folder) {
    const canonicalPath = canonicalFolder(folder);
    let w = this.state.workspaces.find(w => w.canonicalPath === canonicalPath);
    if (!w) { const now = new Date().toISOString(); w = {id:randomUUID(), name:path.basename(canonicalPath) || canonicalPath,path:canonicalPath,canonicalPath,createdAt:now,updatedAt:now,camera:{x:0,y:0,zoom:1}}; for (const key of arrays) w[key] = []; this.state.workspaces.push(w); }
    this.state.activeWorkspaceId = w.id; return w;
  }
  transaction(fn) { const before = structuredClone(this.state); try { const result = fn(); validateState(this.state); this.persist(); return result; } catch (e) { this.state = before; throw e; } }
}
