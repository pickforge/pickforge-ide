export const SETTINGS_CATEGORIES = [
  {
    key: "general",
    label: "General",
    description: "Appearance, workspace behavior, file opening, and updates.",
  },
  {
    key: "agents",
    label: "Agents",
    description: "Models, chat defaults, quick launch, and PickLab.",
  },
  {
    key: "operator",
    label: "Operator",
    description: "Command routing and local dictation.",
  },
  {
    key: "remote",
    label: "Remote",
    description: "Host access, pairing, and Tailscale SSH.",
  },
  {
    key: "projects",
    label: "Projects",
    description: "Archived projects and restoration.",
  },
  {
    key: "account",
    label: "Account & sync",
    description: "Identity, entitlements, data, and settings sync.",
  },
  {
    key: "developer",
    label: "Developer",
    description: "Local feature gates and diagnostics.",
  },
] as const;

export type SettingsCategoryKey = (typeof SETTINGS_CATEGORIES)[number]["key"];

export type SettingsSectionAvailability =
  | "always"
  | "operator"
  | "accounts"
  | "development"
  | "linux"
  | "pikitLanes";

export const SETTINGS_SECTIONS = [
  { key: "agentModels", title: "Agent models", category: "agents", availability: "always" },
  { key: "operatorRouter", title: "Operator router", category: "operator", availability: "operator" },
  { key: "dictation", title: "Dictation", category: "operator", availability: "operator" },
  { key: "chats", title: "Chats", category: "agents", availability: "always" },
  { key: "pickLab", title: "PickLab companion", category: "agents", availability: "always" },
  { key: "pikitLanes", title: "Pi-kit lanes", category: "agents", availability: "pikitLanes" },
  { key: "remoteHost", title: "Remote host", category: "remote", availability: "always" },
  { key: "quickLaunch", title: "Quick launch", category: "agents", availability: "always" },
  { key: "appearance", title: "Appearance", category: "general", availability: "always" },
  { key: "workbench", title: "Workbench", category: "general", availability: "always" },
  { key: "linuxGraphics", title: "Linux graphics", category: "general", availability: "linux" },
  { key: "fileOpening", title: "File opening", category: "general", availability: "always" },
  { key: "updates", title: "Updates", category: "general", availability: "always" },
  { key: "legacySessions", title: "Legacy sessions", category: "general", availability: "always" },
  { key: "archivedProjects", title: "Archived projects", category: "projects", availability: "always" },
  { key: "account", title: "Account", category: "account", availability: "accounts" },
  { key: "featureFlags", title: "Feature flags", category: "developer", availability: "development" },
] as const satisfies readonly {
  key: string;
  title: string;
  category: SettingsCategoryKey;
  availability: SettingsSectionAvailability;
}[];

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]["key"];

export const SETTINGS_SECTION_BY_KEY = Object.fromEntries(
  SETTINGS_SECTIONS.map((section) => [section.key, section]),
) as { [Key in SettingsSectionKey]: Extract<(typeof SETTINGS_SECTIONS)[number], { key: Key }> };

export interface SettingsSectionAvailabilityContext {
  operator: boolean;
  accounts: boolean;
  development: boolean;
  linux: boolean;
  pikitLanes: boolean;
}

export function isSettingsSectionAvailable(
  section: (typeof SETTINGS_SECTIONS)[number],
  context: SettingsSectionAvailabilityContext,
): boolean {
  if (section.availability === "always") return true;
  return context[section.availability];
}

export function availableSettingsCategories(
  context: SettingsSectionAvailabilityContext,
): readonly (typeof SETTINGS_CATEGORIES)[number][] {
  return SETTINGS_CATEGORIES.filter((category) =>
    SETTINGS_SECTIONS.some(
      (section) =>
        section.category === category.key && isSettingsSectionAvailable(section, context),
    ),
  );
}

export function settingsCategoryForSection(
  sectionKey: string | null | undefined,
  context: SettingsSectionAvailabilityContext,
): SettingsCategoryKey | null {
  if (!sectionKey || !(sectionKey in SETTINGS_SECTION_BY_KEY)) return null;
  const section = SETTINGS_SECTION_BY_KEY[sectionKey as SettingsSectionKey];
  return isSettingsSectionAvailable(section, context) ? section.category : null;
}

export function resolveSettingsCategory(
  requested: string | null | undefined,
  context: SettingsSectionAvailabilityContext,
): SettingsCategoryKey {
  const available = availableSettingsCategories(context);
  return (
    available.find((category) => category.key === requested)?.key ??
    available.find((category) => category.key === "general")?.key ??
    available[0]?.key ??
    "general"
  );
}

export function firstSettingsSectionForCategory(
  category: SettingsCategoryKey,
  context: SettingsSectionAvailabilityContext,
): SettingsSectionKey | null {
  return (
    SETTINGS_SECTIONS.find(
      (section) =>
        section.category === category && isSettingsSectionAvailable(section, context),
    )?.key ?? null
  );
}

const SETTINGS_CATEGORY_STORAGE_KEY = "pickforge.settings.category";

/** The active category survives leaving and returning to Settings (#211
 *  acceptance). Storage failures (private browsing, quota) degrade to "no
 *  memory" rather than breaking navigation. */
export function loadRememberedSettingsCategory(): string | null {
  try {
    return localStorage.getItem(SETTINGS_CATEGORY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberSettingsCategory(category: SettingsCategoryKey): void {
  try {
    localStorage.setItem(SETTINGS_CATEGORY_STORAGE_KEY, category);
  } catch {
    // Settings navigation remains usable when storage is unavailable.
  }
}
