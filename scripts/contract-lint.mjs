import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const isPositiveInteger = value => Number.isInteger(value) && value > 0;
const isNodeTest = check => Array.isArray(check?.argv) && check.argv[0] === 'node' && check.argv.includes('--test');
const commandName = argv => argv.join(' ');

async function defaultRunCheck(argv, { root }) {
  try {
    const result = await execute(argv[0], argv.slice(1), { cwd: root, encoding: 'utf8' });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message };
  }
}

export async function lintContract(contract, { root = process.cwd(), runCheck = defaultRunCheck } = {}) {
  const findings = [];
  const error = message => findings.push({ level: 'error', message });
  const scope = Array.isArray(contract?.scope) ? contract.scope : [];
  const checks = Array.isArray(contract?.checks) ? contract.checks : [];

  if (!Array.isArray(contract?.scope)) error('scope debe ser una lista de archivos exactos');
  if (!scope.length) error('scope no puede estar vacío');
  for (const entry of scope) {
    if (typeof entry !== 'string' || !entry || entry.startsWith('/') || entry.endsWith('/') || entry === '.' || entry.split('/').some(part => part === '.' || part === '..') || /[\r\n\\*?\[\]{}]/.test(entry)) {
      error(`scope debe contener un archivo exacto: ${String(entry)}`);
      continue;
    }
    let ignored;
    try { ignored = await runCheck(['git', 'check-ignore', '--quiet', '--', entry], { root }); }
    catch (cause) { error(`no se pudo comprobar si scope está ignorado: ${entry} (${cause.message})`); continue; }
    if (ignored?.code === 0) error(`scope contiene un archivo ignorado por git: ${entry}`);
    else if (ignored?.code !== 1) error(`no se pudo comprobar si scope está ignorado: ${entry}`);
  }

  for (const check of checks) {
    if (!isNodeTest(check)) continue;
    if (check.minNewPassedTests === undefined && !isPositiveInteger(check.minPassedTests)) error(`check ${check.name || commandName(check.argv)} debe definir minPassedTests positivo`);
    else if (check.minPassedTests !== undefined && !isPositiveInteger(check.minPassedTests)) error(`check ${check.name || commandName(check.argv)} tiene minPassedTests incoherente`);
    const testPaths = check.argv.slice(check.argv.indexOf('--test') + 1).filter(value => typeof value === 'string' && !value.startsWith('-'));
    if (testPaths.some(testPath => scope.includes(testPath)) && !isPositiveInteger(check.minNewPassedTests)) {
      error(`check ${check.name || commandName(check.argv)} debe definir minNewPassedTests positivo para pruebas en scope`);
    } else if (check.minNewPassedTests !== undefined && !isPositiveInteger(check.minNewPassedTests)) {
      error(`check ${check.name || commandName(check.argv)} tiene minNewPassedTests incoherente`);
    }
  }

  if (!Number.isFinite(contract?.budget?.maxTokens) || contract.budget.maxTokens < 60000) error('budget.maxTokens debe ser al menos 60000');
  const checkTimeouts = checks.reduce((total, check) => total + (Number.isFinite(check?.timeoutMs) ? check.timeoutMs : 0), 0);
  if (!Number.isFinite(contract?.budget?.timeoutMs) || contract.budget.timeoutMs <= checkTimeouts) error('budget.timeoutMs debe ser mayor que la suma de timeoutMs de los checks');
  if (contract?.judge && (!Number.isFinite(contract.judge.budget?.maxTokens) || contract.judge.budget.maxTokens < 30000)) error('judge.budget.maxTokens debe ser al menos 30000');

  try {
    const status = await runCheck(['git', 'status', '--porcelain'], { root });
    if (status?.code !== 0) error('no se pudo comprobar que el worktree esté limpio');
    else if (String(status.stdout).trim()) error('el worktree debe estar limpio');
  } catch (cause) { error(`no se pudo comprobar que el worktree esté limpio: ${cause.message}`); }

  return findings;
}

async function main(args) {
  if (args.length !== 1) throw new Error('Uso: node scripts/contract-lint.mjs CONTRATO.json');
  const contract = JSON.parse(await fs.readFile(args[0], 'utf8'));
  const findings = await lintContract(contract, { root: process.cwd() });
  for (const finding of findings) console.error(`${finding.level}: ${finding.message}`);
  if (findings.some(finding => finding.level === 'error')) process.exitCode = 1;
}

if (import.meta.main) main(process.argv.slice(2)).catch(error => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
