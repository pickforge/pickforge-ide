export const SETTINGS_CATEGORIES = [
  { key: "general", label: "General" },
  { key: "agents", label: "Agents" },
  { key: "operator", label: "Operator" },
  { key: "remote", label: "Remote" },
  { key: "projects", label: "Projects" },
  { key: "account", label: "Account & sync" },
  { key: "developer", label: "Developer" },
] as const;

export type SettingsCategoryKey = (typeof SETTINGS_CATEGORIES)[number]["key"];

export type SettingsSectionAvailability = "always" | "operator" | "accounts" | "development";

export const SETTINGS_SECTIONS = [
  { key: "agentModels", title: "Agent models", category: "agents", availability: "always" },
  { key: "operatorRouter", title: "Operator router", category: "operator", availability: "operator" },
  { key: "dictation", title: "Dictation", category: "operator", availability: "operator" },
  { key: "chats", title: "Chats", category: "agents", availability: "always" },
  { key: "pickLab", title: "PickLab companion", category: "agents", availability: "always" },
  { key: "remoteHost", title: "Remote host", category: "remote", availability: "always" },
  { key: "quickLaunch", title: "Quick launch", category: "agents", availability: "always" },
  { key: "appearance", title: "Appearance", category: "general", availability: "always" },
  { key: "workbench", title: "Workbench", category: "general", availability: "always" },
  { key: "fileOpening", title: "File opening", category: "general", availability: "always" },
  { key: "updates", title: "Updates", category: "general", availability: "always" },
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
}

export function isSettingsSectionAvailable(
  section: (typeof SETTINGS_SECTIONS)[number],
  context: SettingsSectionAvailabilityContext,
): boolean {
  if (section.availability === "always") return true;
  return context[section.availability];
}
