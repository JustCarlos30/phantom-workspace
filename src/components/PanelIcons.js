import { AppWindow, Image, Network, FolderGit2, BookOpen, Braces, Box, CirclePlay, FileText, Flag, Frame, GitBranch, GitMerge, Layers, ListChecks, PanelsTopLeft, Puzzle, Server, SquareTerminal, Waypoints } from 'lucide-react';

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
};
