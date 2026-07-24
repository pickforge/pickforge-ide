// @vitest-environment jsdom
// @vitest-environment-options {"jsdom":{"customExportConditions":["browser"]}}
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Compatibility = "unprobed" | "probing" | "compatible" | "incompatible";

const modelMocks = vi.hoisted(() => ({
  ompCompatibility: (() => "unprobed") as () => Compatibility,
  piCompatibility: (() => "unprobed") as () => Compatibility,
  ensureOmp: vi.fn(),
  ensurePi: vi.fn(),
}));

const chat = vi.hoisted(() => ({
  id: "chat-omp",
  projectRoot: "/persisted-project",
  kind: "agent",
  agentId: "omp",
  sessionId: "persisted-session",
}));

vi.mock("../../src/screens/workbench/ProjectsPane", () => ({ ProjectsPane: () => null }));
vi.mock("../../src/screens/workbench/FileExplorer", () => ({ FileExplorer: () => null }));
vi.mock("../../src/screens/workbench/InspectorPanel", () => ({ InspectorPanel: () => null }));
vi.mock("../../src/screens/workbench/SourceControl", () => ({ SourceControl: () => null }));
vi.mock("../../src/components/DeviceMirror", () => ({ DeviceMirror: () => null }));
vi.mock("../../src/screens/workbench/DebugConsole", () => ({ DebugConsole: () => null }));
vi.mock("../../src/screens/workbench/Dock", () => ({ DockPanel: () => null, PaneShell: () => null }));
vi.mock("../../src/components/TerminalHost", () => ({ TerminalHost: () => null }));
vi.mock("../../src/components/chat/AgentChatView", () => ({
  AgentChatView: () => {
    const view = document.createElement("div");
    view.dataset.testid = "agent-chat";
    const composer = document.createElement("div");
    composer.dataset.testid = "composer";
    view.appendChild(composer);
    return view;
  },
}));
vi.mock("../../src/components/orchestra/OrchestraView", () => ({ OrchestraView: () => null }));
vi.mock("../../src/stores/agentChat", () => ({ disposeAgentChat: vi.fn() }));
vi.mock("../../src/lib/agentModels", () => ({
  ensureOmpNativeCompatibility: modelMocks.ensureOmp,
  ensurePiNativeCompatibility: modelMocks.ensurePi,
  isOmpNativeCompatibilityPending: () => {
    const state = modelMocks.ompCompatibility();
    return state === "unprobed" || state === "probing";
  },
  isPiNativeCompatibilityPending: () => {
    const state = modelMocks.piCompatibility();
    return state === "unprobed" || state === "probing";
  },
  loadAgentModels: () => ({ omp: "openai/gpt-test", pi: "anthropic/claude-test" }),
  ompNativeChatUnavailableReason: () => {
    const state = modelMocks.ompCompatibility();
    if (state === "compatible") return null;
    if (state === "incompatible") return "OMP native chat is incompatible";
    return "Checking for compatible OMP >=17.1.1 and <18.0.0";
  },
  piNativeChatUnavailableReason: () => {
    const state = modelMocks.piCompatibility();
    if (state === "compatible") return null;
    if (state === "incompatible") return "Pi native chat is incompatible";
    return "Checking for compatible Pi 0.79.x";
  },
}));
vi.mock("../../src/lib/agentBackends", () => ({
  normalizeAgentProvider: (agentId: string) =>
    agentId === "omp" || agentId === "pi" ? agentId : null,
  nativeChatUnavailableReason: () => null,
}));
vi.mock("../../src/components/ui", () => ({ ForgeEmptyState: () => null, PaneReveal: () => null }));
vi.mock("../../src/components/icons", () => ({ IconGrid: () => null, IconTerminal: () => null }));
vi.mock("../../src/lib/process", () => ({ detectBinaries: vi.fn().mockResolvedValue([]) }));
vi.mock("../../src/lib/remoteContext", () => ({
  canLaunchAgentForMode: () => true,
  remotePathFor: (path: string) => path,
  shouldUseLocalMcp: () => false,
}));
vi.mock("../../src/stores/fileOpenSettings", () => ({ editorCommand: () => null }));
vi.mock("../../src/lib/opener", () => ({ openPathSystem: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/stores/quickLaunch", () => ({
  binaryForItem: () => null,
  commandForItem: () => "",
  hotkeyMatches: () => false,
  quickLaunchItems: () => [],
}));
vi.mock("../../src/stores/workspace", () => ({
  workspace: { activeChatId: chat.id, activeRoot: chat.projectRoot, loaded: true, projects: [] },
  findChat: (id: string) => id === chat.id ? chat : undefined,
  isChatDestroying: () => false,
  onChatDeleted: () => () => undefined,
  setChatSessionId: vi.fn(),
}));
vi.mock("../../src/stores/orchestra", () => ({
  clearProjectOrchestra: vi.fn(), removeChatFromOrchestra: vi.fn(), selectedLanes: () => [],
}));
vi.mock("../../src/stores/chatSessions", () => ({ chatBackend: () => "dtach" }));
vi.mock("../../src/stores/chatActivity", () => ({
  clearChatActivity: vi.fn(), graceChatUnseen: vi.fn(), handlePaneClosed: vi.fn(),
  REATTACH_REPLAY_GRACE_MS: 0, recordChatAttention: vi.fn(), recordChatOutput: vi.fn(),
  setActiveChatForActivity: vi.fn(), setStagedChatsForActivity: vi.fn(),
}));
vi.mock("../../src/stores/orchestraStage", () => ({
  orchestraOpen: () => false, setOrchestraOpen: vi.fn(), stagedChatIds: () => [],
}));
vi.mock("../../src/stores/chatArchive", () => ({ isChatArchived: () => false }));
vi.mock("../../src/stores/terminalHosts", () => ({
  deleteTerminalHost: vi.fn(), getTerminalHost: () => undefined, setTerminalHost: vi.fn(),
}));
vi.mock("../../src/stores/mcp", () => ({
  ensureMcpRunning: vi.fn().mockResolvedValue(undefined), mcpEnv: () => ({}),
}));
vi.mock("../../src/lib/chatAutoName", () => ({
  armChatAutoName: vi.fn(), chatHadAgentSession: () => false, clearChatAgentSession: vi.fn(),
  forgetChatAutoName: vi.fn(), handleOscTitle: vi.fn(), handleAgentPaneExited: vi.fn(),
  markChatSessionPane: vi.fn(), maybeAutoNameChat: vi.fn(), revokeAgentPane: vi.fn(),
  transferAgentPaneOwnership: vi.fn(),
}));
vi.mock("../../src/router", () => ({ route: () => "settings" }));
vi.mock("../../src/stores/runConsole", () => ({ runConsole: { open: () => false } }));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (flag: string) => flag === "ompAgents",
}));
vi.mock("../../src/stores/operatorDock", () => ({ operatorDockOpen: () => false, toggleOperatorDock: vi.fn() }));
vi.mock("../../src/components/operator/OperatorDock", () => ({ OperatorDock: () => null }));
vi.mock("../../src/components/Tour", () => ({ Tour: () => null }));
vi.mock("../../src/stores/tour", () => ({ startTour: vi.fn(), tourSeen: () => true }));

import { WorkbenchScreen } from "../../src/screens/workbench/Workbench";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let resolveProbe: ((compatible: boolean) => void) | undefined;

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountWithDelayedProbe(provider: "omp" | "pi"): Promise<void> {
  chat.agentId = provider;
  const [compatibility, setCompatibility] = createSignal<Compatibility>("unprobed");
  if (provider === "omp") modelMocks.ompCompatibility = compatibility;
  else modelMocks.piCompatibility = compatibility;
  const probe = new Promise<boolean>((resolve) => {
    resolveProbe = (compatible) => {
      setCompatibility(compatible ? "compatible" : "incompatible");
      resolve(compatible);
    };
  });
  const ensure = provider === "omp" ? modelMocks.ensureOmp : modelMocks.ensurePi;
  ensure.mockImplementation(() => {
    setCompatibility("probing");
    return probe;
  });
  dispose = render(() => WorkbenchScreen(), container);
  await flush();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  chat.agentId = "omp";
  modelMocks.ompCompatibility = () => "unprobed";
  modelMocks.piCompatibility = () => "unprobed";
  modelMocks.ensureOmp.mockReset().mockResolvedValue(false);
  modelMocks.ensurePi.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  resolveProbe = undefined;
  container.remove();
});

describe.each(["omp", "pi"] as const)("Workbench persisted %s chat compatibility", (provider) => {
  it("announces a delayed probe neutrally, then mounts native chat and its composer", async () => {
    await mountWithDelayedProbe(provider);

    const pending = container.querySelector<HTMLElement>("[role=status]");
    expect(pending?.textContent).toContain(
      provider === "omp" ? "Checking for compatible OMP" : "Checking for compatible Pi",
    );
    expect(pending?.getAttribute("aria-live")).toBe("polite");
    expect(pending?.getAttribute("aria-busy")).toBe("true");
    expect(pending?.classList.contains("pf-chat-switch-notice")).toBe(true);
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.querySelector("[data-testid=agent-chat]")).toBeNull();

    resolveProbe?.(true);
    await flush();

    expect(container.querySelector("[role=status]")).toBeNull();
    expect(container.querySelector("[data-testid=agent-chat]")).not.toBeNull();
    expect(container.querySelector("[data-testid=composer]")).not.toBeNull();
  });

  it("keeps a completed incompatible probe as an alert without mounting native chat", async () => {
    await mountWithDelayedProbe(provider);
    resolveProbe?.(false);
    await flush();

    expect(container.querySelector("[role=status]")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("incompatible");
    expect(container.querySelector("[data-testid=agent-chat]")).toBeNull();
    expect(container.querySelector("[data-testid=composer]")).toBeNull();
  });
});
