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

/** Mutable lane-assignment state threaded through `layout`'s per-commit
 *  helpers: `lanes[i]` is the hash expected next at lane `i`. */
interface LaneState {
  lanes: (string | null)[];
  laneColor: number[];
  nextColor: number;
}

function freeLaneSlot(state: LaneState): number {
  const i = state.lanes.indexOf(null);
  if (i !== -1) return i;
  state.lanes.push(null);
  state.laneColor.push(0);
  return state.lanes.length - 1;
}

/** Reuses the lane this commit's children were already waiting on, or claims
 *  a fresh one. */
function claimCommitLane(state: LaneState, hash: string): { lane: number; color: number } {
  let lane = state.lanes.indexOf(hash);
  if (lane === -1) {
    lane = freeLaneSlot(state);
    state.laneColor[lane] = state.nextColor++ % LANE_COLORS.length;
  }
  state.lanes[lane] = hash; // claim for the snapshot
  return { lane, color: state.laneColor[lane] };
}

// Child lanes that were waiting for this commit merge into it.
function releaseMergedLanes(state: LaneState, hash: string, myLane: number): void {
  for (let i = 0; i < state.lanes.length; i++) {
    if (state.lanes[i] === hash && i !== myLane) state.lanes[i] = null;
  }
}

// First parent continues in this lane; extra parents branch into new lanes.
function advanceLanesForParents(state: LaneState, parents: string[], myLane: number): void {
  if (parents.length === 0) {
    state.lanes[myLane] = null;
    return;
  }
  state.lanes[myLane] = parents[0];
  for (let pi = 1; pi < parents.length; pi++) {
    const par = parents[pi];
    if (state.lanes.indexOf(par) === -1) {
      const slot = freeLaneSlot(state);
      state.lanes[slot] = par;
      state.laneColor[slot] = state.nextColor++ % LANE_COLORS.length;
    }
  }
}

function buildRowSegments(
  topLanes: (string | null)[],
  botLanes: (string | null)[],
  laneColor: number[],
  c: GraphCommit,
  myLane: number,
  color: number,
): Segment[] {
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
  return segments;
}

/** Assign each commit a lane and the connectors between adjacent rows. Lane
 *  indices are stable (slots are reused, never compacted) so pass-through lanes
 *  draw as straight vertical lines. */
function layout(commits: GraphCommit[]): { rows: LayoutRow[]; lanes: number } {
  const state: LaneState = { lanes: [], laneColor: [], nextColor: 0 };
  let maxLanes = 1;
  const rows: LayoutRow[] = [];

  for (const c of commits) {
    const { lane: myLane, color } = claimCommitLane(state, c.hash);
    const topLanes = state.lanes.slice();
    releaseMergedLanes(state, c.hash, myLane);
    advanceLanesForParents(state, c.parents, myLane);
    const botLanes = state.lanes.slice();
    const segments = buildRowSegments(topLanes, botLanes, state.laneColor, c, myLane, color);

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
