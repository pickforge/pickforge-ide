import { createEffect, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { AGENTS, loadAgentModels, setAgentModel } from "../lib/agentModels";
import {
  addQuickLaunchItem,
  isAskAiItem,
  conflictingHotkeys,
  eventToHotkey,
  formatHotkey,
  quickLaunchItems,
  removeQuickLaunchItem,
  resetQuickLaunchItems,
  updateQuickLaunchItem,
} from "../stores/quickLaunch";
import { HairlinePanel, MonoEyebrow } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import {
  IconClaude,
  IconClose,
  IconIngot,
  IconOpenAI,
  IconPlus,
  IconRefresh,
} from "../components/icons";
import { currentZoom, zoomIn, zoomOut, zoomReset } from "../lib/zoom";
import { setRunButtonLabels, workbenchPrefs } from "../stores/workbenchPrefs";
import {
  setWindowControlsSide,
  windowControlsSide,
  type ControlsSide,
} from "../stores/windowControls";
import { hostPlatform } from "../lib/platform";
import { layout, resetLayout, setDockVisible } from "../stores/workbenchLayout";
import { startTour } from "../stores/tour";
import { navigate } from "../router";
import { recoverChatSessions, setRecoverChatSessions } from "../stores/chatSessions";
import {
  fileOpenSettings,
  setFileOpenCustom,
  setFileOpenMode,
  type FileOpenMode,
} from "../stores/fileOpenSettings";
import {
  loadAgentEngine,
  loadAskChatTitle,
  loadDefaultChatKind,
  setAgentEngine,
  setAskChatTitle,
  setDefaultChatKind,
  type DefaultChatKind,
} from "../lib/chatDefaults";
import { type AgentEngine } from "../lib/agentChat";
import { appVersion } from "../lib/appInfo";
import { appTheme, applyTheme } from "../stores/theme";
import { flagEnabled, flagStates, setFlagOverride, type FlagKey } from "../stores/flags";
import { checkForUpdate, installUpdate, updateAvailable, updateError, updateStatus } from "../lib/updater";
import { pickLabStatus, type PickLabStatus } from "../lib/picklab";
import {
  remoteHostIssuePairingCode,
  remoteHostStart,
  remoteHostStatus,
  remoteHostStop,
  remoteTailscaleSshSet,
  type PairingCode,
  type RemoteHostOverview,
} from "../lib/remoteHost";
import { telemetryGet, telemetrySet } from "../lib/telemetry";
import {
  accountError,
  accountSession,
  accountStatus,
  cancelSignIn,
  hasProEntitlement,
  signIn,
  signOut,
} from "../stores/account";
import * as db from "../lib/db";
import "./screens.css";

function Section(props: { title: string; children: any }) {
  return (
    <HairlinePanel class="pf-settings-section">
      <MonoEyebrow text={props.title} tick />
      <div class="pf-settings-body">{props.children}</div>
    </HairlinePanel>
  );
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function SettingsScreen() {
  const [models, setModels] = createSignal(loadAgentModels());
  const [defaultChatKind, setDefaultChatKindSig] = createSignal<DefaultChatKind>(
    loadDefaultChatKind(),
  );
  const [agentEngine, setAgentEngineSig] = createSignal<AgentEngine>(loadAgentEngine());
  const [askChatTitle, setAskChatTitleSig] = createSignal(loadAskChatTitle());
  const [archived, setArchived] = createSignal<db.Project[]>([]);
  const [capturingId, setCapturingId] = createSignal<string | null>(null);
  const [pickLab, setPickLab] = createSignal<PickLabStatus | null>(null);
  const [pickLabLoading, setPickLabLoading] = createSignal(false);
  const [crashReports, setCrashReports] = createSignal(true);
  const [crashReportsError, setCrashReportsError] = createSignal<string | null>(null);
  const [remoteHost, setRemoteHost] = createSignal<RemoteHostOverview | null>(null);
  const [remotePort, setRemotePort] = createSignal("4747");
  const [remoteLoading, setRemoteLoading] = createSignal(false);
  const [remoteError, setRemoteError] = createSignal<string | null>(null);
  const [remoteNow, setRemoteNow] = createSignal(Date.now());

  const reloadArchived = async () => {
    const all = await db.projectsList(true);
    setArchived(all.filter((p) => p.archivedAt !== null));
  };
  const reloadPickLab = async () => {
    setPickLabLoading(true);
    try {
      setPickLab(await pickLabStatus());
    } catch (error) {
      setPickLab({
        cliAvailable: false,
        mcpAvailable: false,
        cliPath: null,
        mcpPath: null,
        version: null,
        doctor: null,
        agents: null,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPickLabLoading(false);
    }
  };
  const reloadTelemetry = async () => {
    try {
      const config = await telemetryGet();
      setCrashReports(config.crash_reports);
      setCrashReportsError(null);
    } catch (error) {
      setCrashReportsError(error instanceof Error ? error.message : String(error));
    }
  };
  const reloadRemoteHost = async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const next = await remoteHostStatus();
      setRemoteHost(next);
      setRemotePort(String(next.listener.kind === "loopback" ? next.listener.port : next.defaultPort));
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoteLoading(false);
    }
  };
  onMount(() => {
    void reloadArchived();
    void reloadPickLab();
    void reloadTelemetry();
    void reloadRemoteHost();
  });
  const pairingExpiryTimer = window.setInterval(() => setRemoteNow(Date.now()), 1_000);
  onCleanup(() => window.clearInterval(pairingExpiryTimer));

  const changeModel = (agentId: string, model: string) => {
    setAgentModel(agentId, model || null);
    setModels(loadAgentModels());
  };

  const changeDefaultChatKind = (kind: string) => {
    const value = kind as DefaultChatKind;
    setDefaultChatKind(value);
    setDefaultChatKindSig(value);
  };

  const changeAgentEngine = (engine: string) => {
    const value = engine as AgentEngine;
    setAgentEngine(value);
    setAgentEngineSig(value);
  };

  const changeAskChatTitle = (on: boolean) => {
    setAskChatTitle(on);
    setAskChatTitleSig(on);
  };

  const changeCrashReports = async (on: boolean) => {
    const previous = crashReports();
    setCrashReports(on);
    setCrashReportsError(null);
    try {
      await telemetrySet(on);
    } catch (error) {
      setCrashReports(previous);
      setCrashReportsError(error instanceof Error ? error.message : String(error));
    }
  };

  const restore = async (root: string) => {
    await db.projectSetArchived(root, null);
    await reloadArchived();
  };

  const updateLabel = () => {
    switch (updateStatus()) {
      case "available": return `Version ${updateAvailable()?.version} available`;
      case "none": return "You're up to date";
      case "checking": return "Checking…";
      case "downloading": return "Downloading…";
      case "ready": return "Restarting…";
      case "error": return "Update check failed";
      default: return "Check for the latest release";
    }
  };

  const conflicts = () => conflictingHotkeys(quickLaunchItems());
  const agentLabel = (id?: string) =>
    AGENTS.find((a) => a.id === id)?.label ?? id ?? "";
  const pickLabDoctorLabel = () => {
    const status = pickLab();
    if (!status?.cliAvailable) return "Not installed";
    const doctor = recordOf(status.doctor);
    if (doctor?.ok === true) return "Ready";
    if (doctor?.ok === false) return "Needs attention";
    return status.doctor ? "Available" : "Not checked";
  };
  const pickLabAgentsLabel = () => {
    const agents = recordOf(pickLab()?.agents)?.agents;
    return Array.isArray(agents) ? `${agents.length} registered` : "Not checked";
  };
  const activePairingCode = (): PairingCode | null => {
    const now = remoteNow();
    const codes = remoteHost()?.pairingCodes ?? [];
    return [...codes].reverse().find((code) => !code.usedAtMs && code.expiresAtMs > now) ?? null;
  };
  const tailscaleLabel = () => {
    const status = remoteHost()?.tailscale;
    if (!status?.available) return "Not installed";
    if (status.error) return "Needs attention";
    if (status.online === true) return status.dnsName ?? status.hostName ?? "Online";
    return status.backendState ?? "Not running";
  };
  const sshLabel = () => {
    const status = remoteHost()?.tailscale;
    if (!status?.available) return "Not installed";
    if (status.sshEnabled === true) return "Enabled";
    if (status.sshEnabled === false) return "Disabled";
    return status.sshCapable ? "Available" : "Unavailable";
  };
  const startRemote = async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const port = Number(remotePort());
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("Port must be 1-65535");
      }
      setRemoteHost(await remoteHostStart(remoteHost()?.defaultHost ?? "127.0.0.1", port));
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoteLoading(false);
    }
  };
  const stopRemote = async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      setRemoteHost(await remoteHostStop());
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoteLoading(false);
    }
  };
  const issuePairing = async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      setRemoteNow(Date.now());
      await remoteHostIssuePairingCode();
      await reloadRemoteHost();
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : String(error));
      setRemoteLoading(false);
    }
  };
  const copyPairing = async () => {
    const code = activePairingCode()?.code;
    if (!code) {
      await issuePairing();
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setRemoteError("Clipboard copy is unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setRemoteError(null);
    } catch {
      setRemoteError("Could not copy pairing code");
    }
  };
  const toggleSsh = async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      await remoteTailscaleSshSet(remoteHost()?.tailscale.sshEnabled !== true);
      await reloadRemoteHost();
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : String(error));
      setRemoteLoading(false);
    }
  };

  // Capture the next shortcut for the item being edited (Esc cancels,
  // Backspace clears). Capture phase so nothing else steals the key.
  createEffect(() => {
    const id = capturingId();
    if (!id) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapturingId(null);
      if (e.key === "Backspace" || e.key === "Delete") {
        updateQuickLaunchItem(id, { hotkey: null });
        return setCapturingId(null);
      }
      const hk = eventToHotkey(e);
      if (hk) {
        updateQuickLaunchItem(id, { hotkey: hk });
        setCapturingId(null);
      }
    };
    window.addEventListener("keydown", handler, true);
    onCleanup(() => window.removeEventListener("keydown", handler, true));
  });

  return (
    <div class="pf-screen pf-screen--scroll">
      <header class="pf-screen-head">
        <MonoEyebrow text="Settings" tick />
      </header>

      <div class="pf-settings">
        <Section title="Agent models">
          <For each={AGENTS}>
            {(agent) => (
              <div class="pf-settings-row">
                <span class="pf-settings-label">
                  <Show when={agent.id === "claudeCode"}>
                    <span class="pf-settings-brand"><IconClaude size={14} /></span>
                  </Show>
                  <Show when={agent.id === "codex"}>
                    <span class="pf-settings-brand"><IconOpenAI size={14} /></span>
                  </Show>
                  {agent.label}
                </span>
                <Show
                  when={agent.models.length > 0}
                  fallback={<span class="pf-settings-muted">CLI default</span>}
                >
                  <Dropdown
                    class="pf-settings-dropdown"
                    value={models()[agent.id] ?? ""}
                    onChange={(v) => changeModel(agent.id, v)}
                    options={agent.models.map((m) => ({
                      value: m.id,
                      label: m.label,
                      icon: () => <IconIngot size={13} />,
                    }))}
                  />
                </Show>
              </div>
            )}
          </For>
        </Section>

        <Section title="Chats">
          <div class="pf-settings-row">
            <span class="pf-settings-label">New chat creates</span>
            <Dropdown
              class="pf-settings-dropdown"
              value={defaultChatKind()}
              onChange={changeDefaultChatKind}
              options={[
                { value: "ask", label: "Ask each time" },
                { value: "terminal", label: "Terminal" },
                { value: "agent", label: "Agent chat" },
              ]}
            />
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Ask for a chat title
              <span class="pf-settings-hint-inline">a name field in the new-chat menu; empty keeps auto-naming</span>
            </span>
            <div class="pf-seg">
              <button classList={{ active: askChatTitle() }} onClick={() => changeAskChatTitle(true)}>On</button>
              <button classList={{ active: !askChatTitle() }} onClick={() => changeAskChatTitle(false)}>Off</button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Agent chat engine
              <span class="pf-settings-hint-inline">interactive approvals + steering, or one-shot CLI</span>
            </span>
            <Dropdown
              class="pf-settings-dropdown"
              value={agentEngine()}
              onChange={changeAgentEngine}
              options={[
                { value: "v2", label: "v2 (interactive)" },
                { value: "v1", label: "v1 (one-shot CLI)" },
              ]}
            />
          </div>
        </Section>

        <Section title="PickLab companion">
          <div class="pf-settings-row">
            <span class="pf-settings-label">CLI</span>
            <span class="pf-settings-muted">
              {pickLab()?.cliAvailable ? `picklab ${pickLab()?.version ?? ""}` : "Not found"}
            </span>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">MCP server</span>
            <span class="pf-settings-muted">
              {pickLab()?.mcpAvailable ? "picklab-mcp available" : "Not found"}
            </span>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Doctor</span>
            <span class="pf-settings-muted">{pickLabDoctorLabel()}</span>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Agent configs</span>
            <span class="pf-settings-muted">{pickLabAgentsLabel()}</span>
          </div>
          <Show when={pickLab()?.error}>
            <div class="pf-ql-warn">{pickLab()?.error}</div>
          </Show>
          <div class="pf-ql-actions">
            <button
              class="pf-ql-add"
              disabled={pickLabLoading()}
              onClick={() => void reloadPickLab()}
            >
              <IconRefresh size={13} /> {pickLabLoading() ? "Checking..." : "Refresh"}
            </button>
            <span class="pf-settings-muted">Managed as an external Pickforge tool</span>
          </div>
        </Section>

        <Section title="Remote host">
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Listener
              <Show when={remoteHost()?.localUrl}>
                <span class="pf-settings-hint-inline">{remoteHost()?.localUrl}</span>
              </Show>
            </span>
            <div class="pf-remote-controls">
              <input
                class="pf-input pf-remote-port"
                value={remotePort()}
                disabled={remoteHost()?.running || remoteLoading()}
                onInput={(e) => setRemotePort(e.currentTarget.value)}
              />
              <button
                class="pf-ql-add"
                disabled={remoteLoading()}
                onClick={() => void (remoteHost()?.running ? stopRemote() : startRemote())}
              >
                {remoteHost()?.running ? "Stop" : "Start"}
              </button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Pairing code</span>
            <div class="pf-remote-code-actions">
              <button
                class="pf-text-btn pf-remote-code"
                disabled={remoteLoading()}
                title={activePairingCode() ? "Copy pairing code" : "Issue pairing code"}
                onClick={() => void copyPairing()}
              >
                {activePairingCode()?.code ?? "Issue code"}
              </button>
              <button
                class="pf-ql-add pf-remote-code-refresh"
                disabled={remoteLoading() || !activePairingCode()}
                title="Refresh pairing code"
                aria-label="Refresh pairing code"
                onClick={() => void issuePairing()}
              >
                <IconRefresh size={13} />
              </button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Paired clients</span>
            <span class="pf-settings-muted">{remoteHost()?.clients.length ?? 0}</span>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Tailscale</span>
            <span class="pf-settings-muted">{tailscaleLabel()}</span>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Tailscale SSH</span>
            <button
              class="pf-text-btn"
              disabled={remoteLoading() || !remoteHost()?.tailscale.available}
              onClick={() => void toggleSsh()}
            >
              {remoteHost()?.tailscale.sshEnabled ? "Disable" : `Enable · ${sshLabel()}`}
            </button>
          </div>
          <Show when={remoteError() ?? remoteHost()?.tailscale.error}>
            <div class="pf-ql-warn">{remoteError() ?? remoteHost()?.tailscale.error}</div>
          </Show>
          <div class="pf-ql-actions">
            <button
              class="pf-ql-add"
              disabled={remoteLoading()}
              onClick={() => void reloadRemoteHost()}
            >
              <IconRefresh size={13} /> {remoteLoading() ? "Checking..." : "Refresh"}
            </button>
            <span class="pf-settings-muted">{remoteHost()?.authPath ?? ""}</span>
          </div>
        </Section>

        <Section title="Quick launch">
          <div class="pf-ql-head">
            <span class="pf-settings-muted">
              Chips above the terminal. Shortcuts fire into the focused pane.
            </span>
          </div>
          <div class="pf-ql-list">
            {/* Index (not For): rows are keyed by position so editing a field
                never re-creates its <input> — the text box keeps focus. */}
            <Index each={quickLaunchItems()}>
              {(item) => (
                <div
                  class="pf-ql-row"
                  classList={{ "pf-ql-row--conflict": conflicts().has(item().id) }}
                >
                  <input
                    class="pf-input pf-ql-label"
                    value={item().label}
                    onInput={(e) =>
                      updateQuickLaunchItem(item().id, { label: e.currentTarget.value })
                    }
                  />
                  <Show
                    when={item().agentId}
                    fallback={
                      <input
                        class="pf-input pf-ql-cmd"
                        value={item().command ?? ""}
                        placeholder="command to type…"
                        onInput={(e) =>
                          updateQuickLaunchItem(item().id, { command: e.currentTarget.value })
                        }
                      />
                    }
                  >
                    <span class="pf-ql-agent">agent · {agentLabel(item().agentId)}</span>
                  </Show>
                  <button
                    class="pf-ql-hotkey"
                    classList={{ "pf-ql-hotkey--capturing": capturingId() === item().id }}
                    title="Click, then press a shortcut (Esc cancels, Backspace clears)"
                    onClick={() => setCapturingId(item().id)}
                  >
                    {capturingId() === item().id ? "press shortcut…" : formatHotkey(item().hotkey)}
                  </button>
                  <button
                    class="pf-ql-ai"
                    classList={{ "pf-ql-ai--on": isAskAiItem(item()) }}
                    title="Show in the Inspector's Ask AI — the selected widget's context is appended to this command"
                    onClick={() => updateQuickLaunchItem(item().id, { ai: !isAskAiItem(item()) })}
                  >
                    AI
                  </button>
                  <button
                    class="pf-icon-btn"
                    title="Remove"
                    onClick={() => removeQuickLaunchItem(item().id)}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              )}
            </Index>
          </div>
          <Show when={conflicts().size > 0}>
            <div class="pf-ql-warn">Two items share a shortcut — only one will fire.</div>
          </Show>
          <div class="pf-ql-actions">
            <button class="pf-ql-add" onClick={addQuickLaunchItem}>
              <IconPlus size={13} /> Add item
            </button>
            <button class="pf-text-btn" onClick={resetQuickLaunchItems}>
              Reset defaults
            </button>
          </div>
        </Section>

        <Section title="Appearance">
          <div class="pf-settings-row">
            <span class="pf-settings-label">Theme</span>
            <div class="pf-seg">
              <button
                classList={{ active: appTheme() === "dark" }}
                onClick={() => applyTheme("dark")}
              >
                Dark
              </button>
              <button
                classList={{ active: appTheme() === "light" }}
                onClick={() => applyTheme("light")}
              >
                Light
              </button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Interface zoom
              <span class="pf-settings-hint-inline">Ctrl/⌘ + − 0</span>
            </span>
            <div class="pf-zoom">
              <button class="pf-zoom-btn" title="Zoom out" onClick={zoomOut}>−</button>
              <span class="pf-zoom-val">{Math.round(currentZoom() * 100)}%</span>
              <button class="pf-zoom-btn" title="Zoom in" onClick={zoomIn}>+</button>
              <button class="pf-text-btn" onClick={zoomReset}>Reset</button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Window controls
              <Show when={hostPlatform() === "macos"}>
                <span class="pf-settings-hint-inline">macOS · always left</span>
              </Show>
            </span>
            <div class="pf-seg" classList={{ "pf-seg--disabled": hostPlatform() === "macos" }}>
              <For each={["auto", "left", "right"] as ControlsSide[]}>
                {(s) => (
                  <button
                    classList={{ active: windowControlsSide() === s }}
                    disabled={hostPlatform() === "macos"}
                    onClick={() => setWindowControlsSide(s)}
                  >
                    {s === "auto" ? "Auto" : s === "left" ? "Left" : "Right"}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Section>

        <Section title="Workbench">
          <div class="pf-settings-row">
            <span class="pf-settings-label">Left panel</span>
            <div class="pf-seg">
              <button classList={{ active: layout().leftVisible }} onClick={() => setDockVisible("left", true)}>Shown</button>
              <button classList={{ active: !layout().leftVisible }} onClick={() => setDockVisible("left", false)}>Hidden</button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Right panel</span>
            <div class="pf-seg">
              <button classList={{ active: layout().rightVisible }} onClick={() => setDockVisible("right", true)}>Shown</button>
              <button classList={{ active: !layout().rightVisible }} onClick={() => setDockVisible("right", false)}>Hidden</button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Run buttons</span>
            <div class="pf-seg">
              <button classList={{ active: !workbenchPrefs().runButtonLabels }} onClick={() => setRunButtonLabels(false)}>Icons</button>
              <button classList={{ active: workbenchPrefs().runButtonLabels }} onClick={() => setRunButtonLabels(true)}>Labels</button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Recover chat sessions
              <span class="pf-settings-hint-inline">keep a chat's agent running across restarts (dtach/tmux)</span>
            </span>
            <div class="pf-seg">
              <button classList={{ active: recoverChatSessions() }} onClick={() => setRecoverChatSessions(true)}>On</button>
              <button classList={{ active: !recoverChatSessions() }} onClick={() => setRecoverChatSessions(false)}>Off</button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Crash reports
              <span class="pf-settings-hint-inline">send anonymous crash reports to help fix problems (applies after restart)</span>
            </span>
            <div class="pf-seg">
              <button classList={{ active: crashReports() }} onClick={() => void changeCrashReports(true)}>On</button>
              <button classList={{ active: !crashReports() }} onClick={() => void changeCrashReports(false)}>Off</button>
            </div>
          </div>
          <Show when={crashReportsError()}>
            <div class="pf-ql-warn">{crashReportsError()}</div>
          </Show>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Panel layout</span>
            <button class="pf-text-btn" onClick={resetLayout}>Reset to default</button>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Product tour
              <span class="pf-settings-hint-inline">a quick guided walkthrough</span>
            </span>
            <button class="pf-text-btn" onClick={() => { navigate("workbench"); startTour(); }}>Replay tour</button>
          </div>
        </Section>

        <Section title="File opening">
          <div class="pf-settings-row">
            <span class="pf-settings-label">Open files with</span>
            <Dropdown
              class="pf-settings-dropdown"
              value={fileOpenSettings().mode}
              onChange={(v) => setFileOpenMode(v as FileOpenMode)}
              options={[
                { value: "nvim-pane", label: "Neovim (new pane)" },
                { value: "system", label: "System default editor" },
                { value: "custom", label: "Custom command…" },
              ]}
            />
          </div>
          <Show when={fileOpenSettings().mode === "custom"}>
            <div class="pf-settings-row">
              <span class="pf-settings-label">Command</span>
              <input
                class="pf-input"
                value={fileOpenSettings().customCommand}
                placeholder="code -g {path}"
                onInput={(e) => setFileOpenCustom(e.currentTarget.value)}
              />
            </div>
          </Show>
          <span class="pf-settings-muted">
            Editor modes open in a new terminal pane; {"{path}"} is the file path.
          </span>
        </Section>

        <Section title="Updates">
          <div class="pf-settings-row">
            <span class="pf-settings-label">Current version</span>
            <span class="pf-settings-muted">v{appVersion()}</span>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">{updateLabel()}</span>
            <Show
              when={updateAvailable()}
              fallback={
                <button
                  class="pf-ql-add"
                  disabled={updateStatus() === "checking"}
                  onClick={() => void checkForUpdate(false)}
                >
                  Check for updates
                </button>
              }
            >
              <button
                class="pf-text-btn"
                disabled={updateStatus() === "downloading"}
                onClick={() => void installUpdate()}
              >
                {updateStatus() === "downloading"
                  ? "Installing…"
                  : `Install v${updateAvailable()!.version}`}
              </button>
            </Show>
          </div>
          <Show when={updateError()}>
            <div class="pf-vm-error">{updateError()}</div>
          </Show>
        </Section>

        <Section title="Archived projects">
          <Show
            when={archived().length > 0}
            fallback={<span class="pf-settings-muted">No archived projects</span>}
          >
            <For each={archived()}>
              {(p) => (
                <div class="pf-settings-row">
                  <span class="pf-settings-label">{p.displayName}</span>
                  <button class="pf-text-btn" onClick={() => restore(p.projectRoot)}>
                    Restore
                  </button>
                </div>
              )}
            </For>
          </Show>
        </Section>

        <Show when={flagEnabled("accounts")}>
          <Section title="Account">
            <Show
              when={accountStatus() === "signingIn"}
              fallback={
                <Show
                  when={accountSession()}
                  fallback={
                    <>
                      <span class="pf-settings-muted">
                        Sign-in is optional. PickForge works fully offline; an account only adds Pro features and settings sync.
                      </span>
                      <div class="pf-ql-row">
                        <button class="pf-ql-add" onClick={() => void signIn("github")}>
                          Continue with GitHub
                        </button>
                        <button class="pf-ql-add" onClick={() => void signIn("google")}>
                          Continue with Google
                        </button>
                      </div>
                    </>
                  }
                >
                  {(account) => (
                    <>
                      <div class="pf-settings-row">
                        <span class="pf-settings-label">
                          {account().displayName ?? account().email ?? "Signed in"}
                          <Show when={account().email && account().email !== (account().displayName ?? account().email)}>
                            <span class="pf-settings-hint-inline">{account().email}</span>
                          </Show>
                        </span>
                      </div>
                      <div class="pf-settings-row">
                        <span class="pf-settings-label">Plan</span>
                        <span class="pf-settings-muted">{hasProEntitlement() ? "Pro" : "Free"}</span>
                      </div>
                      <span class="pf-settings-muted">
                        PickForge sends no project data to your account. Only profile and entitlement state sync.
                      </span>
                      <div class="pf-ql-actions">
                        <button class="pf-text-btn" onClick={() => void signOut()}>
                          Sign out
                        </button>
                      </div>
                    </>
                  )}
                </Show>
              }
            >
              <div class="pf-settings-row">
                <span class="pf-settings-label">
                  Waiting for browser sign-in…
                  <span class="pf-settings-hint-inline">complete the OAuth flow in your browser</span>
                </span>
                <button class="pf-text-btn" onClick={cancelSignIn}>Cancel</button>
              </div>
            </Show>
            <Show when={accountError()}>
              <div class="pf-ql-warn">{accountError()}</div>
            </Show>
          </Section>
        </Show>

        <Show when={import.meta.env.DEV}>
          <Section title="Feature flags">
            <For each={flagStates()}>
              {(f) => (
                <div class="pf-settings-row">
                  <span class="pf-settings-label">
                    {f.key}
                    <span class="pf-settings-hint-inline">{f.description}</span>
                  </span>
                  <div class="pf-seg">
                    <button
                      classList={{ active: f.override === true }}
                      onClick={() => setFlagOverride(f.key as FlagKey, true)}
                    >
                      On
                    </button>
                    <button
                      classList={{ active: f.override === false }}
                      onClick={() => setFlagOverride(f.key as FlagKey, false)}
                    >
                      Off
                    </button>
                    <button
                      classList={{ active: f.override === undefined }}
                      onClick={() => setFlagOverride(f.key as FlagKey, undefined)}
                    >
                      Default ({f.defaultValue ? "on" : "off"})
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Section>
        </Show>
      </div>
    </div>
  );
}
