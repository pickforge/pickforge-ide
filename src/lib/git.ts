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

/** Git work-trees at/beneath the project root (monorepo subfolders). Absolute
 *  paths; `[root]` when the root itself is a repo. */
export const gitDiscoverRepos = (projectRoot: string) =>
  invoke<string[]>("git_discover_repos", { projectRoot });

export interface GraphCommit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  date: string;
  refs: string[];
  subject: string;
}

/** Recent commits across all refs (newest first) for the graph view. */
export const gitLogGraph = (projectRoot: string, limit = 200) =>
  invoke<GraphCommit[]>("git_log_graph", { projectRoot, limit });
