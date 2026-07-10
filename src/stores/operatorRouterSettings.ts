import { createSignal } from "solid-js";
import { noteSettingsEdit } from "../lib/settingsSyncEdits";

export type OperatorRouterBackend = "claudeCode" | "codex" | "ollama";
export type OperatorRouterSettingBackend = "off" | OperatorRouterBackend;

export interface OperatorRouterSettings {
  backend: OperatorRouterSettingBackend;
  models: Record<OperatorRouterBackend, string>;
  lastLatencyMs: Partial<Record<OperatorRouterBackend, number>>;
}

const STORE_KEY = "pickforge.operatorRouter";

export const ROUTER_BACKENDS: OperatorRouterBackend[] = ["claudeCode", "codex", "ollama"];

export const DEFAULT_ROUTER_MODELS: Record<OperatorRouterBackend, string> = {
  claudeCode: "claude-haiku-4-5",
  codex: "gpt-5.3-codex-spark",
  ollama: "qwen2.5:3b",
};

const DEFAULT_SETTINGS: OperatorRouterSettings = {
  backend: "off",
  models: DEFAULT_ROUTER_MODELS,
  lastLatencyMs: {},
};

function isBackend(value: unknown): value is OperatorRouterSettingBackend {
  return value === "off" || ROUTER_BACKENDS.includes(value as OperatorRouterBackend);
}

function isRouteBackend(value: OperatorRouterSettingBackend): value is OperatorRouterBackend {
  return value !== "off";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function latencyValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalize(value: unknown): OperatorRouterSettings {
  const saved = record(value);
  const models = record(saved.models);
  const lastLatencyMs = record(saved.lastLatencyMs);
  const backend = isBackend(saved.backend) ? saved.backend : DEFAULT_SETTINGS.backend;

  return {
    backend,
    models: {
      claudeCode: stringValue(models.claudeCode, DEFAULT_ROUTER_MODELS.claudeCode),
      codex: stringValue(models.codex, DEFAULT_ROUTER_MODELS.codex),
      ollama: stringValue(models.ollama, DEFAULT_ROUTER_MODELS.ollama),
    },
    lastLatencyMs: Object.fromEntries(
      ROUTER_BACKENDS
        .map((b) => [b, latencyValue(lastLatencyMs[b])] as const)
        .filter((entry): entry is [OperatorRouterBackend, number] => entry[1] !== undefined),
    ) as Partial<Record<OperatorRouterBackend, number>>,
  };
}

export function loadOperatorRouterSettings(): OperatorRouterSettings {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(settings: OperatorRouterSettings) {
  localStorage.setItem(STORE_KEY, JSON.stringify(settings));
}

const [settings, setSettings] = createSignal(loadOperatorRouterSettings());
export const operatorRouterSettings = settings;

export function setOperatorRouterBackend(backend: OperatorRouterSettingBackend) {
  setSettings((current) => {
    const next = { ...current, backend };
    persist(next);
    return next;
  });
  noteSettingsEdit("operatorConfig");
}

export function setOperatorRouterModel(backend: OperatorRouterBackend, model: string) {
  setSettings((current) => {
    const next = {
      ...current,
      models: { ...current.models, [backend]: model },
    };
    persist(next);
    return next;
  });
  noteSettingsEdit("operatorConfig");
}

export function persistOperatorRouterLatency(
  backend: OperatorRouterBackend,
  latencyMs: number,
) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  setSettings((current) => {
    const next = {
      ...current,
      lastLatencyMs: { ...current.lastLatencyMs, [backend]: latencyMs },
    };
    persist(next);
    return next;
  });
}

export function configuredRouterBackend(): OperatorRouterBackend | null {
  const backend = settings().backend;
  if (!isRouteBackend(backend)) return null;
  const model = settings().models[backend]?.trim();
  return model ? backend : null;
}
