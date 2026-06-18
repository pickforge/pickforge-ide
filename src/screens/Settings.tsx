import { createSignal, For, onMount, Show } from "solid-js";
import { AGENTS, loadAgentModels, setAgentModel } from "../lib/agentModels";
import { HairlinePanel, MonoEyebrow } from "../components/ui";
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
