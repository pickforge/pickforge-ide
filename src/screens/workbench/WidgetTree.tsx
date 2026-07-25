// Flutter widget inspector: a live widget tree + a details panel + a "send to
// AI" composer. Click a node to highlight it on the device; "Select on device"
// taps a widget on the device and syncs it here; the details panel shows the
// type, source, props and a thumbnail; an agent chip opens a composer that ships
// the widget (screenshot + context markdown) to a new agent terminal pane.
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { IconChevronDown, IconChevronRight, IconRefresh } from "../../components/icons";
import { EmberButton, MonoEyebrow } from "../../components/ui";
import { findChat, workspace } from "../../stores/workspace";
import { hasTerminalHost, launchAgentInSplit, openFileInChat } from "../../stores/terminalHosts";
import { captureInRepo, setCaptureInRepo } from "../../stores/inspectStorage";
import { recordForgeDispatch } from "../../lib/runRecord";
import { shquote } from "../../lib/runTargets";
import { commandForItem, isAskAiItem, quickLaunchItems, type QuickLaunchItem } from "../../stores/quickLaunch";
import { buildWidgetMarkdown, widgetBaseName } from "../../lib/widgetContext";
import { publishMcpSelection } from "../../stores/mcp";
import {
  inspectDir,
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

async function resolveCapturePaths(
  iso: string,
  node: WidgetNode,
  root: string,
): Promise<{ dir: string; base: string; png: string | null; predictedPng: string | null }> {
  const png = await vmScreenshot(iso, node.id, 1024, 2048).catch(() => null);
  const base = widgetBaseName(node);
  // Default to PickForge home; per-project opt-in to the repo.
  const dir = await inspectDir(captureInRepo(root), root);
  const sep = dir.includes("\\") ? "\\" : "/";
  // Each capture gets its own sub-folder: <dir>/<base>/{context.md,screenshot.png}.
  const predictedPng = png ? `${dir}${sep}${base}${sep}screenshot.png` : null;
  return { dir, base, png, predictedPng };
}

/** Path of nodes from root to `node` (inclusive), falling back to just the
 *  node itself when the live tree doesn't contain it (e.g. the selection
 *  came from a device tap, not the summary tree). */
function resolveWidgetPath(tree: WidgetNode | null, node: WidgetNode): WidgetNode[] {
  return (tree ? findPath(tree, node.id) : null) ?? [node];
}

/** Persists the dispatch (pick + agent run) for the forge audit. Best
 *  effort — a write failure must not affect the launched agent. */
function recordWidgetCaptureDispatch(
  paneId: string,
  root: string,
  node: WidgetNode,
  chatId: string,
  item: QuickLaunchItem,
  command: string,
  md: string,
): void {
  const loc = node.creationLocation;
  void recordForgeDispatch(
    {
      id: 0,
      projectRoot: root,
      widgetClass: node.className,
      creationFile: loc ? fileFromUri(loc.file) : null,
      creationLine: loc?.line ?? null,
      skillId: "",
      agentId: item.agentId ?? item.id,
      terminalId: paneId,
      chatId,
      pickedAt: Date.now(),
      widgetContextJson: md,
    },
    command,
  );
}

/** Live-selection sync while "Select on device" is armed: polls the VM's
 *  selected widget on each frame event (debounced) and re-arms select mode
 *  after a hot restart invalidates the isolate. A composable, called
 *  synchronously from `WidgetTree`'s own setup so its `onMount`/`onCleanup`
 *  run under the same reactive owner as if written inline. */
function useLiveWidgetSelectionSync(
  refresh: () => void,
  isolate: () => string | null,
  setIsolate: (v: string | null) => void,
  selectMode: () => boolean,
  groupName: () => string,
  ensureIsolate: (force?: boolean) => Promise<string | null>,
  setSelected: (n: WidgetNode | null) => void,
  setSelectedId: (id: string | null) => void,
): void {
  const unlisteners: UnlistenFn[] = [];
  onMount(() => {
    refresh();
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
}

/** The widget tree list + its header controls. A presentational child
 *  component — everything is an accessor/callback prop. */
function WidgetTreeSection(props: {
  selectMode: () => boolean;
  onToggleSelectMode: () => void;
  onRefresh: () => void;
  tree: () => WidgetNode | null;
  loading: () => boolean;
  error: () => string | null;
  selectedId: () => string | null;
  onSelect: (n: WidgetNode) => void;
  onOpen: (n: WidgetNode) => void;
}) {
  return (
    <div class="pf-inspector-section">
      <div class="pf-rail-head">
        <MonoEyebrow text="Widget tree" />
        <div class="pf-wt-actions">
          <button
            class="pf-wt-toggle"
            classList={{ "pf-wt-toggle--on": props.selectMode() }}
            title="Select a widget by tapping it on the device"
            onClick={props.onToggleSelectMode}
          >
            Select on device
          </button>
          <button class="pf-icon-btn" title="Refresh" onClick={props.onRefresh}>
            <IconRefresh size={14} />
          </button>
        </div>
      </div>
      <Show
        when={props.tree()}
        fallback={
          <div class="pf-rail-empty">
            {props.loading() ? "Loading…" : props.error() ? props.error() : "No widget tree"}
          </div>
        }
      >
        <div class="pf-wt-tree">
          <TreeNode
            node={props.tree()!}
            depth={0}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            onOpen={props.onOpen}
          />
        </div>
      </Show>
    </div>
  );
}

/** The selected-widget details: thumbnail, source jump, "Ask AI" chips/
 *  composer, and the properties list. A presentational child component. */
/** The "Ask AI" chip row, or (once a chip is picked) its capture-prompt
 *  composer. A presentational child component. */
function WidgetAskAiPanel(props: {
  agentChips: () => QuickLaunchItem[];
  composerFor: () => QuickLaunchItem | null;
  onOpenComposer: (item: QuickLaunchItem) => void;
  onCloseComposer: () => void;
  prompt: () => string;
  onPromptChange: (v: string) => void;
  onSend: () => void;
  busy: () => boolean;
  captureInRepo: () => boolean;
  onToggleCaptureInRepo: () => void;
}) {
  return (
    <Show
      when={props.composerFor()}
      fallback={
        <div class="pf-wd-ai">
          <MonoEyebrow text="Ask AI" tick />
          <div class="pf-wd-ai-chips">
            <For each={props.agentChips()}>
              {(item) => (
                <button
                  class="pf-wd-chip"
                  title={`Send this widget to ${item.label}`}
                  onClick={() => props.onOpenComposer(item)}
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
        <MonoEyebrow text={`Ask ${props.composerFor()!.label}`} />
        <textarea
          class="pf-wd-prompt"
          value={props.prompt()}
          ref={(el) => setTimeout(() => el.focus(), 0)}
          onInput={(e) => props.onPromptChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              props.onSend();
            } else if (e.key === "Escape") {
              props.onCloseComposer();
            }
          }}
        />
        <div class="pf-wd-composer-actions">
          <button
            class="pf-wd-loc"
            title="Where the capture (md + screenshot) is saved"
            onClick={props.onToggleCaptureInRepo}
          >
            {props.captureInRepo() ? "saved in repo" : "saved in ~/.pickforge"}
          </button>
          <span class="pf-wd-composer-spacer" />
          <button class="pf-text-btn" disabled={props.busy()} onClick={props.onCloseComposer}>
            Cancel
          </button>
          <EmberButton label={props.busy() ? "Sending…" : "Send"} disabled={props.busy()} onClick={props.onSend} />
        </div>
      </div>
    </Show>
  );
}

/** The widget's property list, plus the null-value toggle. A presentational
 *  child component. */
function WidgetPropsList(props: {
  hasProps: () => boolean;
  visibleProps: () => WidgetProp[];
  nullCount: () => number;
  showNull: () => boolean;
  onToggleShowNull: () => void;
}) {
  return (
    <Show when={props.hasProps()}>
      <div class="pf-wd-props">
        <For each={props.visibleProps()}>
          {(p) => (
            <div class="pf-wd-prop">
              <span class="pf-wd-prop-name">{p.name}</span>
              <span class="pf-wd-prop-val">{p.value}</span>
            </div>
          )}
        </For>
        <Show when={props.nullCount() > 0}>
          <button class="pf-wd-nulltoggle" onClick={props.onToggleShowNull}>
            {props.showNull() ? "hide null" : `show ${props.nullCount()} null`}
          </button>
        </Show>
      </div>
    </Show>
  );
}

function WidgetDetailsPanel(props: {
  node: () => WidgetNode;
  thumb: () => string | null;
  onOpenLocation: (n: WidgetNode) => void;
  agentChips: () => QuickLaunchItem[];
  composerFor: () => QuickLaunchItem | null;
  onOpenComposer: (item: QuickLaunchItem) => void;
  onCloseComposer: () => void;
  prompt: () => string;
  onPromptChange: (v: string) => void;
  onSend: () => void;
  busy: () => boolean;
  captureInRepo: () => boolean;
  onToggleCaptureInRepo: () => void;
  hasProps: () => boolean;
  visibleProps: () => WidgetProp[];
  nullCount: () => number;
  showNull: () => boolean;
  onToggleShowNull: () => void;
  error: () => string | null;
}) {
  return (
    <div class="pf-inspector-section pf-wd">
      <MonoEyebrow text="Widget" tick />
      <div class="pf-wd-head">
        <div class="pf-wd-thumb">
          <Show when={props.thumb()} fallback={<span class="pf-wd-thumb-empty">—</span>}>
            <img src={props.thumb()!} alt={props.node().className} />
          </Show>
        </div>
        <div class="pf-wd-meta">
          <span class="pf-wd-type">{props.node().className}</span>
          <Show
            when={props.node().creationLocation}
            fallback={<span class="pf-wd-src pf-wd-src--none">no source (track-widget-creation off)</span>}
          >
            <button class="pf-wd-src" title="Open source" onClick={() => props.onOpenLocation(props.node())}>
              {fileFromUri(props.node().creationLocation!.file).split(/[/\\]/).pop()}:{props.node().creationLocation!.line}
            </button>
          </Show>
        </div>
      </div>

      <WidgetAskAiPanel
        agentChips={props.agentChips}
        composerFor={props.composerFor}
        onOpenComposer={props.onOpenComposer}
        onCloseComposer={props.onCloseComposer}
        prompt={props.prompt}
        onPromptChange={props.onPromptChange}
        onSend={props.onSend}
        busy={props.busy}
        captureInRepo={props.captureInRepo}
        onToggleCaptureInRepo={props.onToggleCaptureInRepo}
      />

      <WidgetPropsList
        hasProps={props.hasProps}
        visibleProps={props.visibleProps}
        nullCount={props.nullCount}
        showNull={props.showNull}
        onToggleShowNull={props.onToggleShowNull}
      />
      <Show when={props.error()}>
        <div class="pf-vm-error">{props.error()}</div>
      </Show>
    </div>
  );
}

/** Fetches properties + a thumbnail whenever the selection changes, clearing
 *  both when there's no selection/isolate yet. A composable, called
 *  synchronously from `createWidgetInspectorState`'s own setup so its
 *  `createEffect` runs under the same reactive owner as if written inline. */
function useWidgetPropsAndThumbSync(
  selectedId: () => string | null,
  isolate: () => string | null,
  groupName: () => string,
  setProps: (v: WidgetProp[]) => void,
  setThumb: (v: string | null) => void,
): void {
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
}

/** Captures the widget (screenshot + context md) and launches the agent in a
 *  new terminal pane with a short prompt referencing them. A factory (not a
 *  composable — no signals of its own) so `createWidgetInspectorState` can
 *  keep this flow out of its own body. */
function createWidgetCaptureSend(deps: {
  composerFor: () => QuickLaunchItem | null;
  selectedNode: () => WidgetNode | null;
  isolate: () => string | null;
  tree: () => WidgetNode | null;
  props: () => WidgetProp[];
  prompt: () => string;
  setError: (v: string | null) => void;
  setBusy: (v: boolean) => void;
  setComposerFor: (v: QuickLaunchItem | null) => void;
}): () => Promise<void> {
  return async () => {
    const item = deps.composerFor();
    const node = deps.selectedNode();
    const iso = deps.isolate();
    const root = workspace.activeRoot;
    if (!item || !node || !iso || !root) return;
    const chatId = workspace.activeChatId;
    if (!chatId || !hasTerminalHost(chatId)) {
      deps.setError("Open a chat first so the agent has a terminal.");
      return;
    }
    deps.setBusy(true);
    try {
      const { dir, base, png, predictedPng } = await resolveCapturePaths(iso, node, root);
      const path = resolveWidgetPath(deps.tree(), node);
      const ancestors = path.slice(0, -1).map((n) => n.className).slice(-5);
      const children = node.children.map((c) => c.className).slice(0, 12);
      const md = buildWidgetMarkdown({
        node,
        props: deps.props(),
        ancestors,
        children,
        pngPath: predictedPng,
        instruction: deps.prompt(),
      });
      const paths = await inspectSave(dir, base, md, png);
      const ask = `Read ${paths.mdPath} (PickForge widget capture: screenshot path + source file:line + props inside). ${deps.prompt()}`;
      const command = `${commandForItem(item)} ${shquote(ask)}`;
      const paneId = launchAgentInSplit(chatId, command, { forceLocal: true });
      if (paneId) recordWidgetCaptureDispatch(paneId, root, node, chatId, item, command, md);
      deps.setComposerFor(null);
    } catch (e) {
      deps.setError(String(e));
    } finally {
      deps.setBusy(false);
    }
  };
}

/** The isolate/tree refresh and select-mode handlers. A factory (not a
 *  composable — no signals of its own) so `createWidgetInspectorState` can
 *  keep this cluster out of its own body. */
function createWidgetTreeControls(
  isolate: () => string | null,
  setIsolate: (v: string | null) => void,
  setTree: (v: WidgetNode | null) => void,
  groupName: () => string,
  bumpGroup: () => void,
  setError: (v: string | null) => void,
  setLoading: (v: boolean) => void,
  setSelected: (v: WidgetNode | null) => void,
  setSelectedId: (v: string | null) => void,
  setComposerFor: (v: QuickLaunchItem | null) => void,
  selectMode: () => boolean,
  setSelectMode: (v: boolean) => void,
) {
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
      bumpGroup(); // fetch into the other group; backend disposes the prior one
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

  return { ensureIsolate, refresh, selectNode, toggleSelectMode };
}

/** Owns every signal and handler for the inspector: isolate/tree/selection
 *  state, the properties/thumbnail fetch effect, and the capture-and-send
 *  flow. A composable, called synchronously from `WidgetTree`'s own setup
 *  so its `createEffect`/`onMount`/`onCleanup` calls run under the same
 *  reactive owner as if written inline. */
function createWidgetInspectorState() {
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

  // Publish the live widget selection to the MCP endpoint so an embedded agent's
  // `get_current_selection` reflects exactly what the inspector shows. Cleared on
  // unmount so a closed inspector reports "no selection".
  createEffect(() => publishMcpSelection(selected()));
  onCleanup(() => publishMcpSelection(null));

  const { ensureIsolate, refresh, selectNode, toggleSelectMode } = createWidgetTreeControls(
    isolate,
    setIsolate,
    setTree,
    groupName,
    () => {
      group ^= 1;
    },
    setError,
    setLoading,
    setSelected,
    setSelectedId,
    setComposerFor,
    selectMode,
    setSelectMode,
  );

  // Open a widget's source — respects the file-open setting (in-app editor pane),
  // never the bare OS default editor, unless the user is in "system" mode.
  const openLocation = (n: WidgetNode) => {
    if (!n.creationLocation) return;
    const path = fileFromUri(n.creationLocation.file);
    const chatId = workspace.activeChatId;
    const projectRoot = chatId ? (findChat(chatId)?.projectRoot ?? workspace.activeRoot) : workspace.activeRoot;
    openFileInChat(chatId, path, projectRoot);
  };

  useWidgetPropsAndThumbSync(selectedId, isolate, groupName, setProps, setThumb);

  const openComposer = (item: QuickLaunchItem) => {
    const n = selectedNode();
    setPrompt(`Review this ${n?.className ?? "widget"} and suggest improvements.`);
    setComposerFor(item);
  };

  const send = createWidgetCaptureSend({
    composerFor,
    selectedNode,
    isolate,
    tree,
    props,
    prompt,
    setError,
    setBusy,
    setComposerFor,
  });

  useLiveWidgetSelectionSync(
    () => void refresh(),
    isolate,
    setIsolate,
    selectMode,
    groupName,
    ensureIsolate,
    setSelected,
    setSelectedId,
  );

  return {
    tree,
    loading,
    error,
    selectedId,
    selectMode,
    selectedNode,
    thumb,
    composerFor,
    prompt,
    busy,
    captureInRepoFlag: () => captureInRepo(workspace.activeRoot),
    hasProps: () => props().length > 0,
    visibleProps,
    nullCount,
    showNull,
    refresh,
    selectNode,
    toggleSelectMode,
    openLocation,
    openComposer,
    send,
    setComposerFor,
    setPrompt,
    setShowNull,
  };
}

export function WidgetTree() {
  const s = createWidgetInspectorState();
  const agentChips = () => quickLaunchItems().filter(isAskAiItem);

  return (
    <>
      <WidgetTreeSection
        selectMode={s.selectMode}
        onToggleSelectMode={() => void s.toggleSelectMode()}
        onRefresh={() => void s.refresh()}
        tree={s.tree}
        loading={s.loading}
        error={s.error}
        selectedId={s.selectedId}
        onSelect={s.selectNode}
        onOpen={s.openLocation}
      />

      <Show when={s.selectedNode()}>
        {(node) => (
          <WidgetDetailsPanel
            node={node}
            thumb={s.thumb}
            onOpenLocation={s.openLocation}
            agentChips={agentChips}
            composerFor={s.composerFor}
            onOpenComposer={s.openComposer}
            onCloseComposer={() => s.setComposerFor(null)}
            prompt={s.prompt}
            onPromptChange={s.setPrompt}
            onSend={() => void s.send()}
            busy={s.busy}
            captureInRepo={s.captureInRepoFlag}
            onToggleCaptureInRepo={() =>
              workspace.activeRoot &&
              setCaptureInRepo(workspace.activeRoot, !captureInRepo(workspace.activeRoot))
            }
            hasProps={s.hasProps}
            visibleProps={s.visibleProps}
            nullCount={s.nullCount}
            showNull={s.showNull}
            onToggleShowNull={() => s.setShowNull((o) => !o)}
            error={s.error}
          />
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
