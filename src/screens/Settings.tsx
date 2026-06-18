import { createEffect, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { AGENTS, loadAgentModels, setAgentModel } from "../lib/agentModels";
import {
  addQuickLaunchItem,
  conflictingHotkeys,
  eventToHotkey,
  formatHotkey,
  quickLaunchItems,
  removeQuickLaunchItem,
  resetQuickLaunchItems,
  updateQuickLaunchItem,
} from "../stores/quickLaunch";
import { HairlinePanel, MonoEyebrow } from "../components/ui";
import { IconClose, IconPlus } from "../components/icons";
import { currentZoom, zoomIn, zoomOut, zoomReset } from "../lib/zoom";
import { setQuickLaunchVisible, workbenchPrefs } from "../stores/workbenchPrefs";
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
  const [theme, setTheme] = createSignal(
    localStorage.getItem("pickforge.theme") ?? "dark",
  );
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

  const applyTheme = (t: string) => {
    setTheme(t);
    localStorage.setItem("pickforge.theme", t);
    document.documentElement.dataset.theme = t === "light" ? "light" : "";
  };

  const restore = async (root: string) => {
    await db.projectSetArchived(root, null);
    await reloadArchived();
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
                  <select
                    class="pf-select"
                    value={models()[agent.id] ?? ""}
                    onChange={(e) => changeModel(agent.id, e.currentTarget.value)}
                  >
                    <For each={agent.models}>
                      {(m) => <option value={m.id}>{m.label}</option>}
                    </For>
                  </select>
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
                classList={{ active: theme() === "dark" }}
                onClick={() => applyTheme("dark")}
              >
                Dark
              </button>
              <button
                classList={{ active: theme() === "light" }}
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
