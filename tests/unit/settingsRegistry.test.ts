import { describe, expect, it } from "vitest";
import {
  isSettingsSectionAvailable,
  SETTINGS_CATEGORIES,
  SETTINGS_SECTION_BY_KEY,
  SETTINGS_SECTIONS,
} from "../../src/screens/settingsRegistry";

const CURRENT_SETTINGS_ORDER = [
  "agentModels",
  "operatorRouter",
  "dictation",
  "chats",
  "pickLab",
  "remoteHost",
  "quickLaunch",
  "appearance",
  "workbench",
  "fileOpening",
  "updates",
  "archivedProjects",
  "account",
  "featureFlags",
];

describe("settings section registry", () => {
  it("characterizes the existing stacked render order", () => {
    expect(SETTINGS_SECTIONS.map(({ key }) => key)).toEqual(CURRENT_SETTINGS_ORDER);
    expect(SETTINGS_SECTIONS.map(({ title }) => title)).toEqual([
      "Agent models",
      "Operator router",
      "Dictation",
      "Chats",
      "PickLab companion",
      "Remote host",
      "Quick launch",
      "Appearance",
      "Workbench",
      "File opening",
      "Updates",
      "Archived projects",
      "Account",
      "Feature flags",
    ]);
  });

  it("indexes every section by key without changing registry order", () => {
    expect(Object.keys(SETTINGS_SECTION_BY_KEY)).toEqual(CURRENT_SETTINGS_ORDER);
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS_SECTION_BY_KEY[section.key]).toBe(section);
    }
  });

  it("assigns each section once to the future navigation categories", () => {
    const categoryKeys = new Set(SETTINGS_CATEGORIES.map(({ key }) => key));
    expect(new Set(SETTINGS_SECTIONS.map(({ key }) => key)).size).toBe(SETTINGS_SECTIONS.length);
    expect(SETTINGS_SECTIONS.every(({ category }) => categoryKeys.has(category))).toBe(true);
    expect(SETTINGS_CATEGORIES.map(({ key }) => key)).toEqual([
      "general",
      "agents",
      "operator",
      "remote",
      "projects",
      "account",
      "developer",
    ]);
  });

  it("preserves operator, account, and development gating", () => {
    const visible = (operator: boolean, accounts: boolean, development: boolean) =>
      SETTINGS_SECTIONS
        .filter((section) =>
          isSettingsSectionAvailable(section, { operator, accounts, development }),
        )
        .map(({ key }) => key);

    expect(visible(false, false, false)).toEqual(
      CURRENT_SETTINGS_ORDER.filter(
        (key) => !["operatorRouter", "dictation", "account", "featureFlags"].includes(key),
      ),
    );
    expect(visible(true, true, true)).toEqual(CURRENT_SETTINGS_ORDER);
    expect(visible(true, false, false)).toEqual(
      expect.arrayContaining(["operatorRouter", "dictation"]),
    );
    expect(visible(false, true, false)).toContain("account");
    expect(visible(false, false, true)).toContain("featureFlags");
  });
});
