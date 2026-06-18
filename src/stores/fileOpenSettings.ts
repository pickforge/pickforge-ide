// How clicking a file in the explorer opens it (localStorage). Default: open in
// Neovim in a new terminal pane. Alternatives: the OS default editor, or a
// custom command template where {path} is the (shell-quoted) file path.
import { createSignal } from "solid-js";

export type FileOpenMode = "nvim-pane" | "system" | "custom";

interface FileOpenState {
  mode: FileOpenMode;
  customCommand: string;
}

const KEY = "pickforge.fileOpen";
const DEFAULTS: FileOpenState = { mode: "nvim-pane", customCommand: "code -g {path}" };

function load(): FileOpenState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    const mode: FileOpenMode =
      p.mode === "system" || p.mode === "custom" ? p.mode : "nvim-pane";
    return {
      mode,
      customCommand: typeof p.customCommand === "string" ? p.customCommand : DEFAULTS.customCommand,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

const [state, setState] = createSignal<FileOpenState>(load());
export const fileOpenSettings = state;

function persist(next: FileOpenState) {
  setState(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function setFileOpenMode(mode: FileOpenMode) {
  persist({ ...state(), mode });
}
export function setFileOpenCustom(customCommand: string) {
  persist({ ...state(), customCommand });
}

/** Single-quote a path for a POSIX shell. */
export function shellQuote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

/** The command to type into a new pane for the editor modes (null for system). */
export function editorCommand(path: string): string | null {
  const s = state();
  const quoted = shellQuote(path);
  if (s.mode === "nvim-pane") return `nvim ${quoted}`;
  if (s.mode === "custom") {
    const tpl = s.customCommand.trim() || DEFAULTS.customCommand;
    return tpl.includes("{path}") ? tpl.replaceAll("{path}", quoted) : `${tpl} ${quoted}`;
  }
  return null; // system mode → opened via the OS, not a pane
}
