import type { Component, ParentProps } from "solid-js";
import { HairlinePanel, MonoEyebrow } from "../components/ui";
import { SETTINGS_SECTION_BY_KEY, type SettingsSectionKey } from "./settingsRegistry";

function createSettingsSection(key: SettingsSectionKey): Component<ParentProps> {
  const section = SETTINGS_SECTION_BY_KEY[key];
  const title = section.title;
  return (props) => (
    <HairlinePanel
      id={`settings-${key}`}
      class="pf-settings-section"
      data-settings-section={key}
      data-settings-category={section.category}
    >
      <MonoEyebrow text={title} tick />
      <div class="pf-settings-body">{props.children}</div>
    </HairlinePanel>
  );
}

export const AgentModelsSettingsSection = createSettingsSection("agentModels");
export const OperatorRouterSettingsSection = createSettingsSection("operatorRouter");
export const DictationSettingsSection = createSettingsSection("dictation");
export const ChatsSettingsSection = createSettingsSection("chats");
export const PickLabSettingsSection = createSettingsSection("pickLab");
export const RemoteHostSettingsSection = createSettingsSection("remoteHost");
export const QuickLaunchSettingsSection = createSettingsSection("quickLaunch");
export const AppearanceSettingsSection = createSettingsSection("appearance");
export const WorkbenchSettingsSection = createSettingsSection("workbench");
export const FileOpeningSettingsSection = createSettingsSection("fileOpening");
export const UpdatesSettingsSection = createSettingsSection("updates");
export const ArchivedProjectsSettingsSection = createSettingsSection("archivedProjects");
export const AccountSettingsSection = createSettingsSection("account");
export const FeatureFlagsSettingsSection = createSettingsSection("featureFlags");
