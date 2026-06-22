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
import { IconClose, IconPlus } from "../components/icons";
import { currentZoom, zoomIn, zoomOut, zoomReset } from "../lib/zoom";
import { setQuickLaunchVisible, setRunButtonLabels, workbenchPrefs } from "../stores/workbenchPrefs";
import {
  setWindowControlsSide,
  windowControlsSide,
  type ControlsSide,
} from "../stores/windowControls";
import { hostPlatform } from "../lib/platform";
import { layout, resetLayout, setDockVisible } from "../stores/workbenchLayout";
import {
  fileOpenSettings,
  setFileOpenCustom,
  setFileOpenMode,
  type FileOpenMode,
} from "../stores/fileOpenSettings";
import { appVersion } from "../lib/appInfo";
import { appTheme, applyTheme } from "../stores/theme";
import { checkForUpdate, installUpdate, updateAvailable, updateError, updateStatus } from "../lib/updater";
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

export function SettingsScreen() {
  const [models, setModels] = createSignal(loadAgentModels());
  const [archived, setArchived] = createSignal<db.Project[]>([]);
  const [capturingId, setCapturingId] = createSignal<string | null>(null);

  const reloadArchived = async () => {
    const all = await db.projectsList(true);
    setArchived(all.filter((p) => p.archivedAt !== null));
  };
  onMount(reloadArchived);

  const changeModel = (agentId: string, model: string) => {
    setAgentModel(agentId, model || null);
    setModels(loadAgentModels());
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
                <span class="pf-settings-label">{agent.label}</span>
                <Show
                  when={agent.models.length > 0}
                  fallback={<span class="pf-settings-muted">CLI default</span>}
                >
                  <Dropdown
                    class="pf-settings-dropdown"
                    value={models()[agent.id] ?? ""}
                    onChange={(v) => changeModel(agent.id, v)}
                    options={agent.models.map((m) => ({ value: m.id, label: m.label }))}
                  />
                </Show>
              </div>
            )}
          </For>
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
            <span class="pf-settings-label">Quick launch bar</span>
            <div class="pf-seg">
              <button
                classList={{ active: workbenchPrefs().quickLaunchVisible }}
                onClick={() => setQuickLaunchVisible(true)}
              >
                Shown
              </button>
              <button
                classList={{ active: !workbenchPrefs().quickLaunchVisible }}
                onClick={() => setQuickLaunchVisible(false)}
              >
                Hidden
              </button>
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
            <span class="pf-settings-label">Panel layout</span>
            <button class="pf-text-btn" onClick={resetLayout}>Reset to default</button>
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
      </div>
    </div>
  );
}
