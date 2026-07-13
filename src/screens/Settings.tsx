import { createEffect, createSignal, For, Index, onCleanup, onMount, Show, type JSX } from "solid-js";
import {
  agentProfiles,
  discoverAgentCli,
  loadAgentModels,
  setAgentModel,
  type AgentCliDiagnostic,
  type AgentProfile,
} from "../lib/agentModels";
import { nativeChatUnavailableReason, type AgentEngine } from "../lib/agentBackends";
import {
  addQuickLaunchItem,
  addOptionalQuickLaunch,
  isAskAiItem,
  conflictingHotkeys,
  eventToHotkey,
  formatHotkey,
  quickLaunchItems,
  removeQuickLaunchItem,
  optionalQuickLaunchChoices,
  resetQuickLaunchItems,
  updateQuickLaunchItem,
} from "../stores/quickLaunch";
import { MonoEyebrow } from "../components/ui";
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
import { navigate, navigateSettingsSection, settingsSection } from "../router";
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
import { appVersion } from "../lib/appInfo";
import { appTheme, applyTheme } from "../stores/theme";
import {
  flagEnabled,
  flagStates,
  setFlagOverride,
  subscribeToFlagChanges,
  type FlagKey,
} from "../stores/flags";
import { checkForUpdate, installUpdate, updateAvailable, updateError, updateStatus } from "../lib/updater";
import { pickLabStatus, type PickLabStatus } from "../lib/picklab";
import {
  operatorRouterSettings,
  setOperatorRouterBackend,
  setOperatorRouterModel,
  type OperatorRouterBackend,
  type OperatorRouterSettingBackend,
} from "../stores/operatorRouterSettings";
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
import { voiceStatus, type VoiceStatus } from "../lib/voice";
import {
  setVoiceMicEnabled,
  setVoiceModelPath,
  setVoicePushToCommand,
  voiceDictationSettings,
  voiceModelOverride,
} from "../stores/voiceSettings";
import {
  accountError,
  accountSession,
  accountStatus,
  cancelSignIn,
  hasProEntitlement,
  signIn,
  signOut,
} from "../stores/account";
import {
  creditBalanceCents,
  refreshCreditBalance,
  startCreditCheckout,
  CREDIT_PACKS,
  type CreditPack,
} from "../stores/credits";
import { formatCreditBalance } from "../lib/agentPricing";
import {
  lastSyncedRelative,
  setSettingsSyncGroup,
  setSettingsSyncOptIn,
  settingsSyncErrorMessage,
  settingsSyncing,
  settingsSyncState,
  SYNC_GROUPS,
  syncNow,
} from "../stores/settingsSyncStore";
import type { SyncFieldGroup } from "@pickforge/sync";
import {
  deleteConfirmMatches,
  exportAccountData,
  performAccountDeletion,
} from "../lib/accountData";
import { ConfirmDialog } from "../components/ConfirmDialog";
import * as db from "../lib/db";
import {
  AccountSettingsSection,
  AgentModelsSettingsSection,
  AppearanceSettingsSection,
  ArchivedProjectsSettingsSection,
  ChatsSettingsSection,
  DictationSettingsSection,
  FeatureFlagsSettingsSection,
  FileOpeningSettingsSection,
  OperatorRouterSettingsSection,
  PickLabSettingsSection,
  QuickLaunchSettingsSection,
  RemoteHostSettingsSection,
  UpdatesSettingsSection,
  WorkbenchSettingsSection,
} from "./settingsSections";
import { SettingsNavigation } from "./SettingsNavigation";
import {
  availableSettingsCategories,
  firstSettingsSectionForCategory,
  resolveSettingsCategory,
  settingsCategoryForSection,
  type SettingsCategoryKey,
  type SettingsSectionAvailabilityContext,
} from "./settingsRegistry";
import "./screens.css";


function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatLatency(ms: number): string {
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

const SYNC_GROUP_LABELS: Record<SyncFieldGroup, { title: string; hint: string }> = {
  appSettings: { title: "Appearance & workbench", hint: "theme, run buttons, window controls" },
  operatorConfig: { title: "Operator & dictation", hint: "router backend, models, mic toggles" },
  keybindings: { title: "Quick launch", hint: "chips, commands, and shortcuts" },
  remoteBindings: { title: "Remote bindings", hint: "per-project remote host, matched by name" },
};

const SETTINGS_CATEGORY_STORAGE_KEY = "pickforge.settings.category";
const SETTINGS_SCROLL_SETTLE_MS = 2_000;
const SETTINGS_SCROLL_KEYS: Record<string, true> = {
  ArrowDown: true,
  ArrowUp: true,
  End: true,
  Home: true,
  PageDown: true,
  PageUp: true,
  " ": true,
};

function loadRememberedSettingsCategory(): string | null {
  try {
    return localStorage.getItem(SETTINGS_CATEGORY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberSettingsCategory(category: SettingsCategoryKey): void {
  try {
    localStorage.setItem(SETTINGS_CATEGORY_STORAGE_KEY, category);
  } catch {
    // Settings navigation remains usable when storage is unavailable.
  }
}
const AGENT_DIAGNOSTIC_IDS = ["omp", "pi"] as const;
const AGENT_BRAND_ICON: Readonly<Partial<Record<string, () => JSX.Element>>> = Object.freeze({
  claudeCode: () => <IconClaude size={14} />,
  codex: () => <IconOpenAI size={14} />,
  omp: () => <IconIngot size={14} />,
});

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
  const [voiceState, setVoiceState] = createSignal<VoiceStatus | null>(null);
  const [agentDiagnostics, setAgentDiagnostics] =
    createSignal<Record<string, AgentCliDiagnostic>>({});
  const [agentDiagnosticErrors, setAgentDiagnosticErrors] =
    createSignal<Record<string, string>>({});
  const [agentDiagnosticsLoading, setAgentDiagnosticsLoading] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [exportStatus, setExportStatus] = createSignal<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteConfirm, setDeleteConfirm] = createSignal("");
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const [accountNotice, setAccountNotice] = createSignal<string | null>(null);
  const [activeCategory, setActiveCategory] = createSignal<SettingsCategoryKey>(
    loadRememberedSettingsCategory() as SettingsCategoryKey ?? "general",
  );
  const [settingsPane, setSettingsPane] = createSignal<HTMLElement | null>(null);

  const settingsAvailability = (): SettingsSectionAvailabilityContext => ({
    operator: flagEnabled("operator"),
    accounts: flagEnabled("accounts"),
    development: import.meta.env.DEV,
  });
  const availableCategories = () => availableSettingsCategories(settingsAvailability());

  const selectCategory = (
    requested: SettingsCategoryKey,
    options: { replace?: boolean; updateRoute?: boolean } = {},
  ) => {
    const category = resolveSettingsCategory(requested, settingsAvailability());
    setActiveCategory(category);
    rememberSettingsCategory(category);
    if (options.updateRoute === false) return;
    const section = firstSettingsSectionForCategory(category, settingsAvailability());
    if (section) navigateSettingsSection(section, { replace: options.replace });
  };

  createEffect(() => {
    if (!flagEnabled("settingsNavigation")) return;
    const context = settingsAvailability();
    const requestedSection = settingsSection();
    const directCategory = settingsCategoryForSection(requestedSection, context);
    if (directCategory && requestedSection) {
      if (directCategory !== activeCategory()) {
        setActiveCategory(directCategory);
        rememberSettingsCategory(directCategory);
      }

      const pane = settingsPane();
      if (!pane || activeCategory() !== directCategory) return;

      const firstSection = firstSettingsSectionForCategory(directCategory, context);
      let cancelled = false;
      let alignmentFrame: number | null = null;
      let settleTimer: number | undefined;
      let layoutObserver: ResizeObserver | null = null;

      const cancelAlignment = () => {
        if (cancelled) return;
        cancelled = true;
        if (alignmentFrame !== null) cancelAnimationFrame(alignmentFrame);
        clearTimeout(settleTimer);
        layoutObserver?.disconnect();
        pane.removeEventListener("wheel", cancelAlignment);
        pane.removeEventListener("touchstart", cancelAlignment);
        pane.removeEventListener("pointerdown", cancelAlignment);
        window.removeEventListener("keydown", cancelForScrollKey, true);
      };
      const cancelForScrollKey = (event: KeyboardEvent) => {
        if (SETTINGS_SCROLL_KEYS[event.key]) cancelAlignment();
      };
      const alignRequestedSection = () => {
        alignmentFrame = null;
        if (
          cancelled
          || settingsPane() !== pane
          || settingsSection() !== requestedSection
          || activeCategory() !== directCategory
        ) {
          cancelAlignment();
          return;
        }

        const scrollTail = pane.querySelector<HTMLElement>(".pf-settings-pane-tail");
        if (requestedSection === firstSection) {
          scrollTail?.style.removeProperty("height");
          pane.scrollTop = 0;
          return;
        }

        const target = document.getElementById(`settings-${requestedSection}`);
        if (!target || !pane.contains(target)) return;
        const offset = target.getBoundingClientRect().top - pane.getBoundingClientRect().top;
        if (scrollTail) {
          const targetScrollTop = pane.scrollTop + offset;
          const contentHeight = pane.scrollHeight - scrollTail.offsetHeight;
          const tailHeight = Math.max(
            0,
            Math.ceil(targetScrollTop + pane.clientHeight - contentHeight),
          );
          scrollTail.style.height = `${tailHeight}px`;
        }
        if (Math.abs(offset) > 0.5) pane.scrollTop += offset;
      };
      const scheduleAlignment = () => {
        if (cancelled || alignmentFrame !== null) return;
        alignmentFrame = requestAnimationFrame(alignRequestedSection);
      };

      pane.addEventListener("wheel", cancelAlignment, { passive: true });
      pane.addEventListener("touchstart", cancelAlignment, { passive: true });
      pane.addEventListener("pointerdown", cancelAlignment, { passive: true });
      window.addEventListener("keydown", cancelForScrollKey, true);

      layoutObserver = new ResizeObserver(scheduleAlignment);
      const content = pane.querySelector<HTMLElement>(".pf-settings--navigation");
      if (content) layoutObserver.observe(content);
      scheduleAlignment();
      settleTimer = window.setTimeout(cancelAlignment, SETTINGS_SCROLL_SETTLE_MS);
      onCleanup(cancelAlignment);
      return;
    }

    if (requestedSection !== null) {
      selectCategory("general", { replace: true });
      return;
    }

    const fallback = resolveSettingsCategory(activeCategory(), context);
    if (fallback !== activeCategory()) {
      selectCategory(fallback, { replace: true });
      return;
    }

    const pane = settingsPane();
    pane?.querySelector<HTMLElement>(".pf-settings-pane-tail")?.style.removeProperty("height");
    if (pane) pane.scrollTop = 0;
  });

  // When the session changes or clears, reset export + delete state so a
  // next/anonymous account sees a clean export control and never inherits the
  // last account's export path or a half-typed/busy confirmation. An export
  // still in flight is already guarded (it won't write or set status for the old
  // account); clearing the busy flag just re-enables the control immediately.
  let lastAccountUserId: string | null | undefined;
  createEffect(() => {
    const userId = accountSession()?.userId ?? null;
    if (userId === lastAccountUserId) return;
    lastAccountUserId = userId;
    setExportStatus(null);
    setExporting(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
    setDeleting(false);
    setDeleteError(null);
  });

  const runExport = async () => {
    if (exporting()) return;
    const startedFor = accountSession()?.userId ?? null;
    const stillCurrent = () => (accountSession()?.userId ?? null) === startedFor;
    setExporting(true);
    setExportStatus(null);
    try {
      const result = await exportAccountData(stillCurrent);
      if (!stillCurrent()) return;
      if (!result.ok) {
        setExportStatus({ kind: "error", text: `Export failed — ${result.message}` });
      } else if (result.saved) {
        setExportStatus({ kind: "ok", text: `Exported to ${result.path}` });
      }
    } finally {
      setExporting(false);
    }
  };

  const openDeleteDialog = () => {
    setDeleteConfirm("");
    setDeleteError(null);
    setAccountNotice(null);
    setDeleteOpen(true);
  };

  const closeDeleteDialog = () => {
    if (deleting()) return;
    setDeleteOpen(false);
  };

  const runDelete = async (email: string | null) => {
    if (deleting() || !deleteConfirmMatches(deleteConfirm(), email)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await performAccountDeletion();
      if (result.ok) {
        setDeleteOpen(false);
        return;
      }
      if (result.reason === "sessionExpired") {
        // performAccountDeletion already signed out; the signed-in view will
        // unmount, so surface why on the section-level notice that survives it.
        setAccountNotice("Your session expired — sign in again. Your account was not deleted.");
        setDeleteOpen(false);
        return;
      }
      setDeleteError(result.message);
    } finally {
      setDeleting(false);
    }
  };

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
  const reloadVoice = async () => {
    try {
      setVoiceState(await voiceStatus(voiceModelOverride()));
    } catch (error) {
      setVoiceState({
        available: false,
        missing: [],
        modelPath: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const reloadAgentDiagnostics = async () => {
    if (!flagEnabled("ompPiAgents") || agentDiagnosticsLoading()) return;
    setAgentDiagnosticsLoading(true);
    const next: Record<string, AgentCliDiagnostic> = {};
    const failures: Record<string, string> = {};
    await Promise.all(AGENT_DIAGNOSTIC_IDS.map(async (agentId) => {
      try {
        next[agentId] = await discoverAgentCli(agentId);
      } catch (error) {
        failures[agentId] = error instanceof Error ? error.message : String(error);
      }
    }));
    setAgentDiagnostics(next);
    setAgentDiagnosticErrors(failures);
    setAgentDiagnosticsLoading(false);
  };
  onMount(() => {
    void reloadArchived();
    void reloadPickLab();
    void reloadTelemetry();
    void reloadRemoteHost();
    if (flagEnabled("operator")) void reloadVoice();
    if (flagEnabled("ompPiAgents")) void reloadAgentDiagnostics();
  });
  // Flipping a rollout flag on while Settings is open loads status that
  // onMount deliberately skipped while the feature was hidden.
  onCleanup(
    subscribeToFlagChanges(() => {
      if (flagEnabled("operator") && voiceState() === null) void reloadVoice();
      if (
        flagEnabled("ompPiAgents")
        && Object.keys(agentDiagnostics()).length === 0
        && Object.keys(agentDiagnosticErrors()).length === 0
      ) {
        void reloadAgentDiagnostics();
      }
    }),
  );
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
    agentProfiles().find((agent) => agent.id === id)?.label ?? id ?? "";
  const agentModelsFor = (agent: AgentProfile) =>
    agent.models.length > 0 ? agent.models : agentDiagnostics()[agent.id]?.models ?? [];
  const agentStatusLabel = (agent: AgentProfile): string => {
    const diagnostic = agentDiagnostics()[agent.id];
    const failure = agentDiagnosticErrors()[agent.id];
    if (failure) return "Diagnostic failed";
    if (!diagnostic) return agentDiagnosticsLoading() ? "Checking installation…" : "Not checked";
    if (!diagnostic.installed) return "Not installed";
    return diagnostic.version ? `${agent.binary} ${diagnostic.version}` : "Installed";
  };
  const agentCapabilityLabel = (agent: AgentProfile): string => {
    const diagnostic = agentDiagnostics()[agent.id];
    const failure = agentDiagnosticErrors()[agent.id];
    const nativeChatReason =
      nativeChatUnavailableReason(agent.id) ?? "Native chat is unavailable for this profile";
    if (failure) return `${nativeChatReason} · status unavailable · ${failure}`;
    if (!diagnostic?.installed) return `${nativeChatReason} · ${agent.binary} is required on PATH`;
    const capabilities = [nativeChatReason];
    if (diagnostic.capabilities.dynamicModels) capabilities.push("offline model catalog");
    if (diagnostic.capabilities.providerSelection) capabilities.push("provider selection");
    if (diagnostic.capabilities.profiles) capabilities.push("named profiles");
    if (diagnostic.errors.length > 0) capabilities.push(diagnostic.errors.join("; "));
    return capabilities.join(" · ");
  };
  const routerBackendOptions = [
    { value: "off", label: "Off" },
    { value: "claudeCode", label: "Claude Code", icon: () => <IconClaude size={13} /> },
    { value: "codex", label: "Codex", icon: () => <IconOpenAI size={13} /> },
    { value: "ollama", label: "Ollama", icon: () => <IconIngot size={13} /> },
    { value: "hosted", label: "Hosted (Pro)" },
  ];
  const routerBackend = () => operatorRouterSettings().backend;
  const activeRouterBackend = (): OperatorRouterBackend | null => {
    const backend = routerBackend();
    return backend === "off" || backend === "hosted" ? null : backend;
  };
  const routerLatencyHint = () => {
    const backend = activeRouterBackend();
    if (!backend) return null;
    const latency = operatorRouterSettings().lastLatencyMs[backend];
    if (latency === undefined) return null;
    const model = operatorRouterSettings().models[backend];
    const via = routerBackendOptions.find((option) => option.value === backend)?.label ?? backend;
    return `~${formatLatency(latency)} via ${via.toLowerCase()} · ${model}`;
  };
  const changeRouterBackend = (backend: string) => {
    if (backend === "hosted" && !accountSession()) return;
    setOperatorRouterBackend(backend as OperatorRouterSettingBackend);
  };
  const [creditCheckoutBusy, setCreditCheckoutBusy] = createSignal(false);
  const [creditCheckoutError, setCreditCheckoutError] = createSignal<string | null>(null);
  const buyCredits = async (pack: CreditPack) => {
    setCreditCheckoutBusy(true);
    setCreditCheckoutError(null);
    try {
      await startCreditCheckout(pack);
    } catch (error) {
      setCreditCheckoutError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreditCheckoutBusy(false);
    }
  };
  createEffect(() => {
    if (flagEnabled("operator") && accountSession()) void refreshCreditBalance();
  });
  onMount(() => {
    const onFocus = () => {
      if (flagEnabled("operator") && accountSession()) void refreshCreditBalance();
    };
    window.addEventListener("focus", onFocus);
    onCleanup(() => window.removeEventListener("focus", onFocus));
  });
  const changeRouterModel = (backend: OperatorRouterBackend, model: string) =>
    setOperatorRouterModel(backend, model);
  const voiceStatusLabel = () => {
    const status = voiceState();
    if (!status) return "Checking…";
    if (status.available) return "Ready";
    if (status.error) return status.error;
    if (status.missing.length > 0) return `Missing ${status.missing.join(", ")}`;
    return "Unavailable";
  };
  const changeVoiceModelPath = (path: string) => {
    setVoiceModelPath(path);
  };
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

  const renderSettings = (navigation: boolean) => (
      <div
        class={`pf-settings${navigation
          ? ` pf-settings--navigation pf-settings--category-${activeCategory()}`
          : ""}`}
      >
        <AgentModelsSettingsSection>
          <For each={agentProfiles()}>
            {(agent) => (
              <>
                <div class="pf-settings-row">
                  <span class="pf-settings-label">
                    <Show when={AGENT_BRAND_ICON[agent.id]}>
                      {(icon) => <span class="pf-settings-brand">{icon()()}</span>}
                    </Show>
                    {agent.label}
                    <Show when={agent.terminalOnly}>
                      <span class="pf-settings-hint-inline">{agentStatusLabel(agent)}</span>
                    </Show>
                  </span>
                  <Show
                    when={agentModelsFor(agent).length > 0}
                    fallback={
                      <span class="pf-settings-muted">
                        {agent.terminalOnly ? "Models unavailable · CLI default" : "CLI default"}
                      </span>
                    }
                  >
                    <Dropdown
                      class="pf-settings-dropdown"
                      value={models()[agent.id] ?? ""}
                      onChange={(v) => changeModel(agent.id, v)}
                      options={agentModelsFor(agent).map((model) => ({
                        value: model.id,
                        label: model.label,
                        icon: () => <IconIngot size={13} />,
                      }))}
                    />
                  </Show>
                </div>
                <Show when={agent.terminalOnly}>
                  <span class="pf-settings-muted">{agentCapabilityLabel(agent)}</span>
                </Show>
              </>
            )}
          </For>
          <Show when={flagEnabled("ompPiAgents")}>
            <span class="pf-settings-muted">
              Offline, read-only checks only. OMP native chat appears after an exact
              compatible 16.4.8 probe; its terminal launch remains available independently.
            </span>
            <div class="pf-ql-actions">
              <button
                class="pf-ql-add"
                disabled={agentDiagnosticsLoading()}
                onClick={() => void reloadAgentDiagnostics()}
              >
                <IconRefresh size={13} />
                {agentDiagnosticsLoading() ? "Checking…" : "Refresh agent status"}
              </button>
            </div>
          </Show>
        </AgentModelsSettingsSection>

        <Show when={flagEnabled("operator")}>
          <OperatorRouterSettingsSection><div class="pf-settings-row">
            <span class="pf-settings-label">Backend</span>
            <Dropdown
              class="pf-settings-dropdown"
              value={routerBackend()}
              onChange={changeRouterBackend}
              options={routerBackendOptions}
            />
          </div>
          <Show when={!accountSession()}>
            <span class="pf-settings-muted">Sign in to use hosted routing.</span>
          </Show>
          <Show when={routerBackend() === "hosted" && accountSession()}>
            <span class="pf-settings-muted">
              Hosted routing uses PickForge credits. Local and BYO routing stay free.
            </span>
          </Show>
          <Show when={activeRouterBackend()}>
            {(backend) => (
              <>
                <div class="pf-settings-row">
                  <span class="pf-settings-label">Model</span>
                  <input
                    class="pf-input pf-router-model"
                    value={operatorRouterSettings().models[backend()]}
                    spellcheck={false}
                    onInput={(e) => changeRouterModel(backend(), e.currentTarget.value)}
                  />
                </div>
                <Show when={routerLatencyHint()}>
                  {(hint) => <span class="pf-settings-muted">{hint()}</span>}
                </Show>
              </>
            )}
          </Show></OperatorRouterSettingsSection>
        </Show>

        <Show when={flagEnabled("operator")}>
          <DictationSettingsSection><div class="pf-settings-row">
            <span class="pf-settings-label">
              Microphone
              <span class="pf-settings-hint-inline">show the mic in the operator dock</span>
            </span>
            <div class="pf-seg">
              <button
                classList={{ active: voiceDictationSettings().micEnabled }}
                onClick={() => setVoiceMicEnabled(true)}
              >
                On
              </button>
              <button
                classList={{ active: !voiceDictationSettings().micEnabled }}
                onClick={() => setVoiceMicEnabled(false)}
              >
                Off
              </button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Push to command
              <span class="pf-settings-hint-inline">run the command automatically once dictation finishes</span>
            </span>
            <div class="pf-seg">
              <button
                classList={{ active: voiceDictationSettings().pushToCommand }}
                onClick={() => setVoicePushToCommand(true)}
              >
                On
              </button>
              <button
                classList={{ active: !voiceDictationSettings().pushToCommand }}
                onClick={() => setVoicePushToCommand(false)}
              >
                Off
              </button>
            </div>
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              Whisper model
              <span class="pf-settings-hint-inline">absolute path to a ggml model (no ~ expansion); empty uses the default</span>
            </span>
            <input
              class="pf-input"
              value={voiceDictationSettings().modelPath}
              placeholder={voiceState()?.modelPath ?? "/absolute/path/to/ggml-base.bin"}
              spellcheck={false}
              onInput={(e) => changeVoiceModelPath(e.currentTarget.value)}
              onChange={() => void reloadVoice()}
            />
          </div>
          <div class="pf-settings-row">
            <span class="pf-settings-label">Status</span>
            <span class="pf-settings-muted">{voiceStatusLabel()}</span>
          </div></DictationSettingsSection>
        </Show>

        <ChatsSettingsSection><div class="pf-settings-row">
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
        </div></ChatsSettingsSection>

        <PickLabSettingsSection><div class="pf-settings-row">
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
        </div></PickLabSettingsSection>

        <RemoteHostSettingsSection><div class="pf-settings-row">
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
        </div></RemoteHostSettingsSection>

        <QuickLaunchSettingsSection><div class="pf-ql-head">
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
          <For each={optionalQuickLaunchChoices()}>
            {(choice) => (
              <button
                class="pf-ql-add"
                onClick={() => addOptionalQuickLaunch(choice.agentId)}
              >
                <IconPlus size={13} /> Add {choice.label}
              </button>
            )}
          </For>
          <button class="pf-text-btn" onClick={resetQuickLaunchItems}>
            Reset defaults
          </button>
        </div></QuickLaunchSettingsSection>

        <AppearanceSettingsSection><div class="pf-settings-row">
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
        </div></AppearanceSettingsSection>

        <WorkbenchSettingsSection><div class="pf-settings-row">
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
        </div></WorkbenchSettingsSection>

        <FileOpeningSettingsSection><div class="pf-settings-row">
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
        </span></FileOpeningSettingsSection>

        <UpdatesSettingsSection><div class="pf-settings-row">
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
        </Show></UpdatesSettingsSection>

        <ArchivedProjectsSettingsSection><Show
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
        </Show></ArchivedProjectsSettingsSection>

        <Show when={flagEnabled("accounts")}>
          <AccountSettingsSection><Show
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
                      <button
                        class="pf-ql-add"
                        onClick={() => {
                          setAccountNotice(null);
                          void signIn("github");
                        }}
                      >
                        Continue with GitHub
                      </button>
                      <button
                        class="pf-ql-add"
                        onClick={() => {
                          setAccountNotice(null);
                          void signIn("google");
                        }}
                      >
                        Continue with Google
                      </button>
                    </div>
                    <Show when={flagEnabled("settingsSync")}>
                      <span class="pf-settings-muted">Sign in to sync settings.</span>
                    </Show>
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
                    <Show when={flagEnabled("operator")}>
                      <div class="pf-settings-row">
                        <span class="pf-settings-label">
                          Operator credits
                          <span class="pf-settings-hint-inline">prepaid balance for hosted routing</span>
                        </span>
                        <span class="pf-settings-muted">
                          {creditBalanceCents() === null
                            ? "—"
                            : formatCreditBalance(creditBalanceCents()!)}
                        </span>
                      </div>
                      <div class="pf-ql-row">
                        <For each={CREDIT_PACKS}>
                          {(option) => (
                            <button
                              class="pf-ql-add"
                              disabled={creditCheckoutBusy()}
                              onClick={() => void buyCredits(option.pack)}
                            >
                              {option.priceLabel}
                            </button>
                          )}
                        </For>
                      </div>
                      <span class="pf-settings-muted">
                        Credits pay for hosted Operator routing (and later hosted voice). Local and BYO routing stay free.
                      </span>
                      <Show when={creditCheckoutError()}>
                        <div class="pf-ql-warn">{creditCheckoutError()}</div>
                      </Show>
                    </Show>
                    <span class="pf-settings-muted">
                      {flagEnabled("settingsSync")
                        ? "PickForge sends no project data to your account beyond the settings groups you enable below. Only profile, entitlement state, and those groups sync."
                        : "PickForge sends no project data to your account. Only profile and entitlement state sync."}
                    </span>
                    <Show when={flagEnabled("settingsSync")}>
                      <div class="pf-settings-row">
                        <span class="pf-settings-label">
                          Settings sync
                          <span class="pf-settings-hint-inline">sync your preferences across signed-in machines</span>
                        </span>
                        <div class="pf-seg">
                          <button
                            classList={{ active: settingsSyncState().optedIn }}
                            onClick={() => setSettingsSyncOptIn(true)}
                          >
                            On
                          </button>
                          <button
                            classList={{ active: !settingsSyncState().optedIn }}
                            onClick={() => setSettingsSyncOptIn(false)}
                          >
                            Off
                          </button>
                        </div>
                      </div>
                      <span class="pf-settings-muted">
                        Synced groups hold UI preferences, operator router choices, quick-launch keybindings, and remote host bindings. Secrets and absolute local paths are blocked from syncing.
                      </span>
                      <Show when={settingsSyncState().optedIn}>
                        <For each={SYNC_GROUPS}>
                          {(group) => (
                            <div class="pf-settings-row">
                              <span class="pf-settings-label">
                                {SYNC_GROUP_LABELS[group].title}
                                <span class="pf-settings-hint-inline">{SYNC_GROUP_LABELS[group].hint}</span>
                              </span>
                              <div class="pf-seg">
                                <button
                                  classList={{ active: settingsSyncState().groups[group] }}
                                  onClick={() => setSettingsSyncGroup(group, true)}
                                >
                                  On
                                </button>
                                <button
                                  classList={{ active: !settingsSyncState().groups[group] }}
                                  onClick={() => setSettingsSyncGroup(group, false)}
                                >
                                  Off
                                </button>
                              </div>
                            </div>
                          )}
                        </For>
                        <div class="pf-ql-actions">
                          <button
                            class="pf-ql-add"
                            disabled={settingsSyncing()}
                            onClick={() => syncNow()}
                          >
                            <IconRefresh size={13} /> {settingsSyncing() ? "Syncing…" : "Sync now"}
                          </button>
                          <span class="pf-settings-muted">
                            {lastSyncedRelative() ? `Last synced ${lastSyncedRelative()}` : "Not synced yet"}
                          </span>
                        </div>
                        <Show when={settingsSyncErrorMessage()}>
                          <div class="pf-ql-warn">{settingsSyncErrorMessage()}</div>
                        </Show>
                      </Show>
                    </Show>
                    <div class="pf-account-tools">
                      <MonoEyebrow text="Your data" />
                      <span class="pf-settings-muted">
                        A portable copy of your PickForge account data — profile, entitlements, credit ledger, and synced settings.
                      </span>
                      <div class="pf-ql-actions">
                        <button
                          class="pf-ql-add"
                          disabled={exporting()}
                          onClick={() => void runExport()}
                        >
                          {exporting() ? "Exporting…" : "Export my data"}
                        </button>
                        <Show when={exportStatus()}>
                          {(status) => (
                            <span
                              class="pf-account-status"
                              classList={{ "pf-account-status--error": status().kind === "error" }}
                            >
                              {status().text}
                            </span>
                          )}
                        </Show>
                      </div>
                    </div>
                    <div class="pf-ql-actions">
                      <button class="pf-text-btn" onClick={() => void signOut()}>
                        Sign out
                      </button>
                    </div>
                    <div class="pf-danger-zone">
                      <MonoEyebrow text="Danger zone" />
                      <div class="pf-settings-row">
                        <span class="pf-settings-label">
                          Delete account
                          <span class="pf-settings-hint-inline">permanently remove your account and all associated data</span>
                        </span>
                        <button class="pf-danger-btn" onClick={openDeleteDialog}>
                          Delete account
                        </button>
                      </div>
                    </div>
                    <ConfirmDialog
                      open={deleteOpen()}
                      eyebrow="Danger zone"
                      title="Delete your account?"
                      destructive
                      confirmLabel={deleting() ? "Deleting…" : "Delete account"}
                      confirmDisabled={!deleteConfirmMatches(deleteConfirm(), account().email)}
                      busy={deleting()}
                      onCancel={closeDeleteDialog}
                      onConfirm={() => void runDelete(account().email)}
                    >
                      <p class="pf-confirm-para">
                        This permanently deletes your PickForge account and all associated data — profile, entitlements, synced settings, and credit ledger.
                      </p>
                      <p class="pf-confirm-para pf-confirm-para--warn">
                        Any remaining credits are forfeited and this cannot be undone.
                      </p>
                      <p class="pf-confirm-para">
                        Local projects and code on this machine are not touched — they never left your device.
                      </p>
                      <label class="pf-confirm-field">
                        <span>Type DELETE to confirm.</span>
                        <input
                          class="pf-confirm-input"
                          type="text"
                          autocomplete="off"
                          spellcheck={false}
                          placeholder="DELETE"
                          value={deleteConfirm()}
                          disabled={deleting()}
                          onInput={(e) => setDeleteConfirm(e.currentTarget.value)}
                        />
                      </label>
                      <Show when={deleteError()}>
                        <span class="pf-account-status pf-account-status--error">{deleteError()}</span>
                      </Show>
                    </ConfirmDialog>
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
          <Show when={accountNotice()}>
            <div class="pf-ql-warn">{accountNotice()}</div>
          </Show>
          <Show when={accountError()}>
            <div class="pf-ql-warn">{accountError()}</div>
          </Show></AccountSettingsSection>
        </Show>

        <Show when={import.meta.env.DEV}>
          <FeatureFlagsSettingsSection><For each={flagStates()}>
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
          </For></FeatureFlagsSettingsSection>
        </Show>
      </div>
  );

  return (
    <div
      class="pf-screen pf-screen--scroll"
      classList={{ "pf-screen--settings-navigation": flagEnabled("settingsNavigation") }}
    >
      <header class="pf-screen-head">
        <MonoEyebrow text="Settings" tick />
      </header>

      <Show
        when={flagEnabled("settingsNavigation")}
        fallback={renderSettings(false)}
      >
        <SettingsNavigation
          categories={availableCategories()}
          active={activeCategory()}
          onSelect={selectCategory}
          paneRef={(element) => setSettingsPane(element)}
        >
          {renderSettings(true)}
        </SettingsNavigation>
      </Show>
    </div>
  );
}
