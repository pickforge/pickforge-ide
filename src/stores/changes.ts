// Changes review store seam (#231 PR2): scope switch between a specific
// agent turn ("thisTurn") and the live working tree ("workingTree"), lazy
// per-file diff fetch keyed by path, and freshness state per scope. No UI
// lives here yet — PR3/PR4 build the chat receipt and Workbench surface on
// top of this.
//
// Each scope keeps its OWN target/result/freshness state rather than one
// shared slot, so switching the scope toggle back and forth (a "This turn" /
// "Working tree" tab, not a full re-navigation) doesn't discard the other
// scope's already-fetched data — matching the issue's "scope switch" as a
// toggle over two live views, not a destructive re-target.
//
// `stale` here is a STORE-level cache-freshness concept — "a refresh trigger
// fired since the last successful fetch, so the cached ChangeSet might not
// reflect current reality" — distinct from `ChangeSet.stale` on the wire
// (turn scope: still open; working-tree scope: always `false`, since a live
// read is fresh by construction the moment it's returned). See
// `lib/changes.ts`'s `ChangeSet.stale` doc comment for that split.
import { createSignal } from "solid-js";
import { errorText } from "../lib/errors";
import {
  changesListTurnChangeSets,
  changesTurnFileDiff,
  changesWorkingTree,
  changesWorkingTreeFileDiff,
  type ChangeDiff,
  type ChangeSet,
  type WorkingTreeChanges,
} from "../lib/changes";

export type ChangesReviewScope = "thisTurn" | "workingTree";

interface ThisTurnTarget {
  chatId: string;
  projectRoot: string;
  turnSeq: number;
}

interface WorkingTreeTarget {
  projectRoot: string;
}

// ---- "this turn" slice ----

const [scope, setScopeSignal] = createSignal<ChangesReviewScope>("thisTurn");

const [turnTarget, setTurnTargetSignal] = createSignal<ThisTurnTarget | null>(null);
const [turnChangeSet, setTurnChangeSet] = createSignal<ChangeSet | null>(null);
const [turnLoading, setTurnLoading] = createSignal(false);
const [turnError, setTurnError] = createSignal<string | null>(null);
const [turnCapturedAt, setTurnCapturedAt] = createSignal<number | null>(null);
const [turnStale, setTurnStale] = createSignal(false);
let turnDiffCache = new Map<string, Promise<ChangeDiff>>();
// Bumped at the START of every `refreshThisTurn` call (a target switch or a
// refresh trigger both go through it) — same pattern as `stores/agentChat.ts`'s
// `ensureGenerations`. A completion only commits its result if this still
// matches the generation it captured; an older, slower request finishing
// after a newer one has already landed is a no-op instead of clobbering the
// newer result (and, worse, resetting `turnLoading` back to false under a
// still-in-flight newer fetch).
let turnGeneration = 0;

// ---- "working tree" slice ----

const [workingTreeTarget, setWorkingTreeTargetSignal] = createSignal<WorkingTreeTarget | null>(null);
const [workingTreeChangeSet, setWorkingTreeChangeSet] = createSignal<ChangeSet | null>(null);
const [workingTreeState, setWorkingTreeState] = createSignal<WorkingTreeChanges["state"] | null>(null);
const [workingTreeLoading, setWorkingTreeLoading] = createSignal(false);
const [workingTreeError, setWorkingTreeError] = createSignal<string | null>(null);
const [workingTreeCapturedAt, setWorkingTreeCapturedAt] = createSignal<number | null>(null);
const [workingTreeStale, setWorkingTreeStale] = createSignal(false);
let workingTreeDiffCache = new Map<string, Promise<ChangeDiff>>();
// See `turnGeneration` above — same guard, working-tree slice.
let workingTreeGeneration = 0;

// ---- scope-derived public signals (mirror whichever slice is active) ----

export const changesReviewScope = scope;
export const changesReviewChangeSet = () =>
  scope() === "thisTurn" ? turnChangeSet() : workingTreeChangeSet();
export const changesReviewLoading = () =>
  scope() === "thisTurn" ? turnLoading() : workingTreeLoading();
export const changesReviewError = () =>
  scope() === "thisTurn" ? turnError() : workingTreeError();
export const changesReviewCapturedAt = () =>
  scope() === "thisTurn" ? turnCapturedAt() : workingTreeCapturedAt();
export const changesReviewStale = () =>
  scope() === "thisTurn" ? turnStale() : workingTreeStale();
/** Only meaningful in `workingTree` scope: `null` before the first fetch,
 *  otherwise the explicit `notARepo`/`remoteUnsupported`/`ready` state the
 *  last `changes_working_tree` call returned. */
export const changesReviewWorkingTreeState = workingTreeState;

export function setChangesReviewScope(next: ChangesReviewScope): void {
  setScopeSignal(next);
}

// ---- targeting + refresh ----

export function setThisTurnTarget(chatId: string, projectRoot: string, turnSeq: number): void {
  setTurnTargetSignal({ chatId, projectRoot, turnSeq });
  turnDiffCache = new Map();
  setTurnChangeSet(null);
  setTurnError(null);
  setTurnCapturedAt(null);
  setTurnStale(false);
  void refreshThisTurn();
}

/** The in-chat receipt's "Review changes" action (#231 PR3): selects
 *  `turnSeq`'s ChangeSet as the active review target and switches scope to
 *  "this turn", so whatever is watching this store (today: the Source
 *  Control pane focus below; PR4: the reusable Changes reviewer) shows that
 *  turn's snapshot. */
export function openChangesReviewForTurn(chatId: string, projectRoot: string, turnSeq: number): void {
  setChangesReviewScope("thisTurn");
  setThisTurnTarget(chatId, projectRoot, turnSeq);
}

export function setWorkingTreeTarget(projectRoot: string): void {
  setWorkingTreeTargetSignal({ projectRoot });
  workingTreeDiffCache = new Map();
  setWorkingTreeChangeSet(null);
  setWorkingTreeState(null);
  setWorkingTreeError(null);
  setWorkingTreeCapturedAt(null);
  setWorkingTreeStale(false);
  void refreshWorkingTree();
}

async function refreshThisTurn(): Promise<void> {
  const target = turnTarget();
  if (!target) return;
  const generation = ++turnGeneration;
  setTurnLoading(true);
  try {
    const sets = await changesListTurnChangeSets(target.chatId, target.projectRoot);
    if (generation !== turnGeneration) return; // superseded by a newer request — never commit
    setTurnChangeSet(sets.find((cs) => cs.turnSeq === target.turnSeq) ?? null);
    setTurnError(null);
    setTurnCapturedAt(Date.now());
    setTurnStale(false);
    turnDiffCache = new Map(); // a refetch invalidates any lazily-cached diffs
  } catch (err) {
    if (generation !== turnGeneration) return;
    setTurnError(errorText(err));
  } finally {
    if (generation === turnGeneration) setTurnLoading(false);
  }
}

async function refreshWorkingTree(): Promise<void> {
  const target = workingTreeTarget();
  if (!target) return;
  const generation = ++workingTreeGeneration;
  setWorkingTreeLoading(true);
  try {
    const result = await changesWorkingTree(target.projectRoot);
    if (generation !== workingTreeGeneration) return; // superseded by a newer request — never commit
    setWorkingTreeState(result.state);
    setWorkingTreeChangeSet(result.state === "ready" ? result.changeSet : null);
    setWorkingTreeError(null);
    setWorkingTreeCapturedAt(Date.now());
    setWorkingTreeStale(false);
    workingTreeDiffCache = new Map();
  } catch (err) {
    if (generation !== workingTreeGeneration) return;
    setWorkingTreeError(errorText(err));
  } finally {
    if (generation === workingTreeGeneration) setWorkingTreeLoading(false);
  }
}

/** Re-fetches the currently ACTIVE scope's target. Callers that need both
 *  scopes fresh (e.g. a project-change trigger while either target might be
 *  set) should call the `notify*` functions below instead, which check both
 *  slices' targets independent of which one is currently on screen. */
export function refreshChangesReview(): Promise<void> {
  return scope() === "thisTurn" ? refreshThisTurn() : refreshWorkingTree();
}

// ---- lazy per-file diff fetch, keyed by path (+ staged for working tree) ----

/** Fetches (and caches) the unified diff for `path` in the ACTIVE scope's
 *  current target. The promise itself is cached — not just its resolved
 *  value — so concurrent callers asking for the same file share one request
 *  instead of racing duplicate fetches; a rejected fetch is evicted so a
 *  transient error doesn't permanently wedge later attempts. The cache is
 *  cleared on every successful refresh (a stale diff must never outlive the
 *  listing it was fetched against) and whenever the target changes.
 *
 *  The eviction closure below captures the SPECIFIC map instance (`cache`) a
 *  promise was stored in, never the mutable `turnDiffCache`/`workingTreeDiffCache`
 *  module binding directly — `refreshThisTurn`/`refreshWorkingTree` reassign
 *  that binding to a fresh Map on every target switch or successful refresh.
 *  A promise from an OLD (superseded) target that later rejects must only
 *  ever evict itself from the map it actually belongs to; reading the
 *  binding fresh inside the closure would instead reach into whatever map is
 *  CURRENTLY assigned and delete a same-named key that may by then belong to
 *  the new target's own in-flight or cached fetch. */
export function loadChangeDiff(path: string, staged = false): Promise<ChangeDiff> {
  if (scope() === "thisTurn") {
    const target = turnTarget();
    if (!target) return Promise.reject(new Error("no active this-turn changes-review target"));
    const cache = turnDiffCache;
    const cached = cache.get(path);
    if (cached) return cached;
    const promise = changesTurnFileDiff(target.chatId, target.projectRoot, target.turnSeq, path);
    cache.set(path, promise);
    void promise.catch(() => cache.delete(path));
    return promise;
  }
  const target = workingTreeTarget();
  if (!target) return Promise.reject(new Error("no active working-tree changes-review target"));
  // A NUL delimiter can't appear in either component, so it's an unambiguous
  // join even if `path` itself started with "staged"/"unstaged". Written as
  // the \u0000 escape (closes #311) rather than a raw embedded byte -- same
  // runtime string, but keeps this a plain-text source file instead of one
  // git/editors detect as binary.
  const key = `${staged ? "staged" : "unstaged"}\u0000${path}`;
  const cache = workingTreeDiffCache;
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = changesWorkingTreeFileDiff(target.projectRoot, path, staged);
  cache.set(key, promise);
  void promise.catch(() => cache.delete(key));
  return promise;
}

/** Fetches the NEXT bounded chunk of `path`'s diff past `skipLines` already-held
 *  lines (#231 PR5's "load more" affordance for a `truncated: true` result),
 *  in the ACTIVE scope's current target — same target resolution as
 *  [`loadChangeDiff`], but never cached: each chunk is a one-off fetch the
 *  caller (`ChangesReviewSurface`'s accumulation logic) already holds the
 *  result of, not something a later caller would ever ask for again by the
 *  same key. */
export function loadChangeDiffChunk(path: string, staged: boolean, skipLines: number): Promise<ChangeDiff> {
  if (scope() === "thisTurn") {
    const target = turnTarget();
    if (!target) return Promise.reject(new Error("no active this-turn changes-review target"));
    return changesTurnFileDiff(target.chatId, target.projectRoot, target.turnSeq, path, skipLines);
  }
  const target = workingTreeTarget();
  if (!target) return Promise.reject(new Error("no active working-tree changes-review target"));
  return changesWorkingTreeFileDiff(target.projectRoot, path, staged, skipLines);
}

// ---- refresh triggers: relevant agent turn completion, project change,
// window refocus (while the surface is mounted — see
// `startChangesReviewFocusRefresh` below). No permanent polling — every
// refresh here is caused by one of these three events. Wiring the actual
// call sites (the agent-chat turnDone reducer, the workspace active-root
// effect, panel mount/unmount) is PR3/PR4's job, once there's a UI surface
// to keep in sync; these are the store's public seam for that wiring. ----

/** Call when a chat turn completes. Refreshes only if the currently-set
 *  "this turn" target belongs to that chat — an unrelated chat's turn
 *  finishing must not refetch a different chat's review. */
export function notifyChangesReviewTurnCompleted(chatId: string): void {
  if (turnTarget()?.chatId !== chatId) return;
  setTurnStale(true);
  void refreshThisTurn();
}

/** Call when the active project changes. Refreshes the working-tree slice
 *  only if it's currently targeting that same project — becoming active
 *  again (or a project directory's git state changing underfoot) is exactly
 *  when a live worktree view is most likely to have gone stale. */
export function notifyChangesReviewProjectChanged(projectRoot: string): void {
  if (workingTreeTarget()?.projectRoot !== projectRoot) return;
  setWorkingTreeStale(true);
  void refreshWorkingTree();
}

function onWindowFocus(): void {
  if (turnTarget()) {
    setTurnStale(true);
    void refreshThisTurn();
  }
  if (workingTreeTarget()) {
    setWorkingTreeStale(true);
    void refreshWorkingTree();
  }
}

let focusListening = false;

/** Starts window-refocus refresh. Idempotent — a second call while already
 *  listening is a no-op, so a panel can call this unconditionally on mount
 *  (same contract as `stores/pikitLanes.ts`'s polling start/stop). Deliberately
 *  NOT auto-started at module load: refocus should only refresh while the
 *  changes-review surface is actually mounted, not for the lifetime of the
 *  app the moment any target is set. */
export function startChangesReviewFocusRefresh(): void {
  if (focusListening || typeof window === "undefined") return;
  window.addEventListener("focus", onWindowFocus);
  focusListening = true;
}

/** Stops window-refocus refresh. Call from the panel's cleanup. */
export function stopChangesReviewFocusRefresh(): void {
  if (!focusListening) return;
  window.removeEventListener("focus", onWindowFocus);
  focusListening = false;
}

// ---- #333: project-turn-completed EVENT, for the legacy Source Control
// pane's auto-refresh. Folded in here (rather than kept as its own
// one-producer/one-consumer module — #333 review's KISS finding) since it's
// the same shape of "a turn completed, should something refresh" concern as
// the rest of this file, just at project-root granularity instead of a
// per-chat target: the legacy panel (`SourceControl.tsx`'s
// `createRepoScanner`) scans by PROJECT ROOT, not by chat, so there's no
// per-chat target here to match against the way `notifyChangesReviewTurnCompleted`
// above does. NOT gated by the `changesReview` flag — the legacy panel is the
// default UI with the flag off.
//
// Deliberately a plain subscriber-callback EVENT, not a signal/epoch a late
// subscriber could "replay". An epoch counter is STATE: any effect that reads
// it fires immediately on subscribe with whatever value already exists,
// which — for a component that mounts AFTER a turn already completed for a
// DIFFERENT, previously-active project — would incorrectly re-run an extra
// scan the newly-mounted component never actually needed (#333 review P2).
// Subscribing here only ever sees events fired from that point forward,
// matching "turn completed" as the one-shot occurrence it actually is. ----
type ProjectTurnListener = (projectRoot: string) => void;
const projectTurnListeners = new Set<ProjectTurnListener>();

/** Call when a chat turn completes, with the PROJECT ROOT that chat belongs
 *  to (not the chat id — this event has no per-chat target to match). */
export function notifyProjectTurnCompleted(projectRoot: string): void {
  for (const listener of projectTurnListeners) listener(projectRoot);
}

/** Subscribe to `notifyProjectTurnCompleted` events fired from now on (an
 *  event already fired before this call is never replayed). Returns an
 *  unsubscribe function — call it from the subscriber's cleanup. */
export function onProjectTurnCompleted(listener: ProjectTurnListener): () => void {
  projectTurnListeners.add(listener);
  return () => projectTurnListeners.delete(listener);
}
