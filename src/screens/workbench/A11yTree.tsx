// Framework-agnostic accessibility inspector for React Native / native-Android
// and native iOS. Dumps the device's accessibility tree — UIAutomator (the same
// XML native Views, Compose and RN all emit) for adb serials, or `idb` for a
// booted simulator — and renders it as a collapsible tree; selecting a node
// shows its role / text / resourceId / bounds, and a device screenshot is
// fetched as a thumbnail. Mirrors WidgetTree's layout/idiom but reads from
// `adb_*` / `ios_*` (not the Flutter VM service), and its "Ask AI" forge ships
// the selected node (screenshot + context markdown) to a new agent terminal pane.
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { IconChevronDown, IconRefresh } from "../../components/icons";
import { EmberButton, MonoEyebrow } from "../../components/ui";
import {
  adbDumpUiautomator,
  adbScreenshot,
  iosDumpAccessibility,
  iosScreenshot,
  readImageDataUrl,
  type A11yNode,
} from "../../lib/device";
import { inspectDir, inspectSave } from "../../lib/vm";
import { captureInRepo, setCaptureInRepo } from "../../stores/inspectStorage";
import { workspace } from "../../stores/workspace";
import { hasTerminalHost, launchAgentInSplit } from "../../stores/terminalHosts";
import { recordForgeDispatch } from "../../lib/runRecord";
import { shquote } from "../../lib/runTargets";
import { commandForItem, isAskAiItem, quickLaunchItems, type QuickLaunchItem } from "../../stores/quickLaunch";
import { a11yBaseName, buildA11yMarkdown } from "../../lib/widgetContext";
import { publishMcpSelection } from "../../stores/mcp";

/** Bounds → "left,top → right,bottom (w×h)" for the details panel. */
function boundsLabel(b: A11yNode["bounds"]): string {
  const w = Math.round(b.right - b.left);
  const h = Math.round(b.bottom - b.top);
  return `${b.left},${b.top} → ${b.right},${b.bottom} (${w}×${h})`;
}

/** A node's display name: its resource-id leaf, else text, else class basename. */
function nodeName(n: A11yNode): string {
  const idLeaf = n.resourceId?.split("/").pop();
  if (idLeaf) return idLeaf;
  if (n.text) return n.text;
  const cls = n.className.split(".").pop() ?? n.className;
  return cls || "node";
}

/** Path of nodes from root to the node with `nodeId` (inclusive), or null. */
function findPath(root: A11yNode, id: string, acc: A11yNode[] = []): A11yNode[] | null {
  const next = [...acc, root];
  if (root.nodeId === id) return next;
  for (const c of root.children) {
    const r = findPath(c, id, next);
    if (r) return r;
  }
  return null;
}

type A11ySource = "uiAutomator" | "iosAccessibility";

/** The device-level screenshot fetch (not per-node): captures into the
 *  inspect dir, reads it back as a data URL, and keeps the accepted bytes
 *  (used by `send`) so a stale in-flight dump can't overwrite what's shown.
 *  A factory (not a composable — no signals of its own). */
function createA11yThumbLoader(
  source: () => A11ySource,
  serialMatches: (serial: string, mine: number) => boolean,
  setThumb: (v: string | null) => void,
  setShotB64: (v: string | null) => void,
) {
  return async (serial: string, mine: number) => {
    const root = workspace.activeRoot;
    if (!root) return;
    try {
      const dir = await inspectDir(captureInRepo(root), root);
      const path =
        source() === "iosAccessibility"
          ? await iosScreenshot(serial, dir, "a11y-screenshot.png")
          : await adbScreenshot(serial, dir, "a11y-screenshot.png");
      const url = path ? await readImageDataUrl(path) : null;
      if (serialMatches(serial, mine)) {
        setThumb(url);
        // Keep the accepted bytes so the forge can't re-read a file a stale
        // in-flight dump may have overwritten. Strip the data-URL prefix once.
        setShotB64(url ? url.replace(/^data:image\/png;base64,/, "") : null);
      }
    } catch {
      if (serialMatches(serial, mine)) {
        setThumb(null);
        setShotB64(null);
      }
    }
  };
}

/** Captures the selected node (reusing the dump's device screenshot) into
 *  its own capture folder, then launches the agent in a new pane with a
 *  prompt that points at the markdown. Mirrors WidgetTree's `send`, minus
 *  any source file:line. A factory (not a composable — no signals of its
 *  own) so `createA11yInspectorState` can keep this flow out of its own
 *  body. */
function createA11yCaptureSend(deps: {
  busy: () => boolean;
  composerFor: () => QuickLaunchItem | null;
  selectedNode: () => A11yNode | null;
  tree: () => A11yNode | null;
  prompt: () => string;
  shotB64: () => string | null;
  source: () => A11ySource;
  handles: () => { id: string; list: string; search: string };
  setError: (v: string | null) => void;
  setBusy: (v: boolean) => void;
  setComposerFor: (v: QuickLaunchItem | null) => void;
}): () => Promise<void> {
  return async () => {
    if (deps.busy()) return;
    const item = deps.composerFor();
    const node = deps.selectedNode();
    const root = workspace.activeRoot;
    if (!item || !node || !root) return;
    // Snapshot reactive state before any await — a refresh/device switch or an
    // edit mid-send must not let findPath, the saved markdown, or the armed chat
    // drift from what the user launched.
    const t = deps.tree();
    const instruction = deps.prompt();
    const chatId = workspace.activeChatId;
    if (!chatId || !hasTerminalHost(chatId)) {
      deps.setError("Open a chat first so the agent has a terminal.");
      return;
    }
    deps.setBusy(true);
    try {
      // Ship the ACCEPTED screenshot bytes (the base64 that passed the epoch check
      // and is shown as the thumbnail) so the capture folder always matches the
      // displayed thumbnail — never a re-read of a11y-screenshot.png that a stale
      // in-flight dump may have overwritten.
      const png = deps.shotB64();
      const base = a11yBaseName(node);
      const dir = await inspectDir(captureInRepo(root), root);
      const sep = dir.includes("\\") ? "\\" : "/";
      const predictedPng = png ? `${dir}${sep}${base}${sep}screenshot.png` : null;
      const path = (t ? findPath(t, node.nodeId) : null) ?? [node];
      const ancestors = path.slice(0, -1).map((n) => nodeName(n)).slice(-5);
      const children = node.children.map((c) => nodeName(c)).slice(0, 12);
      const md = buildA11yMarkdown({
        node,
        ancestors,
        children,
        pngPath: predictedPng,
        instruction,
        source: deps.source(),
      });
      const paths = await inspectSave(dir, base, md, png);
      const ask = `Read ${paths.mdPath} (PickForge UI capture: screenshot path + runtime accessibility info, NO source file:line — search by ${deps.handles().search}). ${instruction}`;
      const command = `${commandForItem(item)} ${shquote(ask)}`;
      const paneId = launchAgentInSplit(chatId, command, { forceLocal: true });
      if (paneId) {
        // Persist the dispatch (pick + agent run) for the forge audit. Best
        // effort — a write failure must not affect the launched agent. A11y
        // nodes carry no source file:line (search by resource-id / text / class).
        void recordForgeDispatch(
          {
            id: 0,
            projectRoot: root,
            widgetClass: node.className,
            creationFile: null,
            creationLine: null,
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
      deps.setComposerFor(null);
    } catch (e) {
      deps.setError(String(e));
    } finally {
      deps.setBusy(false);
    }
  };
}

/** Switching devices must not show the previous device's tree/screenshot, and
 *  a slow in-flight call must not latch on later — clears everything and
 *  bumps the epoch (invalidating outstanding requests) whenever the serial
 *  (or online state) changes. A composable, called synchronously from
 *  `createA11yInspectorState`'s own setup so its `createEffect` runs under
 *  the same reactive owner as if written inline. */
function useA11yResetOnDeviceChange(
  serial: () => string | null,
  online: () => boolean,
  bumpEpoch: () => void,
  reset: {
    setTree: (v: A11yNode | null) => void;
    setSelected: (v: A11yNode | null) => void;
    setThumb: (v: string | null) => void;
    setShotB64: (v: string | null) => void;
    setComposerFor: (v: QuickLaunchItem | null) => void;
    setError: (v: string | null) => void;
    setDumped: (v: boolean) => void;
    setLoading: (v: boolean) => void;
  },
): void {
  createEffect(
    on(
      () => [serial(), online()] as const,
      () => {
        bumpEpoch();
        reset.setTree(null);
        reset.setSelected(null);
        reset.setThumb(null);
        reset.setShotB64(null);
        reset.setComposerFor(null);
        reset.setError(null);
        reset.setDumped(false);
        reset.setLoading(false);
      },
      { defer: true },
    ),
  );
}

/** Owns every signal and handler for the inspector: tree/selection/dump
 *  state, the epoch-guarded refresh + thumbnail load, and the
 *  capture-and-send flow. A composable, called synchronously from
 *  `A11yTree`'s own setup so its `createEffect`/`onCleanup` calls run
 *  under the same reactive owner as if written inline. */
function createA11yInspectorState(props: {
  serial: string | null;
  online: boolean;
  source: () => A11ySource;
  handles: () => { id: string; list: string; search: string };
}) {
  const [tree, setTree] = createSignal<A11yNode | null>(null);
  const [selected, setSelected] = createSignal<A11yNode | null>(null);
  const [thumb, setThumb] = createSignal<string | null>(null);
  // Base64 PNG (no data-URL prefix) of the screenshot that passed the epoch check
  // and is shown as the thumbnail. The forge ships THESE bytes so the saved capture
  // always matches the displayed thumbnail, even if a stale in-flight dump later
  // overwrites a11y-screenshot.png on disk.
  const [shotB64, setShotB64] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Tracks whether a dump has run, so the pre-dump and empty-after-dump states
  // read differently ("Dump…" vs "is the app foregrounded?").
  const [dumped, setDumped] = createSignal(false);
  const [composerFor, setComposerFor] = createSignal<QuickLaunchItem | null>(null);
  const [prompt, setPrompt] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  /** The currently selected accessibility node (the forge target). */
  const selectedNode = () => selected();

  // Publish the live a11y selection to the MCP endpoint so an embedded agent's
  // `get_current_selection` reflects what the inspector shows; cleared on unmount.
  createEffect(() => publishMcpSelection(selected()));
  onCleanup(() => publishMcpSelection(null));

  // Bumped on each dump AND on every serial/online change, so an in-flight dump
  // or screenshot whose serial is no longer current is discarded on resolve and
  // can never paint the previous device's tree over the new view.
  let epoch = 0;

  useA11yResetOnDeviceChange(
    () => props.serial,
    () => props.online,
    () => {
      epoch++;
    },
    { setTree, setSelected, setThumb, setShotB64, setComposerFor, setError, setDumped, setLoading },
  );

  const loadThumb = createA11yThumbLoader(
    props.source,
    (serial, mine) => mine === epoch && serial === props.serial,
    setThumb,
    setShotB64,
  );

  const refresh = async () => {
    const serial = props.serial;
    if (!serial) return;
    const mine = ++epoch;
    setError(null);
    setLoading(true);
    try {
      const root =
        props.source() === "iosAccessibility"
          ? await iosDumpAccessibility(serial)
          : await adbDumpUiautomator(serial);
      if (mine !== epoch || serial !== props.serial) return; // superseded
      setTree(root);
      setSelected(null);
      setThumb(null);
      setShotB64(null);
      setComposerFor(null);
      setDumped(true);
      void loadThumb(serial, mine);
    } catch (e) {
      if (mine !== epoch || serial !== props.serial) return;
      setError(String(e));
    } finally {
      if (mine === epoch) setLoading(false);
    }
  };

  const selectNode = (n: A11yNode) => {
    setSelected(n);
    setComposerFor(null);
  };

  const openComposer = (item: QuickLaunchItem) => {
    const n = selectedNode();
    setPrompt(`Review this ${n ? nodeName(n) : "element"} and suggest improvements.`);
    setComposerFor(item);
  };

  const send = createA11yCaptureSend({
    busy,
    composerFor,
    selectedNode,
    tree,
    prompt,
    shotB64,
    source: props.source,
    handles: props.handles,
    setError,
    setBusy,
    setComposerFor,
  });

  return {
    tree,
    selectedNode,
    thumb,
    loading,
    error,
    dumped,
    composerFor,
    prompt,
    busy,
    refresh,
    selectNode,
    openComposer,
    setComposerFor,
    setPrompt,
    send,
  };
}

/** The tree section: header (dump button) + collapsible node tree, gated on
 *  inspect capability and device online state. A presentational child
 *  component. */
function A11yTreeSection(props: {
  serial: string | null;
  online: boolean;
  canInspect: () => boolean;
  loading: () => boolean;
  onRefresh: () => void;
  tree: () => A11yNode | null;
  error: () => string | null;
  dumped: () => boolean;
  selectedId: () => string | null;
  onSelect: (n: A11yNode) => void;
}) {
  return (
    <div class="pf-inspector-section">
      <div class="pf-rail-head">
        <MonoEyebrow text="Accessibility tree" />
        <div class="pf-wt-actions">
          <button
            class="pf-icon-btn"
            title={
              props.canInspect()
                ? "Dump accessibility tree"
                : "This target can't be inspected (no inspect-selection capability)"
            }
            disabled={!props.serial || props.loading() || !props.canInspect()}
            onClick={props.onRefresh}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </div>

      <Show
        when={props.canInspect()}
        fallback={<div class="pf-rail-empty">This target can't be inspected on the device.</div>}
      >
        <Show
          when={props.online && props.serial}
          fallback={<div class="pf-rail-empty">Connect or boot a device to inspect</div>}
        >
          <Show
            when={props.tree()}
            fallback={
              <div class="pf-rail-empty">
                {props.loading()
                  ? "Dumping…"
                  : props.error()
                    ? props.error()
                    : props.dumped()
                      ? "No accessibility tree (is the app foregrounded?)"
                      : "Dump the accessibility tree to inspect"}
              </div>
            }
          >
            <div class="pf-wt-tree">
              <A11yTreeNode
                node={props.tree()!}
                depth={0}
                selectedId={props.selectedId}
                onSelect={props.onSelect}
              />
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** The "Ask AI" chip row, or (once a chip is picked) its capture-prompt
 *  composer. A presentational child component. */
function A11yAskAiPanel(props: {
  canMapSource: () => boolean;
  handles: () => { id: string; list: string; search: string };
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
          <Show when={!props.canMapSource()}>
            <p class="pf-wd-disclaimer" title="No exact source mapping for this target">
              No exact source mapping — the forge ships runtime handles
              ({props.handles().list}) for the agent to search by.
            </p>
          </Show>
          <div class="pf-wd-ai-chips">
            <For each={props.agentChips()}>
              {(item) => (
                <button
                  class="pf-wd-chip"
                  title={`Send this element to ${item.label}`}
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
              if (!props.busy()) props.onSend();
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

/** The selected node's details: thumbnail, "Ask AI" chips/composer, and its
 *  role/text/resource-id/bounds/flags. A presentational child component. */
function A11yDetailsPanel(props: {
  node: () => A11yNode;
  thumb: () => string | null;
  handles: () => { id: string; list: string; search: string };
  canMapSource: () => boolean;
  agentChips: () => QuickLaunchItem[];
  composerFor: () => QuickLaunchItem | null;
  onOpenComposer: (item: QuickLaunchItem) => void;
  onCloseComposer: () => void;
  prompt: () => string;
  onPromptChange: (v: string) => void;
  onSend: () => void;
  busy: () => boolean;
  error: () => string | null;
}) {
  const node = props.node;
  return (
    <div class="pf-inspector-section pf-wd">
      <MonoEyebrow text="Node" tick />
      <div class="pf-wd-head">
        <div class="pf-wd-thumb">
          <Show when={props.thumb()} fallback={<span class="pf-wd-thumb-empty">—</span>}>
            <img src={props.thumb()!} alt={node().className} />
          </Show>
        </div>
        <div class="pf-wd-meta">
          <span class="pf-wd-type">{nodeName(node())}</span>
          <span class="pf-wd-src pf-wd-src--none">{node().className}</span>
        </div>
      </div>

      <A11yAskAiPanel
        canMapSource={props.canMapSource}
        handles={props.handles}
        agentChips={props.agentChips}
        composerFor={props.composerFor}
        onOpenComposer={props.onOpenComposer}
        onCloseComposer={props.onCloseComposer}
        prompt={props.prompt}
        onPromptChange={props.onPromptChange}
        onSend={props.onSend}
        busy={props.busy}
        captureInRepo={() => captureInRepo(workspace.activeRoot)}
        onToggleCaptureInRepo={() =>
          workspace.activeRoot &&
          setCaptureInRepo(workspace.activeRoot, !captureInRepo(workspace.activeRoot))
        }
      />

      <div class="pf-wd-props">
        <div class="pf-wd-prop">
          <span class="pf-wd-prop-name">role</span>
          <span class="pf-wd-prop-val">{node().role}</span>
        </div>
        <Show when={node().text}>
          <div class="pf-wd-prop">
            <span class="pf-wd-prop-name">text</span>
            <span class="pf-wd-prop-val">{node().text}</span>
          </div>
        </Show>
        <Show when={node().contentDescription}>
          <div class="pf-wd-prop">
            <span class="pf-wd-prop-name">content-desc</span>
            <span class="pf-wd-prop-val">{node().contentDescription}</span>
          </div>
        </Show>
        <Show when={node().resourceId}>
          <div class="pf-wd-prop">
            <span class="pf-wd-prop-name">{props.handles().id}</span>
            <span class="pf-wd-prop-val">{node().resourceId}</span>
          </div>
        </Show>
        <div class="pf-wd-prop">
          <span class="pf-wd-prop-name">bounds</span>
          <span class="pf-wd-prop-val">{boundsLabel(node().bounds)}</span>
        </div>
        <div class="pf-wd-prop">
          <span class="pf-wd-prop-name">flags</span>
          <span class="pf-wd-prop-val">
            {[
              node().enabled ? "enabled" : "disabled",
              node().clickable ? "clickable" : null,
              node().selected ? "selected" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>
      <Show when={props.error()}>
        <div class="pf-vm-error">{props.error()}</div>
      </Show>
    </div>
  );
}

export function A11yTree(props: {
  serial: string | null;
  online: boolean;
  // Which dump/screenshot backend the `serial` targets: adb UIAutomator
  // (RN / native-Android) or `idb` on an iOS simulator (native iOS, where
  // `serial` carries the udid). Both return the same A11yNode shape / PNG path,
  // so the rest of the component is source-agnostic.
  source?: A11ySource;
  // Capability gates from the active target (adapters.rs). When inspect is
  // absent the dump/forge is muted (not dead); when source mapping is absent the
  // forge carries a "no exact source" certainty note (mirrors buildA11yMarkdown).
  canInspect?: boolean;
  canMapSource?: boolean;
}) {
  const source = () => props.source ?? "uiAutomator";
  // Search-handle vocabulary for the active source — iOS (idb) nodes carry
  // identifier / label / role; adb UIAutomator nodes carry resource-id / text /
  // class. Keeps the node-detail label, the forge disclaimer and the agent prompt
  // consistent with the capture markdown (buildA11yMarkdown).
  const handles = () =>
    source() === "iosAccessibility"
      ? { id: "identifier", list: "accessibility id, label, role", search: "accessibility id / label / role" }
      : { id: "resource-id", list: "resource-id, text, class", search: "resource-id / text / class" };
  const canInspect = () => props.canInspect ?? true;
  const canMapSource = () => props.canMapSource ?? false;
  const agentChips = () => quickLaunchItems().filter(isAskAiItem);

  const s = createA11yInspectorState({ serial: props.serial, online: props.online, source, handles });

  return (
    <>
      <A11yTreeSection
        serial={props.serial}
        online={props.online}
        canInspect={canInspect}
        loading={s.loading}
        onRefresh={() => void s.refresh()}
        tree={s.tree}
        error={s.error}
        dumped={s.dumped}
        selectedId={() => s.selectedNode()?.nodeId ?? null}
        onSelect={s.selectNode}
      />

      <Show when={s.selectedNode()}>
        {(node) => (
          <A11yDetailsPanel
            node={node}
            thumb={s.thumb}
            handles={handles}
            canMapSource={canMapSource}
            agentChips={agentChips}
            composerFor={s.composerFor}
            onOpenComposer={s.openComposer}
            onCloseComposer={() => s.setComposerFor(null)}
            prompt={s.prompt}
            onPromptChange={s.setPrompt}
            onSend={() => void s.send()}
            busy={s.busy}
            error={s.error}
          />
        )}
      </Show>
    </>
  );
}

function A11yTreeNode(props: {
  node: A11yNode;
  depth: number;
  selectedId: () => string | null;
  onSelect: (n: A11yNode) => void;
}) {
  const [open, setOpen] = createSignal(props.depth < 3);
  const hasKids = () => props.node.children.length > 0;
  const selected = () => props.selectedId() === props.node.nodeId;
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
        <span class="pf-wt-name">{nodeName(props.node)}</span>
        <Show when={props.node.role !== "unknown"}>
          <span class="pf-a11y-role">{props.node.role}</span>
        </Show>
      </div>
      <Show when={open() && hasKids()}>
        <For each={props.node.children}>
          {(child) => (
            <A11yTreeNode
              node={child}
              depth={props.depth + 1}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
