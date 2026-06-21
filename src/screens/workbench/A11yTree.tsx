// Framework-agnostic accessibility inspector for React Native / native-Android.
// Dumps the device's UIAutomator tree (the same XML native Views, Compose and RN
// all emit) for the selected adb serial and renders it as a collapsible tree;
// selecting a node shows its role / text / resourceId / bounds, and a device
// screenshot is fetched as a thumbnail. Mirrors WidgetTree's layout/idiom but
// reads from `adb_*` (not the Flutter VM service). The "send to AI" forge is
// intentionally left for #18 — node selection is surfaced so it can build on it.
import { createSignal, For, Show } from "solid-js";
import { IconChevronDown, IconRefresh } from "../../components/icons";
import { MonoEyebrow } from "../../components/ui";
import {
  adbDumpUiautomator,
  adbScreenshot,
  readImageDataUrl,
  type A11yNode,
} from "../../lib/device";
import { inspectDir } from "../../lib/vm";
import { captureInRepo } from "../../stores/inspectStorage";
import { workspace } from "../../stores/workspace";

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

export function A11yTree(props: { serial: string | null; online: boolean }) {
  const [tree, setTree] = createSignal<A11yNode | null>(null);
  const [selected, setSelected] = createSignal<A11yNode | null>(null);
  const [thumb, setThumb] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Tracks whether a dump has run, so the pre-dump and empty-after-dump states
  // read differently ("Dump…" vs "is the app foregrounded?").
  const [dumped, setDumped] = createSignal(false);

  /** The currently selected accessibility node (consumed by #18's forge). */
  const selectedNode = () => selected();

  const refresh = async () => {
    const serial = props.serial;
    if (!serial) return;
    setError(null);
    setLoading(true);
    try {
      const root = await adbDumpUiautomator(serial);
      setTree(root);
      setSelected(null);
      setThumb(null);
      setDumped(true);
      void loadThumb(serial);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // A device-level screenshot (not per-node) — the inspector's visual reference.
  // Captured into the inspect dir, then read back as a data URL for inline <img>.
  const loadThumb = async (serial: string) => {
    const root = workspace.activeRoot;
    if (!root) return;
    try {
      const dir = await inspectDir(captureInRepo(root), root);
      const path = await adbScreenshot(serial, dir, "a11y-screenshot.png");
      setThumb(path ? await readImageDataUrl(path) : null);
    } catch {
      setThumb(null);
    }
  };

  const selectNode = (n: A11yNode) => setSelected(n);

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
