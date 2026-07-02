import { type JSX, For } from "solid-js";
import { HairlinePanel, MonoEyebrow } from "../ui";
import "./chat.css";

export interface FileChange {
  path: string;
  kind: string;
  diff?: string | null;
}

export function FileChangeCard(props: { changes: FileChange[] }): JSX.Element {
  return (
    <HairlinePanel class="pf-chat-card pf-chat-files">
      <div class="pf-chat-files-head">
        <MonoEyebrow text="Files" />
        <span class="pf-chat-meta">{props.changes.length}</span>
      </div>
      <ul class="pf-chat-files-list">
        <For each={props.changes}>
          {(change) => (
            <li class="pf-chat-file-row">
              <span class="pf-chat-file-kind">{change.kind}</span>
              <code class="pf-chat-file-path">{change.path}</code>
            </li>
          )}
        </For>
      </ul>
    </HairlinePanel>
  );
}
