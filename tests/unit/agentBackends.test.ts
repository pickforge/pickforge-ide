import { describe, expect, it, vi } from "vitest";


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

  it("normalizes persisted legacy Claude IDs without accepting terminal-only backends", async () => {
    const { backends } = await loadBackends();

    expect(backends.normalizeAgentProvider("claude")).toBe("claudeCode");
    expect(backends.normalizeAgentProvider("claudeCode")).toBe("claudeCode");
    expect(backends.normalizeAgentProvider("codex")).toBe("codex");
    expect(backends.normalizeAgentProvider("omp")).toBeNull();
    expect(backends.normalizeAgentProvider("pi")).toBeNull();
  });

  it("advertises OMP ACP and Pi RPC without claiming native chat", async () => {
    const { backends } = await loadBackends();

    expect(backends.AGENT_BACKENDS.omp.protocol).toEqual({
      kind: "acp",
      availability: "availableNotIntegrated",
    });
    expect(backends.AGENT_BACKENDS.pi.protocol).toEqual({
      kind: "rpc",
      availability: "availableNotIntegrated",
    });
    for (const id of ["omp", "pi"] as const) {
      expect(backends.isNativeAgentProvider(id)).toBe(false);
      expect(backends.supportsBackendCapability(id, "nativeChat")).toBe(false);
      expect(backends.nativeChatUnavailableReason(id)).toContain("not integrated yet");
      expect(backends.supportsBackendCapability(id, "terminal", "terminal")).toBe(true);
      expect(backends.AGENT_BACKENDS[id].capabilities.imageInput.support).toBe("unknown");
      expect(backends.AGENT_BACKENDS[id].capabilities.mcpConfiguration.support).toBe("unsupported");
    }
  });
});
