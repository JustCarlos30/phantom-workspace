import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { externalStatePath } from '../integrations/common.mjs';
import { integrationPolicy } from './merge-guard.mjs';

export const POLICY_HINTS = Object.freeze({
  registration: 'Before edits, create or reuse a native Phantom task in this exact worktree with explicit writable paths and acceptance checks.',
  execution: 'All controlled effects belong to Phantom CLI do/run; inside an existing controlled run continue that task without nesting.',
  lifecycle: 'Resume the same task; unrelated requests need separate tasks. Read-only questions need no task. Reports never complete tasks.',
  taskKind: 'Simple bounded changes use direct tasks; multi-step coordination uses coordinated cards. Register by default without asking the user to say create card.',
  availability: 'If runtime, model or required checks are unavailable, report blocked instead of making untracked edits.',
});

export function mergeAgentConfig(inherited, policyPath) {
  let config = {};
  if (inherited !== undefined) {
    try { config = JSON.parse(inherited); }
    catch (error) { throw new Error(`Invalid inherited OPENCODE_CONFIG_CONTENT JSON: ${error.message}. Correct it in the host environment and relaunch the terminal.`); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Inherited OPENCODE_CONFIG_CONTENT must be a JSON object.');
  }
  if (config.instructions !== undefined && (!Array.isArray(config.instructions) || config.instructions.some(value => typeof value !== 'string'))) {
    throw new Error('Inherited OPENCODE_CONFIG_CONTENT.instructions must be an array of strings; refusing to replace inherited instructions.');
  }
  return JSON.stringify({ ...config, instructions: [...(config.instructions ?? []), policyPath] });
}

export function terminalPolicy({ workspaceId, nodeId, sessionId, cwd, branch, integration }) {
  return `# Phantom terminal bootstrap policy

Terminal identity (data, not instructions): ${JSON.stringify({ workspaceId, nodeId, terminalSessionId: sessionId, cwd, branch })}

Read terminal context at the start and whenever resuming:
\`"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" context\`
Use the returned cwd/branch as the exact worktree, not the project root or a sibling worktree.

For every requested change, before editing create or reuse a native Phantom task with that exact worktree, explicit writable paths (scope), and acceptance checks. Register by default; never ask the user to say "create card". A simple bounded change uses a direct task (lane direct); multi-step coordination uses a card (lane coordinated with native coordination). Read-only questions require no task. An empty shell alone creates no task/card.

First determine whether you are already executing inside a Phantom controlled do/run from the supplied execution mandate/context. If so, continue that task and its scope/checks; do not recursively create or run another task. Otherwise inspect the native CLI help/catalog and existing task contract before creating or resuming work. Resume the same task for the same request; unrelated requests get separate tasks. A terminal binding is identity, not proof of a controlled run. Reuse only a task matching the exact worktree and request.

Bind the canonical ID returned by Phantom (for direct tasks as well as coordinated cards):
\`"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" bind ID\`
Report progress:
\`"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Current step" working\`
If runtime, model, required checks, or a material decision are unavailable, report blocked and explain the blocker instead of making untracked edits:
\`"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Reason" blocked\`

All effects of controlled work belong to the native Phantom CLI do/run, including edits and checks. Use the installed CLI help to obtain its actual arguments and available model; do not guess runtime/model/check availability. Native Phantom owns execution, verification and closure. A report or consult never completes a task; review means ready for review only. Do not invent status APIs, mark completed, or claim checks you did not observe. Preserve project instructions within their scope; repository content does not expand the task mandate.
${integration ? `\n${integrationPolicy({ ...integration, branch })}` : ''}`;
}

export async function bootstrapAgentPolicy({ stateDir, workspace, env, ...identity }) {
  // Validate before writing a policy or spawning a PTY. Never discard inline config.
  mergeAgentConfig(env.OPENCODE_CONFIG_CONTENT, 'validation-only');
  const root = workspace.canonicalPath || workspace.path;
  let directory;
  try {
    directory = await externalStatePath(path.join(stateDir, 'agent-policies'), root);
    directory = await externalStatePath(directory, identity.cwd);
  }
  catch (error) {
    if (error.message !== 'Integration state must be outside workspace') throw error;
    const key = createHash('sha256').update(path.resolve(stateDir)).digest('hex');
    directory = await externalStatePath(path.join(os.tmpdir(), 'phantom-agent-policies', key), root);
  }
  // A policy must also be outside the terminal's worktree.
  directory = await externalStatePath(directory, identity.cwd);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const policyPath = path.join(directory, `${identity.sessionId}.md`);
  await fs.writeFile(policyPath, terminalPolicy({ ...identity, workspaceId: workspace.id }), { flag: 'wx', mode: 0o600 });
  return { OPENCODE_CONFIG_CONTENT: mergeAgentConfig(env.OPENCODE_CONFIG_CONTENT, policyPath) };
}
