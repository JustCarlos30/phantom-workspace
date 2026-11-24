import React, { useState } from 'react';
import Canvas from '../components/Canvas';
import Minimap from '../components/Minimap';
import Spaces from '../components/Spaces';
import ProjectSwitcher from '../components/ProjectSwitcher';
import SidebarPanels from '../components/SidebarPanels';
import RailUsage from '../components/RailUsage';
import '../limits.css';
import ToolPicker from '../components/ToolPicker';
import { CommandPalette } from '../components/CommandPalette';
import { Inspector } from '../components/Inspector';
import ProjectPicker from '../components/ProjectPicker';
import ShortcutSettings from '../components/ShortcutSettings';
import { NoteIcon, TerminalIcon } from '../components/ShellIcons';
import { demo, Panel } from './decorators';
import { workspace, noteNode, noop, done } from './fixtures';

const types = [['note', 'Nota', NoteIcon, 'Contexto de texto', 'space'], ['terminal', 'Terminal', TerminalIcon, 'Sesión local', 'space']];
export default { title: 'Navegación' };
export const Lienzo = { render: () => {
  const [w, setWorkspace] = useState(structuredClone(workspace)), [focused, focus] = useState(null), [selected, select] = useState([]);
  return <Panel><Canvas {...demo} workspace={w} selected={selected} onSelect={select} focused={focused} onFocus={focus} onChange={(id, patch) => setWorkspace(old => ({ ...old, nodes: old.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }))} onCamera={noop} connection={{ status: 'connected' }} onMenu={noop} onCloseTerminal={noop} registerBeforeFlush={() => noop} flush={done} /></Panel>;
} };
export const Minimapa = { render: () => <Panel><Minimap nodes={[noteNode]} camera={{ x: 0, y: 0, zoom: 1 }} size={{ width: 900, height: 600 }} selected={[noteNode.id]} onUpdate={noop} /></Panel> };
export const Proyectos = { render: () => { const projects = [workspace, { ...workspace, id: 'second', name: 'Proyecto con nombre muy largo para comprobar el truncado' }]; const [open, setOpen] = useState(true), [active, setActive] = useState(workspace.id); return <div className="project-rail" style={{ position: 'relative', height: 700 }}><div className="brand rail-head"><ProjectSwitcher projects={projects} active={projects.find(p => p.id === active)} open={open} onOpenChange={setOpen} onSelect={setActive} onOpenFolder={noop} /></div></div>; } };
export const Espacios = { render: () => { const [open, setOpen] = useState(true), [active, setActive] = useState(null); return <div className="project-rail" style={{ position: 'relative', height: 700 }}><div className="brand rail-head"><Spaces spaces={[{ id: 'space-demo', name: 'Investigación' }]} nodes={[noteNode]} active={active} onSelect={setActive} open={open} onOpenChange={setOpen} onCreate={noop} onRename={noop} onRemove={noop} /></div></div>; } };
export const Paneles = { render: () => <SidebarPanels nodes={[noteNode]} types={types} selected={[noteNode.id]} sessions={{}} onJump={noop} onFocus={noop} onSearch={noop} onMap={noop} /> };
export const Herramientas = { render: () => <ToolPicker types={types} onPick={noop} onClose={noop} /> };
export const Comandos = { render: () => <CommandPalette open workspace={workspace} onClose={noop} onAction={noop} /> };
export const InspectorContextual = { render: () => <Inspector {...demo} tab="playground" /> };
export const Selector = { render: () => <ProjectPicker open projects={[workspace, { ...workspace, id: 'second', name: 'Segundo proyecto' }]} active={workspace.id} onClose={noop} onSelect={noop} onOpenFolder={noop} /> };
export const Atajos = { render: () => <ShortcutSettings open bindings={{}} conflicts={[]} onClose={noop} onSetBinding={noop} onReset={noop} /> };

export const Limites = { render: () => <div className="project-rail" style={{ position: "relative", height: 440, justifyContent: "flex-end" }}><RailUsage data={{ providers: [{ id: "claude", label: "Claude", available: true, plan: "Max", windows: [{ label: "Sesión", percent: 42 }, { label: "Semana", percent: 76 }] }] }} loading={false} onRefresh={noop} /></div> };
