import { type JSX, For, Show, createSignal } from "solid-js";
import { HairlinePanel, MonoEyebrow } from "../ui";
import { type RowExpansion } from "./ChatTimeline";
import "./chat.css";

export interface FileChange {
  path: string;
  kind: string;
  diff?: string | null;
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "pf-diff-line--meta";
  if (line.startsWith("@@")) return "pf-diff-line--hunk";
  if (line.startsWith("+")) return "pf-diff-line--add";
  if (line.startsWith("-")) return "pf-diff-line--del";
  return "";
}

function DiffView(props: { diff: string }): JSX.Element {
  const lines = () => props.diff.replace(/\n$/, "").split("\n");
  return (
    <pre class="pf-chat-diff">
      <For each={lines()}>
        {(line) => (
          <span class={`pf-diff-line ${diffLineClass(line)}`}>{line === "" ? " " : line}</span>
        )}
      </For>
    </pre>
  );
}

function FileChangeRow(props: {
  change: FileChange;
  open?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  const toggle = () => (props.onToggle ? props.onToggle() : setLocalOpen((v) => !v));
  return (
    <li class="pf-chat-file">
      <div class="pf-chat-file-row">
        <span class="pf-chat-file-kind">{props.change.kind}</span>
        <code class="pf-chat-file-path">{props.change.path}</code>
        <Show when={props.change.diff}>
          <button
            type="button"
            class="pf-chat-tail-toggle pf-chat-file-diff-toggle"
            aria-expanded={open()}
            onClick={toggle}
          >
            {open() ? "Hide diff" : "Diff"}
          </button>
        </Show>
      </div>
      <Show when={props.change.diff && open()}>
        <DiffView diff={props.change.diff!} />
      </Show>
    </li>
  );
}

export function FileChangeCard(props: {
  changes: FileChange[];
  expansion?: RowExpansion;
  rowKey?: string;
}): JSX.Element {
  return (
    <HairlinePanel class="pf-chat-card pf-chat-files">
      <div class="pf-chat-files-head">
        <MonoEyebrow text="Files" />
        <span class="pf-chat-meta">{props.changes.length}</span>
      </div>
      <ul class="pf-chat-files-list">
        <For each={props.changes}>
          {(change, i) => {
            const subKey = () => `${props.rowKey}:file:${i()}`;
            return (
              <FileChangeRow
                change={change}
                open={props.expansion ? props.expansion.get(subKey()) : undefined}
                onToggle={props.expansion ? () => props.expansion!.toggle(subKey()) : undefined}
              />
            );
          }}
        </For>
      </ul>
    </HairlinePanel>
  );
}
