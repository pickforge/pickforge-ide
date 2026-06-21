import { createResource, For, Show } from "solid-js";
import {
  ForgeEmptyState,
  MonoEyebrow,
  StatusPill,
  type StatusIntent,
} from "../components/ui";
import { workspace } from "../stores/workspace";
import * as db from "../lib/db";
import "./screens.css";

function runIntent(r: db.RunSessionLog): StatusIntent {
  if (r.endedAt === null) return "live";
  if (r.errorCount > 0 || (r.exitCode ?? 0) !== 0) return "error";
  return "connected";
}

/** A forge dispatch's source label: file:line when known, else the widget/role. */
function pickSource(p: db.PickHistory): string {
  if (p.creationFile) {
    const name = p.creationFile.split(/[/\\]/).pop() ?? p.creationFile;
    return p.creationLine != null ? `${name}:${p.creationLine}` : name;
  }
  return p.widgetClass;
}

export function RunHistoryScreen() {
  const [runs] = createResource(
    () => workspace.activeRoot,
    (root) => (root ? db.runsList(root, 200) : Promise.resolve([])),
  );
  const [picks] = createResource(
    () => workspace.activeRoot,
    (root) => (root ? db.picksList(root, 200) : Promise.resolve([])),
  );

  return (
    <div class="pf-screen">
      <header class="pf-screen-head">
        <MonoEyebrow text="Run sessions" tick />
      </header>
      <Show
        when={(runs() ?? []).length > 0}
        fallback={
          <ForgeEmptyState
            glyph={<span style={{ "font-size": "22px" }}>▦</span>}
            eyebrow="Empty"
            title="No runs yet"
            hint="App run sessions and their hot-reload metrics will appear here."
          />
        }
      >
        <div class="pf-screen-list">
          <For each={runs()}>
            {(r) => (
              <div class="pf-list-row">
                <StatusPill
                  label={r.endedAt === null ? "running" : (r.exitReason ?? "ended")}
                  intent={runIntent(r)}
                  pulsing={r.endedAt === null}
                />
                <span class="pf-list-sub">{r.targetFile ?? r.connectionMode}</span>
                <span class="pf-list-meta">
                  ↻{r.hotReloadCount} · {new Date(r.startedAt).toLocaleString()}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={(picks() ?? []).length > 0}>
        <header class="pf-screen-head">
          <MonoEyebrow text="Forge dispatches" tick />
        </header>
        <div class="pf-screen-list">
          <For each={picks()}>
            {(p) => (
              <div class="pf-list-row">
                <StatusPill label={p.agentId} intent="connected" />
                <span class="pf-list-sub">{pickSource(p)}</span>
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
