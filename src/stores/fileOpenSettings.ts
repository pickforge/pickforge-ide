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

/** A 1-based source location to open a file at (#234's citation-open path).
 *  `column`/`endLine` only matter alongside `line` — a location with no
 *  `line` is treated as absent. */
export interface EditorLocation {
  line?: number;
  column?: number;
  endLine?: number;
}

/** A validated positive integer, or `null` for anything else (including a
 *  non-integer, zero/negative, or non-finite value) — every location field
 *  gets substituted into a shell command string, so this is the one gate
 *  between an untrusted number and command text, independent of whatever
 *  upstream validation already happened in the chat-link classifier. */
function safePosition(n: number | undefined): number | null {
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** The command to type into a new pane for the editor modes (null for system).
 *  `location` is best-effort: Neovim positions the cursor via `+call cursor(...)`
 *  when `line` validates; a custom template substitutes `{line}`/`{column}`/
 *  `{endLine}` (each left as an empty string when absent) and otherwise opens
 *  the file exactly as before — an existing `{path}`-only template still works
 *  unchanged, it just never receives a location. System mode has no portable
 *  location contract and always ignores `location`. */
export function editorCommand(path: string, location?: EditorLocation): string | null {
  const s = state();
  const quoted = shellQuote(path);
  const line = safePosition(location?.line);
  const column = safePosition(location?.column);
  const endLine = safePosition(location?.endLine);

  if (s.mode === "nvim-pane") {
    if (line === null) return `nvim ${quoted}`;
    const cursorCol = column ?? 1;
    return `nvim '+call cursor(${line},${cursorCol})' ${quoted}`;
  }
  if (s.mode === "custom") {
    const tpl = s.customCommand.trim() || DEFAULTS.customCommand;
    const substituted = tpl
      .replaceAll("{path}", quoted)
      .replaceAll("{line}", line === null ? "" : String(line))
      .replaceAll("{column}", column === null ? "" : String(column))
      .replaceAll("{endLine}", endLine === null ? "" : String(endLine));
    return tpl.includes("{path}") ? substituted : `${substituted} ${quoted}`;
  }
  return null; // system mode → opened via the OS, not a pane
}
