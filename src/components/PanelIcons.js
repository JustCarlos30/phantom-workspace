import { SiteIcon as AppWindow, ImageIcon as Image, NetworkIcon as Network, ResourcesIcon as FolderGit2, BookIcon as BookOpen, CodeIcon as Braces, BoxIcon as Box, PlayIcon as CirclePlay, NoteIcon as FileText, FlagIcon as Flag, ZoneIcon as Frame, BranchIcon as GitBranch, MergeIcon as GitMerge, LayersIcon as Layers, TasksIcon as ListChecks, PanelsIcon as PanelsTopLeft, PluginsIcon as Puzzle, ServerIcon as Server, TerminalIcon as SquareTerminal, WorkflowIcon as Waypoints } from './ShellIcons.jsx';

// Shared by the launcher, rail, command palette and canvas headers. Each symbol
// names a function; decorative colors and generic AI/robot imagery stay out.
export const PANEL_ICONS = {
  terminal: SquareTerminal,
  browser: AppWindow,
  note: FileText,
  reference: Image,
  zone: Frame,
  mission: Flag,
  tasks: ListChecks,
  context: BookOpen,
  repo: Network,
  git: GitBranch,
  incorporaciones: GitMerge,
  branches: FolderGit2,
  services: Server,
  docker: Box,
  workflows: Waypoints,
  playwright: CirclePlay,
  playground: Braces,
  'command-center': PanelsTopLeft,
  plugins: Puzzle,
  'phantom-cards': Layers,
  'phantom-skills': BookOpen,
  'video-log': BookOpen,
  'convencions-base': BookOpen,
  'convencions-project': ListChecks,
};
