import { createResource, For, Show } from "solid-js";
import { ForgeEmptyState, MonoEyebrow } from "../components/ui";
import { workspace } from "../stores/workspace";
import * as db from "../lib/db";
import "./screens.css";

export function HistoryScreen() {
  const [picks] = createResource(
    () => workspace.activeRoot,
    (root) => (root ? db.picksList(root, 200) : Promise.resolve([])),
  );

  return (
    <div class="pf-screen">
      <header class="pf-screen-head">
        <MonoEyebrow text="Pick history" tick />
      </header>
      <Show
        when={(picks() ?? []).length > 0}
        fallback={
          <ForgeEmptyState
            glyph={<span style={{ "font-size": "22px" }}>⌖</span>}
            eyebrow="Empty"
            title="No picks yet"
            hint="Widget selections you forge will appear here."
          />
        }
      >
        <div class="pf-screen-list">
          <For each={picks()}>
            {(p) => (
              <div class="pf-list-row">
                <span class="pf-mono">{p.widgetClass}</span>
                <span class="pf-list-sub">
                  {p.creationFile ?? "—"}
                  {p.creationLine != null ? `:${p.creationLine}` : ""}
                </span>
                <span class="pf-list-meta">
                  {new Date(p.pickedAt).toLocaleString()}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
