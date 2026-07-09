import type { RemotePty } from "./pty";
import { workspace } from "../stores/workspace";
import { flagEnabled } from "../stores/flags";

export type CapturedRemotePtys = Partial<Record<string, RemotePty | null>>;

export function remotePtyFor(
  projectRoot: string | null | undefined,
): RemotePty | null {
  if (!projectRoot || !flagEnabled("remoteProjects")) return null;
  const project = workspace.projects.find(
    (item) => item.projectRoot === projectRoot,
  );
  if (!project?.remoteHost || !project.remoteRoot) return null;
  return { host: project.remoteHost, remoteRoot: project.remoteRoot };
}

export function captureRemotePtyForPane(
  panes: CapturedRemotePtys,
  paneId: string,
  remote: RemotePty | null,
): CapturedRemotePtys {
  return { ...panes, [paneId]: remote };
}

function normalizedLocalPath(path: string): string | null {
  if (!path || path.includes("\0")) return null;
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) return null;
  if (normalized.split("/").some((part) => part === "." || part === "..")) return null;
  return normalized.replace(/\/+$/, "") || "/";
}

export function remotePathFor(
  localPath: string,
  projectRoot: string | null | undefined,
  remoteRoot: string,
): string | null {
  const path = normalizedLocalPath(localPath);
  const root = projectRoot ? normalizedLocalPath(projectRoot) : null;
  if (!path || !root || !remoteRoot.startsWith("/") || remoteRoot.includes("\0")) return null;

  const suffix =
    path === root ? "" : root === "/" ? path.slice(1) : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
  if (suffix === null) return null;

  const remoteBase = remoteRoot.replace(/\/+$/, "") || "/";
  return suffix ? `${remoteBase === "/" ? "" : remoteBase}/${suffix}` : remoteBase;
}
