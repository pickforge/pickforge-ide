// Web (CDP) DOM inspector. Mirrors A11yTree's layout/idiom but reads from a
// Chrome DevTools Protocol attachment instead of adb: it discovers a dev
// server's debugger (http://host:port/json), attaches to the page, dumps the
// DOM, and renders it as a collapsible tree. Selecting a node shows its
// selector / source attribute and, via the "Ask AI" forge, ships a capture
// (selected DOM node + best-effort mapped source) to a new agent terminal pane.
//
// Best-effort by design: a Chromium-based dev server with the debugger exposed
// (e.g. `--remote-debugging-port=9222`) must be running. When nothing is
// reachable the rail shows an honest "no dev server reachable" empty state — it
// never speaks Dart-VM-service language.
import { createSignal, For, Show } from "solid-js";
import { IconChevronDown, IconRefresh } from "../../components/icons";
import { EmberButton, MonoEyebrow } from "../../components/ui";
import {
  cdpAttach,
  cdpDetach,
  cdpDiscover,
  cdpDomTree,
  cdpResolveSource,
  type DomNode,
} from "../../lib/cdp";
import { inspectDir, inspectSave } from "../../lib/vm";
import { captureInRepo, setCaptureInRepo } from "../../stores/inspectStorage";
import { workspace } from "../../stores/workspace";
import { hasTerminalHost, launchAgentInSplit } from "../../stores/terminalHosts";
import { recordForgeDispatch } from "../../lib/runRecord";
import { shquote } from "../../lib/runTargets";
import { commandForItem, isAskAiItem, quickLaunchItems, type QuickLaunchItem } from "../../stores/quickLaunch";
import { buildCdpMarkdown, cdpBaseName } from "../../lib/widgetContext";

/** Default debugger endpoint a Chromium browser exposes with
 *  `--remote-debugging-port=9222`. */
const DEFAULT_DEBUGGER = "127.0.0.1:9222";

/** Parse "host:port" (or "http://host:port") into its parts; null if invalid. */
function parseEndpoint(raw: string): { host: string; port: number } | null {
  const trimmed = raw.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const m = /^([^:/]+):(\d{1,5})$/.exec(trimmed);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1], port };
}

/** A DOM node's display name: `tag#id`, else `tag.class0`, else the tag. */
function nodeName(n: DomNode): string {
  if (n.id) return `${n.tag}#${n.id}`;
  const cls = n.class?.split(/\s+/).filter(Boolean)[0];
  return cls ? `${n.tag}.${cls}` : n.tag;
}

/** Authored source for a node from its framework source attribute, if any.
 *  The attribute already encodes `file:line:col` (e.g. Vue's data-v-inspector,
 *  React click-to-source plugins) — the standard "click-to-source" handle. */
function nodeSource(n: DomNode): string | null {
  const a = n.sourceAttr?.trim();
  return a && a.length > 0 ? a : null;
}

/** Path of nodes from root to the node with `nodeId` (inclusive), or null. */
function findPath(root: DomNode, id: string, acc: DomNode[] = []): DomNode[] | null {
  const next = [...acc, root];
  if (root.nodeId === id) return next;
  for (const c of root.children) {
    const r = findPath(c, id, next);
    if (r) return r;
  }
  return null;
}

export function CdpTree(props: {
  // Capability gates from the active web target (adapters.rs). Web declares both
  // inspectSelection + mapSelectionToSource, but the props keep the component
  // honest if a future profile drops one.
  canInspect?: boolean;
  canMapSource?: boolean;
}) {
  const canInspect = () => props.canInspect ?? true;
  const canMapSource = () => props.canMapSource ?? false;
  const [endpoint, setEndpoint] = createSignal(DEFAULT_DEBUGGER);
  const [attached, setAttached] = createSignal(false);
  const [pageUrl, setPageUrl] = createSignal<string | null>(null);
  const [tree, setTree] = createSignal<DomNode | null>(null);
  const [selected, setSelected] = createSignal<DomNode | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [dumped, setDumped] = createSignal(false);
  const [composerFor, setComposerFor] = createSignal<QuickLaunchItem | null>(null);
  const [prompt, setPrompt] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const selectedNode = () => selected();

  // Bumped on each (re)attach + dump so a slow in-flight DOM dump from a prior
  // attachment can never paint over a newer view.
  let epoch = 0;

  const reset = () => {
    setTree(null);
    setSelected(null);
    setComposerFor(null);
    setDumped(false);
  };

  // Discover the dev server's debugger, attach to the first page, then dump the
  // DOM. Honest errors: an unreachable endpoint / no page target surfaces a
  // "no dev server reachable" message, not a crash.
  const connectAndDump = async () => {
    const ep = parseEndpoint(endpoint());
    if (!ep) {
      setError("Enter a debugger endpoint like 127.0.0.1:9222");
      return;
    }
    const mine = ++epoch;
    setError(null);
    setLoading(true);
    try {
      const targets = await cdpDiscover(ep.host, ep.port);
      if (mine !== epoch) return;
      const page = targets[0];
      if (!page) {
        setAttached(false);
        reset();
        setError("No dev server reachable (no debuggable page at this endpoint).");
        return;
      }
      await cdpAttach(page.webSocketDebuggerUrl);
      if (mine !== epoch) return;
      setAttached(true);
      setPageUrl(page.url || null);
      const root = await cdpDomTree();
      if (mine !== epoch) return;
      reset();
      setTree(root);
      setDumped(true);
    } catch (e) {
      if (mine !== epoch) return;
      setAttached(false);
      setError(
        `No dev server reachable. Run the web app under a Chromium browser with ` +
          `--remote-debugging-port set. (${String(e)})`,
      );
    } finally {
      if (mine === epoch) setLoading(false);
    }
  };

  // Re-dump the DOM on an existing attachment (no rediscovery).
  const redump = async () => {
    if (!attached()) return connectAndDump();
    const mine = ++epoch;
    setError(null);
    setLoading(true);
    try {
      const root = await cdpDomTree();
      if (mine !== epoch) return;
      reset();
      setTree(root);
      setDumped(true);
    } catch (e) {
      if (mine !== epoch) return;
      // A redump failure means the backend dropped the connection (tab/port
      // closed): the attachment is gone. Fall back to the detached view so the
      // honest "no dev server reachable" state shows and the user can re-attach,
      // instead of stranding them on a stale tree behind a dead CDP chip.
      setAttached(false);
      reset();
      setError(String(e));
    } finally {
      if (mine === epoch) setLoading(false);
    }
  };

  const selectNode = (n: DomNode) => {
    setSelected(n);
    setComposerFor(null);
  };

  const agentChips = () => quickLaunchItems().filter(isAskAiItem);

  const openComposer = (item: QuickLaunchItem) => {
    const n = selectedNode();
    setPrompt(`Review this ${n ? nodeName(n) : "element"} and suggest improvements.`);
    setComposerFor(item);
  };

  // Capture the selected DOM node (+ best-effort mapped source) into its own
  // capture folder, then launch the agent in a new pane pointed at the markdown.
  // Mirrors A11yTree.send; web nodes carry a source attribute when the dev
  // server injects one (else "no exact source").
  const send = async () => {
    if (busy()) return;
    const item = composerFor();
    const node = selectedNode();
    const root = workspace.activeRoot;
    if (!item || !node || !root) return;
    // Snapshot reactive state before any await so a redump / edit mid-send can't
    // drift the saved markdown or the armed chat.
    const t = tree();
    const instruction = prompt();
    const chatId = workspace.activeChatId;
    if (!chatId || !hasTerminalHost(chatId)) {
      setError("Open a chat first so the agent has a terminal.");
      return;
    }
    setBusy(true);
    try {
      // Resolve the framework source attribute (often a *generated* file:line:col)
      // through the page source map FIRST, so the capture + audit row record the
      // authored location, not the build artifact. Best-effort: an unmapped /
      // missing `.map` falls back to the raw attribute.
      const rawSource = canMapSource() ? nodeSource(node) : null;
      const ep = parseEndpoint(endpoint());
      const mapped =
        rawSource && ep ? await cdpResolveSource(ep.host, ep.port, rawSource) : null;
      const source = mapped ?? rawSource;
      const base = cdpBaseName(node);
      const dir = await inspectDir(captureInRepo(root), root);
      const path = (t ? findPath(t, node.nodeId) : null) ?? [node];
      const ancestors = path.slice(0, -1).map((n) => nodeName(n)).slice(-5);
      const children = node.children.map((c) => nodeName(c)).slice(0, 12);
      const md = buildCdpMarkdown({
        node,
        source,
        ancestors,
        children,
        pageUrl: pageUrl(),
        instruction,
      });
      // No screenshot for the CDP path (kept minimal — no per-node capture).
      const paths = await inspectSave(dir, base, md, null);
      const sourceNote = source
        ? `mapped source ${source}`
        : `NO exact source — search by selector / text / class`;
      const ask = `Read ${paths.mdPath} (PickForge web UI capture: selected DOM node + ${sourceNote}). ${instruction}`;
      const command = `${commandForItem(item)} ${shquote(ask)}`;
      const paneId = launchAgentInSplit(chatId, command, { forceLocal: true });
      if (paneId) {
        // Persist the dispatch for the forge audit (best-effort). When a source
        // mapped, record it as the creation file:line so the audit row carries
        // the same source the agent received.
        const loc = source ? parseFileLine(source) : null;
        void recordForgeDispatch(
          {
            id: 0,
            projectRoot: root,
            widgetClass: nodeName(node),
            creationFile: loc?.file ?? null,
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
      setComposerFor(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Show when={!attached()}>
        <div class="pf-inspector-section">
          <MonoEyebrow text="Web debugger" />
          <input
            class="pf-vm-input"
            value={endpoint()}
            onInput={(e) => setEndpoint(e.currentTarget.value)}
            placeholder="127.0.0.1:9222"
          />
          <EmberButton
            label={loading() ? "Connecting…" : "Connect"}
            disabled={loading() || !canInspect()}
            onClick={() => void connectAndDump()}
          />
          <Show when={error()}>
            <div class="pf-vm-error">{error()}</div>
          </Show>
          <p class="pf-inspector-hint">
            Run the web app under a Chromium-based browser with
            {" "}<span class="pf-mono">--remote-debugging-port=9222</span> and connect to
            inspect its DOM. Source mapping is best-effort.
          </p>
        </div>
      </Show>

      <Show when={attached()}>
        <div class="pf-inspector-section">
          <div class="pf-rail-head">
            <MonoEyebrow text="DOM tree" />
            <div class="pf-wt-actions">
              <button
                class="pf-vm-chip"
                title="Attached — click to detach"
                onClick={() => {
                  void cdpDetach();
                  setAttached(false);
                  reset();
                }}
              >
                <span class="pf-vm-dot" />
                CDP
              </button>
              <button
                class="pf-icon-btn"
                title="Re-dump the DOM"
                disabled={loading() || !canInspect()}
                onClick={() => void redump()}
              >
                <IconRefresh size={14} />
              </button>
            </div>
          </div>

          <Show
            when={tree()}
            fallback={
              <div class="pf-rail-empty">
                {loading()
                  ? "Dumping…"
                  : error()
                    ? error()
                    : dumped()
                      ? "Empty DOM (is the page loaded?)"
                      : "Dump the DOM to inspect"}
              </div>
            }
          >
            <div class="pf-wt-tree">
              <CdpTreeNode
                node={tree()!}
                depth={0}
                selectedId={() => selectedNode()?.nodeId ?? null}
                onSelect={selectNode}
              />
            </div>
          </Show>
        </div>
      </Show>

      <Show when={selectedNode()}>
        {(node) => (
          <div class="pf-inspector-section pf-wd">
            <MonoEyebrow text="Element" tick />
            <div class="pf-wd-head">
              <div class="pf-wd-meta">
                <span class="pf-wd-type">{nodeName(node())}</span>
                <Show
                  when={nodeSource(node())}
                  fallback={<span class="pf-wd-src pf-wd-src--none">no exact source</span>}
                >
                  <span class="pf-wd-src">{nodeSource(node())}</span>
                </Show>
              </div>
            </div>

            <Show
              when={composerFor()}
              fallback={
                <div class="pf-wd-ai">
                  <MonoEyebrow text="Ask AI" tick />
                  <Show when={!canMapSource() || !nodeSource(node())}>
                    <p class="pf-wd-disclaimer" title="No exact source mapping for this element">
                      No exact source mapping — the forge ships the selector
                      (tag / id / class, text) for the agent to search by.
                    </p>
                  </Show>
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
                    title="Where the capture (md) is saved"
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
                <span class="pf-wd-prop-name">tag</span>
                <span class="pf-wd-prop-val">{node().tag}</span>
              </div>
              <Show when={node().id}>
                <div class="pf-wd-prop">
                  <span class="pf-wd-prop-name">id</span>
                  <span class="pf-wd-prop-val">{node().id}</span>
                </div>
              </Show>
              <Show when={node().class}>
                <div class="pf-wd-prop">
                  <span class="pf-wd-prop-name">class</span>
                  <span class="pf-wd-prop-val">{node().class}</span>
                </div>
              </Show>
              <Show when={node().text}>
                <div class="pf-wd-prop">
                  <span class="pf-wd-prop-name">text</span>
                  <span class="pf-wd-prop-val">{node().text}</span>
                </div>
              </Show>
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

/** Parse a "file:line[:col]" source string into file + (zero-or-one-based) line. */
function parseFileLine(s: string): { file: string; line: number | null } | null {
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(s.trim());
  if (!m) return { file: s.trim(), line: null };
  return { file: m[1], line: Number(m[2]) };
}

function CdpTreeNode(props: {
  node: DomNode;
  depth: number;
  selectedId: () => string | null;
  onSelect: (n: DomNode) => void;
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
        <Show when={props.node.sourceAttr}>
          <span class="pf-a11y-role">src</span>
        </Show>
      </div>
      <Show when={open() && hasKids()}>
        <For each={props.node.children}>
          {(child) => (
            <CdpTreeNode
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
