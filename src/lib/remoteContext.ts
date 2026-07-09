import type { RemotePty } from "./pty";
import { workspace } from "../stores/workspace";
import { flagEnabled } from "../stores/flags";

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
