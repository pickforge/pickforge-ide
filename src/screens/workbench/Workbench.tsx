// The 3-pane workbench: projects/chats/files | terminal | inspector.
import { createSignal, For, onMount, Show } from "solid-js";
import { ProjectsChatsPanel } from "./ProjectsChatsPanel";
import { FileExplorer } from "./FileExplorer";
import { InspectorPanel } from "./InspectorPanel";
import {
  TerminalHost,
  type TerminalHostHandle,
} from "../../components/TerminalHost";
import { Chip, MonoEyebrow } from "../../components/ui";
import { IconGear } from "../../components/icons";
import { detectBinaries } from "../../lib/process";
import { AGENTS, launchCommand } from "../../lib/agentModels";
import { workspace } from "../../stores/workspace";
import { navigate } from "../../router";
import "./workbench.css";

const AGENT_CHIPS = [
  { label: "claude", agentId: "claudeCode", ember: true },
  { label: "codex", agentId: "codex" },
];
const TOOL_CHIPS = [
  { label: "flutter doctor", command: "flutter doctor ", binary: "flutter" },
  { label: "adb devices", command: "adb devices ", binary: "adb" },
];

export function WorkbenchScreen() {
  const [host, setHost] = createSignal<TerminalHostHandle | null>(null);
  const [available, setAvailable] = createSignal<Record<string, boolean>>({});

  onMount(async () => {
    const bins = [...new Set([...AGENTS.map((a) => a.binary), "flutter", "adb"])];
    try {
      const result = await detectBinaries(bins);
      const map: Record<string, boolean> = {};
      bins.forEach((b, i) => (map[b] = result[i]));
      setAvailable(map);
    } catch (err) {
      console.error("[pickforge] detect_binaries failed", err);
    }
  });

  const type = (text: string) => host()?.typeToFocused(text);

  return (
    <div class="pf-workbench">
      <aside class="pf-workbench-left pf-reveal" style={{ "--pf-reveal-delay": "70ms" }}>
        <ProjectsChatsPanel />
        <FileExplorer />
        <div class="pf-rail-footer">
          <span class="pf-rail-copy">© PICKFORGE · MIT</span>
          <button
            class="pf-icon-btn"
            title="Settings"
            onClick={() => navigate("settings")}
          >
            <IconGear size={15} />
          </button>
        </div>
      </aside>

      <main class="pf-workbench-center pf-reveal">
        <div class="pf-launch">
          <MonoEyebrow text="Quick launch" tick />
          <div class="pf-chips">
            <For each={AGENT_CHIPS}>
              {(c) => {
                const agent = AGENTS.find((a) => a.id === c.agentId)!;
                return (
                  <Chip
                    label={c.label}
                    ember={c.ember}
                    disabled={available()[agent.binary] === false}
                    onClick={() => type(launchCommand(c.agentId))}
                  />
                );
              }}
            </For>
            <For each={TOOL_CHIPS}>
              {(c) => (
                <Chip
                  label={c.label}
                  disabled={available()[c.binary] === false}
                  onClick={() => type(c.command)}
                />
              )}
            </For>
          </div>
        </div>
        <div class="pf-workbench-terminal">
          {/* Mount the terminal only once the workspace has loaded, so the
              shell spawns in the active project's directory (not the home dir). */}
          <Show when={workspace.loaded}>
            <TerminalHost onReady={setHost} cwd={workspace.activeRoot ?? undefined} />
          </Show>
        </div>
      </main>

      <aside class="pf-workbench-right pf-reveal" style={{ "--pf-reveal-delay": "140ms" }}>
        <InspectorPanel />
      </aside>
    </div>
  );
}
