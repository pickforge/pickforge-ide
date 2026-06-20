// Flutter widget inspector: a live widget tree + a details panel + a "send to
// AI" composer. Click a node to highlight it on the device; "Select on device"
// taps a widget on the device and syncs it here; the details panel shows the
// type, source, props and a thumbnail; an agent chip opens a composer that ships
// the widget (screenshot + context markdown) to a new agent terminal pane.
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { IconChevronDown, IconChevronRight, IconRefresh } from "../../components/icons";
import { EmberButton, MonoEyebrow } from "../../components/ui";
import { openPathSystem } from "../../lib/opener";
import { editorCommand } from "../../stores/fileOpenSettings";
import { workspace } from "../../stores/workspace";
import { getTerminalHost } from "../../stores/terminalHosts";
import { armChatAutoName } from "../../lib/chatAutoName";
import { shquote } from "../../lib/runTargets";
import { commandForItem, isAskAiItem, quickLaunchItems, type QuickLaunchItem } from "../../stores/quickLaunch";
import { buildWidgetMarkdown, widgetBaseName } from "../../lib/widgetContext";
import {
  inspectSave,
  onVmFrame,
  vmFindIsolate,
  vmScreenshot,
  vmSelectedWidget,
  vmSetSelection,
  vmShowSelectMode,
  vmWidgetProperties,
  vmWidgetTree,
  type WidgetNode,
  type WidgetProp,
} from "../../lib/vm";

// Flutter creation locations are file:// URIs — decode percent-escapes and the
// Windows `/C:/…` leading slash so the path is openable.
function fileFromUri(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    let p = decodeURIComponent(new URL(uri).pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // /C:/Users → C:/Users
    return p;
  } catch {
    return decodeURIComponent(uri.replace(/^file:\/\//, ""));
  }
}

/** Path of nodes from root to the node with `id` (inclusive), or null. */
function findPath(root: WidgetNode, id: string, acc: WidgetNode[] = []): WidgetNode[] | null {
  const next = [...acc, root];
  if (root.id === id) return next;
  for (const c of root.children) {
    const r = findPath(c, id, next);
    if (r) return r;
  }
  return null;
}

export function WidgetTree() {
  const [isolate, setIsolate] = createSignal<string | null>(null);
  const [tree, setTree] = createSignal<WidgetNode | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  // The selected node is stored directly (not derived from the tree) so a
  // device-tapped widget that isn't in the summary tree still shows details.
  const [selected, setSelected] = createSignal<WidgetNode | null>(null);
  const [selectMode, setSelectMode] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [props, setProps] = createSignal<WidgetProp[]>([]);
  const [showNull, setShowNull] = createSignal(false);
  const nullCount = () => props().filter((p) => p.value === "null").length;
  const visibleProps = () => (showNull() ? props() : props().filter((p) => p.value !== "null"));
  const [thumb, setThumb] = createSignal<string | null>(null);
  const [composerFor, setComposerFor] = createSignal<QuickLaunchItem | null>(null);
  const [prompt, setPrompt] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  // Rotate two object groups so selection ids stay valid across refreshes.
  let group = 0;
  const groupName = () => `pf-inspect-${group}`;

  const selectedNode = () => selected();

  // Resolve the Flutter isolate. `force` re-discovers it (the isolate changes on
  // hot restart, so cached ids go stale — re-resolve instead of making the user
  // disconnect/reconnect the VM).
  const ensureIsolate = async (force = false): Promise<string | null> => {
    if (!force) {
      const iso = isolate();
      if (iso) return iso;
    }
    const iso = await vmFindIsolate();
    setIsolate(iso);
    return iso;
  };

  const refresh = async () => {
    setError(null);
    setLoading(true);
    try {
      const iso = await ensureIsolate(true);
      if (!iso) return;
      group ^= 1; // fetch into the other group; backend disposes the prior one
      setTree(await vmWidgetTree(iso, groupName()));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const selectNode = (n: WidgetNode) => {
    setSelected(n);
    setSelectedId(n.id);
    setComposerFor(null);
    const iso = isolate();
    if (iso && n.id) void vmSetSelection(iso, n.id, groupName()).catch(() => {});
  };

  const toggleSelectMode = async () => {
    const next = !selectMode();
    setSelectMode(next);
    // Re-resolve the isolate so this works after a hot restart without a manual
    // VM reconnect.
    const iso = await ensureIsolate(true).catch(() => null);
    if (iso) void vmShowSelectMode(iso, next).catch(() => {});
  };

  // Open a widget's source — respects the file-open setting (in-app editor pane),
  // never the bare OS default editor, unless the user is in "system" mode.
  const openLocation = (n: WidgetNode) => {
    if (!n.creationLocation) return;
    const path = fileFromUri(n.creationLocation.file);
    const cmd = editorCommand(path);
    const host = getTerminalHost(workspace.activeChatId);
    if (cmd === null || !host) {
      void openPathSystem(path).catch(() => {});
      return;
    }
    host.openInNewPane(cmd);
  };

  // Fetch properties + thumbnail when the selection changes.
  createEffect(() => {
    const id = selectedId();
    const iso = isolate();
    if (!id || !iso) {
      setProps([]);
      setThumb(null);
      return;
    }
    void vmWidgetProperties(iso, id, groupName()).then(setProps).catch(() => setProps([]));
    void vmScreenshot(iso, id, 320, 320)
      .then((b64) => setThumb(b64 ? `data:image/png;base64,${b64}` : null))
      .catch(() => setThumb(null));
  });

  const openComposer = (item: QuickLaunchItem) => {
    const n = selectedNode();
    setPrompt(`Review this ${n?.className ?? "widget"} and suggest improvements.`);
    setComposerFor(item);
  };

  // Capture the widget (screenshot + context md) and launch the agent in a new
  // terminal pane with a short prompt referencing them.
  const send = async () => {
    const item = composerFor();
    const node = selectedNode();
    const iso = isolate();
    const root = workspace.activeRoot;
    if (!item || !node || !iso || !root) return;
    const host = getTerminalHost(workspace.activeChatId);
    if (!host) {
      setError("Open a chat first so the agent has a terminal.");
      return;
    }
    setBusy(true);
    try {
      const png = await vmScreenshot(iso, node.id, 1024, 2048).catch(() => null);
      const base = widgetBaseName(node);
      const sep = root.includes("\\") ? "\\" : "/";
      const predictedPng = png ? `${root}${sep}.pickforge${sep}inspect${sep}${base}.png` : null;
      const t = tree();
      const path = (t ? findPath(t, node.id) : null) ?? [node];
      const ancestors = path.slice(0, -1).map((n) => n.className).slice(-5);
      const children = node.children.map((c) => c.className).slice(0, 12);
      const md = buildWidgetMarkdown({
        node,
        props: props(),
        ancestors,
        children,
        pngPath: predictedPng,
        instruction: prompt(),
      });
      const paths = await inspectSave(root, base, md, png);
      const ask = `Read ${paths.mdPath} (PickForge widget capture: screenshot path + source file:line + props inside). ${prompt()}`;
      const paneId = host.openInNewPane(`${commandForItem(item)} ${shquote(ask)}`);
      if (paneId) armChatAutoName(workspace.activeChatId, paneId);
      setComposerFor(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  let unlisteners: UnlistenFn[] = [];
  onMount(() => {
    void refresh();
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    void onVmFrame(() => {
      if (!selectMode()) return;
      clearTimeout(frameTimer);
      frameTimer = setTimeout(() => {
        const iso = isolate();
        if (!iso) return;
        void vmSelectedWidget(iso, groupName())
          .then((sel) => {
            if (sel?.id) {
              setSelected(sel);
              setSelectedId(sel.id);
            }
          })
          .catch(async () => {
            // Likely a hot restart (isolate changed) — re-resolve and re-arm
            // select mode so it keeps working without a manual reconnect.
            setIsolate(null);
            const fresh = await ensureIsolate(true).catch(() => null);
            if (fresh && selectMode()) void vmShowSelectMode(fresh, true).catch(() => {});
          });
      }, 250);
    }).then((u) => unlisteners.push(u));
    // A device tap selects + shows details here; it must NOT auto-open the OS
    // editor — opening source is explicit (the jump button), via the editor pane.
    onCleanup(() => {
      clearTimeout(frameTimer);
      unlisteners.forEach((u) => u());
      const iso = isolate();
      if (iso && selectMode()) void vmShowSelectMode(iso, false).catch(() => {});
    });
  });

  const agentChips = () => quickLaunchItems().filter(isAskAiItem);

  return (
    <>
      <div class="pf-inspector-section">
        <div class="pf-rail-head">
          <MonoEyebrow text="Widget tree" />
          <div class="pf-wt-actions">
            <button
              class="pf-wt-toggle"
              classList={{ "pf-wt-toggle--on": selectMode() }}
              title="Select a widget by tapping it on the device"
              onClick={toggleSelectMode}
            >
              Select on device
            </button>
            <button class="pf-icon-btn" title="Refresh" onClick={() => void refresh()}>
              <IconRefresh size={14} />
            </button>
          </div>
        </div>
        <Show
          when={tree()}
          fallback={
            <div class="pf-rail-empty">
              {loading() ? "Loading…" : error() ? error() : "No widget tree"}
            </div>
          }
        >
          <div class="pf-wt-tree">
            <TreeNode
              node={tree()!}
              depth={0}
              selectedId={selectedId}
              onSelect={selectNode}
              onOpen={openLocation}
            />
          </div>
        </Show>
      </div>

      <Show when={selectedNode()}>
        {(node) => (
          <div class="pf-inspector-section pf-wd">
            <MonoEyebrow text="Widget" tick />
            <div class="pf-wd-head">
              <div class="pf-wd-thumb">
                <Show when={thumb()} fallback={<span class="pf-wd-thumb-empty">—</span>}>
                  <img src={thumb()!} alt={node().className} />
                </Show>
              </div>
              <div class="pf-wd-meta">
                <span class="pf-wd-type">{node().className}</span>
                <Show
                  when={node().creationLocation}
                  fallback={<span class="pf-wd-src pf-wd-src--none">no source (track-widget-creation off)</span>}
                >
                  <button class="pf-wd-src" title="Open source" onClick={() => openLocation(node())}>
                    {fileFromUri(node().creationLocation!.file).split(/[/\\]/).pop()}:{node().creationLocation!.line}
                  </button>
                </Show>
              </div>
            </div>

            <Show
              when={composerFor()}
              fallback={
                <div class="pf-wd-ai">
                  <MonoEyebrow text="Ask AI" tick />
                  <div class="pf-wd-ai-chips">
                    <For each={agentChips()}>
                      {(item) => (
                        <button
                          class="pf-wd-chip"
                          title={`Send this widget to ${item.label}`}
                          onClick={() => openComposer(item)}
                        >
                          {item.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              }
            >
              <div class="pf-wd-composer">
                <MonoEyebrow text={`Ask ${composerFor()!.label}`} />
                <textarea
                  class="pf-wd-prompt"
                  value={prompt()}
                  ref={(el) => setTimeout(() => el.focus(), 0)}
                  onInput={(e) => setPrompt(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    } else if (e.key === "Escape") {
                      setComposerFor(null);
                    }
                  }}
                />
                <div class="pf-wd-composer-actions">
                  <button class="pf-text-btn" disabled={busy()} onClick={() => setComposerFor(null)}>
                    Cancel
                  </button>
                  <EmberButton label={busy() ? "Sending…" : "Send"} disabled={busy()} onClick={() => void send()} />
                </div>
              </div>
            </Show>

            <Show when={props().length > 0}>
              <div class="pf-wd-props">
                <For each={visibleProps()}>
                  {(p) => (
                    <div class="pf-wd-prop">
                      <span class="pf-wd-prop-name">{p.name}</span>
                      <span class="pf-wd-prop-val">{p.value}</span>
                    </div>
                  )}
                </For>
                <Show when={nullCount() > 0}>
                  <button class="pf-wd-nulltoggle" onClick={() => setShowNull((o) => !o)}>
                    {showNull() ? "hide null" : `show ${nullCount()} null`}
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={error()}>
              <div class="pf-vm-error">{error()}</div>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

function TreeNode(props: {
  node: WidgetNode;
  depth: number;
  selectedId: () => string | null;
  onSelect: (n: WidgetNode) => void;
  onOpen: (n: WidgetNode) => void;
}) {
  const [open, setOpen] = createSignal(props.depth < 3);
  const hasKids = () => props.node.children.length > 0;
  const selected = () => props.selectedId() === props.node.id;
  return (
    <div class="pf-wt-node">
      <div
        class="pf-wt-row"
        classList={{ "pf-wt-row--on": selected() }}
        style={{ "padding-left": `${props.depth * 12 + 4}px` }}
        onClick={() => props.onSelect(props.node)}
      >
        <button
          class="pf-wt-caret"
          classList={{ "pf-wt-caret--hidden": !hasKids() }}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <Show when={hasKids()}>
            <IconChevronDown size={11} class={open() ? "" : "pf-flip-x"} />
          </Show>
        </button>
        <span class="pf-wt-name">{props.node.className}</span>
        <Show when={props.node.creationLocation}>
          <button
            class="pf-wt-jump"
            title={`Open ${props.node.creationLocation!.file}:${props.node.creationLocation!.line}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onOpen(props.node);
            }}
          >
            <IconChevronRight size={11} />
          </button>
        </Show>
      </div>
      <Show when={open() && hasKids()}>
        <For each={props.node.children}>
          {(child) => (
            <TreeNode
              node={child}
              depth={props.depth + 1}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
              onOpen={props.onOpen}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
