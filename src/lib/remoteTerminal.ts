import type { RemotePty } from "./pty";

export interface StartedPty<T> {
  remote: RemotePty | null;
  value: T;
}

export interface PtyExit {
  code: number | null;
  notice: string | null;
  preserveBuffer: boolean;
}

export async function startPtyWithLocalFallback<T>(
  remote: RemotePty | null,
  start: (remote: RemotePty | null) => Promise<T>,
  onFallback: (remote: RemotePty) => void,
): Promise<StartedPty<T>> {
  try {
    return { remote, value: await start(remote) };
  } catch (error) {
    if (!remote) throw error;
    onFallback(remote);
    return { remote: null, value: await start(null) };
  }
}

export function remotePtyExit(
  remote: RemotePty | null,
  code: number | null,
): PtyExit {
  if (remote && code === 255) {
    return {
      code,
      notice:
        `ssh:${remote.host} exited 255: transport failure or remote exit 255. Open the project's Remote panel and choose Test connection.`,
      preserveBuffer: true,
    };
  }
  return { code, notice: null, preserveBuffer: false };
}
