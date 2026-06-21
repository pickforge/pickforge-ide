// Framework-agnostic accessibility inspector for React Native / native-Android.
// Dumps the device's UIAutomator tree (the same XML native Views, Compose and RN
// all emit) for the selected adb serial and renders it as a collapsible tree;
// selecting a node shows its role / text / resourceId / bounds, and a device
// screenshot is fetched as a thumbnail. Mirrors WidgetTree's layout/idiom but
// reads from `adb_*` (not the Flutter VM service), and its "Ask AI" forge ships
// the selected node (screenshot + context markdown) to a new agent terminal pane.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { IconChevronDown, IconRefresh } from "../../components/icons";
import { EmberButton, MonoEyebrow } from "../../components/ui";
import {
  adbDumpUiautomator,
  adbScreenshot,
  readImageDataUrl,
  type A11yNode,
} from "../../lib/device";
import { inspectDir, inspectSave } from "../../lib/vm";
import { captureInRepo, setCaptureInRepo } from "../../stores/inspectStorage";
import { workspace } from "../../stores/workspace";
import { getTerminalHost } from "../../stores/terminalHosts";
import { armChatAutoName } from "../../lib/chatAutoName";
import { shquote } from "../../lib/runTargets";
import { commandForItem, isAskAiItem, quickLaunchItems, type QuickLaunchItem } from "../../stores/quickLaunch";
import { a11yBaseName, buildA11yMarkdown } from "../../lib/widgetContext";

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

export function A11yTree(props: { serial: string | null; online: boolean }) {
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

  // Bumped on each dump AND on every serial/online change, so an in-flight dump
  // or screenshot whose serial is no longer current is discarded on resolve and
  // can never paint the previous device's tree over the new view.
  let epoch = 0;

  // Switching devices must not show the previous device's tree/screenshot, and a
  // slow in-flight call must not latch on later — clear everything and invalidate
  // outstanding requests whenever the serial (or online state) changes.
  createEffect(
    on(
      () => [props.serial, props.online] as const,
      () => {
        epoch++;
        setTree(null);
        setSelected(null);
        setThumb(null);
        setShotB64(null);
        setComposerFor(null);
        setError(null);
        setDumped(false);
        setLoading(false);
      },
      { defer: true },
    ),
  );

  const refresh = async () => {
    const serial = props.serial;
    if (!serial) return;
    const mine = ++epoch;
    setError(null);
    setLoading(true);
    try {
      const root = await adbDumpUiautomator(serial);
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

  // A device-level screenshot (not per-node) — the inspector's visual reference.
  // Captured into the inspect dir, then read back as a data URL for inline <img>.
  // Tagged with the dump's epoch so a stale screenshot can't overwrite a newer
  // view (or the next device's).
  const loadThumb = async (serial: string, mine: number) => {
    const root = workspace.activeRoot;
    if (!root) return;
    try {
      const dir = await inspectDir(captureInRepo(root), root);
      const path = await adbScreenshot(serial, dir, "a11y-screenshot.png");
      const url = path ? await readImageDataUrl(path) : null;
      if (mine === epoch && serial === props.serial) {
        setThumb(url);
        // Keep the accepted bytes so the forge can't re-read a file a stale
        // in-flight dump may have overwritten. Strip the data-URL prefix once.
        setShotB64(url ? url.replace(/^data:image\/png;base64,/, "") : null);
      }
    } catch {
      if (mine === epoch && serial === props.serial) {
        setThumb(null);
        setShotB64(null);
      }
    }
  };

  const selectNode = (n: A11yNode) => {
    setSelected(n);
    setComposerFor(null);
  };

  const agentChips = () => quickLaunchItems().filter(isAskAiItem);

  const openComposer = (item: QuickLaunchItem) => {
    const n = selectedNode();
    setPrompt(`Review this ${n ? nodeName(n) : "element"} and suggest improvements.`);
    setComposerFor(item);
  };

  // Capture the selected node (reusing the dump's device screenshot) into its own
  // capture folder, then launch the agent in a new pane with a prompt that points
  // at the markdown. Mirrors WidgetTree.send, minus any source file:line.
  const send = async () => {
    if (busy()) return;
    const item = composerFor();
    const node = selectedNode();
    const root = workspace.activeRoot;
    if (!item || !node || !root) return;
    // Snapshot reactive state before any await — a refresh/device switch or an
    // edit mid-send must not let findPath, the saved markdown, or the armed chat
    // drift from what the user launched.
    const t = tree();
    const instruction = prompt();
    const chatId = workspace.activeChatId;
    const host = getTerminalHost(chatId);
    if (!host) {
      setError("Open a chat first so the agent has a terminal.");
      return;
    }
    setBusy(true);
    try {
      // Ship the ACCEPTED screenshot bytes (the base64 that passed the epoch check
      // and is shown as the thumbnail) so the capture folder always matches the
      // displayed thumbnail — never a re-read of a11y-screenshot.png that a stale
      // in-flight dump may have overwritten.
      const png = shotB64();
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
      });
      const paths = await inspectSave(dir, base, md, png);
      const ask = `Read ${paths.mdPath} (PickForge UI capture: screenshot path + runtime accessibility info, NO source file:line — search by resource-id / text / class). ${instruction}`;
      const paneId = host.openInNewPane(`${commandForItem(item)} ${shquote(ask)}`);
      if (paneId) armChatAutoName(chatId, paneId);
      setComposerFor(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="pf-inspector-section">
        <div class="pf-rail-head">
          <MonoEyebrow text="Accessibility tree" />
          <div class="pf-wt-actions">
            <button
              class="pf-icon-btn"
              title="Dump accessibility tree"
              disabled={!props.serial || loading()}
              onClick={() => void refresh()}
            >
              <IconRefresh size={14} />
            </button>
          </div>
        </div>

        <Show
          when={props.online && props.serial}
          fallback={<div class="pf-rail-empty">Connect or boot a device to inspect</div>}
        >
          <Show
            when={tree()}
            fallback={
              <div class="pf-rail-empty">
                {loading()
                  ? "Dumping…"
                  : error()
                    ? error()
                    : dumped()
                      ? "No accessibility tree (is the app foregrounded?)"
                      : "Dump the accessibility tree to inspect"}
              </div>
            }
          >
            <div class="pf-wt-tree">
              <A11yTreeNode
                node={tree()!}
                depth={0}
                selectedId={() => selectedNode()?.nodeId ?? null}
                onSelect={selectNode}
              />
            </div>
          </Show>
        </Show>
      </div>

      <Show when={selectedNode()}>
        {(node) => (
          <div class="pf-inspector-section pf-wd">
            <MonoEyebrow text="Node" tick />
            <div class="pf-wd-head">
              <div class="pf-wd-thumb">
                <Show when={thumb()} fallback={<span class="pf-wd-thumb-empty">—</span>}>
                  <img src={thumb()!} alt={node().className} />
                </Show>
              </div>
              <div class="pf-wd-meta">
                <span class="pf-wd-type">{nodeName(node())}</span>
                <span class="pf-wd-src pf-wd-src--none">{node().className}</span>
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
                          title={`Send this element to ${item.label}`}
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
                      if (!busy()) void send();
                    } else if (e.key === "Escape") {
                      setComposerFor(null);
                    }
                  }}
                />
                <div class="pf-wd-composer-actions">
                  <button
                    class="pf-wd-loc"
                    title="Where the capture (md + screenshot) is saved"
                    onClick={() =>
                      workspace.activeRoot &&
                      setCaptureInRepo(workspace.activeRoot, !captureInRepo(workspace.activeRoot))
                    }
                  >
                    {captureInRepo(workspace.activeRoot) ? "saved in repo" : "saved in ~/.pickforge"}
                  </button>
                  <span class="pf-wd-composer-spacer" />
                  <button class="pf-text-btn" disabled={busy()} onClick={() => setComposerFor(null)}>
                    Cancel
                  </button>
                  <EmberButton label={busy() ? "Sending…" : "Send"} disabled={busy()} onClick={() => void send()} />
                </div>
              </div>
            </Show>

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
                  <span class="pf-wd-prop-name">resource-id</span>
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
            <Show when={error()}>
              <div class="pf-vm-error">{error()}</div>
            </Show>
          </div>
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
