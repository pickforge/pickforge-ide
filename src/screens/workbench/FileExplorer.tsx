// Lazy project file tree backed by the list_dir command.
import { createEffect, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { MonoEyebrow } from "../../components/ui";
import { IconChevronDown, IconChevronRight, IconDot } from "../../components/icons";
import { workspace } from "../../stores/workspace";

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}

function FileNode(props: { entry: Entry; depth: number }) {
  const [open, setOpen] = createSignal(false);
  const [children, setChildren] = createSignal<Entry[] | null>(null);

  const toggle = async () => {
    if (!props.entry.isDir) return;
    if (!open() && children() === null) {
      try {
        setChildren(await invoke<Entry[]>("list_dir", { path: props.entry.path }));
      } catch {
        setChildren([]);
      }
    }
    setOpen(!open());
  };

  return (
    <div>
      <div
        class="pf-file-row"
        style={{ "padding-left": `${props.depth * 12 + 8}px` }}
        onClick={toggle}
      >
        <span class="pf-file-icon">
          {props.entry.isDir ? (
            open() ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />
          ) : (
            <IconDot size={13} />
          )}
        </span>
        <span class="pf-file-name">{props.entry.name}</span>
      </div>
      <Show when={open() && children()}>
        <For each={children()!}>
          {(c) => <FileNode entry={c} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  );
}

export function FileExplorer() {
  const [entries, setEntries] = createSignal<Entry[]>([]);

  createEffect(() => {
    const root = workspace.activeRoot;
    if (!root) {
      setEntries([]);
      return;
    }
    invoke<Entry[]>("list_dir", { path: root })
      .then(setEntries)
      .catch(() => setEntries([]));
  });

  return (
    <section class="pf-rail-section pf-files">
      <div class="pf-rail-head">
        <MonoEyebrow text="Files" tick />
      </div>
      <div class="pf-file-tree">
        <Show
          when={workspace.activeRoot}
          fallback={<div class="pf-rail-empty">Open a project</div>}
        >
          <For each={entries()}>{(e) => <FileNode entry={e} depth={0} />}</For>
        </Show>
      </div>
    </section>
  );
}
