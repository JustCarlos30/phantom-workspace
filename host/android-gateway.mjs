import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIPv4 } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { mobileInterfaces } from './mobile.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE = /^(?:[0-9a-f-]{36}|[a-zA-Z][\w-]*:[0-9a-f-]{36})$/;
const METHOD = /^[a-zA-Z][\w-]*(?:\.[a-zA-Z][\w-]*)+$/;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.startsWith('--') && !/[\x00-\x1f\x7f]/.test(value);
const inside = (parent, child) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const nodeId = value => text(value) && NODE.test(value) && UUID.test(value.slice(value.lastIndexOf(':') + 1));
const privateIPv4 = value => isIPv4(value) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);

export class AndroidGateway {
  constructor({ hostDataDir, gatewayDataDir, repoPath, nodeBin, spawn: spawnImpl = spawn, execFile: execImpl = execFile, configFile } = {}) {
    check(text(hostDataDir), 'Falta el directorio de datos del host');
    this.hostDataDir = path.resolve(hostDataDir);
    this.gatewayDataDir = path.resolve(gatewayDataDir ?? path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'phantom-mobile-host'));
    this.configFile = path.resolve(configFile ?? path.join(this.hostDataDir, 'android-gateway.json'));
    check(inside(this.hostDataDir, this.configFile), 'La configuración Android debe estar en el directorio del host');
    this.defaultRepo = repoPath ?? process.env.PHANTOM_MOBILE_REPO ?? path.resolve(ROOT, '../phantom-mobile');
    this.nodeBin = nodeBin ?? process.env.PHANTOM_MOBILE_NODE ?? (process.versions.electron ? 'node' : process.execPath);
    check(text(this.nodeBin), 'Binario Node no válido');
    this.spawn = spawnImpl; this.execFile = execImpl;
    this.lastError = null; this.expectedExits = new WeakSet();
  }

  config() {
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      check(saved && typeof saved === 'object' && !Array.isArray(saved) && text(saved.repoPath), 'La configuración debe contener una ruta repoPath válida');
    }
    catch (error) { if (error.code !== 'ENOENT') return { repoPath: this.defaultRepo, repoValid: false, repoError: `No se puede leer la configuración Android: ${error.message}` }; }
    const repoPath = saved?.repoPath ?? this.defaultRepo;
    try {
      check(text(repoPath), 'Ruta de phantom-mobile no válida');
      const resolved = path.resolve(repoPath);
      check(fs.statSync(path.join(resolved, 'host/cli.mjs')).isFile(), 'Falta host/cli.mjs');
      check(JSON.parse(fs.readFileSync(path.join(resolved, 'package.json'), 'utf8')).name === 'phantom-mobile', 'package.json debe tener name "phantom-mobile"');
      return { repoPath: resolved, repoValid: true, repoError: null };
    } catch (error) { return { repoPath, repoValid: false, repoError: `Repositorio phantom-mobile no válido: ${error.message}` }; }
  }

  execute(args) {
    return new Promise((resolve, reject) => {
      this.execFile(this.nodeBin, args, { shell: false, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) reject(new Error(`No se pudo ejecutar el gateway: ${String(stderr || error.message).slice(-4096)}`));
        else resolve(String(stdout));
      });
    });
  }

  async detectNode() {
    try {
      const version = (await this.execute(['--version'])).trim();
      const match = /^v(\d+)\./.exec(version);
      check(match, `Versión de Node no reconocida: ${version}`);
      return { binary: this.nodeBin, version, compatible: Number(match[1]) >= 26, error: Number(match[1]) >= 26 ? null : `El gateway requiere Node >= 26; se detectó ${version}. Configura PHANTOM_MOBILE_NODE con un Node compatible.` };
    } catch (error) { return { binary: this.nodeBin, version: null, compatible: false, error: `No se pudo detectar Node: ${error.message}` }; }
  }

  alive() { return !!this.child && this.child.exitCode == null && this.child.signalCode == null; }

  async command(name, args = []) {
    const repo = this.activeRepo ?? this.config().repoPath;
    try { return JSON.parse(await this.execute([path.join(repo, 'host/cli.mjs'), name, ...args, '--data', this.gatewayDataDir])); }
    catch (error) { this.lastError = error.message; throw error; }
  }

  async status() {
    const config = this.config();
    const node = await this.detectNode();
    let gateway = this.ready ?? {};
    if (this.alive() && this.ready && !this.stopping) {
      try { gateway = await this.command('status'); } catch { /* El error queda visible sin perder los controles de parada. */ }
    }
    const processAlive = this.alive();
    return { ...gateway, ...config, node, hostDataDir: this.hostDataDir, gatewayDataDir: this.gatewayDataDir,
      interfaces: mobileInterfaces(), processAlive, enabled: processAlive && !!this.ready,
      starting: !!this.starting, stopping: !!this.stopping, lastError: this.lastError,
      devices: processAlive ? (gateway.devices ?? []) : [], workspaceId: processAlive ? (gateway.workspaceId ?? null) : null };
  }

  async configure({ repoPath } = {}) {
    check(!this.starting && !this.stopping && !this.alive(), 'Detén el gateway antes de cambiar su repositorio');
    check(text(repoPath), 'Ruta de phantom-mobile no válida');
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.configFile, JSON.stringify({ repoPath: path.resolve(repoPath) }) + '\n', { mode: 0o600 });
    fs.chmodSync(this.configFile, 0o600);
    this.lastError = null;
    return this.status();
  }

  async start({ workspaceId, address, port = 0 } = {}) {
    check(!this.starting && !this.stopping && !this.alive(), 'El gateway ya está activo o cambiando de estado');
    check(text(workspaceId) && UUID.test(workspaceId), 'UUID de proyecto no válido');
    check(typeof address === 'string' && privateIPv4(address) && mobileInterfaces().some(item => item.address === address), 'Elige una interfaz LAN IPv4 privada detectada');
    check(Number.isInteger(port) && (port === 0 || (port >= 1024 && port <= 65535)), 'Puerto no válido (0 o 1024–65535)');
    this.stopRequested = false;
    this.starting = this.launch({ workspaceId, address, port });
    try { return await this.starting; }
    catch (error) { this.lastError = error.message; throw error; }
    finally { this.starting = null; }
  }

  async launch({ workspaceId, address, port }) {
    const config = this.config();
    check(config.repoValid, config.repoError);
    const node = await this.detectNode();
    check(node.compatible, node.error);
    check(!this.stopRequested, 'Arranque cancelado');
    check(!inside(this.hostDataDir, this.gatewayDataDir), 'Los datos del gateway deben estar separados de los del desktop');
    fs.mkdirSync(this.hostDataDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.gatewayDataDir, { recursive: true, mode: 0o700 });
    check(!inside(fs.realpathSync(this.hostDataDir), fs.realpathSync(this.gatewayDataDir)), 'Los datos del gateway deben estar separados de los del desktop');
    fs.chmodSync(this.gatewayDataDir, 0o700);
    this.activeRepo = config.repoPath; this.lastError = null; this.ready = null;
    const args = [path.join(config.repoPath, 'host/cli.mjs'), 'start', '--address', address, '--workspace', workspaceId,
      '--host-data', this.hostDataDir, '--data', this.gatewayDataDir, '--port', String(port)];
    const child = this.spawn(this.nodeBin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let stderr = Buffer.alloc(0);
    child.stderr.on('data', chunk => { stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(-4096); });
    const reason = message => `${message}${stderr.length ? `: ${stderr.toString('utf8')}` : ''}`;
    child.on('error', error => { if (this.child === child) this.lastError = reason(`Error del proceso gateway: ${error.message}`); });
    child.once('close', (code, signal) => {
      if (this.child === child) {
        if (!this.expectedExits.has(child)) this.lastError = reason(`El gateway terminó (código ${code ?? signal ?? 'desconocido'})`);
        this.child = null; this.ready = null;
      }
    });
    try {
      const ready = await new Promise((resolve, reject) => {
        let output = '', settled = false;
        const finish = (error, value) => {
          if (settled) return; settled = true; clearTimeout(timer);
          if (this.child === child) this.cancelStart = null;
          child.stdout.removeListener('data', onData); child.removeListener('error', onError); child.removeListener('close', onClose);
          // Drena stdout también después de recibir la línea de disponibilidad.
          child.stdout.resume();
          error ? reject(error) : resolve(value);
        };
        const onError = error => finish(new Error(reason(`No se pudo iniciar el gateway: ${error.message}`)));
        const onClose = (code, signal) => finish(new Error(reason(`El gateway terminó antes de arrancar (${code ?? signal})`)));
        const onData = chunk => {
          output += chunk.toString();
          if (Buffer.byteLength(output) > 65536) return finish(new Error('Respuesta de arranque del gateway demasiado grande'));
          const end = output.indexOf('\n');
          if (end < 0) return;
          try {
            const value = JSON.parse(output.slice(0, end));
            check(value && typeof value.url === 'string' && new URL(value.url).protocol === 'https:' &&
              text(value.hostId) && text(value.fingerprint) && value.workspaceId === workspaceId, 'Respuesta de arranque del gateway no válida');
            finish(null, value);
          } catch (error) { finish(new Error(reason(`Respuesta de arranque no válida: ${error.message}`))); }
        };
        const timer = setTimeout(() => finish(new Error(reason('El gateway no respondió en 20 segundos'))), 20000);
        this.cancelStart = () => finish(new Error('Arranque del gateway cancelado'));
        child.stdout.on('data', onData); child.once('error', onError); child.once('close', onClose);
      });
      check(this.alive() && !this.stopRequested, 'Arranque del gateway cancelado');
      this.ready = ready;
      return { ...ready, enabled: true };
    } catch (error) {
      this.expectedExits.add(child);
      await this.terminate(child);
      throw error;
    }
  }

  async terminate(child) {
    if (child.exitCode != null || child.signalCode != null) return;
    await new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); child.removeListener('close', done); resolve(); };
      child.once('close', done);
      timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 2000);
      child.kill('SIGTERM');
    });
  }

  async stop() {
    if (this.stopping) return this.stopping;
    this.stopRequested = true;
    this.cancelStart?.();
    if (this.child) { this.expectedExits.add(this.child); if (this.starting) this.child.kill('SIGTERM'); }
    this.stopping = (async () => {
      if (this.starting) await this.starting.catch(() => {});
      const child = this.child;
      if (child && this.alive()) {
        this.expectedExits.add(child);
        try { await this.command('stop'); } catch { /* SIGTERM es el respaldo si falla el CLI. */ }
        await this.terminate(child);
      }
      this.ready = null;
      return { enabled: false };
    })();
    try { return await this.stopping; } finally { this.stopping = null; }
  }

  requireActive() { check(this.alive() && this.ready && !this.stopping, 'Inicia primero el gateway Android'); }
  async pairing() { this.requireActive(); return this.command('pairing'); }
  async bootstrap() { this.requireActive(); return this.command('export-bootstrap'); }

  async approve({ id, nodes = [], allow = [], workspaceRead = false, workspaceAllow = [], acknowledgeAgentAuthority = false } = {}) {
    check(text(id) && UUID.test(id), 'UUID de dispositivo no válido');
    check(Array.isArray(nodes) && nodes.length <= 256 && nodes.every(nodeId), 'Nodos no válidos');
    check(Array.isArray(allow) && allow.length <= 1024, 'Permisos no válidos');
    for (const value of allow) {
      check(text(value), 'Permiso no válido');
      const parts = value.split('=');
      check(parts.length === 2 && nodeId(parts[0]) && METHOD.test(parts[1]) && nodes.includes(parts[0]), 'Cada permiso NODE_ID=METHOD exige su nodo de lectura');
    }
    check(typeof workspaceRead === 'boolean' && typeof acknowledgeAgentAuthority === 'boolean', 'Opciones de permisos no válidas');
    check(Array.isArray(workspaceAllow) && workspaceAllow.length <= 256 && workspaceAllow.every(value => text(value) && METHOD.test(value)), 'Permisos del proyecto no válidos');
    check(!workspaceAllow.length || workspaceRead, 'Los permisos del proyecto exigen lectura del proyecto');
    check(!nodes.some(value => value.startsWith('phantom:')) || acknowledgeAgentAuthority, 'Debes reconocer que el teléfono actuará con la autoridad del agente');
    if (nodes.length && !acknowledgeAgentAuthority) {
      let state;
      try { state = JSON.parse(fs.readFileSync(path.join(this.hostDataDir, 'state.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(`No se pueden comprobar los roles del proyecto: ${error.message}`); }
      const orchestrators = (state?.workspaces ?? []).flatMap(workspace => (workspace.nodes ?? []).filter(node => node.data?.role === 'orchestrator').map(node => node.id));
      check(!nodes.some(value => orchestrators.includes(value)), 'Debes reconocer que el teléfono actuará con la autoridad del agente orquestador');
    }
    this.requireActive();
    const status = await this.command('status');
    const device = status.devices?.find(item => item.id === id);
    check(device && ['pending', 'approved'].includes(device.state), 'Dispositivo no disponible');
    const args = ['--id', id, ...nodes.flatMap(value => ['--node', value]), ...allow.flatMap(value => ['--allow', value]),
      ...(workspaceRead ? ['--workspace-read'] : []), ...workspaceAllow.flatMap(value => ['--workspace-allow', value]),
      ...(acknowledgeAgentAuthority ? ['--acknowledge-agent-authority'] : [])];
    return this.command(device.state === 'pending' ? 'approve' : 'permissions', args);
  }

  async revoke({ id } = {}) {
    check(text(id) && UUID.test(id), 'UUID de dispositivo no válido');
    this.requireActive(); return this.command('revoke', ['--id', id]);
  }
}
