// Group serializers/appliers for @pickforge/sync. Each SyncFieldGroup has a
// collect() that builds a stable, versioned payload from the local stores and
// an apply() that writes a payload back defensively — unknown versions/fields
// are ignored, and absolute local paths never enter a payload (the sync
// sanitizer rejects them, so we key remote bindings by project basename).
import type { Json } from "@pickforge/sync";
import { appTheme, applyTheme, type ThemeMode } from "../stores/theme";
import { setRunButtonLabels, workbenchPrefs } from "../stores/workbenchPrefs";
import {
  setWindowControlsSide,
  windowControlsSide,
  type ControlsSide,
} from "../stores/windowControls";
import {
  operatorRouterSettings,
  ROUTER_BACKENDS,
  setOperatorRouterBackend,
  setOperatorRouterModel,
  type OperatorRouterBackend,
  type OperatorRouterSettingBackend,
} from "../stores/operatorRouterSettings";
import {
  setVoiceMicEnabled,
  setVoicePushToCommand,
  voiceDictationSettings,
} from "../stores/voiceSettings";
import {
  allQuickLaunchItems,
  setQuickLaunchItems,
  type QuickLaunchItem,
} from "../stores/quickLaunch";

const PAYLOAD_VERSION = 1;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A v1 payload with a matching version, or null for unknown/old shapes. */
function versioned(payload: Json): Record<string, unknown> | null {
  const root = record(payload);
  if (!root || root.v !== PAYLOAD_VERSION) return null;
  return root;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// ---- appSettings: theme + workbench + window chrome prefs ----

const THEMES: ThemeMode[] = ["dark", "light"];
const CONTROL_SIDES: ControlsSide[] = ["auto", "left", "right"];

export function collectAppSettings(): Json {
  return {
    v: PAYLOAD_VERSION,
    theme: appTheme(),
    runButtonLabels: workbenchPrefs().runButtonLabels,
    windowControlsSide: windowControlsSide(),
  };
}

export function applyAppSettings(payload: Json): void {
  const root = versioned(payload);
  if (!root) return;

  const theme = str(root.theme);
  if (theme && THEMES.includes(theme as ThemeMode)) applyTheme(theme as ThemeMode);

  const runButtonLabels = bool(root.runButtonLabels);
  if (runButtonLabels !== null) setRunButtonLabels(runButtonLabels);

  const side = str(root.windowControlsSide);
  if (side && CONTROL_SIDES.includes(side as ControlsSide)) {
    setWindowControlsSide(side as ControlsSide);
  }
}

// ---- operatorConfig: router backend/models + dictation toggles ----
// modelPath is EXCLUDED: it is an absolute local path to a ggml model, which is
// both machine-specific and rejected by the sync sanitizer. lastLatencyMs is
// per-machine telemetry, not a setting, so it stays out too.

function isRouterBackend(value: unknown): value is OperatorRouterSettingBackend {
  return (
    value === "off" ||
    value === "hosted" ||
    ROUTER_BACKENDS.includes(value as OperatorRouterBackend)
  );
}

export function collectOperatorConfig(): Json {
  const router = operatorRouterSettings();
  const voice = voiceDictationSettings();
  return {
    v: PAYLOAD_VERSION,
    router: {
      backend: router.backend,
      models: {
        claudeCode: router.models.claudeCode,
        codex: router.models.codex,
        ollama: router.models.ollama,
      },
    },
    dictation: {
      micEnabled: voice.micEnabled,
      pushToCommand: voice.pushToCommand,
    },
  };
}

export function applyOperatorConfig(payload: Json): void {
  const root = versioned(payload);
  if (!root) return;

  const router = record(root.router);
  if (router) {
    if (isRouterBackend(router.backend)) setOperatorRouterBackend(router.backend);
    const models = record(router.models);
    if (models) {
      for (const backend of ROUTER_BACKENDS) {
        const model = str(models[backend]);
        if (model !== null) setOperatorRouterModel(backend, model);
      }
    }
  }

  const dictation = record(root.dictation);
  if (dictation) {
    const micEnabled = bool(dictation.micEnabled);
    if (micEnabled !== null) setVoiceMicEnabled(micEnabled);
    const pushToCommand = bool(dictation.pushToCommand);
    if (pushToCommand !== null) setVoicePushToCommand(pushToCommand);
  }
}

// ---- keybindings: quick-launch items (labels, commands, hotkeys) ----
// The hotkey lives under the `keybinding` field, not `hotkey`: the sync
// sanitizer rejects any key containing "key" unless it is an allowed keybinding
// field name, and `keybinding` is on that allow-list while `hotkey` is not.

interface KeybindingItem {
  id: string;
  label: string;
  keybinding: string | null;
  command?: string;
  agentId?: string;
  binary?: string;
  ai?: boolean;
}

export function collectKeybindings(): Json {
  const items: KeybindingItem[] = allQuickLaunchItems().map((item) => {
    const out: KeybindingItem = { id: item.id, label: item.label, keybinding: item.hotkey };
    if (item.command !== undefined) out.command = item.command;
    if (item.agentId !== undefined) out.agentId = item.agentId;
    if (item.binary !== undefined) out.binary = item.binary;
    if (item.ai !== undefined) out.ai = item.ai;
    return out;
  });
  return { v: PAYLOAD_VERSION, items } as unknown as Json;
}

function readQuickLaunchItem(value: unknown): QuickLaunchItem | null {
  const item = record(value);
  const id = str(item?.id);
  const label = str(item?.label);
  if (!item || !id || label === null) return null;

  const hotkey = item.keybinding === null ? null : str(item.keybinding);
  const next: QuickLaunchItem = { id, label, hotkey };
  const command = str(item.command);
  if (command !== null) next.command = command;
  const agentId = str(item.agentId);
  if (agentId !== null) next.agentId = agentId;
  const binary = str(item.binary);
  if (binary !== null) next.binary = binary;
  const ai = bool(item.ai);
  if (ai !== null) next.ai = ai;
  return next;
}

export function applyKeybindings(payload: Json): void {
  const root = versioned(payload);
  if (!root || !Array.isArray(root.items)) return;

  // An empty list is a valid "all chips deleted" state and must apply; only a
  // malformed payload (any unreadable entry) is rejected.
  const items: QuickLaunchItem[] = [];
  for (const value of root.items) {
    const item = readQuickLaunchItem(value);
    if (!item) return;
    items.push(item);
  }

  setQuickLaunchItems(items);
}

// ---- remoteBindings: per-project remote host, matched by project basename ----
// The project root is an absolute local path and must never enter the payload,
// so bindings carry the basename instead. remoteRoot is an absolute POSIX path
// on the remote host, which the sanitizer allows only under the `remoteRoot`
// field. v2 stores bindings as an ARRAY of { project, remoteHost, remoteRoot }:
// the sanitizer scans map KEYS with its denied-key pattern, so a project named
// e.g. "api-key-notes" as a key would block the whole group — as a value it is
// scanned by the value rules and plain names pass.

const REMOTE_BINDINGS_VERSION = 2;

export interface RemoteBindingProject {
  projectRoot: string;
  remoteHost: string | null;
  remoteRoot: string | null;
}

export interface RemoteBindingApplyContext {
  projects: RemoteBindingProject[];
  setBinding(
    projectRoot: string,
    remoteHost: string,
    remoteRoot: string,
  ): void | Promise<void>;
}

/** Last path segment of an absolute project root (no slashes, so payload-safe). */
export function projectBasename(projectRoot: string): string {
  const trimmed = projectRoot.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

export function collectRemoteBindings(projects: RemoteBindingProject[]): Json {
  const bindings = new Map<string, { remoteHost: string; remoteRoot: string }>();
  // Collisions (same basename, different parents) resolve last-write-wins; the
  // binding is machine-local anyway and only adopted where a slot is unbound.
  for (const project of projects) {
    if (!project.remoteHost || !project.remoteRoot) continue;
    const key = projectBasename(project.projectRoot);
    if (!key) continue;
    bindings.set(key, { remoteHost: project.remoteHost, remoteRoot: project.remoteRoot });
  }
  return {
    v: REMOTE_BINDINGS_VERSION,
    bindings: [...bindings.entries()].map(([project, binding]) => ({ project, ...binding })),
  };
}

/** Bindings by basename from a v2 (array) or legacy v1 (record) payload. */
function readRemoteBindings(
  payload: Json,
): Map<string, { remoteHost: string; remoteRoot: string }> | null {
  const root = record(payload);
  if (!root) return null;
  const bindings = new Map<string, { remoteHost: string; remoteRoot: string }>();

  if (root.v === REMOTE_BINDINGS_VERSION && Array.isArray(root.bindings)) {
    for (const value of root.bindings) {
      const entry = record(value);
      const project = str(entry?.project);
      const remoteHost = str(entry?.remoteHost);
      const remoteRoot = str(entry?.remoteRoot);
      if (!project || !remoteHost || !remoteRoot) continue;
      bindings.set(project, { remoteHost, remoteRoot });
    }
    return bindings;
  }

  if (root.v === 1) {
    const legacy = record(root.bindings);
    if (!legacy) return null;
    for (const [project, value] of Object.entries(legacy)) {
      const entry = record(value);
      const remoteHost = str(entry?.remoteHost);
      const remoteRoot = str(entry?.remoteRoot);
      if (!remoteHost || !remoteRoot) continue;
      bindings.set(project, { remoteHost, remoteRoot });
    }
    return bindings;
  }

  return null;
}

export async function applyRemoteBindings(
  payload: Json,
  ctx: RemoteBindingApplyContext,
): Promise<void> {
  const bindings = readRemoteBindings(payload);
  if (!bindings) return;

  for (const project of ctx.projects) {
    // Per-machine overlay: a project the local machine has already bound wins
    // locally — never clobber it with the server's value. Only fill slots that
    // are currently unbound here.
    if (project.remoteHost) continue;
    const binding = bindings.get(projectBasename(project.projectRoot));
    if (!binding) continue;
    await ctx.setBinding(project.projectRoot, binding.remoteHost, binding.remoteRoot);
  }
}
