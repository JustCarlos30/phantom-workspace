import test from 'node:test';
import assert from 'node:assert/strict';
import { lintContract } from '../scripts/contract-lint.mjs';

const valid = () => ({
  scope: ['scripts/contract-lint.mjs', 'test/contract-lint.test.mjs'],
  checks: [{ name: 'lint', argv: ['node', '--test', 'test/contract-lint.test.mjs'], timeoutMs: 1000, minPassedTests: 1, minNewPassedTests: 6 }],
  budget: { maxTokens: 60000, timeoutMs: 1001 },
});

function runner({ ignored = [], dirty = false } = {}) {
  return async argv => {
    if (argv[1] === 'check-ignore') return { code: ignored.includes(argv.at(-1)) ? 0 : 1 };
    if (argv[1] === 'status') return { code: 0, stdout: dirty ? ' M file.mjs\n' : '' };
    throw new Error(`unexpected command: ${argv.join(' ')}`);
  };
}

test('acepta un contrato consistente sin consultar el repositorio real', async () => {
  assert.deepEqual(await lintContract(valid(), { root: '/fixture', runCheck: runner() }), []);
});

test('rechaza entradas de scope que no son archivos exactos', async () => {
  const contract = valid(); contract.scope = ['docs/', '*.mjs', '/tmp/file'];
  const findings = await lintContract(contract, { runCheck: runner() });
  assert.equal(findings.filter(finding => finding.message.includes('archivo exacto')).length, 3);
});

test('rechaza archivos ignorados en scope', async () => {
  const contract = valid();
  const findings = await lintContract(contract, { runCheck: runner({ ignored: ['scripts/contract-lint.mjs'] }) });
  assert.ok(findings.some(finding => finding.message.includes('ignorado por git')));
});

test('exige umbrales coherentes en node --test que escribe pruebas', async () => {
  const contract = valid(); delete contract.checks[0].minPassedTests; delete contract.checks[0].minNewPassedTests;
  const findings = await lintContract(contract, { runCheck: runner() });
  assert.ok(findings.some(finding => finding.message.includes('minPassedTests')));
  assert.ok(findings.some(finding => finding.message.includes('minNewPassedTests')));
});

test('valida los presupuestos y el juez', async () => {
  const contract = valid(); contract.budget = { maxTokens: 59999, timeoutMs: 1000 }; contract.judge = { budget: { maxTokens: 29999 } };
  const findings = await lintContract(contract, { runCheck: runner() });
  assert.ok(findings.some(finding => finding.message.includes('budget.maxTokens')));
  assert.ok(findings.some(finding => finding.message.includes('suma de timeoutMs')));
  assert.ok(findings.some(finding => finding.message.includes('judge.budget.maxTokens')));
});

test('requiere un worktree limpio', async () => {
  const findings = await lintContract(valid(), { runCheck: runner({ dirty: true }) });
  assert.ok(findings.some(finding => finding.message === 'el worktree debe estar limpio'));
});
