// A VS Code-style commit graph for the Source Control pane. The backend hands
// back commits + parents; lane/topology layout is computed here and drawn as an
// SVG column beside each commit row. Read-only.
import { createResource, createSignal, For, Show } from "solid-js";
import { gitLogGraph, type GraphCommit } from "../../lib/git";

const LANE_W = 14;
const ROW_H = 30;
const DOT_R = 4;
// Tokenized lane palette (data-viz colors, cycled per lane).
const LANE_COLORS = [
  "var(--pf-info)",
  "var(--pf-connected)",
  "var(--pf-warning)",
  "var(--pf-error)",
  "var(--pf-ember)",
  "var(--pf-text-med)",
];
const MAX_LANES = 6; // clamp the graph column so it never eats the narrow pane

interface Segment {
  x1: number;
  x2: number;
  color: number;
}
interface LayoutRow {
  commit: GraphCommit;
  nodeLane: number;
  color: number;
  segments: Segment[];
}

/** Assign each commit a lane and the connectors between adjacent rows. Lane
 *  indices are stable (slots are reused, never compacted) so pass-through lanes
 *  draw as straight vertical lines. */
function layout(commits: GraphCommit[]): { rows: LayoutRow[]; lanes: number } {
  const lanes: (string | null)[] = []; // lanes[i] = hash expected next at lane i
  const laneColor: number[] = [];
  let nextColor = 0;
  let maxLanes = 1;
  const rows: LayoutRow[] = [];

  const freeSlot = () => {
    const i = lanes.indexOf(null);
    if (i !== -1) return i;
    lanes.push(null);
    laneColor.push(0);
    return lanes.length - 1;
  };

  for (const c of commits) {
    let myLane = lanes.indexOf(c.hash);
    if (myLane === -1) {
      myLane = freeSlot();
      laneColor[myLane] = nextColor++ % LANE_COLORS.length;
    }
    lanes[myLane] = c.hash; // claim for the snapshot
    const color = laneColor[myLane];
    const topLanes = lanes.slice();

    // Child lanes that were waiting for this commit merge into it.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === c.hash && i !== myLane) lanes[i] = null;
    }
    // First parent continues in this lane; extra parents branch into new lanes.
    if (c.parents.length === 0) {
      lanes[myLane] = null;
    } else {
      lanes[myLane] = c.parents[0];
      for (let pi = 1; pi < c.parents.length; pi++) {
        const par = c.parents[pi];
        if (lanes.indexOf(par) === -1) {
          const slot = freeSlot();
          lanes[slot] = par;
          laneColor[slot] = nextColor++ % LANE_COLORS.length;
        }
      }
    }
    const botLanes = lanes.slice();

    const segments: Segment[] = [];
    for (let i = 0; i < topLanes.length; i++) {
      const h = topLanes[i];
      if (!h) continue;
      if (h === c.hash) {
        if (c.parents.length > 0) segments.push({ x1: i, x2: myLane, color });
      } else {
        const bi = botLanes.indexOf(h);
        if (bi !== -1) segments.push({ x1: i, x2: bi, color: laneColor[bi] ?? 0 });
      }
    }
    for (let pi = 1; pi < c.parents.length; pi++) {
      const bi = botLanes.indexOf(c.parents[pi]);
      if (bi !== -1) segments.push({ x1: myLane, x2: bi, color: laneColor[bi] ?? color });
    }

    maxLanes = Math.max(maxLanes, topLanes.length, botLanes.length);
    rows.push({ commit: c, nodeLane: myLane, color, segments });
  }
  return { rows, lanes: Math.min(maxLanes, MAX_LANES) };
}

const cx = (lane: number) => Math.min(lane, MAX_LANES - 1) * LANE_W + LANE_W / 2;
const path = (s: Segment) => {
  const x1 = cx(s.x1);
  const x2 = cx(s.x2);
  if (x1 === x2) return `M ${x1} 0 L ${x1} ${ROW_H}`;
  const mid = ROW_H / 2;
  return `M ${x1} 0 C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${ROW_H}`;
};

// Strip the "HEAD -> ", "tag: ", "origin/" noise into a short ref chip label.
function refLabel(ref: string): { label: string; kind: string } {
  if (ref.startsWith("HEAD -> ")) return { label: ref.slice(8), kind: "head" };
  if (ref === "HEAD") return { label: "HEAD", kind: "head" };
  if (ref.startsWith("tag: ")) return { label: ref.slice(5), kind: "tag" };
  if (ref.startsWith("origin/")) return { label: ref, kind: "remote" };
  return { label: ref, kind: "branch" };
}

export function GitGraph(props: { repo: string; version?: number }) {
  const [commits] = createResource(
    () => ({ repo: props.repo, v: props.version ?? 0 }),
    (src) => gitLogGraph(src.repo, 200).catch(() => [] as GraphCommit[]),
  );
  const [selected, setSelected] = createSignal<string | null>(null);
  const data = () => layout(commits() ?? []);
  const graphW = () => data().lanes * LANE_W;

  return (
    <div class="pf-graph">
      <Show
        when={(commits() ?? []).length > 0}
        fallback={<div class="pf-rail-empty">{commits.loading ? "Loading…" : "No commits"}</div>}
      >
        <For each={data().rows}>
          {(row) => {
            const c = row.commit;
            const isSel = () => selected() === c.hash;
            return (
              <div
                class="pf-graph-row"
                classList={{ "pf-graph-row--sel": isSel() }}
                onClick={() => setSelected(isSel() ? null : c.hash)}
              >
                <div class="pf-graph-track">
                  <svg width={graphW()} height={ROW_H} style={{ flex: "none" }}>
                    <For each={row.segments}>
                      {(s) => (
                        <path
                          d={path(s)}
                          fill="none"
                          stroke={LANE_COLORS[s.color]}
                          stroke-width="1.5"
                          opacity="0.85"
                        />
                      )}
                    </For>
                    <circle cx={cx(row.nodeLane)} cy={ROW_H / 2} r={DOT_R} fill={LANE_COLORS[row.color]} />
                  </svg>
                  <div class="pf-graph-meta">
                    <For each={c.refs}>
                      {(ref) => {
                        const r = refLabel(ref);
                        return <span class="pf-graph-ref" data-kind={r.kind}>{r.label}</span>;
                      }}
                    </For>
                    <span class="pf-graph-subject" title={c.subject}>{c.subject}</span>
                  </div>
                </div>
                <Show when={isSel()}>
                  <div class="pf-graph-detail">
                    <div class="pf-graph-detail-row">
                      <span class="pf-graph-hash">{c.short}</span>
                      <span class="pf-graph-author">{c.author}</span>
                      <span class="pf-graph-date">{c.date}</span>
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
