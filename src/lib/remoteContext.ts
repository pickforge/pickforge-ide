import type { RemotePty } from "./pty";
import { workspace } from "../stores/workspace";
import { flagEnabled } from "../stores/flags";

export type CapturedRemotePtys = Partial<Record<string, RemotePty | null>>;
export type PaneSpawnMode = "pending" | "local" | "remote";

export function remotePtyFor(
  projectRoot: string | null | undefined,
): RemotePty | null {
  if (!projectRoot || !flagEnabled("remoteProjects")) return null;
  const project = workspace.projects.find(
    (item) => item.projectRoot === projectRoot,
  );
  if (!project?.remoteHost || !project.remoteRoot) return null;
  return {
    host: project.remoteHost,
    remoteRoot: project.remoteRoot,
    remoteProcessLeases: flagEnabled("remoteProcessLeases"),
  };
}

export function captureRemotePtyForPane(
  panes: CapturedRemotePtys,
  paneId: string,
  remote: RemotePty | null,
): CapturedRemotePtys {
  return { ...panes, [paneId]: remote };
}

export function paneSpawnModeFor(
  panes: CapturedRemotePtys,
  paneId: string,
): PaneSpawnMode {
  const remote = panes[paneId];
  return remote === undefined ? "pending" : remote ? "remote" : "local";
}

export function shouldUseLocalMcp(mode: PaneSpawnMode): boolean {
  return mode === "local";
}

export function canLaunchAgentForMode(mode: PaneSpawnMode): boolean {
  return mode !== "pending";
}

function normalizedLocalPath(path: string): string | null {
  if (!path || path.includes("\0")) return null;
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) return null;
  if (normalized.split("/").some((part) => part === "." || part === "..")) return null;
  return normalized.replace(/\/+$/, "") || "/";
}

function pathSuffix(path: string, root: string): string | null {
  if (path === root) return "";
  if (root === "/") return path.slice(1);
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

function isMeaningfulRemoteRoot(root: string): boolean {
  return root !== "/";
}

export function remotePathFor(
  localPath: string,
  projectRoot: string | null | undefined,
  remoteRoot: string,
): string | null {
  const path = normalizedLocalPath(localPath);
  const localRoot = projectRoot ? normalizedLocalPath(projectRoot) : null;
  const remoteBase = normalizedLocalPath(remoteRoot);
  if (!path || !localRoot || !remoteBase || !remoteRoot.startsWith("/")) return null;

  if (isMeaningfulRemoteRoot(remoteBase) && pathSuffix(path, remoteBase) !== null) {
    return path;
  }

  const suffix = pathSuffix(path, localRoot);
  if (suffix === null) return null;

  return suffix ? `${remoteBase === "/" ? "" : remoteBase}/${suffix}` : remoteBase;
}
