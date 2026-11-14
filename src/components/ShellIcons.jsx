import React from 'react';
import '../identity.css';

// Own geometry on a 24px grid. Solids use even/odd cutouts, never a second
// colour, so the same silhouette works on every flat active key.
function glyph(name, line, solid) {
  function Icon({ size = 20, variant = 'auto', active = false, className = '', strokeWidth: _strokeWidth, ...props }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props} className={`shell-icon ${className}`} data-icon={name} data-variant={active ? 'solid' : variant}>
      <g className="shell-icon__line" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{line}</g>
      <g className="shell-icon__solid" fill="currentColor" fillRule="evenodd" stroke="none">{solid}</g>
    </svg>;
  }
  Icon.displayName = `${name}Icon`;
  return Icon;
}

export const TerminalIcon = glyph('terminal', <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m7 0h3" /></>, <path d="M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm.3 5 3 3-3 3 1.4 1.4L12.1 12 7.7 7.6ZM13 14v2h5v-2Z" />);
export const ChatIcon = glyph('chat', <path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-6 3V7a3 3 0 0 1 3-3Zm1 5h10M7 13h6" />, <path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-6 3V7a3 3 0 0 1 3-3Zm1 4v2h10V8Zm0 4v2h6v-2Z" />);
export const NoteIcon = glyph('note', <><path d="M5 3h10l5 5v13H5Zm10 0v5h5M8 12h8m-8 4h6" /></>, <path d="M5 3h10l5 5v13H5Zm10 1v4h4ZM8 11v2h8v-2Zm0 4v2h6v-2Z" />);
export const SiteIcon = glyph('site', <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></>, <path d="M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM5 9v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9Z" />);
export const ImageIcon = glyph('image', <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>, <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm.5 5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM5 18h14l-3-5-4 5-4-4Z" />);
export const ZoneIcon = glyph('zone', <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 3v18M3 8h18" /></>, <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 6v10h10V9ZM5 9v10h2V9Zm4-4v2h10V5Z" />);
export const SelectIcon = glyph('select', <path d="m5 3 14 9-7 1-3 7Z" />, <path d="m5 3 14 9-7 1-3 7Z" />);
export const HandIcon = glyph('hand', <path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-2a5 5 0 0 1-4-2L3 12a2 2 0 0 1 3-2l2 2Z" />, <path d="M8 12V5a2 2 0 0 1 3-1.73V11h1V4a2 2 0 0 1 4 0v7h1V7a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-2a5 5 0 0 1-4-2L3 12a2 2 0 0 1 3-2Z" />);
export const CommentIcon = ChatIcon;
export const MinimapIcon = glyph('minimap', <><rect x="3" y="3" width="18" height="18" rx="3" /><rect x="6" y="6" width="7" height="5" rx="1" /><path d="M15 14h3v4h-7v-4Z" /></>, <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 3v5h7V6Zm5 8v4h7v-4Z" />);
export const FitIcon = glyph('fit', <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M8 8h8v8H8Z" />, <path d="M3 3h6v2H5v4H3Zm12 0h6v6h-2V5h-4ZM3 15h2v4h4v2H3Zm16 0h2v6h-6v-2h4ZM8 8h8v8H8Z" />);
export const ActivityIcon = glyph('activity', <><circle cx="12" cy="12" r="9" /><path d="m5 12 4 0 2-5 3 10 2-5h3" /></>, <path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm-2 4-2 4H5v2h4l1.5-3 3 8L17 13h2v-2h-3l-2 3-3-7Z" />);
export const SessionsIcon = TerminalIcon;
export const ResourcesIcon = glyph('resources', <><path d="M3 7h7l2 2h9v10H3ZM3 7V4h7l2 3" /></>, <path d="M3 4h7l3 3h8v12H3Zm3 7v2h12v-2Z" />);
export const MapIcon = glyph('map', <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16" />, <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm5 0v12l2 1V5Zm6 2v12l2-1V6Z" />);
export const PluginsIcon = glyph('plugins', <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" /></>, <path d="M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm-1 2v3h3V6Zm9 0v3h3V6ZM6 15v3h3v-3Zm9 0v3h3v-3Z" />);
export const CommandsIcon = glyph('commands', <path d="M8 8H5a3 3 0 1 1 3-3v14a2 2 0 1 1-2-2h13a2 2 0 1 1-2 2V5a3 3 0 1 1 3 3Zm0 0v9h9V8Z" />, <path d="M5 2a4 4 0 0 1 4 4v1h7V6a4 4 0 1 1 4 4h-2v6h2a3 3 0 1 1-4 3v-1H9v1a3 3 0 1 1-3-3h1v-6H6a4 4 0 1 1-1-8Zm0 2a2 2 0 1 0 1 4h1V6a2 2 0 0 0-2-2Zm15 0a2 2 0 0 0-2 2v2h2a2 2 0 0 0 0-4ZM9 10v6h7v-6ZM6 18a1 1 0 1 0 1 1v-1Zm12 0v1a1 1 0 1 0 1-1Z" />);
export const BookIcon = glyph('book', <path d="M12 5a10 10 0 0 0-9-1v15a10 10 0 0 1 9 1 10 10 0 0 1 9-1V4a10 10 0 0 0-9 1Zm0 0v15" />, <path d="M12 5a10 10 0 0 0-9-1v15a10 10 0 0 1 9 1 10 10 0 0 1 9-1V4a10 10 0 0 0-9 1Zm-1 1v11h2V6Z" />);
export const TasksIcon = glyph('tasks', <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m6 8 1 1 2-2m3 1h6M6 14l1 1 2-2m3 1h6" /></>, <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 4-1 1 2 2 3-3-1-1-2 2Zm6 0v2h6V7Zm-6 6-1 1 2 2 3-3-1-1-2 2Zm6 0v2h6v-2Z" />);
export const FlagIcon = glyph('flag', <path d="M5 21V3h14l-3 5 3 5H5" />, <path d="M4 3h16l-3 5 3 5H6v8H4Z" />);
export const BranchIcon = glyph('branch', <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10m12-10a8 8 0 0 1-8 8H6" /></>, <><circle cx="6" cy="5" r="3" /><circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /><path d="M5 7h2v7h3a7 7 0 0 0 7-7h2a9 9 0 0 1-9 9H7v2H5Z" /></>);
export const NetworkIcon = glyph('network', <><circle cx="12" cy="5" r="3" /><circle cx="5" cy="19" r="3" /><circle cx="19" cy="19" r="3" /><path d="m10 8-4 8m8-8 4 8M8 19h8" /></>, <><circle cx="12" cy="5" r="4" /><circle cx="5" cy="19" r="4" /><circle cx="19" cy="19" r="4" /><path d="m9 7 2 1-4 9-2-1Zm4 1 2-1 4 9-2 1ZM8 18h8v2H8Z" /></>);
export const MergeIcon = glyph('merge', <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7a8 8 0 0 0 8 8h4m0-12v14m-4-10 4-4 4 4" /></>, <><circle cx="6" cy="5" r="3" /><circle cx="18" cy="19" r="3" /><path d="M5 7h2a7 7 0 0 0 7 7h3V6l-2 2-2-2 5-5 5 5-2 2-2-2v11h-2v-1h-3a9 9 0 0 1-9-9Z" /></>);
export const ServerIcon = glyph('server', <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01m4-11h6m-6 11h6" /></>, <path d="M5 3h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 2v3h2V5Zm5 1v1h7V6ZM5 14h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Zm1 2v3h2v-3Zm5 1v1h7v-1Z" />);
export const BoxIcon = glyph('box', <path d="m12 2 9 5v10l-9 5-9-5V7Zm-9 5 9 5 9-5m-9 5v10M7.5 4.5l9 5" />, <path d="m12 2 9 5v10l-9 5-9-5V7Zm-8 5 7 4v8l2 1v-9l7-4-2-1-6 3-6-3Z" />);
export const WorkflowIcon = glyph('workflow', <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h9v9M6 9v9h9" /></>, <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 5h10v10h-2V7H9ZM5 9h2v8h8v2H5Z" /></>);
export const PlayIcon = glyph('play', <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></>, <path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm-2 5v8l6-4Z" />);
export const CodeIcon = glyph('code', <path d="m8 5-5 7 5 7m8-14 5 7-5 7M14 3l-4 18" />, <path d="m7 4 2 2-4 6 4 6-2 2-6-8Zm10 0 6 8-6 8-2-2 4-6-4-6ZM13 3h2l-4 18H9Z" />);
export const PanelsIcon = glyph('panels', <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18M9 9v12" /></>, <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm4 7v9h8a1 1 0 0 0 1-1v-8ZM5 10v8a1 1 0 0 0 1 1h2v-9Z" />);
export const LayersIcon = glyph('layers', <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5" />, <path d="m12 3 10 5-10 5L2 8ZM2 11l10 5 10-5v2l-10 5-10-5Zm0 5 10 5 10-5v2l-10 5-10-5Z" />);

export const SHELL_ICONS = { terminal: TerminalIcon, chat: ChatIcon, note: NoteIcon, site: SiteIcon, browser: SiteIcon, image: ImageIcon, reference: ImageIcon, zone: ZoneIcon, select: SelectIcon, hand: HandIcon, comment: CommentIcon, minimap: MinimapIcon, fit: FitIcon, activity: ActivityIcon, sessions: SessionsIcon, resources: ResourcesIcon, map: MapIcon, plugins: PluginsIcon, commands: CommandsIcon, book: BookIcon, tasks: TasksIcon, mission: FlagIcon, git: BranchIcon, repo: NetworkIcon, incorporaciones: MergeIcon, branches: ResourcesIcon, services: ServerIcon, docker: BoxIcon, workflows: WorkflowIcon, playwright: PlayIcon, playground: CodeIcon, 'command-center': PanelsIcon, 'phantom-cards': LayersIcon, 'phantom-skills': BookIcon, 'video-log': BookIcon, 'convencions-base': BookIcon, 'convencions-project': TasksIcon };

// Explicit variants for consumers that do not use the chrome's ARIA selectors.
export const SHELL_LINE_ICONS = Object.fromEntries(Object.entries(SHELL_ICONS).map(([key, Icon]) => [key, props => <Icon {...props} variant="line" />]));
export const SHELL_SOLID_ICONS = Object.fromEntries(Object.entries(SHELL_ICONS).map(([key, Icon]) => [key, props => <Icon {...props} variant="solid" />]));
