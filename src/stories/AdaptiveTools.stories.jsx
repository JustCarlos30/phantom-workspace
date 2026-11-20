import React from 'react';
import ToolPicker from '../components/ToolPicker';
import { NoteIcon, TerminalIcon } from '../components/ShellIcons';
import { noop } from './fixtures';

const types = [['note', 'Nota', NoteIcon, 'Contexto de texto', 'space'], ['terminal', 'Terminal', TerminalIcon, 'Sesión local', 'space']];
// Fictitious data, only for this story: never read from or written to real storage.
const memory = seed => { const m = new Map(Object.entries(seed)); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const learned = memory({ 'phantom.toolUsage.v1:story': JSON.stringify({ v: 1, paused: false, tools: { terminal: { count: 5, last: 20 }, note: { count: 2, last: 10 } }, hidden: [], stats: { total: 7, fromFrequent: 2, dismissed: 0 } }) });

export default { title: 'Navegación/Herramientas frecuentes' };
export const Vacio = { render: () => <ToolPicker types={types} workspaceId="story-empty" storage={memory({})} onPick={noop} onClose={noop} /> };
export const Aprendido = { render: () => <ToolPicker types={types} workspaceId="story" storage={learned} onPick={noop} onClose={noop} /> };
