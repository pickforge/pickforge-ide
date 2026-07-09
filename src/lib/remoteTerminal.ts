import type { RemotePty } from "./pty";

export async function startPtyWithLocalFallback<T>(
  remote: RemotePty | null,
  start: (remote: RemotePty | null) => Promise<T>,
  onFallback: (remote: RemotePty) => void,
): Promise<T> {
  try {
    return await start(remote);
  } catch (error) {
    if (!remote) throw error;
    onFallback(remote);
    return start(null);
  }
}

export function deliverPtyExit(
  remote: RemotePty | null,
  code: number | null,
  onNotice: (notice: string) => void,
  onExit: (code: number | null) => void,
): void {
  if (remote && code === 255) {
    onNotice(
      `ssh:${remote.host} exited 255: transport failure or remote exit 255. Open the project's Remote panel and choose Test connection.`,
    );
  }
  onExit(code);
}
