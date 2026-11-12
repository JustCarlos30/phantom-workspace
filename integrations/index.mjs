import { gitInspect } from './git.mjs';
import { services } from './services.mjs';
import { dockerList, dockerOperation } from './docker.mjs';
import { contextScan, contextRead } from './context.mjs';
import { phantom, shutdownPhantom } from './phantom.mjs';
import { opencodeSessions } from './opencode.mjs';
import { plugins } from './plugins.mjs';
import { skillsCatalog, skillsRead } from './skills.mjs';

export async function shutdownIntegrations() {
  await shutdownPhantom();
  let automation;
  try { automation = await import('./automation.mjs'); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./automation.mjs', import.meta.url).href) return; throw error; }
  await automation.shutdownAutomation?.();
}

export async function handleIntegration(method, payload = {}, context) {
  let result;
  if (method === 'git.inspect') result = await gitInspect(payload, context);
  else if (method === 'opencode.sessions') result = await opencodeSessions(payload, context);
  else if (['services.list', 'services.pin', 'services.remove'].includes(method)) result = await services(method, payload, context);
  else if (method === 'docker.list') result = await dockerList(payload, context);
  else if (['docker.logs', 'docker.action'].includes(method)) result = await dockerOperation(method, payload, context);
  else if (method === 'context.scan') result = await contextScan(payload, context);
  else if (method === 'context.read') result = await contextRead(payload, context);
  else if (method === 'skills.catalog') result = await skillsCatalog(payload, context);
  else if (method === 'skills.read') result = await skillsRead(payload, context);
   else if (['plugins.list', 'plugins.update', 'plugins.status', 'plugins.models'].includes(method)) result = await plugins(method, payload, context);
   else if (['phantom.list', 'phantom.detail', 'phantom.events', 'phantom.controllers', 'phantom.create', 'phantom.update', 'phantom.control'].includes(method)) result = await phantom(method, payload, context);
  else {
    // Automation is supplied by its independent owner; do not hide missing dependencies inside that module.
    let automation;
    try { automation = await import('./automation.mjs'); }
    catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./automation.mjs', import.meta.url).href) return { handled: false }; throw error; }
    return automation.handleAutomation(method, payload, context);
  }
  return { handled: true, result };
}
