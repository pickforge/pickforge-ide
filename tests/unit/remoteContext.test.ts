import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: false,
  projects: [] as Array<{
    projectRoot: string;
    remoteHost: string | null;
    remoteRoot: string | null;
  }>,
}));

vi.mock("../../src/stores/flags", () => ({
  flagEnabled: () => state.enabled,
}));

vi.mock("../../src/stores/workspace", () => ({
  workspace: {
    get projects() {
      return state.projects;
    },
  },
}));

import { remotePtyFor } from "../../src/lib/remoteContext";

describe("remotePtyFor", () => {
  beforeEach(() => {
    state.enabled = false;
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
    });
  });
});
