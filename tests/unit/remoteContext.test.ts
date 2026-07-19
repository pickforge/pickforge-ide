import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: false,
  leases: false,
  projects: [] as Array<{
    projectRoot: string;
    remoteHost: string | null;
    remoteRoot: string | null;
  }>,
}));

vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (key: string) =>
    key === "remoteProjects" ? state.enabled : state.leases,
}));

vi.mock("../../src/stores/workspace", () => ({
  workspace: {
    get projects() {
      return state.projects;
    },
  },
}));

import {
  canLaunchAgentForMode,
  captureRemotePtyForPane,
  executionRemoteFor,
  paneSpawnModeFor,
  remotePathFor,
  remotePtyFor,
  resolvePtyRemote,
  shouldUseLocalMcp,
} from "../../src/lib/remoteContext";
import { startPtyWithLocalFallback } from "../../src/lib/remoteTerminal";

describe("remotePtyFor", () => {
  beforeEach(() => {
    state.enabled = false;
    state.leases = false;
    state.projects = [];
  });

  it("returns null when remote projects are disabled", () => {
    state.projects = [
      {
        projectRoot: "/app",
        remoteHost: "mac-mini",
        remoteRoot: "/Users/dev/app",
      },
    ];

    expect(remotePtyFor("/app")).toBeNull();
  });

  it("returns null for an unbound project", () => {
    state.enabled = true;
    state.projects = [
      { projectRoot: "/app", remoteHost: null, remoteRoot: null },
    ];

    expect(remotePtyFor("/app")).toBeNull();
  });

  it("returns the bound host and root when remote projects are enabled", () => {
    state.enabled = true;
    state.projects = [
      {
        projectRoot: "/app",
        remoteHost: "mac-mini",
        remoteRoot: "/Users/dev/app",
      },
    ];

    expect(remotePtyFor("/app")).toEqual({
      host: "mac-mini",
      remoteRoot: "/Users/dev/app",
      remoteProcessLeases: false,
    });
  });

  it("captures the enabled lease flag at the remote launch seam", () => {
    state.enabled = true;
    state.leases = true;
    state.projects = [
      {
        projectRoot: "/app",
        remoteHost: "mac-mini",
        remoteRoot: "/Users/dev/app",
      },
    ];

    expect(remotePtyFor("/app")).toEqual({
      host: "mac-mini",
      remoteRoot: "/Users/dev/app",
      remoteProcessLeases: true,
    });
  });

  it("keeps a pane's remote context after its project binding changes", () => {
    state.enabled = true;
    state.projects = [
      {
        projectRoot: "/app",
        remoteHost: "mac-mini",
        remoteRoot: "/Users/dev/app",
      },
    ];
    const panes = captureRemotePtyForPane({}, "pane-1", remotePtyFor("/app"));

    state.projects = [
      {
        projectRoot: "/app",
        remoteHost: "linux-box",
        remoteRoot: "/srv/app",
      },
    ];

    expect(panes["pane-1"]).toEqual({
      host: "mac-mini",
      remoteRoot: "/Users/dev/app",
      remoteProcessLeases: false,
    });
    expect(remotePtyFor("/app")).toEqual({
      host: "linux-box",
      remoteRoot: "/srv/app",
      remoteProcessLeases: false,
    });
  });

  it("uses local MCP context when a remote start resolves through the fallback", async () => {
    const started = await startPtyWithLocalFallback(
      { host: "mac-mini", remoteRoot: "/srv/app", remoteProcessLeases: false },
      async (remote) => {
        if (remote) throw new Error("remote unavailable");
        return 42;
      },
      () => {},
    );
    const panes = captureRemotePtyForPane({}, "pane-1", started.remote);

    expect(shouldUseLocalMcp(paneSpawnModeFor(panes, "pane-1"))).toBe(true);
  });

  it("blocks an agent launch until the primary spawn mode resolves", () => {
    expect(canLaunchAgentForMode(paneSpawnModeFor({}, "pane-1"))).toBe(false);

    const panes = captureRemotePtyForPane({}, "pane-1", {
      host: "mac-mini",
      remoteRoot: "/srv/app",
      remoteProcessLeases: false,
    });
    expect(canLaunchAgentForMode(paneSpawnModeFor(panes, "pane-1"))).toBe(true);
  });

  it("keeps a path already under the remote root", () => {
    expect(remotePathFor("/srv/app/lib/main.dart", "/home/dev/app", "/srv/app/")).toBe(
      "/srv/app/lib/main.dart",
    );
  });

  it("maps an in-project local path into the remote root", () => {
    expect(remotePathFor("/home/dev/app/lib/main.dart", "/home/dev/app", "/srv/app/")).toBe(
      "/srv/app/lib/main.dart",
    );
  });

  it("refuses to map a path outside or ambiguously below the project root", () => {
    expect(remotePathFor("/home/dev/other/main.dart", "/home/dev/app", "/srv/app")).toBeNull();
    expect(remotePathFor("/home/dev/app-copy/main.dart", "/home/dev/app", "/srv/app")).toBeNull();
    expect(remotePathFor("/home/dev/app/../secret.txt", "/home/dev/app", "/srv/app")).toBeNull();
  });

  it("does not treat a filesystem-root binding as an already-remote path", () => {
    expect(remotePathFor("/home/dev/app/lib/main.dart", "/home/dev/app", "/")).toBe(
      "/lib/main.dart",
    );
    expect(remotePathFor("/tmp/other.dart", "/home/dev/app", "/")).toBeNull();
    expect(remotePathFor("/app/other.dart", "/home/dev/app", "/app")).toBe(
      "/app/other.dart",
    );
  });
});

describe("resolvePtyRemote", () => {
  beforeEach(() => {
    state.enabled = false;
    state.leases = false;
    state.projects = [];
  });

  it("looks up the project's live binding when nothing was captured yet", () => {
    state.enabled = true;
    state.projects = [
      { projectRoot: "/app", remoteHost: "mac-mini", remoteRoot: "/srv/app" },
    ];

    expect(resolvePtyRemote(undefined, "/app")).toEqual({
      host: "mac-mini",
      remoteRoot: "/srv/app",
      remoteProcessLeases: false,
    });
  });

  it("keeps an already-captured binding even after the project's binding changes", () => {
    state.enabled = true;
    state.projects = [
      { projectRoot: "/app", remoteHost: "mac-mini", remoteRoot: "/srv/app" },
    ];
    const captured = resolvePtyRemote(undefined, "/app");

    state.projects = [
      { projectRoot: "/app", remoteHost: "linux-box", remoteRoot: "/srv/app2" },
    ];

    expect(resolvePtyRemote(captured, "/app")).toEqual({
      host: "mac-mini",
      remoteRoot: "/srv/app",
      remoteProcessLeases: false,
    });
  });

  it("honors an explicit local override even when the project is remotely bound", () => {
    state.enabled = true;
    state.projects = [
      { projectRoot: "/app", remoteHost: "mac-mini", remoteRoot: "/srv/app" },
    ];

    expect(resolvePtyRemote(null, "/app")).toBeNull();
  });
});

describe("executionRemoteFor", () => {
  it("passes a project-rooted remote through unchanged when the target has no nested cwd", () => {
    const remote = { host: "mac-mini", remoteRoot: "/srv/app", remoteProcessLeases: false };

    expect(executionRemoteFor(remote, undefined)).toEqual(remote);
  });

  it("stays on the SAME remote host, rooted at the target's nested cwd", () => {
    const remote = { host: "mac-mini", remoteRoot: "/srv/repo", remoteProcessLeases: false };

    expect(executionRemoteFor(remote, "/srv/repo/apps/app")).toEqual({
      host: "mac-mini",
      remoteRoot: "/srv/repo/apps/app",
      remoteProcessLeases: false,
    });
  });

  it("never invents a remote binding for a local target", () => {
    expect(executionRemoteFor(null, "/local/apps/app")).toBeNull();
  });
});
