// Read-only wire contract. No defaults that manufacture conventions or adoption.
export const CONVENCIONS_CONTRACT_VERSION = 1;
export const CONVENCION_STATES = { adopted: 'Adoptada', observed: 'Observada', proposed: 'Propuesta', excepted: 'Exceptuada' };
const fail = label => { throw new Error(`Contrato Convencions inválido: ${label}`); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key))) fail('campos');
}
function text(value, label, max = 16000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(label);
}
function date(value) {
  text(value, 'fecha', 40);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) fail('fecha');
  const parsed = Date.parse(value);
  // Date.parse normalizes impossible dates (e.g. February 31) and 24:00.
  // A source timestamp must describe the instant it actually spells out.
  const canonical = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, fraction) => `.${fraction.padEnd(3, '0')}Z`) : value.replace(/Z$/, '.000Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== canonical) fail('fecha');
}
function list(value, validate, max = 1000) {
  if (!Array.isArray(value) || value.length > max) fail('lista');
  for (let index = 0; index < value.length; index++) validate(value[index]);
}
function unique(items, key = 'id') { if (new Set(items.map(item => item[key])).size !== items.length) fail(`duplicado ${key}`); }
function scope(value) {
  object(value, ['kind', 'target']);
  if (!['project', 'path', 'file'].includes(value.kind)) fail('alcance');
  text(value.target, 'destino del alcance', 4096);
}
function source(value) {
  object(value, ['label', 'reference', 'observedAt']); text(value.label, 'fuente', 512); text(value.reference, 'referencia', 4096); date(value.observedAt);
}
function convention(value) {
  object(value, ['id', 'title', 'state', 'scope', 'what', 'when', 'why', 'verification', 'sources', 'exception']);
  text(value.id, 'id', 200); text(value.title, 'título', 512);
  if (!Object.hasOwn(CONVENCION_STATES, value.state)) fail('estado');
  scope(value.scope);
  for (const key of ['what', 'when', 'why', 'verification']) text(value[key], key);
  list(value.sources, source, 100);
  if (value.state === 'observed' && !value.sources.length) fail('observación sin evidencia');
  if (value.state === 'excepted') {
    object(value.exception, ['reason', 'until']); text(value.exception.reason, 'motivo de excepción');
    if (value.exception.until !== null) date(value.exception.until);
  } else if (value.exception !== null) fail('excepción fuera de estado');
}
function decision(value) {
  object(value, ['id', 'title', 'kind', 'reason', 'at', 'scope', 'sources']);
  text(value.id, 'decisión id', 200); text(value.title, 'decisión', 512); text(value.reason, 'motivo'); date(value.at); scope(value.scope); list(value.sources, source, 100);
  if (!['decision', 'adaptation'].includes(value.kind)) fail('tipo de decisión');
}
function check(value) {
  object(value, ['id', 'title', 'status', 'at', 'detail', 'sources']); text(value.id, 'check id', 200); text(value.title, 'check', 512); text(value.detail, 'detalle check');
  if (!['not_run', 'passed', 'failed', 'unavailable'].includes(value.status)) fail('estado check');
  if (value.at !== null) date(value.at);
  list(value.sources, source, 100);
  if (['passed', 'failed'].includes(value.status) && (!value.at || !value.sources.length)) fail('comprobación sin evidencia');
}
export function validateConvencionsSnapshot(input, owner) {
  object(input, ['contractVersion', 'workspaceId', 'repository', 'state', 'available', 'reason', 'observedAt', 'bases', 'project']);
  if (input.contractVersion !== CONVENCIONS_CONTRACT_VERSION) fail('versión');
  if (input.workspaceId !== owner.id || input.repository !== (owner.canonicalPath ?? owner.path)) fail('ownership');
  text(input.workspaceId, 'workspace', 200); text(input.repository, 'repositorio', 4096); date(input.observedAt);
  if (!['disabled', 'unavailable', 'ready'].includes(input.state) || input.available !== (input.state === 'ready')) fail('capacidad');
  if (input.state !== 'ready') {
    text(input.reason, 'motivo');
    if (!Array.isArray(input.bases) || input.bases.length || input.project !== null) fail('datos sin capacidad');
  } else {
    if (input.reason !== null) fail('motivo ready');
    list(input.bases, base => {
      object(base, ['id', 'name', 'versions']); text(base.id, 'base id', 200); text(base.name, 'base', 512);
      list(base.versions, version => {
        object(version, ['version', 'publishedAt', 'description', 'conventions']); text(version.version, 'versión base', 200); date(version.publishedAt); text(version.description, 'descripción');
        list(version.conventions, convention); unique(version.conventions);
      }, 100); unique(base.versions, 'version');
    }, 100); unique(input.bases);
    if (input.project !== null) {
      const project = input.project;
      object(project, ['registration', 'integration', 'conventions', 'decisions', 'checks']);
      object(project.registration, ['registeredAt', 'source']); date(project.registration.registeredAt); text(project.registration.source, 'registro');
      if (project.integration !== null) {
        const pin = project.integration;
        object(pin, ['baseId', 'version', 'profile', 'integratedAt', 'reason']);
        for (const key of ['baseId', 'version', 'profile', 'reason']) text(pin[key], key);
        date(pin.integratedAt);
        if (!input.bases.find(base => base.id === pin.baseId)?.versions.some(version => version.version === pin.version)) fail('base fijada inexistente');
      }
      list(project.conventions, convention); unique(project.conventions);
      if (!project.integration && project.conventions.some(item => ['adopted', 'excepted'].includes(item.state))) fail('obligación sin integración');
      list(project.decisions, decision); unique(project.decisions); list(project.checks, check); unique(project.checks);
    }
  }
  return structuredClone(input);
}
const normalize = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function filterConvencions(items, { query = '', state = 'all', scope: kind = 'all' } = {}) {
  const needle = normalize(query.trim());
  return items.filter(item => (state === 'all' || item.state === state) && (kind === 'all' || item.scope.kind === kind) && (!needle || normalize([item.id, item.title, item.what, item.when, item.why, item.verification, item.scope.target, ...item.sources.map(source => `${source.label} ${source.reference}`), item.exception?.reason || ''].join(' ')).includes(needle)));
}
