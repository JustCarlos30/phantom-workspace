import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIPv4 } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { mobileInterfaces } from './mobile.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD = /^[a-zA-Z][\w-]*(?:\.[a-zA-Z][\w-]*)+$/;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.startsWith('--') && !/[\x00-\x1f\x7f]/.test(value);
const inside = (parent, child) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const privateIPv4 = value => isIPv4(value) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);

export class AndroidGateway {
  constructor({ hostDataDir, gatewayDataDir, repoPath, nodeBin, spawn: spawnImpl = spawn, execFile: execImpl = execFile, configFile, listWorkspaces } = {}) {
    check(text(hostDataDir), 'Falta el directorio de datos del host');
    this.hostDataDir = path.resolve(hostDataDir);
    this.gatewayDataDir = path.resolve(gatewayDataDir ?? path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'phantom-mobile-host'));
    this.configFile = path.resolve(configFile ?? path.join(this.hostDataDir, 'android-gateway.json'));
    check(inside(this.hostDataDir, this.configFile), 'La configuración Android debe estar en el directorio del host');
    this.defaultRepo = repoPath ?? process.env.PHANTOM_MOBILE_REPO ?? path.resolve(ROOT, '../phantom-mobile');
    this.nodeBin = nodeBin ?? process.env.PHANTOM_MOBILE_NODE ?? (process.versions.electron ? 'node' : process.execPath);
    check(text(this.nodeBin), 'Binario Node no válido');
    this.spawn = spawnImpl; this.execFile = execImpl;
    this.listWorkspaces = listWorkspaces ?? (() => {
      try { return JSON.parse(fs.readFileSync(path.join(this.hostDataDir, 'state.json'), 'utf8')).workspaces ?? []; }
      catch (error) { if (error.code === 'ENOENT') return []; throw new Error(`No se pueden comprobar los proyectos: ${error.message}`); }
    });
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
      devices: processAlive ? (gateway.devices ?? []) : [], workspaceId: null, scope: gateway.scope ?? 'all',
      workspaces: this.listWorkspaces().map(workspace => ({ id: workspace.id, name: workspace.name,
        nodes: (workspace.nodes ?? []).filter(node => node.type === 'terminal' || node.type === 'chat' || node.data?.chat)
          .map(node => ({ id: node.id, title: node.title, type: node.type, role: node.data?.role || null,
            hasChat: node.type === 'chat' || (node.type === 'terminal' && Boolean(node.data?.chat)) })) })) };
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

  async start({ address, port = 0 } = {}) {
    check(!this.starting && !this.stopping && !this.alive(), 'El gateway ya está activo o cambiando de estado');
    check(typeof address === 'string' && privateIPv4(address) && mobileInterfaces().some(item => item.address === address), 'Elige una interfaz LAN IPv4 privada detectada');
    check(Number.isInteger(port) && (port === 0 || (port >= 1024 && port <= 65535)), 'Puerto no válido (0 o 1024–65535)');
    this.stopRequested = false;
    this.starting = this.launch({ address, port });
    try { return await this.starting; }
    catch (error) { this.lastError = error.message; throw error; }
    finally { this.starting = null; }
  }

  async link({ address, port = 0 } = {}) {
    if (!this.alive()) {
      address ??= mobileInterfaces()[0]?.address;
      check(address, 'No se detecta una red LAN. Conecta el equipo a una red local.');
      await this.start({ address, port });
    }
    this.requireActive();
    const pairing = await this.pairing();
    const bootstrap = await this.bootstrap();
    return { bootstrap, pairing, status: await this.status() };
  }

  async launch({ address, port }) {
    const config = this.config();
    check(config.repoValid, config.repoError);
    const node = await this.detectNode();
    check(node.compatible, node.error);
    check(!this.stopRequested, 'Arranque cancelado');
    const help = await this.execute([path.join(config.repoPath, 'host/cli.mjs'), '--help']);
    check(help.includes('--grants'), 'Esta versión de phantom-mobile solo admite un proyecto. Actualiza phantom-mobile para usar el gateway en todo el workspace.');
    check(!this.stopRequested, 'Arranque cancelado');
    check(!inside(this.hostDataDir, this.gatewayDataDir), 'Los datos del gateway deben estar separados de los del desktop');
    fs.mkdirSync(this.hostDataDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.gatewayDataDir, { recursive: true, mode: 0o700 });
    check(!inside(fs.realpathSync(this.hostDataDir), fs.realpathSync(this.gatewayDataDir)), 'Los datos del gateway deben estar separados de los del desktop');
    fs.chmodSync(this.gatewayDataDir, 0o700);
    this.activeRepo = config.repoPath; this.lastError = null; this.ready = null;
    const args = [path.join(config.repoPath, 'host/cli.mjs'), 'start', '--address', address,
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
              text(value.hostId) && text(value.fingerprint) && value.scope === 'all', 'Respuesta de arranque del gateway no válida');
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

  async approve({ id, grants, acknowledgeAgentAuthority = false } = {}) {
    check(text(id) && UUID.test(id), 'UUID de dispositivo no válido');
    check(Array.isArray(grants) && grants.length <= 512, 'Permisos no válidos (máximo 512)');
    check(typeof acknowledgeAgentAuthority === 'boolean', 'Opciones de permisos no válidas');
    const workspaces = this.listWorkspaces(), pairs = new Set();
    for (const grant of grants) {
      check(grant && typeof grant === 'object' && text(grant.workspaceId) && UUID.test(grant.workspaceId), 'UUID de proyecto no válido');
      const workspace = workspaces.find(item => item.id === grant.workspaceId);
      check(workspace, 'Proyecto ajeno o eliminado');
      const main = grant.nodeId === `phantom:${workspace.id}`;
      const node = (workspace.nodes ?? []).find(item => item.id === grant.nodeId);
      check(grant.nodeId === null || (text(grant.nodeId) && (main || node)), 'Nodo ajeno o no válido para este proyecto');
      const key = JSON.stringify([grant.workspaceId, grant.nodeId]);
      check(!pairs.has(key), 'Par proyecto/nodo repetido'); pairs.add(key);
      const read = grant.nodeId === null ? 'workspace.read' : 'read';
      check(Array.isArray(grant.capabilities) && grant.capabilities.length <= 1024 && grant.capabilities.includes(read) &&
        grant.capabilities.every(value => text(value) && (value === read || METHOD.test(value))), 'Cada permiso exige lectura y métodos válidos');
      check(new Set(grant.capabilities).size === grant.capabilities.length, 'Capabilities repetidas');
      check(!(main || node?.data?.role === 'orchestrator') || acknowledgeAgentAuthority === true,
        'Debes reconocer que el teléfono actuará con la autoridad del agente u orquestador');
    }
    this.requireActive();
    const status = await this.command('status');
    const device = status.devices?.find(item => item.id === id);
    check(device && ['pending', 'approved'].includes(device.state), 'Dispositivo no disponible');
    check(device.state !== 'pending' || (typeof device.sas === 'string' && /^\d{6}$/.test(device.sas)), 'Falta el código de verificación del teléfono');
    const args = ['--id', id, '--grants', JSON.stringify(grants),
      ...(acknowledgeAgentAuthority ? ['--acknowledge-agent-authority'] : [])];
    return this.command(device.state === 'pending' ? 'approve' : 'permissions', args);
  }

  async revoke({ id } = {}) {
    check(text(id) && UUID.test(id), 'UUID de dispositivo no válido');
    this.requireActive(); return this.command('revoke', ['--id', id]);
  }
}
