import { createEffect, createMemo, createSignal, For, Index, onCleanup, onMount, Show, type JSX } from "solid-js";
import {
  agentAuthFact,
  agentProfiles,
  discoverAgentCli,
  discoverCodexModels,
  loadAgentModels,
  isCompatibleOmpAcpVersion,
  OMP_ACP_VERSION_RANGE,
  OMP_MODEL_CATALOG_ADVISORY,
  setAgentModel,
  type AgentCliDiagnostic,
  type AgentProfile,
} from "../lib/agentModels";
import {
  isCompatiblePiRpcVersion,
  type AgentEngine,
} from "../lib/agentBackends";
import { probeAgentAuth, probePiKit, type AgentAuthProbe, type PiKitDetection } from "../lib/process";
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
import { MonoEyebrow, StatusPill, type StatusIntent } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import {
  IconClaude,
  IconClose,
  IconIngot,
  IconOmp,
  IconOpenAI,
  IconPi,
  IconPlus,
  IconRefresh,
} from "../components/icons";
import { currentZoom, zoomIn, zoomOut, zoomReset } from "../lib/zoom";
import { errorText } from "../lib/errors";
import { setRunButtonLabels, workbenchPrefs } from "../stores/workbenchPrefs";
import {
  setWindowControlsSide,
  windowControlsSide,
  type ControlsSide,
} from "../stores/windowControls";
import { hostPlatform } from "../lib/platform";
import {
  linuxGraphicsBootModeGet,
  linuxGraphicsGet,
  linuxGraphicsRecommendationDismiss,
  linuxGraphicsRecommendationGet,
  linuxGraphicsSet,
  type LinuxGraphicsMode,
} from "../lib/linuxGraphics";
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
import { checkForStudioUpdate, studioUpdateState } from "../stores/studioUpdate";
import { isStudioUpdateBusy, studioUpdateErrorMessage, studioUpdateLabel } from "../lib/studioUpdateView";
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
  remoteHostRevokeClient,
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
  setVoiceOutput,
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
import { PiKitLanesPanel } from "../components/pikit/PiKitLanesPanel";
import * as db from "../lib/db";
import {
  legacyStopConfirmTitle,
  legacyStopIsRisky,
  listLegacySessions,
  stopLegacySession,
  type LegacySessionReport,
  type LegacyStopRequest,
} from "../lib/pty";
import {
  AccountSettingsSection,
  AgentModelsSettingsSection,
  AppearanceSettingsSection,
  ArchivedProjectsSettingsSection,
  ChatsSettingsSection,
  DictationSettingsSection,
  FeatureFlagsSettingsSection,
  FileOpeningSettingsSection,
  LegacySessionsSettingsSection,
  LinuxGraphicsSettingsSection,
  OperatorRouterSettingsSection,
  PickLabSettingsSection,
  PiKitLanesSettingsSection,
  QuickLaunchSettingsSection,
  RemoteHostSettingsSection,
  UpdatesSettingsSection,
  WorkbenchSettingsSection,
} from "./settingsSections";
import { SettingsNavigation } from "./SettingsNavigation";
import {
  availableSettingsCategories,
  firstSettingsSectionForCategory,
  loadRememberedSettingsCategory,
  rememberSettingsCategory,
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

function updateLabel(): string {
  switch (updateStatus()) {
    case "available": return `Version ${updateAvailable()?.version} available`;
    case "none": return "You're up to date";
    case "checking": return "Checking…";
    case "downloading": return "Downloading…";
    case "ready": return "Restarting…";
    case "error": return "Update check failed";
    default: return "Check for the latest release";
  }
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

const LINUX_GRAPHICS_MODE_DESCRIPTIONS: Record<LinuxGraphicsMode, string> = {
  auto: "Prefer X11/XWayland in a mixed session; keep the WebKitGTK DMA-BUF renderer on.",
  compatibility: "Prefer X11/XWayland and disable the WebKitGTK DMA-BUF renderer — the verified fast path on affected AMD/KDE systems.",
  "native-wayland": "Opt into native Wayland; keep the WebKitGTK DMA-BUF renderer on.",
};

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

type AgentConnectorState = {
  label: string;
  intent: StatusIntent;
  reason: string;
};

function connectorNativeState(
  agent: AgentProfile,
  diagnostic: AgentCliDiagnostic | undefined,
  failure: string | undefined,
  loading: boolean,
): AgentConnectorState {
  if (loading) {
    return {
      label: "Checking native chat…",
      intent: "neutral",
      reason: `Checking the installed ${agent.label} CLI and native protocol support.`,
    };
  }
  if (failure) {
    return {
      label: "Native status unavailable",
      intent: "error",
      reason: `The local compatibility probe failed: ${failure}`,
    };
  }
  if (!diagnostic) {
    return {
      label: "Native chat not checked",
      intent: "neutral",
      reason: "Refresh connector status to check native chat compatibility.",
    };
  }
  if (!diagnostic.installed) {
    return {
      label: "Native chat unavailable",
      intent: "neutral",
      reason: `${agent.binary} is not installed on PATH. Terminal launch and native chat are unavailable.`,
    };
  }
  if (diagnostic.capabilities.nativeChat) {
    return {
      label: "Native chat ready",
      intent: "connected",
      reason: agent.id === "omp"
        ? "ACP integration is available; the compatibility probe runs with extensions disabled."
        : "Pi RPC loads installed extensions and tools; native approvals and per-session MCP grants are not available.",
    };
  }
  if (agent.id === "omp") {
    const capabilityErrors = diagnostic.errors.filter(
      (error) => error !== OMP_MODEL_CATALOG_ADVISORY,
    );
    return {
      label: "Native chat unavailable",
      intent: "warning",
      reason: !isCompatibleOmpAcpVersion(diagnostic.version)
        ? `Native chat requires OMP ${OMP_ACP_VERSION_RANGE}; found ${diagnostic.version ?? "an unknown version"}. Terminal launch remains available.`
        : capabilityErrors.length > 0
          ? `OMP compatibility probe did not qualify: ${capabilityErrors.join("; ")}. Terminal launch remains available.`
          : `OMP ${OMP_ACP_VERSION_RANGE} did not report the required ACP and no-extensions support. Terminal launch remains available.`,
    };
  }
  return {
    label: "Native chat unavailable",
    intent: "warning",
    reason: !isCompatiblePiRpcVersion(diagnostic.version)
      ? `Native Pi RPC requires >=0.79.10 and <0.82.0; found ${diagnostic.version ?? "an unknown version"}. Terminal launch remains available.`
      : diagnostic.errors.length > 0
        ? `Pi compatibility probe did not qualify: ${diagnostic.errors.join("; ")}. Terminal launch remains available.`
        : "The Pi compatibility probe did not report native RPC support. Terminal launch remains available.",
  };
}

function connectorCapabilitySummary(
  diagnostic: AgentCliDiagnostic | undefined,
  failure: string | undefined,
  loading: boolean,
): string {
  if (loading) return "Capabilities pending local probe.";
  if (failure) return "Capabilities unavailable because the local probe failed.";
  if (!diagnostic) return "Capabilities not checked.";
  if (!diagnostic.installed) return "Capabilities unavailable until the CLI is installed.";
  const capabilities = ["terminal launch"];
  if (diagnostic.capabilities.nativeChat) capabilities.push("native chat");
  if (diagnostic.capabilities.dynamicModels) capabilities.push("offline model catalog");
  if (diagnostic.capabilities.providerSelection) capabilities.push("provider selection");
  if (diagnostic.capabilities.profiles) capabilities.push("named profiles");
  return `Available: ${capabilities.join(" · ")}`;
}

const PI_KIT_INSTALL_HINT = "Not installed · optional Pi extension pack (github.com/ElbertePlinio/pi-kit)";

/** Fact-row text for the pi-kit shim probe. Absence is neutral, never an
 * error: it is an optional personal extension pack, not part of Pi itself. */
function piKitFactLabel(
  loading: boolean,
  failure: string | null,
  detection: PiKitDetection | null,
): string {
  if (loading) return "Checking…";
  if (failure) return "Unavailable · local probe failed";
  if (!detection) return "Not checked";
  if (!detection.detected) return PI_KIT_INSTALL_HINT;
  const version = detection.version ? `v${detection.version}` : "unknown version";
  const count = detection.linkedExtensionCount;
  return `Detected · ${version} · ${count} extension${count === 1 ? "" : "s"}`;
}

function isConnectorProfile(agent: AgentProfile): boolean {
  return agent.id === "omp" || agent.id === "pi";
}
const AGENT_DIAGNOSTIC_IDS = ["omp", "pi"] as const;
/** Codex and Claude Code are always-available native agents (no rollout
 * flag), so their auth-presence probe runs unconditionally alongside the
 * flag-gated omp/pi connector diagnostics. */
const AGENT_AUTH_DIAGNOSTIC_IDS = ["codex", "claudeCode"] as const;
const AGENT_BRAND_ICON: Readonly<Partial<Record<string, () => JSX.Element>>> = Object.freeze({
  claudeCode: () => <IconClaude size={14} />,
  codex: () => <IconOpenAI size={14} />,
  omp: () => <IconOmp size={14} />,
  pi: () => <IconPi size={14} />,
});

/** The settings category/section navigation state: active category, the
 *  scrollable pane ref, and the scroll-to-section alignment effect that
 *  fires when the route's requested section changes. A composable, called
 *  synchronously from `SettingsScreen`'s own setup so its `createEffect`
 *  runs under the same reactive owner as if written inline. */
// Scrolls the settings pane so `requestedSection` sits at the top, cancelling
// on the first user scroll/touch/pointer/scroll-key gesture (a programmatic
// scroll must never fight one the user just started) or once the layout
// settles. Called synchronously from `createSettingsCategoryState`'s section-
// change effect so `onCleanup` binds to that effect's run.
function alignSettingsPaneToSection(
  pane: HTMLElement,
  directCategory: SettingsCategoryKey,
  requestedSection: string,
  context: SettingsSectionAvailabilityContext,
  activeCategory: () => SettingsCategoryKey,
  settingsPane: () => HTMLElement | null,
): void {
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
}

function createSettingsCategoryState() {
  const [activeCategory, setActiveCategory] = createSignal<SettingsCategoryKey>(
    loadRememberedSettingsCategory() as SettingsCategoryKey ?? "general",
  );
  const [settingsPane, setSettingsPane] = createSignal<HTMLElement | null>(null);

  const settingsAvailability = (): SettingsSectionAvailabilityContext => ({
    operator: flagEnabled("operator"),
    accounts: flagEnabled("accounts"),
    development: import.meta.env.DEV,
    linux: hostPlatform() === "linux",
    pikitLanes: flagEnabled("pikitLanes"),
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

      alignSettingsPaneToSection(pane, directCategory, requestedSection, context, activeCategory, settingsPane);
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

  return {
    activeCategory,
    settingsPane,
    setSettingsPane,
    settingsAvailability,
    availableCategories,
    selectCategory,
  };
}

/** Export/delete-account lifecycle: the two dialogs' local state, reset
 *  whenever the signed-in account changes so a next/anonymous account never
 *  inherits the last account's export path or a half-typed confirmation. A
 *  composable, called synchronously from `SettingsScreen`'s own setup so its
 *  `createEffect` runs under the same reactive owner as if written inline. */
function createAccountLifecycleState() {
  const [exporting, setExporting] = createSignal(false);
  const [exportStatus, setExportStatus] = createSignal<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteConfirm, setDeleteConfirm] = createSignal("");
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const [accountNotice, setAccountNotice] = createSignal<string | null>(null);

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

  return {
    exporting,
    exportStatus,
    deleteOpen,
    deleteConfirm,
    setDeleteConfirm,
    deleting,
    deleteError,
    accountNotice,
    setAccountNotice,
    runExport,
    openDeleteDialog,
    closeDeleteDialog,
    runDelete,
  };
}

/** Agent connector diagnostics: model selection, the omp/pi native-chat
 *  compatibility probes, pi-kit detection, and the codex/claudeCode auth
 *  probes. A composable, called synchronously from `SettingsScreen`'s own
 *  setup — its `reloadAgentDiagnostics` is invoked by the screen's mount/
 *  flag-change lifecycle composable, not here, since that lifecycle also
 *  coordinates several other sections' initial loads. */
function createAgentDiagnosticsState() {
  const [models, setModels] = createSignal(loadAgentModels());
  const [agentDiagnostics, setAgentDiagnostics] =
    createSignal<Record<string, AgentCliDiagnostic>>({});
  const [agentDiagnosticErrors, setAgentDiagnosticErrors] =
    createSignal<Record<string, string>>({});
  const [agentDiagnosticsLoading, setAgentDiagnosticsLoading] = createSignal(false);
  const [piKitDetection, setPiKitDetection] = createSignal<PiKitDetection | null>(null);
  const [piKitError, setPiKitError] = createSignal<string | null>(null);
  const [agentAuthProbes, setAgentAuthProbes] =
    createSignal<Record<string, AgentAuthProbe>>({});
  const [agentAuthErrors, setAgentAuthErrors] =
    createSignal<Record<string, string>>({});

  const changeModel = (agentId: string, model: string) => {
    setAgentModel(agentId, model || null);
    setModels(loadAgentModels());
  };

  const conflicts = () => conflictingHotkeys(quickLaunchItems());
  const agentLabel = (id?: string) =>
    agentProfiles().find((agent) => agent.id === id)?.label ?? id ?? "";
  const agentModelsFor = (agent: AgentProfile) =>
    agent.models.length > 0 ? agent.models : agentDiagnostics()[agent.id]?.models ?? [];
  const agentStatusLabel = (agent: AgentProfile): string => {
    const diagnostic = agentDiagnostics()[agent.id];
    const failure = agentDiagnosticErrors()[agent.id];
    if (agentDiagnosticsLoading()) return "Checking installation…";
    if (failure) return "Status unavailable";
    if (!diagnostic) return "Not checked";
    if (!diagnostic.installed) return "Not installed";
    return diagnostic.version
      ? `Installed · ${agent.binary} ${diagnostic.version}`
      : `Installed · ${agent.binary}`;
  };

  const enabledAgentDiagnosticIds = () =>
    AGENT_DIAGNOSTIC_IDS.filter((agentId) => agentId === "pi" || flagEnabled("ompAgents"));
  const reloadAgentDiagnostics = async (force = false) => {
    const ids = enabledAgentDiagnosticIds();
    if (ids.length === 0 || agentDiagnosticsLoading()) return;
    setAgentDiagnostics(() => ({}));
    setAgentDiagnosticErrors(() => ({}));
    setPiKitDetection(null);
    setPiKitError(null);
    setAgentAuthProbes(() => ({}));
    setAgentAuthErrors(() => ({}));
    setAgentDiagnosticsLoading(true);
    const next: Record<string, AgentCliDiagnostic> = {};
    const failures: Record<string, string> = {};
    const authNext: Record<string, AgentAuthProbe> = {};
    const authFailures: Record<string, string> = {};
    await Promise.all([
      ...ids.map(async (agentId) => {
        try {
          next[agentId] = await discoverAgentCli(agentId);
        } catch (error) {
          failures[agentId] = errorText(error);
        }
      }),
      ...(ids.includes("pi")
        ? [probePiKit().then(setPiKitDetection).catch((error) => setPiKitError(errorText(error)))]
        : []),
      // Codex/Claude Code have no rollout flag, so their auth-presence probe
      // always runs alongside the flag-gated omp/pi connector diagnostics.
      ...AGENT_AUTH_DIAGNOSTIC_IDS.map(async (agentId) => {
        try {
          authNext[agentId] = await probeAgentAuth(agentId);
        } catch (error) {
          authFailures[agentId] = errorText(error);
        }
      }),
      // Session-TTL-cached; never throws, so it needs no failure slot here —
      // a probe/parse failure just leaves the curated static table in place.
      discoverCodexModels(force),
    ]);
    setAgentDiagnostics(() => next);
    setAgentDiagnosticErrors(() => failures);
    setAgentAuthProbes(() => authNext);
    setAgentAuthErrors(() => authFailures);
    setAgentDiagnosticsLoading(false);
  };

  return {
    models,
    changeModel,
    conflicts,
    agentLabel,
    agentModelsFor,
    agentStatusLabel,
    agentDiagnostics,
    agentDiagnosticErrors,
    agentDiagnosticsLoading,
    piKitDetection,
    piKitError,
    agentAuthProbes,
    agentAuthErrors,
    enabledAgentDiagnosticIds,
    reloadAgentDiagnostics,
  };
}

/** Archived-projects state. A composable, called synchronously from
 *  `SettingsScreen`'s own setup. */
function createArchivedProjectsState() {
  const [archived, setArchived] = createSignal<db.Project[]>([]);
  const reloadArchived = async () => {
    const all = await db.projectsList(true);
    setArchived(all.filter((p) => p.archivedAt !== null));
  };
  const restore = async (root: string) => {
    await db.projectSetArchived(root, null);
    await reloadArchived();
  };
  return { archived, reloadArchived, restore };
}

/** Legacy dtach/tmux session listing + the shared single/bulk stop confirm
 *  flow (pickforge#214). A composable, called synchronously from
 *  `SettingsScreen`'s own setup. */
function createLegacySessionsState() {
  const [legacySessions, setLegacySessions] = createSignal<LegacySessionReport>({
    dtach: [],
    tmux: [],
  });
  const [legacyLoading, setLegacyLoading] = createSignal(false);
  const [legacyError, setLegacyError] = createSignal<string | null>(null);
  // A pending stop the user has NOT yet confirmed — either one named session
  // or the bulk "everything currently listed" sweep. Both go through the
  // SAME confirm dialog below: there is only ever one confirmation pattern,
  // and neither path can execute without it, even for a single row.
  const [legacyConfirm, setLegacyConfirm] = createSignal<LegacyStopRequest | null>(null);
  const [legacyConfirmBusy, setLegacyConfirmBusy] = createSignal(false);

  // pickforge#214 — read-only; safe to call any time the panel is open.
  const reloadLegacySessions = async () => {
    setLegacyLoading(true);
    setLegacyError(null);
    try {
      setLegacySessions(await listLegacySessions());
    } catch (error) {
      setLegacyError(errorText(error));
    } finally {
      setLegacyLoading(false);
    }
  };

  const legacyTotalCount = () =>
    legacySessions().dtach.length + legacySessions().tmux.length;

  const legacyConfirmSingleName = () => {
    const request = legacyConfirm();
    return request?.scope === "single" ? request.name : "";
  };

  // Executes whichever request the user just confirmed — one named session
  // or the bulk "everything currently listed" sweep — captured from the list
  // as it stood when the button was clicked. Neither path can run without
  // going through this confirmation first, even for a single row. One
  // failure in the bulk path doesn't abort the rest; every failure is
  // collected and shown.
  const confirmLegacyStop = async () => {
    const request = legacyConfirm();
    if (!request) return;
    setLegacyConfirmBusy(true);
    setLegacyError(null);
    if (request.scope === "single") {
      try {
        await stopLegacySession(request.kind, request.name);
      } catch (error) {
        setLegacyError(errorText(error));
      }
    } else {
      const { dtach, tmux } = legacySessions();
      const failures: string[] = [];
      for (const session of dtach) {
        try {
          await stopLegacySession("dtach", session.name);
        } catch (error) {
          failures.push(`${session.name}: ${errorText(error)}`);
        }
      }
      for (const session of tmux) {
        try {
          await stopLegacySession("tmux", session.name);
        } catch (error) {
          failures.push(`${session.name}: ${errorText(error)}`);
        }
      }
      if (failures.length > 0) setLegacyError(failures.join("; "));
    }
    await reloadLegacySessions();
    setLegacyConfirmBusy(false);
    setLegacyConfirm(null);
  };

  return {
    legacySessions,
    legacyLoading,
    legacyError,
    legacyConfirm,
    setLegacyConfirm,
    legacyConfirmBusy,
    reloadLegacySessions,
    legacyTotalCount,
    legacyConfirmSingleName,
    confirmLegacyStop,
  };
}

/** PickLab CLI/MCP status. A composable, called synchronously from
 *  `SettingsScreen`'s own setup. */
function createPickLabState() {
  const [pickLab, setPickLab] = createSignal<PickLabStatus | null>(null);
  const [pickLabLoading, setPickLabLoading] = createSignal(false);
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
        error: errorText(error),
      });
    } finally {
      setPickLabLoading(false);
    }
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
  return { pickLab, pickLabLoading, reloadPickLab, pickLabDoctorLabel, pickLabAgentsLabel };
}

/** Crash-report telemetry opt-in. A composable, called synchronously from
 *  `SettingsScreen`'s own setup. */
function createTelemetryState() {
  const [crashReports, setCrashReports] = createSignal(true);
  const [crashReportsError, setCrashReportsError] = createSignal<string | null>(null);
  const reloadTelemetry = async () => {
    try {
      const config = await telemetryGet();
      setCrashReports(config.crash_reports);
      setCrashReportsError(null);
    } catch (error) {
      setCrashReportsError(errorText(error));
    }
  };
  const changeCrashReports = async (on: boolean) => {
    const previous = crashReports();
    setCrashReports(on);
    setCrashReportsError(null);
    try {
      await telemetrySet(on);
    } catch (error) {
      setCrashReports(previous);
      setCrashReportsError(errorText(error));
    }
  };
  return { crashReports, crashReportsError, reloadTelemetry, changeCrashReports };
}

/** Linux graphics-compatibility mode (GTK/WebKitGTK rendering backend). A
 *  composable, called synchronously from `SettingsScreen`'s own setup. */
function createLinuxGraphicsState() {
  const [linuxGraphicsMode, setLinuxGraphicsMode] = createSignal<LinuxGraphicsMode>("auto");
  // What startup actually applied — independent of any edit made this
  // session. Restart-required is derived by comparing the live selection
  // against this, so it survives Settings remounts and clears correctly on
  // an A→B→A round trip instead of "sticking" as a component-lifetime flag.
  const [linuxGraphicsBootMode, setLinuxGraphicsBootMode] = createSignal<LinuxGraphicsMode>("auto");
  const [linuxGraphicsError, setLinuxGraphicsError] = createSignal<string | null>(null);
  const [linuxGraphicsRecommendation, setLinuxGraphicsRecommendation] = createSignal(false);
  const linuxGraphicsRestartRequired = () => linuxGraphicsMode() !== linuxGraphicsBootMode();

  const reloadLinuxGraphics = async () => {
    try {
      const config = await linuxGraphicsGet();
      setLinuxGraphicsMode(config.mode);
      setLinuxGraphicsError(null);
    } catch (error) {
      setLinuxGraphicsError(errorText(error));
    }
    try {
      setLinuxGraphicsBootMode(await linuxGraphicsBootModeGet());
    } catch {
      // Leave the previous boot-mode guess in place — worst case the
      // restart notice is briefly wrong until the next successful reload,
      // never crashes the section.
    }
    try {
      setLinuxGraphicsRecommendation(await linuxGraphicsRecommendationGet());
    } catch {
      setLinuxGraphicsRecommendation(false);
    }
  };

  const changeLinuxGraphicsMode = async (mode: LinuxGraphicsMode) => {
    const previous = linuxGraphicsMode();
    if (mode === previous) return;
    setLinuxGraphicsMode(mode);
    setLinuxGraphicsError(null);
    try {
      await linuxGraphicsSet(mode);
    } catch (error) {
      setLinuxGraphicsMode(previous);
      setLinuxGraphicsError(errorText(error));
      return;
    }
    // The persisted mode changed, so the one-time recommendation's
    // applicability may have too (e.g. it never re-fires once mode != Auto) —
    // refetch rather than let a stale banner linger until remount.
    try {
      setLinuxGraphicsRecommendation(await linuxGraphicsRecommendationGet());
    } catch {
      setLinuxGraphicsRecommendation(false);
    }
  };

  const dismissLinuxGraphicsRecommendation = async () => {
    setLinuxGraphicsRecommendation(false);
    try {
      await linuxGraphicsRecommendationDismiss();
    } catch (error) {
      setLinuxGraphicsError(errorText(error));
    }
  };

  const restartPickforge = async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  };

  return {
    linuxGraphicsMode,
    linuxGraphicsError,
    linuxGraphicsRecommendation,
    linuxGraphicsRestartRequired,
    reloadLinuxGraphics,
    changeLinuxGraphicsMode,
    dismissLinuxGraphicsRecommendation,
    restartPickforge,
  };
}

/** Remote-host pairing/listener/client management, plus a 1s pairing-expiry
 *  re-render tick. A composable, called synchronously from `SettingsScreen`'s
 *  own setup so its `onCleanup` runs under the same reactive owner as if
 *  written inline. */
/** The listener/pairing/tailscale signals and their read-only labels, plus
 *  start/stop/toggle actions. A composable, called synchronously from
 *  `createRemoteHostState`'s own setup so its signals live under the same
 *  reactive owner as if written inline. */
function createRemoteHostBaseState() {
  const [remoteHost, setRemoteHost] = createSignal<RemoteHostOverview | null>(null);
  const [remotePort, setRemotePort] = createSignal("4747");
  const [remoteLoading, setRemoteLoading] = createSignal(false);
  const [remoteError, setRemoteError] = createSignal<string | null>(null);

  const reloadRemoteHost = async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const next = await remoteHostStatus();
      setRemoteHost(next);
      setRemotePort(String(next.listener.kind === "loopback" ? next.listener.port : next.defaultPort));
    } catch (error) {
      setRemoteError(errorText(error));
    } finally {
      setRemoteLoading(false);
    }
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
      setRemoteError(errorText(error));
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
      setRemoteError(errorText(error));
    } finally {
      setRemoteLoading(false);
    }
  };
  const toggleSsh = async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      await remoteTailscaleSshSet(remoteHost()?.tailscale.sshEnabled !== true);
      await reloadRemoteHost();
    } catch (error) {
      setRemoteError(errorText(error));
      setRemoteLoading(false);
    }
  };

  return {
    remoteHost,
    setRemoteHost,
    remotePort,
    setRemotePort,
    remoteLoading,
    setRemoteLoading,
    remoteError,
    setRemoteError,
    reloadRemoteHost,
    tailscaleLabel,
    sshLabel,
    startRemote,
    stopRemote,
    toggleSsh,
  };
}

/** Pairing-code issue/copy + client revoke, plus the 1s pairing-expiry
 *  re-render tick. A composable, called synchronously from
 *  `createRemoteHostState`'s own setup so its `onCleanup` runs under the
 *  same reactive owner as if written inline. */
function createRemoteHostPairingState(base: ReturnType<typeof createRemoteHostBaseState>) {
  const [revokingClientId, setRevokingClientId] = createSignal<string | null>(null);
  const [remoteNow, setRemoteNow] = createSignal(Date.now());

  const activePairingCode = (): PairingCode | null => {
    const now = remoteNow();
    const codes = base.remoteHost()?.pairingCodes ?? [];
    return [...codes].reverse().find((code) => !code.usedAtMs && code.expiresAtMs > now) ?? null;
  };
  const issuePairing = async () => {
    base.setRemoteLoading(true);
    base.setRemoteError(null);
    try {
      setRemoteNow(Date.now());
      await remoteHostIssuePairingCode();
      await base.reloadRemoteHost();
    } catch (error) {
      base.setRemoteError(errorText(error));
      base.setRemoteLoading(false);
    }
  };
  const copyPairing = async () => {
    const code = activePairingCode()?.code;
    if (!code) {
      await issuePairing();
      return;
    }
    if (!navigator.clipboard?.writeText) {
      base.setRemoteError("Clipboard copy is unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      base.setRemoteError(null);
    } catch {
      base.setRemoteError("Could not copy pairing code");
    }
  };
  const revokeClient = async (clientId: string) => {
    if (revokingClientId()) return;
    setRevokingClientId(clientId);
    base.setRemoteError(null);
    try {
      await remoteHostRevokeClient(clientId);
      base.setRemoteHost(await remoteHostStatus());
    } catch (error) {
      base.setRemoteError(errorText(error));
    } finally {
      setRevokingClientId(null);
    }
  };

  const pairingExpiryTimer = window.setInterval(() => setRemoteNow(Date.now()), 1_000);
  onCleanup(() => window.clearInterval(pairingExpiryTimer));

  return { revokingClientId, activePairingCode, issuePairing, copyPairing, revokeClient };
}

function createRemoteHostState() {
  const base = createRemoteHostBaseState();
  const pairing = createRemoteHostPairingState(base);
  return { ...base, ...pairing };
}

/** Voice-dictation model status. A composable, called synchronously from
 *  `SettingsScreen`'s own setup. */
function createVoiceSettingsState() {
  const [voiceState, setVoiceState] = createSignal<VoiceStatus | null>(null);
  const reloadVoice = async () => {
    try {
      setVoiceState(await voiceStatus(voiceModelOverride()));
    } catch (error) {
      setVoiceState({
        available: false,
        missing: [],
        modelPath: null,
        error: errorText(error),
      });
    }
  };
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
  return { voiceState, reloadVoice, voiceStatusLabel, changeVoiceModelPath };
}

/** Operator router backend/model selection + credit checkout, plus the
 *  credit-balance refresh effect (on mount and window focus, while signed in
 *  with the operator flag on). A composable, called synchronously from
 *  `SettingsScreen`'s own setup so its `createEffect`/`onMount` run under the
 *  same reactive owner as if written inline. */
function createOperatorRouterState() {
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
  const changeRouterModel = (backend: OperatorRouterBackend, model: string) =>
    setOperatorRouterModel(backend, model);

  const [creditCheckoutBusy, setCreditCheckoutBusy] = createSignal(false);
  const [creditCheckoutError, setCreditCheckoutError] = createSignal<string | null>(null);
  const buyCredits = async (pack: CreditPack) => {
    setCreditCheckoutBusy(true);
    setCreditCheckoutError(null);
    try {
      await startCreditCheckout(pack);
    } catch (error) {
      setCreditCheckoutError(errorText(error));
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

  return {
    routerBackendOptions,
    routerBackend,
    activeRouterBackend,
    routerLatencyHint,
    changeRouterBackend,
    changeRouterModel,
    creditCheckoutBusy,
    creditCheckoutError,
    buyCredits,
  };
}

/** Chat-creation defaults (kind, engine, ask-for-title). A composable, called
 *  synchronously from `SettingsScreen`'s own setup. */
function createChatDefaultsState() {
  const [defaultChatKind, setDefaultChatKindSig] = createSignal<DefaultChatKind>(
    loadDefaultChatKind(),
  );
  const [agentEngine, setAgentEngineSig] = createSignal<AgentEngine>(loadAgentEngine());
  const [askChatTitle, setAskChatTitleSig] = createSignal(loadAskChatTitle());

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

  return {
    defaultChatKind,
    changeDefaultChatKind,
    agentEngine,
    changeAgentEngine,
    askChatTitle,
    changeAskChatTitle,
  };
}

/** The quick-launch hotkey-capture flow: pressing a chip's hotkey button
 *  arms `capturingId`, and the next real keydown (Esc cancels, Backspace/
 *  Delete clears) is captured — capture phase so nothing else steals the
 *  key. A composable, called synchronously from `SettingsScreen`'s own setup
 *  so its `createEffect` runs under the same reactive owner as if written
 *  inline. */
function createQuickLaunchCaptureState() {
  const [capturingId, setCapturingId] = createSignal<string | null>(null);

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

  return { capturingId, setCapturingId };
}

/** The screen's mount-time data loads, plus the flag-change subscription
 *  that loads status a hidden feature's onMount deliberately skipped. A
 *  composable, called synchronously from `SettingsScreen`'s own setup so its
 *  `onMount`/`onCleanup` run under the same reactive owner as if written
 *  inline. */
function useSettingsLifecycleMount(deps: {
  reloadArchived: () => Promise<void>;
  reloadPickLab: () => Promise<void>;
  reloadTelemetry: () => Promise<void>;
  reloadRemoteHost: () => Promise<void>;
  reloadLegacySessions: () => Promise<void>;
  reloadLinuxGraphics: () => Promise<void>;
  reloadVoice: () => Promise<void>;
  voiceState: () => VoiceStatus | null;
  reloadAgentDiagnostics: () => Promise<void>;
  enabledAgentDiagnosticIds: () => readonly string[];
  agentDiagnostics: () => Record<string, AgentCliDiagnostic>;
  agentDiagnosticErrors: () => Record<string, string>;
}): void {
  onMount(() => {
    void deps.reloadArchived();
    void deps.reloadPickLab();
    void deps.reloadTelemetry();
    void deps.reloadRemoteHost();
    void deps.reloadLegacySessions();
    if (hostPlatform() === "linux") void deps.reloadLinuxGraphics();
    if (flagEnabled("operator")) void deps.reloadVoice();
    if (deps.enabledAgentDiagnosticIds().length > 0) void deps.reloadAgentDiagnostics();
  });
  // Flipping a rollout flag on while Settings is open loads status that
  // onMount deliberately skipped while the feature was hidden.
  onCleanup(
    subscribeToFlagChanges(() => {
      if (flagEnabled("operator") && deps.voiceState() === null) void deps.reloadVoice();
      if (
        deps.enabledAgentDiagnosticIds().length > 0
        && Object.keys(deps.agentDiagnostics()).length === 0
        && Object.keys(deps.agentDiagnosticErrors()).length === 0
      ) {
        void deps.reloadAgentDiagnostics();
      }
    }),
  );
}

type AgentDiagnosticsState = ReturnType<typeof createAgentDiagnosticsState>;
type OperatorRouterState = ReturnType<typeof createOperatorRouterState>;
type VoiceSettingsState = ReturnType<typeof createVoiceSettingsState>;
type ChatDefaultsState = ReturnType<typeof createChatDefaultsState>;
type PickLabState = ReturnType<typeof createPickLabState>;
type RemoteHostState = ReturnType<typeof createRemoteHostState>;
type QuickLaunchCaptureState = ReturnType<typeof createQuickLaunchCaptureState>;
type LinuxGraphicsState = ReturnType<typeof createLinuxGraphicsState>;
type LegacySessionsState = ReturnType<typeof createLegacySessionsState>;
type ArchivedProjectsState = ReturnType<typeof createArchivedProjectsState>;
type AccountLifecycleState = ReturnType<typeof createAccountLifecycleState>;

const AgentConnectorFacts = (props: {
  agent: AgentProfile;
  diagnostics: AgentDiagnosticsState;
  diagnostic: () => AgentCliDiagnostic | undefined;
  failure: () => string | undefined;
  catalog: () => AgentProfile["models"];
}) => {
  const { agent, diagnostics, diagnostic, failure, catalog } = props;
  return (
    <div class="pf-agent-connector-facts">
      <div class="pf-agent-connector-fact">
        <span class="pf-agent-connector-key">Installation</span>
        <Show
          when={diagnostics.agentDiagnosticsLoading()}
          fallback={
            <Show
              when={failure()}
              fallback={
                <span class="pf-agent-connector-value">
                  {diagnostics.agentStatusLabel(agent)}
                </span>
              }
            >
              <span class="pf-agent-connector-value">Status unavailable</span>
            </Show>
          }
        >
          <span class="pf-agent-connector-value">Checking installation…</span>
        </Show>
      </div>
      <div class="pf-agent-connector-fact">
        <span class="pf-agent-connector-key">Model catalog</span>
        <Show
          when={catalog().length > 0}
          fallback={
            <span class="pf-agent-connector-value">
              {diagnostics.agentDiagnosticsLoading()
                ? "Checking…"
                : failure()
                  ? "Unavailable · local probe failed"
                  : diagnostic()
                    ? !diagnostic()!.installed
                      ? "Unavailable · CLI not installed"
                      : diagnostic()!.errors.length > 0
                        ? `Unavailable · ${diagnostic()!.errors.join("; ")}`
                        : "No models reported"
                    : "Not checked"}
            </span>
          }
        >
          <div class="pf-agent-connector-catalog">
            <Dropdown
              class="pf-settings-dropdown"
              value={diagnostics.models()[agent.id] ?? ""}
              placeholder={`${catalog().length} discovered · CLI default`}
              title={`${agent.label} model`}
              onChange={(value) => diagnostics.changeModel(agent.id, value)}
              options={catalog().map((model) => ({
                value: model.id,
                label: model.label,
                icon: () => <IconIngot size={13} />,
              }))}
            />
            <span class="pf-settings-muted">
              {catalog().length} discovered offline
            </span>
          </div>
        </Show>
      </div>
      <Show when={agent.id === "pi"}>
        <div class="pf-agent-connector-fact">
          <span class="pf-agent-connector-key">pi-kit</span>
          <span class="pf-agent-connector-value">
            {piKitFactLabel(diagnostics.agentDiagnosticsLoading(), diagnostics.piKitError(), diagnostics.piKitDetection())}
          </span>
        </div>
      </Show>
    </div>
  );
};

const AgentConnectorReason = (props: {
  diagnostics: AgentDiagnosticsState;
  diagnostic: () => AgentCliDiagnostic | undefined;
  failure: () => string | undefined;
  nativeState: () => AgentConnectorState;
}) => {
  const { diagnostics, diagnostic, failure, nativeState } = props;
  return (
    <Show
      when={failure()}
      fallback={
        <>
          <p class="pf-agent-connector-reason">{nativeState().reason}</p>
          <p class="pf-agent-connector-capabilities">
            {connectorCapabilitySummary(
              diagnostic(),
              undefined,
              diagnostics.agentDiagnosticsLoading(),
            )}
          </p>
        </>
      }
    >
      {(message) => (
        <>
          <p class="pf-agent-connector-reason">
            The local compatibility probe failed: {message()}
          </p>
          <p class="pf-agent-connector-capabilities">
            Capabilities unavailable because the local probe failed.
          </p>
        </>
      )}
    </Show>
  );
};

const AgentConnectorCard = (props: { agent: AgentProfile; diagnostics: AgentDiagnosticsState }) => {
  const agent = props.agent;
  const diagnostics = props.diagnostics;
  const diagnostic = () => diagnostics.agentDiagnostics()[agent.id];
  const failure = () => diagnostics.agentDiagnosticErrors()[agent.id];
  const nativeState = createMemo(() =>
    connectorNativeState(agent, diagnostic(), failure(), diagnostics.agentDiagnosticsLoading()));
  const catalog = () => diagnostics.agentModelsFor(agent);
  return (
    <section
      class="pf-agent-connector"
      data-agent-connector={agent.id}
      aria-labelledby={`pf-agent-connector-${agent.id}`}
      aria-busy={diagnostics.agentDiagnosticsLoading()}
    >
      <div class="pf-agent-connector-head">
        <div class="pf-agent-connector-identity">
          <span class="pf-settings-brand">
            {AGENT_BRAND_ICON[agent.id]?.()}
          </span>
          <strong id={`pf-agent-connector-${agent.id}`}>{agent.label}</strong>
          <span class="pf-agent-connector-binary">{agent.binary}</span>
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <Show
            when={failure()}
            fallback={
              <StatusPill
                label={nativeState().label}
                intent={nativeState().intent}
              />
            }
          >
            <StatusPill label="Native status unavailable" intent="error" />
          </Show>
        </div>
      </div>

      <AgentConnectorFacts
        agent={agent}
        diagnostics={diagnostics}
        diagnostic={diagnostic}
        failure={failure}
        catalog={catalog}
      />

      <AgentConnectorReason
        diagnostics={diagnostics}
        diagnostic={diagnostic}
        failure={failure}
        nativeState={nativeState}
      />
    </section>
  );
};

const AgentAuthCard = (props: {
  agentId: (typeof AGENT_AUTH_DIAGNOSTIC_IDS)[number];
  diagnostics: AgentDiagnosticsState;
}) => {
  const { agentId, diagnostics } = props;
  const probe = () => diagnostics.agentAuthProbes()[agentId];
  const failure = () => diagnostics.agentAuthErrors()[agentId];
  const fact = createMemo(() =>
    agentAuthFact(agentId, diagnostics.agentDiagnosticsLoading(), failure(), probe()),
  );
  return (
    <section
      class="pf-agent-connector"
      data-agent-auth-connector={agentId}
      aria-labelledby={`pf-agent-auth-${agentId}`}
      aria-busy={diagnostics.agentDiagnosticsLoading()}
    >
      <div class="pf-agent-connector-head">
        <div class="pf-agent-connector-identity">
          <span class="pf-settings-brand">
            {AGENT_BRAND_ICON[agentId]?.()}
          </span>
          <strong id={`pf-agent-auth-${agentId}`}>{diagnostics.agentLabel(agentId)}</strong>
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <StatusPill label={fact().label} intent={fact().intent} />
        </div>
      </div>
      <p class="pf-agent-connector-reason">{fact().reason}</p>
    </section>
  );
};

const AgentModelsContent = (props: { diagnostics: AgentDiagnosticsState }) => {
  const diagnostics = props.diagnostics;
  return (
    <>
      <For each={agentProfiles().filter((agent) => !isConnectorProfile(agent))}>
        {(agent) => (
          <div class="pf-settings-row">
            <span class="pf-settings-label">
              <Show when={AGENT_BRAND_ICON[agent.id]}>
                {(icon) => <span class="pf-settings-brand">{icon()()}</span>}
              </Show>
              {agent.label}
            </span>
            <Show
              when={diagnostics.agentModelsFor(agent).length > 0}
              fallback={<span class="pf-settings-muted">CLI default</span>}
            >
              <Dropdown
                class="pf-settings-dropdown"
                value={diagnostics.models()[agent.id] ?? ""}
                onChange={(value) => diagnostics.changeModel(agent.id, value)}
                options={diagnostics.agentModelsFor(agent).map((model) => ({
                  value: model.id,
                  label: model.label,
                  icon: () => <IconIngot size={13} />,
                }))}
              />
            </Show>
          </div>
        )}
      </For>

      <div class="pf-agent-diagnostics-head" data-agent-diagnostics-head="connectors">
        <div class="pf-agent-diagnostics-copy">
          <MonoEyebrow text="Connector diagnostics" as="h3" />
          <span
            class="pf-settings-muted"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {diagnostics.agentDiagnosticsLoading()
              ? "Checking enabled connectors on the local PATH…"
              : "Read-only local probes; extensions stay disabled during compatibility checks."}
          </span>
        </div>
        <button
          class="pf-ql-add"
          aria-disabled={diagnostics.agentDiagnosticsLoading()}
          onClick={() => void diagnostics.reloadAgentDiagnostics(true)}
        >
          <IconRefresh size={13} />
          {diagnostics.agentDiagnosticsLoading() ? "Checking connectors…" : "Refresh connector status"}
        </button>
      </div>

      <div class="pf-agent-connector-list">
        <For each={agentProfiles().filter(isConnectorProfile)}>
          {(agent) => <AgentConnectorCard agent={agent} diagnostics={diagnostics} />}
        </For>
      </div>

      <div class="pf-agent-diagnostics-head" data-agent-diagnostics-head="auth">
        <div class="pf-agent-diagnostics-copy">
          <MonoEyebrow text="CLI authentication" as="h3" />
          <span class="pf-settings-muted">
            Probe-only, via each CLI's own status command; PickForge never reads
            credential files, tokens, or keychain entries.
          </span>
        </div>
      </div>

      <div class="pf-agent-connector-list">
        <For each={AGENT_AUTH_DIAGNOSTIC_IDS}>
          {(agentId) => <AgentAuthCard agentId={agentId} diagnostics={diagnostics} />}
        </For>
      </div>
    </>
  );
};

const OperatorRouterContent = (props: { router: OperatorRouterState }) => {
  const router = props.router;
  return (
    <>
      <div class="pf-settings-row">
        <span class="pf-settings-label">Backend</span>
        <Dropdown
          class="pf-settings-dropdown"
          value={router.routerBackend()}
          onChange={router.changeRouterBackend}
          options={router.routerBackendOptions}
        />
      </div>
      <Show when={!accountSession()}>
        <span class="pf-settings-muted">Sign in to use hosted routing.</span>
      </Show>
      <Show when={router.routerBackend() === "hosted" && accountSession()}>
        <span class="pf-settings-muted">
          Hosted routing uses PickForge credits. Local and BYO routing stay free.
        </span>
      </Show>
      <Show when={router.activeRouterBackend()}>
        {(backend) => (
          <>
            <div class="pf-settings-row">
              <span class="pf-settings-label">Model</span>
              <input
                class="pf-input pf-router-model"
                value={operatorRouterSettings().models[backend()]}
                spellcheck={false}
                onInput={(e) => router.changeRouterModel(backend(), e.currentTarget.value)}
              />
            </div>
            <Show when={router.routerLatencyHint()}>
              {(hint) => <span class="pf-settings-muted">{hint()}</span>}
            </Show>
          </>
        )}
      </Show>
    </>
  );
};

const DictationContent = (props: { voice: VoiceSettingsState }) => {
  const voice = props.voice;
  return (
    <>
      <div class="pf-settings-row">
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
          Ember talk-back
          <span class="pf-settings-hint-inline">
            speak safe (no-confirmation) command replies back via local OS TTS — only for commands said aloud, never typed ones
          </span>
        </span>
        <div class="pf-seg">
          <button
            classList={{ active: voiceDictationSettings().voiceOutput === "local" }}
            onClick={() => setVoiceOutput("local")}
          >
            On
          </button>
          <button
            classList={{ active: voiceDictationSettings().voiceOutput === "off" }}
            onClick={() => setVoiceOutput("off")}
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
          placeholder={voice.voiceState()?.modelPath ?? "/absolute/path/to/ggml-base.bin"}
          spellcheck={false}
          onInput={(e) => voice.changeVoiceModelPath(e.currentTarget.value)}
          onChange={() => void voice.reloadVoice()}
        />
      </div>
      <div class="pf-settings-row">
        <span class="pf-settings-label">Status</span>
        <span class="pf-settings-muted">{voice.voiceStatusLabel()}</span>
      </div>
    </>
  );
};

const ChatsContent = (props: { chatDefaults: ChatDefaultsState }) => {
  const chatDefaults = props.chatDefaults;
  return (
    <>
      <div class="pf-settings-row">
        <span class="pf-settings-label">New chat creates</span>
        <Dropdown
          class="pf-settings-dropdown"
          value={chatDefaults.defaultChatKind()}
          onChange={chatDefaults.changeDefaultChatKind}
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
          <button classList={{ active: chatDefaults.askChatTitle() }} onClick={() => chatDefaults.changeAskChatTitle(true)}>On</button>
          <button classList={{ active: !chatDefaults.askChatTitle() }} onClick={() => chatDefaults.changeAskChatTitle(false)}>Off</button>
        </div>
      </div>
      <div class="pf-settings-row">
        <span class="pf-settings-label">
          Agent chat engine
          <span class="pf-settings-hint-inline">interactive approvals + steering, or one-shot CLI</span>
        </span>
        <Dropdown
          class="pf-settings-dropdown"
          value={chatDefaults.agentEngine()}
          onChange={chatDefaults.changeAgentEngine}
          options={[
            { value: "v2", label: "v2 (interactive)" },
            { value: "v1", label: "v1 (one-shot CLI)" },
          ]}
        />
      </div>
    </>
  );
};

const PickLabContent = (props: { pickLabState: PickLabState }) => {
  const pickLabState = props.pickLabState;
  return (
    <>
      <div class="pf-settings-row">
        <span class="pf-settings-label">CLI</span>
        <span class="pf-settings-muted">
          {pickLabState.pickLab()?.cliAvailable ? `picklab ${pickLabState.pickLab()?.version ?? ""}` : "Not found"}
        </span>
      </div>
      <div class="pf-settings-row">
        <span class="pf-settings-label">MCP server</span>
        <span class="pf-settings-muted">
          {pickLabState.pickLab()?.mcpAvailable ? "picklab-mcp available" : "Not found"}
        </span>
      </div>
      <div class="pf-settings-row">
        <span class="pf-settings-label">Doctor</span>
        <span class="pf-settings-muted">{pickLabState.pickLabDoctorLabel()}</span>
      </div>
      <div class="pf-settings-row">
        <span class="pf-settings-label">Agent configs</span>
        <span class="pf-settings-muted">{pickLabState.pickLabAgentsLabel()}</span>
      </div>
      <Show when={pickLabState.pickLab()?.error}>
        <div class="pf-ql-warn">{pickLabState.pickLab()?.error}</div>
      </Show>
      <div class="pf-ql-actions">
        <button
          class="pf-ql-add"
          disabled={pickLabState.pickLabLoading()}
          onClick={() => void pickLabState.reloadPickLab()}
        >
          <IconRefresh size={13} /> {pickLabState.pickLabLoading() ? "Checking..." : "Refresh"}
        </button>
        <span class="pf-settings-muted">Managed as an external Pickforge tool</span>
      </div>
    </>
  );
};

const RemoteListenerRow = (props: { remote: RemoteHostState }) => {
  const remote = props.remote;
  return (
    <div class="pf-settings-row">
      <span class="pf-settings-label">
        Listener
        <Show when={remote.remoteHost()?.localUrl}>
          <span class="pf-settings-hint-inline">{remote.remoteHost()?.localUrl}</span>
        </Show>
      </span>
      <div class="pf-remote-controls">
        <input
          class="pf-input pf-remote-port"
          value={remote.remotePort()}
          disabled={remote.remoteHost()?.running || remote.remoteLoading()}
          onInput={(e) => remote.setRemotePort(e.currentTarget.value)}
        />
        <button
          class="pf-ql-add"
          disabled={remote.remoteLoading()}
          onClick={() => void (remote.remoteHost()?.running ? remote.stopRemote() : remote.startRemote())}
        >
          {remote.remoteHost()?.running ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
};

const RemotePairingRow = (props: { remote: RemoteHostState }) => {
  const remote = props.remote;
  return (
    <div class="pf-settings-row">
      <span class="pf-settings-label">Pairing code</span>
      <div class="pf-remote-code-actions">
        <button
          class="pf-text-btn pf-remote-code"
          disabled={remote.remoteLoading()}
          title={remote.activePairingCode() ? "Copy pairing code" : "Issue pairing code"}
          onClick={() => void remote.copyPairing()}
        >
          {remote.activePairingCode()?.code ?? "Issue code"}
        </button>
        <button
          class="pf-ql-add pf-remote-code-refresh"
          disabled={remote.remoteLoading() || !remote.activePairingCode()}
          title="Refresh pairing code"
          aria-label="Refresh pairing code"
          onClick={() => void remote.issuePairing()}
        >
          <IconRefresh size={13} />
        </button>
      </div>
    </div>
  );
};

const RemoteClientRow = (props: { remote: RemoteHostState; client: RemoteHostOverview["clients"][number] }) => {
  const { remote, client } = props;
  return (
    <div class="pf-settings-row">
      <span class="pf-settings-label">
        {client.clientName}
        <span class="pf-settings-hint-inline">
          Paired {new Date(client.issuedAtMs).toLocaleDateString()}
        </span>
      </span>
      <Show
        when={client.revokedAtMs === null}
        fallback={<span class="pf-settings-muted">Revoked</span>}
      >
        <button
          class="pf-text-btn"
          aria-label={`Revoke ${client.clientName}`}
          disabled={remote.revokingClientId() !== null}
          onClick={() => void remote.revokeClient(client.clientId)}
        >
          {remote.revokingClientId() === client.clientId ? "Revoking…" : "Revoke"}
        </button>
      </Show>
    </div>
  );
};

const RemoteTailscaleRows = (props: { remote: RemoteHostState }) => {
  const remote = props.remote;
  return (
    <>
      <div class="pf-settings-row">
        <span class="pf-settings-label">Tailscale</span>
        <span class="pf-settings-muted">{remote.tailscaleLabel()}</span>
      </div>
      <div class="pf-settings-row">
        <span class="pf-settings-label">Tailscale SSH</span>
        <button
          class="pf-text-btn"
          disabled={remote.remoteLoading() || !remote.remoteHost()?.tailscale.available}
          onClick={() => void remote.toggleSsh()}
        >
          {remote.remoteHost()?.tailscale.sshEnabled ? "Disable" : `Enable · ${remote.sshLabel()}`}
        </button>
      </div>
      <Show when={remote.remoteError() ?? remote.remoteHost()?.tailscale.error}>
        <div class="pf-ql-warn">{remote.remoteError() ?? remote.remoteHost()?.tailscale.error}</div>
      </Show>
    </>
  );
};

const RemoteHostContent = (props: { remote: RemoteHostState }) => {
  const remote = props.remote;
  return (
    <>
      <RemoteListenerRow remote={remote} />
      <RemotePairingRow remote={remote} />
      <div class="pf-settings-row">
        <span class="pf-settings-label">Paired clients</span>
        <span class="pf-settings-muted">{remote.remoteHost()?.clients.length ?? 0}</span>
      </div>
      <For each={remote.remoteHost()?.clients ?? []}>
        {(client) => <RemoteClientRow remote={remote} client={client} />}
      </For>
      <RemoteTailscaleRows remote={remote} />
      <div class="pf-ql-actions">
        <button
          class="pf-ql-add"
          disabled={remote.remoteLoading()}
          onClick={() => void remote.reloadRemoteHost()}
        >
          <IconRefresh size={13} /> {remote.remoteLoading() ? "Checking..." : "Refresh"}
        </button>
        <span class="pf-settings-muted">{remote.remoteHost()?.authPath ?? ""}</span>
      </div>
    </>
  );
};

const QuickLaunchContent = (props: {
  diagnostics: AgentDiagnosticsState;
  capture: QuickLaunchCaptureState;
}) => {
  const { diagnostics, capture } = props;
  return (
    <>
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
              classList={{ "pf-ql-row--conflict": diagnostics.conflicts().has(item().id) }}
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
                <span class="pf-ql-agent">agent · {diagnostics.agentLabel(item().agentId)}</span>
              </Show>
              <button
                class="pf-ql-hotkey"
                classList={{ "pf-ql-hotkey--capturing": capture.capturingId() === item().id }}
                title="Click, then press a shortcut (Esc cancels, Backspace clears)"
                onClick={() => capture.setCapturingId(item().id)}
              >
                {capture.capturingId() === item().id ? "press shortcut…" : formatHotkey(item().hotkey)}
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
      <Show when={diagnostics.conflicts().size > 0}>
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
      </div>
    </>
  );
};

const AppearanceContent = () => (
  <>
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
    {/* macOS has native traffic lights — there are no app-drawn controls to place. */}
    <Show when={hostPlatform() !== "macos"}>
      <div class="pf-settings-row">
        <span class="pf-settings-label">Window controls</span>
        <div class="pf-seg">
          <For each={["auto", "left", "right"] as ControlsSide[]}>
            {(s) => (
              <button
                classList={{ active: windowControlsSide() === s }}
                onClick={() => setWindowControlsSide(s)}
              >
                {s === "auto" ? "Auto" : s === "left" ? "Left" : "Right"}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  </>
);

const WorkbenchContent = (props: { telemetry: ReturnType<typeof createTelemetryState> }) => {
  const telemetry = props.telemetry;
  return (
    <>
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
          <button classList={{ active: telemetry.crashReports() }} onClick={() => void telemetry.changeCrashReports(true)}>On</button>
          <button classList={{ active: !telemetry.crashReports() }} onClick={() => void telemetry.changeCrashReports(false)}>Off</button>
        </div>
      </div>
      <Show when={telemetry.crashReportsError()}>
        <div class="pf-ql-warn">{telemetry.crashReportsError()}</div>
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
    </>
  );
};

const LinuxGraphicsContent = (props: { linuxGraphics: LinuxGraphicsState }) => {
  const linuxGraphics = props.linuxGraphics;
  return (
    <>
      <div class="pf-settings-row">
        <span class="pf-settings-label">
          Graphics compatibility
          <span class="pf-settings-hint-inline">GTK/WebKitGTK rendering backend (restart required)</span>
        </span>
        <div class="pf-seg">
          <button
            classList={{ active: linuxGraphics.linuxGraphicsMode() === "auto" }}
            onClick={() => void linuxGraphics.changeLinuxGraphicsMode("auto")}
          >Auto</button>
          <button
            classList={{ active: linuxGraphics.linuxGraphicsMode() === "compatibility" }}
            onClick={() => void linuxGraphics.changeLinuxGraphicsMode("compatibility")}
          >Compatibility</button>
          <button
            classList={{ active: linuxGraphics.linuxGraphicsMode() === "native-wayland" }}
            onClick={() => void linuxGraphics.changeLinuxGraphicsMode("native-wayland")}
          >Native Wayland</button>
        </div>
      </div>
      <div class="pf-settings-hint-inline">{LINUX_GRAPHICS_MODE_DESCRIPTIONS[linuxGraphics.linuxGraphicsMode()]}</div>
      <Show when={linuxGraphics.linuxGraphicsError()}>
        <div class="pf-ql-warn">{linuxGraphics.linuxGraphicsError()}</div>
      </Show>
      <Show when={linuxGraphics.linuxGraphicsRestartRequired()}>
        <div class="pf-ql-warn">
          Restart PickForge to apply the new graphics mode.{" "}
          <button class="pf-text-btn" onClick={() => void linuxGraphics.restartPickforge()}>Restart now</button>
        </div>
      </Show>
      <Show when={linuxGraphics.linuxGraphicsRecommendation()}>
        <div class="pf-ql-warn">
          KDE Plasma on Wayland with an AMD GPU often renders faster in Compatibility mode.{" "}
          <button class="pf-text-btn" onClick={() => void linuxGraphics.changeLinuxGraphicsMode("compatibility")}>Try Compatibility</button>{" "}
          <button class="pf-text-btn" onClick={() => void linuxGraphics.dismissLinuxGraphicsRecommendation()}>Dismiss</button>
        </div>
      </Show>
    </>
  );
};

const FileOpeningContent = () => (
  <>
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
  </>
);

const UpdatesContent = () => (
  <>
    <div class="pf-settings-row">
      <span class="pf-settings-label">Current version</span>
      <span class="pf-settings-muted">v{appVersion()}</span>
    </div>
    <Show
      when={flagEnabled("studioUpdateDialog")}
      fallback={<>
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
      </>}
    >
      {/* Update & restart / Later / Retry live in the shared
          pickforge-update-dialog (mounted in App.tsx) once the controller
          has an update — this row only drives the shared manual check. */}
      <div class="pf-settings-row">
        <span class="pf-settings-label">{studioUpdateLabel(studioUpdateState())}</span>
        <button
          class="pf-ql-add"
          disabled={isStudioUpdateBusy(studioUpdateState())}
          onClick={() => checkForStudioUpdate()}
        >
          Check for updates
        </button>
      </div>
      <Show when={studioUpdateErrorMessage(studioUpdateState())}>
        <div class="pf-vm-error">{studioUpdateErrorMessage(studioUpdateState())}</div>
      </Show>
    </Show>
  </>
);

const LegacySessionsContent = (props: { legacy: LegacySessionsState }) => {
  const legacy = props.legacy;
  return (
    <>
      <span class="pf-settings-muted">
        Recoverable terminal sessions left behind by an older PickForge
        build. A live one may still belong to another running PickForge
        window — review each before stopping it; nothing here is stopped
        automatically.
      </span>
      <Show when={legacy.legacyError()}>
        <div class="pf-vm-error">{legacy.legacyError()}</div>
      </Show>
      <Show
        when={legacy.legacyTotalCount() > 0}
        fallback={
          <span class="pf-settings-muted">
            {legacy.legacyLoading() ? "Checking…" : "No legacy sessions detected"}
          </span>
        }
      >
        <For each={legacy.legacySessions().dtach}>
          {(session) => (
            <div class="pf-settings-row">
              <span class="pf-settings-label">
                {session.name}
                <StatusPill
                  label={session.live ? "Live" : "Stale"}
                  intent={session.live ? "live" : "neutral"}
                />
              </span>
              <button
                class="pf-text-btn"
                onClick={() =>
                  legacy.setLegacyConfirm({
                    scope: "single",
                    kind: "dtach",
                    name: session.name,
                    risky: session.live,
                  })
                }
              >
                Stop
              </button>
            </div>
          )}
        </For>
        <For each={legacy.legacySessions().tmux}>
          {(session) => (
            <div class="pf-settings-row">
              <span class="pf-settings-label">
                {session.name}
                <StatusPill
                  label={session.attached ? "Attached" : "Detached"}
                  intent={session.attached ? "live" : "neutral"}
                />
              </span>
              <button
                class="pf-text-btn"
                onClick={() =>
                  legacy.setLegacyConfirm({
                    scope: "single",
                    kind: "tmux",
                    name: session.name,
                    risky: session.attached,
                  })
                }
              >
                Stop
              </button>
            </div>
          )}
        </For>
        <div class="pf-settings-row">
          <button class="pf-text-btn" onClick={() => legacy.setLegacyConfirm({ scope: "bulk" })}>
            Stop all {legacy.legacyTotalCount()} shown
          </button>
        </div>
      </Show>
    </>
  );
};

const LegacyStopConfirmDialog = (props: { legacy: LegacySessionsState }) => {
  const legacy = props.legacy;
  return (
    <ConfirmDialog
      open={legacy.legacyConfirm() !== null}
      eyebrow="Legacy sessions"
      title={
        legacy.legacyConfirm()
          ? legacyStopConfirmTitle(legacy.legacyConfirm()!, legacy.legacyTotalCount())
          : ""
      }
      confirmLabel={
        legacy.legacyConfirmBusy() ? "Stopping…" : legacy.legacyConfirm()?.scope === "bulk" ? "Stop all" : "Stop"
      }
      destructive
      busy={legacy.legacyConfirmBusy()}
      onConfirm={() => void legacy.confirmLegacyStop()}
      onCancel={() => legacy.setLegacyConfirm(null)}
    >
      <Show
        when={legacy.legacyConfirm()?.scope === "bulk"}
        fallback={
          <p class="pf-confirm-para">
            This stops the legacy session <strong>{legacy.legacyConfirmSingleName()}</strong>.
            <Show when={legacy.legacyConfirm() !== null && legacyStopIsRisky(legacy.legacyConfirm()!)}>
              {" "}A live session may belong to another running PickForge
              window — only confirm if you're sure nothing else needs it.
            </Show>
          </p>
        }
      >
        <p class="pf-confirm-para">
          This stops every legacy session currently listed above. A live
          one may belong to another running PickForge window — only
          confirm if you're sure nothing else needs it.
        </p>
      </Show>
    </ConfirmDialog>
  );
};

const ArchivedProjectsContent = (props: { archivedProjects: ArchivedProjectsState }) => {
  const archivedProjects = props.archivedProjects;
  return (
    <Show
      when={archivedProjects.archived().length > 0}
      fallback={<span class="pf-settings-muted">No archived projects</span>}
    >
      <For each={archivedProjects.archived()}>
        {(p) => (
          <div class="pf-settings-row">
            <span class="pf-settings-label">{p.displayName}</span>
            <button class="pf-text-btn" onClick={() => archivedProjects.restore(p.projectRoot)}>
              Restore
            </button>
          </div>
        )}
      </For>
    </Show>
  );
};

const AccountCreditsSection = (props: { router: OperatorRouterState }) => {
  const router = props.router;
  return (
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
              disabled={router.creditCheckoutBusy()}
              onClick={() => void router.buyCredits(option.pack)}
            >
              {option.priceLabel}
            </button>
          )}
        </For>
      </div>
      <span class="pf-settings-muted">
        Credits pay for hosted Operator routing (and later hosted voice). Local and BYO routing stay free.
      </span>
      <Show when={router.creditCheckoutError()}>
        <div class="pf-ql-warn">{router.creditCheckoutError()}</div>
      </Show>
    </Show>
  );
};

const AccountSettingsSyncSection = () => (
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
);

const AccountDataAndSignOutSection = (props: { lifecycle: AccountLifecycleState }) => {
  const lifecycle = props.lifecycle;
  return (
    <>
      <div class="pf-account-tools">
        <MonoEyebrow text="Your data" as="h3" />
        <span class="pf-settings-muted">
          A portable copy of your PickForge account data — profile, entitlements, credit ledger, and synced settings.
        </span>
        <div class="pf-ql-actions">
          <button
            class="pf-ql-add"
            disabled={lifecycle.exporting()}
            onClick={() => void lifecycle.runExport()}
          >
            {lifecycle.exporting() ? "Exporting…" : "Export my data"}
          </button>
          <Show when={lifecycle.exportStatus()}>
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
    </>
  );
};

const AccountDeleteDialog = (props: {
  account: () => NonNullable<ReturnType<typeof accountSession>>;
  lifecycle: AccountLifecycleState;
}) => {
  const { account, lifecycle } = props;
  return (
    <>
      <div class="pf-danger-zone">
        <MonoEyebrow text="Danger zone" as="h3" />
        <div class="pf-settings-row">
          <span class="pf-settings-label">
            Delete account
            <span class="pf-settings-hint-inline">permanently remove your account and all associated data</span>
          </span>
          <button class="pf-danger-btn" onClick={lifecycle.openDeleteDialog}>
            Delete account
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={lifecycle.deleteOpen()}
        eyebrow="Danger zone"
        title="Delete your account?"
        destructive
        confirmLabel={lifecycle.deleting() ? "Deleting…" : "Delete account"}
        confirmDisabled={!deleteConfirmMatches(lifecycle.deleteConfirm(), account().email)}
        busy={lifecycle.deleting()}
        onCancel={lifecycle.closeDeleteDialog}
        onConfirm={() => void lifecycle.runDelete(account().email)}
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
            value={lifecycle.deleteConfirm()}
            disabled={lifecycle.deleting()}
            onInput={(e) => lifecycle.setDeleteConfirm(e.currentTarget.value)}
          />
        </label>
        <Show when={lifecycle.deleteError()}>
          <span class="pf-account-status pf-account-status--error">{lifecycle.deleteError()}</span>
        </Show>
      </ConfirmDialog>
    </>
  );
};

const AccountSignedInContent = (props: {
  account: () => NonNullable<ReturnType<typeof accountSession>>;
  lifecycle: AccountLifecycleState;
  router: OperatorRouterState;
}) => {
  const account = props.account;
  const lifecycle = props.lifecycle;
  const router = props.router;
  return (
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
      <AccountCreditsSection router={router} />
      <span class="pf-settings-muted">
        {flagEnabled("settingsSync")
          ? "PickForge sends no project data to your account beyond the settings groups you enable below. Only profile, entitlement state, and those groups sync."
          : "PickForge sends no project data to your account. Only profile and entitlement state sync."}
      </span>
      <AccountSettingsSyncSection />
      <AccountDataAndSignOutSection lifecycle={lifecycle} />
      <AccountDeleteDialog account={account} lifecycle={lifecycle} />
    </>
  );
};

const AccountContent = (props: { lifecycle: AccountLifecycleState; router: OperatorRouterState }) => {
  const lifecycle = props.lifecycle;
  return (
    <>
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
                  <button
                    class="pf-ql-add"
                    onClick={() => {
                      lifecycle.setAccountNotice(null);
                      void signIn("github");
                    }}
                  >
                    Continue with GitHub
                  </button>
                  <button
                    class="pf-ql-add"
                    onClick={() => {
                      lifecycle.setAccountNotice(null);
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
              <AccountSignedInContent account={account} lifecycle={lifecycle} router={props.router} />
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
      <Show when={lifecycle.accountNotice()}>
        <div class="pf-ql-warn">{lifecycle.accountNotice()}</div>
      </Show>
      <Show when={accountError()}>
        <div class="pf-ql-warn">{accountError()}</div>
      </Show>
    </>
  );
};

const SettingsSections = (props: {
  category: ReturnType<typeof createSettingsCategoryState>;
  account: AccountLifecycleState;
  diagnostics: AgentDiagnosticsState;
  archivedProjects: ArchivedProjectsState;
  legacy: LegacySessionsState;
  pickLabState: PickLabState;
  telemetry: ReturnType<typeof createTelemetryState>;
  linuxGraphics: LinuxGraphicsState;
  remote: RemoteHostState;
  voice: VoiceSettingsState;
  router: OperatorRouterState;
  chatDefaults: ChatDefaultsState;
  quickLaunchCapture: QuickLaunchCaptureState;
}) => (
  <div class={`pf-settings pf-settings--navigation pf-settings--category-${props.category.activeCategory()}`}>
    <AgentModelsSettingsSection>
      <AgentModelsContent diagnostics={props.diagnostics} />
    </AgentModelsSettingsSection>

    <Show when={flagEnabled("operator")}>
      <OperatorRouterSettingsSection>
        <OperatorRouterContent router={props.router} />
      </OperatorRouterSettingsSection>
    </Show>

    <Show when={flagEnabled("operator")}>
      <DictationSettingsSection>
        <DictationContent voice={props.voice} />
      </DictationSettingsSection>
    </Show>

    <ChatsSettingsSection>
      <ChatsContent chatDefaults={props.chatDefaults} />
    </ChatsSettingsSection>

    <PickLabSettingsSection>
      <PickLabContent pickLabState={props.pickLabState} />
    </PickLabSettingsSection>

    <Show when={flagEnabled("pikitLanes")}>
      <PiKitLanesSettingsSection>
        <PiKitLanesPanel />
      </PiKitLanesSettingsSection>
    </Show>

    <RemoteHostSettingsSection>
      <RemoteHostContent remote={props.remote} />
    </RemoteHostSettingsSection>

    <QuickLaunchSettingsSection>
      <QuickLaunchContent diagnostics={props.diagnostics} capture={props.quickLaunchCapture} />
    </QuickLaunchSettingsSection>

    <AppearanceSettingsSection>
      <AppearanceContent />
    </AppearanceSettingsSection>

    <WorkbenchSettingsSection>
      <WorkbenchContent telemetry={props.telemetry} />
    </WorkbenchSettingsSection>

    <Show when={hostPlatform() === "linux"}>
      <LinuxGraphicsSettingsSection>
        <LinuxGraphicsContent linuxGraphics={props.linuxGraphics} />
      </LinuxGraphicsSettingsSection>
    </Show>

    <FileOpeningSettingsSection>
      <FileOpeningContent />
    </FileOpeningSettingsSection>

    <UpdatesSettingsSection>
      <UpdatesContent />
    </UpdatesSettingsSection>

    <LegacySessionsSettingsSection>
      <LegacySessionsContent legacy={props.legacy} />
    </LegacySessionsSettingsSection>

    <LegacyStopConfirmDialog legacy={props.legacy} />

    <ArchivedProjectsSettingsSection>
      <ArchivedProjectsContent archivedProjects={props.archivedProjects} />
    </ArchivedProjectsSettingsSection>

    <Show when={flagEnabled("accounts")}>
      <AccountSettingsSection>
        <AccountContent lifecycle={props.account} router={props.router} />
      </AccountSettingsSection>
    </Show>

    <Show when={import.meta.env.DEV}>
      <FeatureFlagsSettingsSection>
        <FeatureFlagsContent />
      </FeatureFlagsSettingsSection>
    </Show>
  </div>
);

const FeatureFlagsContent = () => (
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
);

export function SettingsScreen() {
  const category = createSettingsCategoryState();
  const account = createAccountLifecycleState();
  const diagnostics = createAgentDiagnosticsState();
  const archivedProjects = createArchivedProjectsState();
  const legacy = createLegacySessionsState();
  const pickLabState = createPickLabState();
  const telemetry = createTelemetryState();
  const linuxGraphics = createLinuxGraphicsState();
  const remote = createRemoteHostState();
  const voice = createVoiceSettingsState();
  const router = createOperatorRouterState();
  const chatDefaults = createChatDefaultsState();
  const quickLaunchCapture = createQuickLaunchCaptureState();

  useSettingsLifecycleMount({
    reloadArchived: archivedProjects.reloadArchived,
    reloadPickLab: pickLabState.reloadPickLab,
    reloadTelemetry: telemetry.reloadTelemetry,
    reloadRemoteHost: remote.reloadRemoteHost,
    reloadLegacySessions: legacy.reloadLegacySessions,
    reloadLinuxGraphics: linuxGraphics.reloadLinuxGraphics,
    reloadVoice: voice.reloadVoice,
    voiceState: voice.voiceState,
    reloadAgentDiagnostics: diagnostics.reloadAgentDiagnostics,
    enabledAgentDiagnosticIds: diagnostics.enabledAgentDiagnosticIds,
    agentDiagnostics: diagnostics.agentDiagnostics,
    agentDiagnosticErrors: diagnostics.agentDiagnosticErrors,
  });

  const renderSettings = () => (
    <SettingsSections
      category={category}
      account={account}
      diagnostics={diagnostics}
      archivedProjects={archivedProjects}
      legacy={legacy}
      pickLabState={pickLabState}
      telemetry={telemetry}
      linuxGraphics={linuxGraphics}
      remote={remote}
      voice={voice}
      router={router}
      chatDefaults={chatDefaults}
      quickLaunchCapture={quickLaunchCapture}
    />
  );

  return (
    <div class="pf-screen pf-screen--scroll pf-screen--settings-navigation">
      <header class="pf-screen-head">
        <MonoEyebrow text="Settings" tick />
      </header>

      <SettingsNavigation
        categories={category.availableCategories()}
        active={category.activeCategory()}
        onSelect={category.selectCategory}
        paneRef={(element) => category.setSettingsPane(element)}
      >
        {renderSettings()}
      </SettingsNavigation>
    </div>
  );
}
