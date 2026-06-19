// Typed client for the git status/diff Tauri commands.
import { invoke } from "@tauri-apps/api/core";

export interface GitFileStatus {
  path: string;
  /** two-letter porcelain code, e.g. " M", "??", "A ", "MM" */
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  files: GitFileStatus[];
}

export const gitStatus = (projectRoot: string) =>
  invoke<GitStatus>("git_status", { projectRoot });

export const gitDiff = (projectRoot: string, path: string, staged: boolean) =>
  invoke<string>("git_diff", { projectRoot, path, staged });
