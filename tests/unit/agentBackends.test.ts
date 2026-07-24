import { beforeEach, describe, expect, it, vi } from "vitest";

const rollout = vi.hoisted(() => ({ ompAgents: false }));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (key: string) => key === "ompAgents" && rollout.ompAgents,
}));

beforeEach(() => {
  rollout.ompAgents = false;
});


async function loadBackends() {
  vi.resetModules();
  const backends = await import("../../src/lib/agentBackends");
  return { backends };
}


describe("agent backend capability registry", () => {
  it("is exhaustive and deeply immutable", async () => {
    const { backends } = await loadBackends();

    expect(Object.keys(backends.AGENT_BACKENDS)).toEqual(["claudeCode", "codex", "omp", "pi"]);
    expect(Object.isFrozen(backends.AGENT_BACKENDS)).toBe(true);
    expect(Object.isFrozen(backends.AGENT_BACKEND_CAPABILITY_KEYS)).toBe(true);
    expect(Object.isFrozen(backends.NATIVE_AGENT_BACKENDS)).toBe(true);
    for (const descriptor of Object.values(backends.AGENT_BACKENDS)) {
      expect(Object.keys(descriptor.capabilities)).toEqual(backends.AGENT_BACKEND_CAPABILITY_KEYS);
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.protocol)).toBe(true);
      expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
      expect(Object.isFrozen(descriptor.lifecycle)).toBe(true);
      expect(Object.isFrozen(descriptor.lifecycle.start)).toBe(true);
      expect(Object.isFrozen(descriptor.lifecycle.close)).toBe(true);
      expect(Object.isFrozen(descriptor.lifecycle.resume)).toBe(true);
      expect(Object.isFrozen(descriptor.controls)).toBe(true);
      expect(Object.isFrozen(descriptor.controls.model)).toBe(true);
      expect(Object.isFrozen(descriptor.nativePayload)).toBe(true);
      for (const capability of Object.values(descriptor.capabilities)) {
        expect(Object.isFrozen(capability)).toBe(true);
        expect(Object.isFrozen(capability.surfaces)).toBe(true);
        expect(Object.isFrozen(capability.engines)).toBe(true);
      }
    }
  });


  it("characterizes shared Claude and Codex native-chat parity", async () => {
    const { backends } = await loadBackends();
    const shared = [
      "nativeChat",
      "startSession",
      "streamEvents",
      "sessionEvents",
      "interruptTurn",
      "closeSession",
      "resumeSession",
      "textInput",
      "modelSelection",
      "modelSwitching",
      "effortSelection",
      "modeSelection",
      "modeSwitching",
      "planEvents",
      "toolEvents",
      "fileEvents",
      "usageReporting",
      "contextReporting",
      "errorEvents",
      "processCleanup",
    ] as const;

    for (const capability of shared) {
      expect(backends.supportsBackendCapability("claudeCode", capability)).toBe(true);
      expect(backends.supportsBackendCapability("codex", capability)).toBe(true);
    }
    for (const capability of ["imageInput", "approvalEvents"] as const) {
      expect(backends.supportsBackendCapability("claudeCode", capability, "nativeChat", "v1"))
        .toBe(false);
      expect(backends.supportsBackendCapability("codex", capability, "nativeChat", "v1"))
        .toBe(false);
      expect(backends.supportsBackendCapability("claudeCode", capability, "nativeChat", "v2"))
        .toBe(true);
      expect(backends.supportsBackendCapability("codex", capability, "nativeChat", "v2"))
        .toBe(true);
    }
    expect(backends.supportsBackendCapability("claudeCode", "effortSwitching")).toBe(false);
    expect(backends.backendCapabilityReason("claudeCode", "effortSwitching"))
      .toContain("new session");
    expect(backends.supportsBackendCapability("codex", "effortSwitching")).toBe(true);
  });

  it("limits native remote execution to v1 and agrees with lifecycle metadata", async () => {
    const { backends } = await loadBackends();

    for (const id of ["claudeCode", "codex"] as const) {
      expect(backends.supportsBackendCapability(id, "remoteExecution", "nativeChat", "v1"))
        .toBe(true);
      expect(backends.supportsBackendCapability(id, "remoteExecution", "nativeChat", "v2"))
        .toBe(false);
      expect(backends.backendCapabilityReason(id, "remoteExecution", "nativeChat", "v2"))
        .toContain("v1 agent engine");
    }

    for (const descriptor of Object.values(backends.AGENT_BACKENDS)) {
      for (const engine of ["v1", "v2"] as const) {
        const expected =
          descriptor.lifecycle.remote === "v1SshProcess" && engine === "v1";
        expect(
          backends.supportsBackendCapability(
            descriptor.id,
            "remoteExecution",
            "nativeChat",
            engine,
          ),
        ).toBe(expected);
      }
    }
  });

  it("keeps provider-specific control and payload semantics explicit", async () => {
    const { backends } = await loadBackends();
    const claude = backends.AGENT_BACKENDS.claudeCode;
    const codex = backends.AGENT_BACKENDS.codex;

    expect(claude.lifecycle).toEqual({
      start: { v1: "oneShotProcess", v2: "residentBridgeChat" },
      close: { v1: "killActiveProcess", v2: "closeBridgeChat" },
      resume: { v1: "providerSessionId", v2: "providerSessionId" },
      remote: "v1SshProcess",
    });
    expect(codex.lifecycle).toEqual({
      start: { v1: "oneShotProcess", v2: "appServerThread" },
      close: { v1: "killActiveProcess", v2: "unsubscribeThread" },
      resume: { v1: "providerSessionId", v2: "providerSessionId" },
      remote: "v1SshProcess",
    });
    expect(claude.controls).toEqual({
      model: { v1: "nextTurn", v2: "liveSession" },
      effort: { v1: "newSession", v2: "newSession" },
      mode: { v1: "nextTurn", v2: "liveSession" },
    });
    expect(codex.controls).toEqual({
      model: { v1: "nextTurn", v2: "perTurnPayload" },
      effort: { v1: "perTurnPayload", v2: "perTurnPayload" },
      mode: { v1: "nextTurn", v2: "perTurnPayload" },
    });
    expect(claude.nativePayload).toEqual({
      model: "sessionState",
      effort: "sessionState",
      mode: "sessionState",
    });
    expect(codex.nativePayload).toEqual({
      model: "turn",
      effort: "turn",
      mode: "sessionState",
    });
  });

  it("drives steering visibility and exposes the unavailable reason", async () => {
    const { backends } = await loadBackends();

    expect(backends.supportsBackendCapability("codex", "steerTurn", "nativeChat", "v2"))
      .toBe(true);
    expect(backends.backendCapabilityReason("codex", "steerTurn", "nativeChat", "v2"))
      .toBeNull();
    expect(backends.supportsBackendCapability("codex", "steerTurn", "nativeChat", "v1"))
      .toBe(false);
    expect(backends.backendCapabilityReason("codex", "steerTurn", "nativeChat", "v1"))
      .toContain("v2 agent engine");
    expect(backends.supportsBackendCapability("claudeCode", "steerTurn", "nativeChat", "v2"))
      .toBe(false);
    expect(backends.backendCapabilityReason("claudeCode", "steerTurn", "nativeChat", "v2"))
      .toContain("Agent SDK");
  });

  it("gates OMP while keeping Pi native unconditionally", async () => {
    const { backends } = await loadBackends();

    expect(backends.normalizeAgentProvider("claude")).toBe("claudeCode");
    expect(backends.normalizeAgentProvider("claudeCode")).toBe("claudeCode");
    expect(backends.normalizeAgentProvider("codex")).toBe("codex");
    expect(backends.normalizeAgentProvider("omp")).toBe("omp");
    expect(backends.normalizeAgentProvider("pi")).toBe("pi");
    expect(backends.isNativeAgentProvider("omp")).toBe(false);
    expect(backends.isNativeAgentProvider("pi")).toBe(true);

    rollout.ompAgents = true;
    expect(backends.isNativeAgentProvider("omp")).toBe(true);
    expect(backends.isNativeAgentProvider("pi")).toBe(true);
    expect(backends.NATIVE_AGENT_BACKENDS.map(({ id }) => id)).toEqual(["claudeCode", "codex"]);
  });

  it("registers only fixture-proven OMP ACP v2 capabilities", async () => {
    const { backends } = await loadBackends();
    const omp = backends.AGENT_BACKENDS.omp;

    expect(omp.backendKind).toBe("ompAcp");
    expect(omp.protocol).toEqual({ kind: "acp", availability: "integrated" });
    expect(omp.lifecycle).toEqual({
      start: { v1: "unsupported", v2: "acpSession" },
      close: { v1: "unsupported", v2: "closeAcpSession" },
      resume: { v1: "unsupported", v2: "providerSessionId" },
      remote: "unknown",
    });
    for (const capability of [
      "nativeChat",
      "startSession",
      "streamEvents",
      "sessionEvents",
      "interruptTurn",
      "closeSession",
      "resumeSession",
      "textInput",
      "imageInput",
      "modelSelection",
      "modelSwitching",
      "planEvents",
      "toolEvents",
      "fileEvents",
      "approvalEvents",
      "mcpConfiguration",
      "usageReporting",
      "contextReporting",
      "titleEvents",
      "errorEvents",
      "processCleanup",
    ] as const) {
      expect(backends.supportsBackendCapability("omp", capability, "nativeChat", "v2")).toBe(true);
      expect(backends.supportsBackendCapability("omp", capability, "nativeChat", "v1")).toBe(false);
    }
    for (const capability of [
      "steerTurn",
      "effortSelection",
      "effortSwitching",
      "modeSelection",
      "modeSwitching",
      "rateLimitReporting",
      "authDiscovery",
      "remoteExecution",
    ] as const) {
      expect(backends.supportsBackendCapability("omp", capability, "nativeChat", "v2")).toBe(false);
      expect(backends.backendCapabilityReason("omp", capability, "nativeChat", "v2")).toBeTruthy();
    }
    expect(omp.nativePayload).toEqual({
      model: "sessionState",
      effort: "unsupported",
      mode: "unsupported",
    });
  });

  it("registers version-gated Pi RPC with honest unsupported capabilities", async () => {
    const { backends } = await loadBackends();
    const pi = backends.AGENT_BACKENDS.pi;

    expect(pi.protocol).toEqual({ kind: "rpc", availability: "integrated" });
    expect(backends.supportsBackendCapability("pi", "nativeChat", "nativeChat", "v1"))
      .toBe(false);
    expect(backends.supportsBackendCapability("pi", "nativeChat", "nativeChat", "v2"))
      .toBe(true);
    expect(backends.supportsBackendCapability("pi", "steerTurn")).toBe(true);
    expect(backends.supportsBackendCapability("pi", "approvalEvents")).toBe(false);
    expect(backends.backendCapabilityReason("pi", "approvalEvents")).toContain("no native approval");
    expect(backends.supportsBackendCapability("pi", "mcpConfiguration")).toBe(false);
    expect(backends.backendCapabilityReason("pi", "mcpConfiguration"))
      .toContain("load the user's installed extensions and tools");
    for (const capability of [
      "imageInput",
      "effortSelection",
      "effortSwitching",
      "titleEvents",
      "remoteExecution",
    ] as const) {
      expect(backends.supportsBackendCapability("pi", capability)).toBe(false);
      expect(backends.backendCapabilityReason("pi", capability)).not.toBeNull();
    }
    expect(pi.controls.effort).toEqual({
      v1: "unsupported",
      v2: "unsupported",
    });
    expect(pi.nativePayload.effort).toBe("unsupported");
    expect(pi.lifecycle).toEqual({
      start: { v1: "unsupported", v2: "residentRpc" },
      close: { v1: "unsupported", v2: "closeRpcProcess" },
      resume: { v1: "unsupported", v2: "providerSessionId" },
      remote: "unknown",
    });

    expect(backends.selectableNativeAgentBackends("0.79.9").map((item) => item.id))
      .toEqual(["claudeCode", "codex"]);
    expect(backends.selectableNativeAgentBackends("0.82.0").map((item) => item.id))
      .toEqual(["claudeCode", "codex"]);
    expect(backends.selectableNativeAgentBackends("1.0.0").map((item) => item.id))
      .toEqual(["claudeCode", "codex"]);
    expect(backends.selectableNativeAgentBackends("0.79.10").map((item) => item.id))
      .toEqual(["claudeCode", "codex", "pi"]);
    expect(backends.selectableNativeAgentBackends("0.81.1").map((item) => item.id))
      .toEqual(["claudeCode", "codex", "pi"]);
    expect(backends.selectableNativeAgentBackends("v0.79.99").map((item) => item.id))
      .toEqual(["claudeCode", "codex", "pi"]);
  });

  it("widens the Pi RPC version gate through the 0.81 certification", async () => {
    const { backends } = await loadBackends();

    expect(backends.isCompatiblePiRpcVersion("0.79.9")).toBe(false);
    expect(backends.isCompatiblePiRpcVersion("0.79.10")).toBe(true);
    expect(backends.isCompatiblePiRpcVersion("0.81.1")).toBe(true);
    expect(backends.isCompatiblePiRpcVersion("0.82.0")).toBe(false);
    expect(backends.isCompatiblePiRpcVersion("1.0.0")).toBe(false);
    expect(backends.isCompatiblePiRpcVersion("garbage")).toBe(false);
    // Suffix grammar must match the Rust gate: prerelease and build
    // segments are each optional and may appear together.
    expect(backends.isCompatiblePiRpcVersion("v0.81.2")).toBe(true);
    expect(backends.isCompatiblePiRpcVersion("0.81.999-rc.1")).toBe(true);
    expect(backends.isCompatiblePiRpcVersion("0.81.999+build.7")).toBe(true);
    expect(backends.isCompatiblePiRpcVersion("0.81.999-rc.1+build.7")).toBe(true);
    expect(backends.isCompatiblePiRpcVersion("0.82.0-rc.1")).toBe(false);
  });
});
