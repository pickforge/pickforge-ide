// Workbench Changes review surface v1 (#231 PR4), behind the `changesReview`
// flag. Evolves the Source Control pane's "Changes" view: a summary header
// (repo, totals, scope, freshness), a This-turn/Working-tree scope switch
// bound to the PR2 store, a file navigator, and a single-file unified diff
// body with old/new gutters. Narrow dock real estate rules out a GitHub-style
// side-by-side file list + diff split (that's PR5's wide-viewport split
// view) -- this is master/detail-in-one-column: pick a file in the
// navigator, its diff renders below with its own sticky header, collapse
// toggle, and prev/next controls to move to an adjacent file. No terminal or
// chat lives in this pane (see `Workbench.tsx`'s center column), so nothing
// here can remount it.
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { IconChevronDown, IconChevronRight, IconRefresh } from "../../components/icons";
import { StatusPill, type StatusIntent } from "../../components/ui";
import type { ChangeDiff, ChangedFile, ChangeFileStatus, ChangeSet } from "../../lib/changes";
import { resolveDiffViewMode, SPLIT_VIEW_MIN_WIDTH, type DiffViewMode } from "../../lib/diffViewMode";
import { errorText } from "../../lib/errors";
import {
  countDiffLines,
  parseUnifiedDiff,
  toSplitRows,
  type DiffHunk,
  type DiffLine,
  type ParsedDiff,
  type SplitDiffRow,
} from "../../lib/unifiedDiff";
import {
  changesReviewCapturedAt,
  changesReviewChangeSet,
  changesReviewError,
  changesReviewLoading,
  changesReviewScope,
  changesReviewStale,
  changesReviewWorkingTreeState,
  loadChangeDiff,
  loadChangeDiffChunk,
  refreshChangesReview,
  setChangesReviewScope,
  setWorkingTreeTarget,
  startChangesReviewFocusRefresh,
  stopChangesReviewFocusRefresh,
  type ChangesReviewScope,
} from "../../stores/changes";
import { setDiffViewMode, workbenchPrefs } from "../../stores/workbenchPrefs";
import { workspace } from "../../stores/workspace";
import { openFileInChat } from "../../stores/terminalHosts";

const STATUS_LETTER: Record<ChangeFileStatus, string> = {
  add: "A",
  modify: "M",
  delete: "D",
  rename: "R",
  conflict: "C",
};
const STATUS_TONE: Record<ChangeFileStatus, string> = {
  add: "pf-crs-a",
  modify: "pf-crs-m",
  delete: "pf-crs-d",
  rename: "pf-crs-r",
  conflict: "pf-crs-d",
};
const STATUS_LABEL: Record<ChangeFileStatus, string> = {
  add: "Added",
  modify: "Modified",
  delete: "Deleted",
  rename: "Renamed",
  conflict: "Conflicting",
};

/** Compact navigator badge text for a non-regular kind (#231 PR5) —
 *  `"regular"` never shows a badge, matching the existing binary/truncated
 *  badges' "only render what's actually true" convention. */
const KIND_BADGE: Partial<Record<ChangedFile["kind"], string>> = {
  submodule: "submodule",
  symlink: "symlink",
  modeOnly: "mode only",
};

/** Spells out status + additions/deletions in words, for assistive tech —
 *  the visible row conveys the same information via a letter + color, which
 *  screen-reader labels must never rely on alone (#231's UX contract). */
function srFileStatus(file: ChangedFile): string {
  const additions = file.additions !== null ? `${file.additions} additions` : "unknown additions";
  const deletions = file.deletions !== null ? `${file.deletions} deletions` : "unknown deletions";
  const flags = [
    file.binary ? "binary" : "",
    file.truncated ? "truncated" : "",
    KIND_BADGE[file.kind] ?? "",
  ]
    .filter(Boolean)
    .join(", ");
  return `${STATUS_LABEL[file.status]}, ${additions}, ${deletions}${flags ? `, ${flags}` : ""}`;
}

/** The honest, non-fetching placeholder text for a file this surface will
 *  never diff as text (#231 PR5's hard-state matrix): a merge conflict (a
 *  Git-live-only status — multiple index stages, no single old/new text to
 *  diff), or a submodule/symlink/mode-only KIND. `null` for anything this
 *  surface DOES attempt to diff — the caller's cue to actually fetch. Status
 *  is checked before kind: a conflicted path's `kind` is left at its honest
 *  `"regular"` default server-side (see `ChangedFile::kind`'s Rust doc
 *  comment — a conflict's mode isn't cleanly classifiable mid-merge), so
 *  status must win here or a conflict would fall through to "diffable". */
function hardStateMessage(file: ChangedFile): string | null {
  if (file.status === "conflict") {
    return "Merge conflict — resolve it in your editor. Diff view isn't available for a conflicted file.";
  }
  switch (file.kind) {
    case "submodule":
      return "Submodule — this row is a commit pointer into another repository, not diffed as text.";
    case "symlink":
      return "Symlink — this row is a link target, not diffed as text.";
    case "modeOnly":
      // A rename that ALSO happens to be mode-only (e.g. `git mv` plus a
      // `chmod`, with content byte-identical) still carries real rename
      // information — say so rather than silently collapsing it into a
      // generic mode-only message that drops which file this used to be
      // (#231 PR5 review finding P3).
      return file.status === "rename"
        ? `Renamed from ${file.oldPath ?? "?"} — mode changed only (e.g. permissions), no content to diff.`
        : "File mode changed only (e.g. permissions) — no content to diff.";
    default:
      return null;
  }
}

/** A file row's identity — `path` alone is not unique in `workingTree` scope,
 *  where the same path can appear twice (a staged row and an unstaged row).
 *  The NUL delimiter can't appear in either component (matches
 *  `stores/changes.ts`'s own diff-cache key, #311). */
function fileKey(f: ChangedFile): string {
  return `${f.staged ? "staged" : "unstaged"}\u0000${f.path}`;
}

function FileStatsInline(props: { file: ChangedFile }) {
  return (
    <Show
      when={props.file.additions !== null || props.file.deletions !== null}
      fallback={<span class="pf-crs-unknown">unknown</span>}
    >
      <span class="pf-crs-stat pf-crs-stat--add">
        {props.file.additions === null ? "+?" : `+${props.file.additions}`}
      </span>
      <span class="pf-crs-stat pf-crs-stat--del">
        {props.file.deletions === null ? "−?" : `−${props.file.deletions}`}
      </span>
    </Show>
  );
}

function FileNavigatorRow(props: { file: ChangedFile; active: boolean; paired: boolean; onSelect: () => void }) {
  const f = () => props.file;
  return (
    <button
      type="button"
      class="pf-crs-navrow"
      classList={{ "pf-crs-navrow--active": props.active, "pf-crs-navrow--paired": props.paired }}
      aria-current={props.active ? "true" : undefined}
      title={f().path}
      onClick={props.onSelect}
    >
      <span class={`pf-crs-letter ${STATUS_TONE[f().status]}`} aria-hidden="true">
        {STATUS_LETTER[f().status]}
      </span>
      <span class="pf-crs-navpath">
        <Show when={f().oldPath}>
          <span class="pf-crs-navpath-old">{f().oldPath}</span>
          <span aria-hidden="true"> {"→"} </span>
        </Show>
        {f().path}
      </span>
      <Show when={f().staged !== null}>
        <span class="pf-crs-badge">{f().staged ? "staged" : "unstaged"}</span>
      </Show>
      <Show when={f().binary}>
        <span class="pf-crs-badge">binary</span>
      </Show>
      <Show when={f().truncated}>
        <span class="pf-crs-badge">truncated</span>
      </Show>
      <Show when={KIND_BADGE[f().kind]}>{(label) => <span class="pf-crs-badge">{label()}</span>}</Show>
      <span class="pf-crs-navstats">
        <FileStatsInline file={f()} />
      </span>
      <span class="pf-crs-sr-status">{srFileStatus(f())}</span>
    </button>
  );
}

function FileNavigator(props: { files: ChangedFile[]; activeKey: string | null; onSelect: (key: string) => void }) {
  return (
    <Show when={props.files.length > 0} fallback={<div class="pf-rail-empty">No changed files</div>}>
      <div class="pf-crs-nav">
        <For each={props.files}>
          {(file, index) => {
            // Legible staged/unstaged pairing (#231 PR5): the Rust side
            // already sorts a path's staged+unstaged rows adjacent
            // (`working_tree.rs`'s final sort) — this just draws the
            // connection a reader's eye needs to SEE it, rather than relying
            // on them noticing two same-path rows a few pixels apart.
            const paired = createMemo(() => {
              const prev = props.files[index() - 1];
              return !!prev && prev.path === file.path;
            });
            return (
              <FileNavigatorRow
                file={file}
                active={fileKey(file) === props.activeKey}
                paired={paired()}
                onSelect={() => props.onSelect(fileKey(file))}
              />
            );
          }}
        </For>
      </div>
    </Show>
  );
}

function gutterCell(n: number | null) {
  return <span class="pf-crs-gutter">{n ?? ""}</span>;
}

function DiffLineRow(props: { line: DiffLine }) {
  const kind = () => props.line.kind;
  return (
    <div
      class="pf-crs-diffline"
      classList={{
        "pf-diff-add": kind() === "add",
        "pf-diff-del": kind() === "del",
        "pf-crs-diffline--nonl": kind() === "noNewline",
      }}
    >
      {gutterCell(props.line.oldLine)}
      {gutterCell(props.line.newLine)}
      <span class="pf-crs-diffmarker" aria-hidden="true">
        {kind() === "add" ? "+" : kind() === "del" ? "−" : ""}
      </span>
      <span class="pf-crs-difftext">{props.line.text || " "}</span>
    </div>
  );
}

function DiffHunkBlock(props: { hunk: DiffHunk }) {
  return (
    <div class="pf-crs-hunk">
      <Show when={props.hunk.header}>
        <div class="pf-crs-hunkhead pf-diff-hunk">{props.hunk.header}</div>
      </Show>
      <For each={props.hunk.lines}>{(line) => <DiffLineRow line={line} />}</For>
    </div>
  );
}

/** One split-view column's cell for a `pair` row (#231 PR5) — `side`
 *  chooses which gutter number to show from the shared `line` (a context
 *  line reuses the SAME `DiffLine` on both sides; `oldLine`/`newLine` on it
 *  are both populated, so each side reads its own). `null` renders a blank
 *  cell (the missing half of an unbalanced del/add run). */
function SplitDiffCell(props: { line: DiffLine | null; side: "old" | "new" }) {
  const line = () => props.line;
  const kind = () => line()?.kind;
  return (
    <div
      class="pf-crs-splitcell"
      classList={{
        "pf-diff-add": kind() === "add",
        "pf-diff-del": kind() === "del",
        "pf-crs-splitcell--empty": !line(),
      }}
    >
      {gutterCell(line() ? (props.side === "old" ? line()!.oldLine : line()!.newLine) : null)}
      <span class="pf-crs-diffmarker" aria-hidden="true">
        {kind() === "add" ? "+" : kind() === "del" ? "−" : ""}
      </span>
      <span class="pf-crs-difftext">{line() ? line()!.text || " " : ""}</span>
    </div>
  );
}

function SplitDiffRowView(props: { row: SplitDiffRow }) {
  const pairRow = createMemo(() => {
    const r = props.row;
    return r.kind === "pair" ? r : null;
  });
  const noteRow = createMemo(() => {
    const r = props.row;
    return r.kind === "note" ? r : null;
  });
  return (
    <Show
      when={pairRow()}
      fallback={
        <div class="pf-crs-diffline pf-crs-diffline--nonl pf-crs-splitnote">{noteRow()?.line.text ?? ""}</div>
      }
    >
      {(pair) => (
        <div class="pf-crs-splitrow">
          <SplitDiffCell line={pair().left} side="old" />
          <SplitDiffCell line={pair().right} side="new" />
        </div>
      )}
    </Show>
  );
}

function SplitDiffHunkBlock(props: { hunk: DiffHunk }) {
  const rows = createMemo(() => toSplitRows(props.hunk.lines));
  return (
    <div class="pf-crs-hunk">
      <Show when={props.hunk.header}>
        <div class="pf-crs-hunkhead pf-diff-hunk pf-crs-splithunkhead">
          <span>{props.hunk.header}</span>
          <span>{props.hunk.header}</span>
        </div>
      </Show>
      <For each={rows()}>{(row) => <SplitDiffRowView row={row} />}</For>
    </div>
  );
}

/** The active file's diff, lazily fetched via the PR2 store cache and
 *  re-fetched whenever the active file (or its staged/unstaged identity)
 *  changes; extended #231 PR5 with a "load more" affordance for a truncated
 *  result. Never fetches at all for a file [`hardStateMessage`] already has
 *  an honest placeholder for (a submodule/symlink/mode-only kind, or a
 *  conflict) — the caller already knows what to render from the listing
 *  alone, so a round trip would be pure waste. A composable, called
 *  synchronously from `ChangesReviewSurface`'s own setup so its
 *  `createResource`/`createEffect` run under the same reactive owner as if
 *  written inline. */
function createActiveFileDiff(activeFile: () => ChangedFile | null) {
  const diffable = createMemo(() => {
    const f = activeFile();
    return !!f && hardStateMessage(f) === null;
  });
  const source = createMemo(() => {
    const f = activeFile();
    return f && diffable() ? { path: f.path, staged: f.staged === true } : null;
  });
  const [diff] = createResource(source, (target) => loadChangeDiff(target.path, target.staged));

  const key = createMemo(() => {
    const s = source();
    return s ? `${s.staged ? "staged" : "unstaged"} ${s.path}` : null;
  });

  // Accumulated "load more" text (#231 PR5): reset whenever the active
  // file/staged identity changes; grown by `loadMore` below. Keyed by
  // `key()` (not just "the current file") so a stale in-flight `loadMore`
  // for a file the user already navigated away from never lands its chunk
  // onto the NEW active file's text.
  const [extra, setExtra] = createSignal<{ forKey: string; text: string; truncated: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [loadMoreError, setLoadMoreError] = createSignal<string | null>(null);

  createEffect(() => {
    key();
    setExtra(null);
    setLoadMoreError(null);
  });

  const combined = createMemo<ChangeDiff | undefined>(() => {
    const latest = diff.latest;
    if (!latest) return latest;
    const e = extra();
    const k = key();
    if (!e || !k || e.forKey !== k) return latest;
    return { ...latest, diff: (latest.diff ?? "") + e.text, truncated: e.truncated };
  });

  const loadMore = async () => {
    const s = source();
    const base = diff.latest;
    const k = key();
    if (!s || !base || base.diff === null || !k) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const current = extra();
      const alreadyHeld = current?.forKey === k ? current.text : "";
      const skipLines = countDiffLines(base.diff) + countDiffLines(alreadyHeld);
      const chunk = await loadChangeDiffChunk(s.path, s.staged, skipLines);
      setExtra({ forKey: k, text: alreadyHeld + (chunk.diff ?? ""), truncated: chunk.truncated });
    } catch (err) {
      setLoadMoreError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return {
    diffable,
    loading: () => diff.loading,
    error: () => diff.error,
    latest: combined,
    loadingMore,
    loadMoreError,
    loadMore,
  };
}

function DiffStatusMessage(props: { text: string }) {
  return <div class="pf-rail-empty pf-crs-diffmessage">{props.text}</div>;
}

function binaryMessage(diff: ChangeDiff): string {
  // `typeof` rather than `!== null`: defensive against a `sizeBytes`-less
  // fixture/mock (this field postdates PR4's original binary-fallback
  // shape), never trusting a non-numeric value as a byte count.
  return typeof diff.sizeBytes === "number"
    ? `Binary file — ${diff.sizeBytes.toLocaleString()} bytes.`
    : "Binary file — content not shown.";
}

/** Renders one lazily-fetched `ChangeDiff` result honestly (#231 PR4, hard
 *  states extended #231 PR5): binary content gets a size when cheaply known
 *  (never a fabricated count); invalid UTF-8 is called out rather than
 *  silently shown as replacement characters; a truncated diff gets an
 *  explicit load-more action, plus an open-externally action in scopes where
 *  a live file backs it. */
function DiffResultBody(props: {
  diff: ChangeDiff;
  viewMode: DiffViewMode;
  onLoadMore: () => void;
  loadingMore: boolean;
  loadMoreError: string | null;
  onOpenExternally: (() => void) | null;
}) {
  const parsed = createMemo<ParsedDiff | null>(() =>
    props.diff.available && !props.diff.binary && props.diff.diff !== null
      ? parseUnifiedDiff(props.diff.diff)
      : null,
  );
  return (
    <Show
      when={parsed()}
      fallback={
        <DiffStatusMessage
          text={!props.diff.available ? "No diff available for this file." : binaryMessage(props.diff)}
        />
      }
    >
      {(diff) => (
        <>
          <Show when={props.diff.invalidUtf8}>
            <div class="pf-crs-diffnotice">
              Contains invalid UTF-8 — shown with replacement characters where bytes couldn't be decoded.
            </div>
          </Show>
          <Show when={diff().hunks.length === 0}>
            <DiffStatusMessage text="No changes in this diff." />
          </Show>
          <Show
            when={props.viewMode === "split"}
            fallback={<For each={diff().hunks}>{(hunk) => <DiffHunkBlock hunk={hunk} />}</For>}
          >
            <For each={diff().hunks}>{(hunk) => <SplitDiffHunkBlock hunk={hunk} />}</For>
          </Show>
          <Show when={props.diff.truncated}>
            <div class="pf-crs-diffnotice pf-crs-diffnotice--actions">
              <span>Diff truncated — showing a bounded prefix.</span>
              <button type="button" class="pf-crs-diffaction" disabled={props.loadingMore} onClick={props.onLoadMore}>
                {props.loadingMore ? "Loading…" : "Load more"}
              </button>
              <Show when={props.onOpenExternally}>
                {(open) => (
                  <button type="button" class="pf-crs-diffaction" onClick={open()}>
                    Open file
                  </button>
                )}
              </Show>
            </div>
            <Show when={props.loadMoreError}>
              {(err) => <div class="pf-crs-diffnotice pf-crs-diffnotice--error">{err()}</div>}
            </Show>
          </Show>
        </>
      )}
    </Show>
  );
}

function ViewModeToggle(props: { mode: DiffViewMode; onChange: (m: DiffViewMode) => void }) {
  return (
    // Its own class, deliberately NOT `.pf-sc-viewtoggle` (the Source
    // Control/scope toggle's class) even though the visual style is mirrored
    // — a shared class would make `.pf-sc-viewtoggle button` selectors (in
    // tests and elsewhere) ambiguous once both toggles can render together.
    <div class="pf-crs-viewtoggle">
      <button classList={{ "pf-crs-view--on": props.mode === "unified" }} onClick={() => props.onChange("unified")}>
        Unified
      </button>
      <button classList={{ "pf-crs-view--on": props.mode === "split" }} onClick={() => props.onChange("split")}>
        Split
      </button>
    </div>
  );
}

function DiffPaneHeader(props: {
  file: ChangedFile;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  viewMode: DiffViewMode;
  canSplit: boolean;
  onViewModeChange: (m: DiffViewMode) => void;
}) {
  return (
    <div class="pf-crs-diffhead">
      <button
        type="button"
        class="pf-icon-btn"
        title={props.collapsed ? "Expand" : "Collapse"}
        aria-expanded={!props.collapsed}
        onClick={props.onToggleCollapse}
      >
        <Show when={props.collapsed} fallback={<IconChevronDown size={12} />}>
          <IconChevronRight size={12} />
        </Show>
      </button>
      <span class="pf-crs-diffpath">{props.file.path}</span>
      <span class="pf-crs-diffheadstats">
        <FileStatsInline file={props.file} />
      </span>
      <Show when={props.canSplit}>
        <ViewModeToggle mode={props.viewMode} onChange={props.onViewModeChange} />
      </Show>
      <div class="pf-crs-diffnav">
        <button type="button" class="pf-icon-btn" title="Previous file" disabled={!props.hasPrev} onClick={props.onPrev}>
          <IconChevronRight size={12} class="pf-flip-x" />
        </button>
        <button type="button" class="pf-icon-btn" title="Next file" disabled={!props.hasNext} onClick={props.onNext}>
          <IconChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

function DiffPane(props: {
  activeFile: ChangedFile | null;
  diffState: () => {
    diffable: boolean;
    loading: boolean;
    error: unknown;
    latest: ChangeDiff | undefined;
    loadingMore: boolean;
    loadMoreError: string | null;
    onLoadMore: () => void;
  };
  collapsed: boolean;
  onToggleCollapse: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  viewMode: DiffViewMode;
  canSplit: boolean;
  onViewModeChange: (m: DiffViewMode) => void;
  onOpenExternally: (() => void) | null;
}) {
  return (
    <Show when={props.activeFile} fallback={<div class="pf-rail-empty">Select a file to view its diff.</div>}>
      {(file) => (
        <div class="pf-crs-diffpane">
          <DiffPaneHeader
            file={file()}
            collapsed={props.collapsed}
            onToggleCollapse={props.onToggleCollapse}
            onPrev={props.onPrev}
            onNext={props.onNext}
            hasPrev={props.hasPrev}
            hasNext={props.hasNext}
            viewMode={props.viewMode}
            canSplit={props.canSplit}
            onViewModeChange={props.onViewModeChange}
          />
          <Show when={!props.collapsed}>
            <div class="pf-crs-diffbody">
              <Show
                when={props.diffState().diffable}
                fallback={<DiffStatusMessage text={hardStateMessage(file()) ?? "Not renderable in this view."} />}
              >
                <Show when={props.diffState().loading}>
                  <DiffStatusMessage text="Loading diff…" />
                </Show>
                <Show when={!props.diffState().loading && props.diffState().error}>
                  <DiffStatusMessage text="Diff unavailable." />
                </Show>
                <Show when={!props.diffState().loading && !props.diffState().error && props.diffState().latest}>
                  {(diff) => (
                    <DiffResultBody
                      diff={diff()}
                      viewMode={props.viewMode}
                      onLoadMore={props.diffState().onLoadMore}
                      loadingMore={props.diffState().loadingMore}
                      loadMoreError={props.diffState().loadMoreError}
                      onOpenExternally={props.onOpenExternally}
                    />
                  )}
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function freshnessIntent(stale: boolean, error: boolean): StatusIntent {
  if (error) return "error";
  return stale ? "warning" : "connected";
}

function ScopeTabs(props: { scope: ChangesReviewScope; onChange: (s: ChangesReviewScope) => void }) {
  return (
    <div class="pf-sc-viewtoggle">
      <button
        classList={{ "pf-sc-view--on": props.scope === "thisTurn" }}
        onClick={() => props.onChange("thisTurn")}
      >
        This turn
      </button>
      <button
        classList={{ "pf-sc-view--on": props.scope === "workingTree" }}
        onClick={() => props.onChange("workingTree")}
      >
        Working tree
      </button>
    </div>
  );
}

function repoBaseName(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}

function SummaryHeader(props: {
  changeSet: ChangeSet | null;
  scope: ChangesReviewScope;
  branch: string | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  capturedAt: number | null;
  onScopeChange: (s: ChangesReviewScope) => void;
  onRefresh: () => void;
}) {
  const totals = () => props.changeSet?.totals ?? null;
  const hasUnknownStats = createMemo(() =>
    (props.changeSet?.files ?? []).some((f) => f.additions === null || f.deletions === null),
  );
  const repoLabel = () => {
    const root = props.changeSet?.repoRoot;
    return root ? repoBaseName(root) : "—";
  };
  return (
    <div class="pf-crs-header">
      <div class="pf-crs-headrow">
        <span class="pf-crs-repo">{repoLabel()}</span>
        <Show when={props.scope === "workingTree" && props.branch}>
          <span class="pf-crs-branch">{props.branch}</span>
        </Show>
        <ScopeTabs scope={props.scope} onChange={props.onScopeChange} />
      </div>
      <div class="pf-crs-headrow">
        <Show when={totals()} fallback={<span class="pf-crs-meta">{props.loading ? "Loading…" : "No changes selected"}</span>}>
          {(t) => (
            <>
              <span class="pf-crs-meta">
                {t().files} file{t().files === 1 ? "" : "s"}
              </span>
              <span class="pf-crs-stat pf-crs-stat--add">+{t().additions}</span>
              <span class="pf-crs-stat pf-crs-stat--del">{"−"}{t().deletions}</span>
              <Show when={hasUnknownStats()}>
                <span class="pf-crs-unknown-flag" title="Some file line counts are unknown and are not included in these totals">
                  {"±?"}
                </span>
              </Show>
              <Show when={props.changeSet?.truncated}>
                <span class="pf-crs-badge" title="Showing a bounded prefix of changed files">
                  truncated
                </span>
              </Show>
            </>
          )}
        </Show>
        <span class="pf-crs-freshness">
          <StatusPill
            label={props.error ?? (props.loading ? "Refreshing…" : props.stale ? "Stale" : "Up to date")}
            intent={freshnessIntent(props.stale, !!props.error)}
          />
        </span>
        <button type="button" class="pf-icon-btn" title="Refresh" disabled={props.loading} onClick={props.onRefresh}>
          <IconRefresh size={14} />
        </button>
      </div>
    </div>
  );
}

/** This-turn scope's empty states: distinguishes "no turn has ever been
 *  selected" (capturedAt stays null until a fetch completes, and no fetch
 *  ever runs without a target) from "a turn was targeted but isn't in the
 *  listing" (capturedAt is set, changeSet is null). */
function ThisTurnEmptyMessage(props: { capturedAt: number | null }) {
  return (
    <div class="pf-rail-empty">
      {props.capturedAt === null
        ? "Select “Review changes” from a chat receipt, or switch to Working tree."
        : "No change details for this turn."}
    </div>
  );
}

function workingTreeEmptyText(
  state: "ready" | "notARepo" | "remoteUnsupported" | null,
  hasProject: boolean,
): string {
  switch (state) {
    case "notARepo":
      // Covers both causes the Rust side collapses into one state: no `.git`
      // at or above this root, or the `git` binary itself couldn't be run at
      // all (spawn failure resolves the same way — see
      // `crate::git::toplevel`). Distinguishing them would need an extra
      // `git --version` probe call for a cosmetic-only difference; both
      // honestly mean "no local Git-backed review is possible here".
      return "Git unavailable or not a repository.";
    case "remoteUnsupported":
      return "Remote projects aren’t supported yet.";
    case "ready":
      return "No changes in the working tree.";
    default:
      return hasProject ? "Checking…" : "No project selected.";
  }
}

function WorkingTreeEmptyMessage(props: {
  state: "ready" | "notARepo" | "remoteUnsupported" | null;
  hasProject: boolean;
}) {
  return <div class="pf-rail-empty">{workingTreeEmptyText(props.state, props.hasProject)}</div>;
}

/** Starts/stops the store's window-refocus refresh and seeds the
 *  working-tree slice for the active project — scoped to exactly this
 *  surface's mounted lifetime, matching `stores/changes.ts`'s own contract
 *  ("only refresh while the changes-review surface is actually mounted"). A
 *  composable, called synchronously from `ChangesReviewSurface`'s own setup
 *  so its `onMount`/`onCleanup` run under the same reactive owner as if
 *  written inline. */
function useChangesReviewSurfaceLifecycle(): void {
  onMount(() => {
    const root = workspace.activeRoot;
    if (root) setWorkingTreeTarget(root);
    startChangesReviewFocusRefresh();
  });
  onCleanup(() => stopChangesReviewFocusRefresh());
}

/** Reconciles the active file selection against the current file listing:
 *  keeps the current selection if it's still present, otherwise falls back to
 *  the first file (or none). Uses the setter's callback form so this effect
 *  depends only on `files()`, never on `activeKey` itself. */
function useActiveFileReconciliation(files: () => ChangedFile[]) {
  const [activeKey, setActiveKey] = createSignal<string | null>(null);
  createEffect(() => {
    const list = files();
    setActiveKey((current) => {
      if (list.length === 0) return null;
      if (current && list.some((f) => fileKey(f) === current)) return current;
      return fileKey(list[0]);
    });
  });
  return [activeKey, setActiveKey] as const;
}

/** Tracks a DOM node's own content-box width via `ResizeObserver` (#231
 *  PR5's split-view width gate). Guards `typeof ResizeObserver ===
 *  "undefined"` — jsdom (this component's unit tests) has no real layout
 *  engine and no `ResizeObserver` at all; a mount there simply keeps `width`
 *  at `0`, which `resolveDiffViewMode` already treats as "not wide enough
 *  for split" rather than crashing. Real-width behavior (split actually
 *  appearing at a wide viewport, forcing unified at a narrow one) is proven
 *  in `tests/vrt/changes-review-surface.spec.ts`, a real browser. */
function usePaneWidth(nodeRef: () => HTMLElement | undefined) {
  const [width, setWidth] = createSignal(0);
  onMount(() => {
    const node = nodeRef();
    if (!node || typeof ResizeObserver === "undefined") return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    onCleanup(() => observer.disconnect());
  });
  return width;
}

/** Joins an absolute repo root with a repo-relative path for the "open file
 *  externally" affordance (#231 PR5) — workingTree scope only, so `repoRoot`
 *  is always a real live filesystem path, never a historical turn's (which
 *  may no longer exist — see the issue's "deleted/missing files after a
 *  historical turn snapshot" state, why this action is scope-gated at all).
 *  Detects the root's OWN separator rather than assuming POSIX, since
 *  `repoRoot` is a platform-native path string from the Rust side. */
function joinRepoPath(repoRoot: string, relativePath: string): string {
  const sep = repoRoot.includes("\\") && !repoRoot.includes("/") ? "\\" : "/";
  return repoRoot.endsWith(sep) ? `${repoRoot}${relativePath}` : `${repoRoot}${sep}${relativePath}`;
}

export function ChangesReviewSurface(props: { branch: string | null }) {
  useChangesReviewSurfaceLifecycle();

  const scope = changesReviewScope;
  const changeSet = changesReviewChangeSet;
  const files = createMemo(() => changeSet()?.files ?? []);
  const [activeKey, setActiveKey] = useActiveFileReconciliation(files);
  // v1 shows exactly one file's diff at a time (no per-file collapse
  // persistence is specified — see `DiffPane`'s doc comment on the
  // master/detail design), so collapse is a single flag for whichever file
  // is currently active, not a per-path set. Switching the active file
  // always starts expanded.
  const [collapsed, setCollapsed] = createSignal(false);
  createEffect(() => {
    activeKey();
    setCollapsed(false);
  });

  const activeIndex = createMemo(() => {
    const key = activeKey();
    return key ? files().findIndex((f) => fileKey(f) === key) : -1;
  });
  const activeFile = createMemo<ChangedFile | null>(() => {
    const i = activeIndex();
    return i >= 0 ? files()[i] : null;
  });

  const selectIndex = (i: number) => {
    const list = files();
    if (i < 0 || i >= list.length) return;
    setActiveKey(fileKey(list[i]));
  };

  const diffState = createActiveFileDiff(activeFile);

  let rootEl: HTMLDivElement | undefined;
  const width = usePaneWidth(() => rootEl);
  const canSplit = createMemo(() => width() >= SPLIT_VIEW_MIN_WIDTH);
  const viewMode = createMemo(() => resolveDiffViewMode(width(), workbenchPrefs().diffViewMode));

  // "Open file" (#231 PR5's open-externally affordance for a truncated
  // diff) is offered ONLY in `workingTree` scope — see `joinRepoPath`'s doc
  // comment for why a historical turn snapshot never gets this action.
  const onOpenExternally = createMemo<(() => void) | null>(() => {
    if (scope() !== "workingTree") return null;
    const root = changeSet()?.repoRoot;
    const file = activeFile();
    if (!root || !file) return null;
    return () => {
      openFileInChat(workspace.activeChatId, joinRepoPath(root, file.path), workspace.activeRoot);
    };
  });

  return (
    <div class="pf-crs" ref={rootEl}>
      <SummaryHeader
        changeSet={changeSet()}
        scope={scope()}
        branch={props.branch}
        loading={changesReviewLoading()}
        error={changesReviewError()}
        stale={changesReviewStale()}
        capturedAt={changesReviewCapturedAt()}
        onScopeChange={setChangesReviewScope}
        onRefresh={() => void refreshChangesReview()}
      />
      <div class="pf-crs-body">
        <Show
          when={files().length > 0}
          fallback={
            <Show
              when={scope() === "thisTurn"}
              fallback={
                <WorkingTreeEmptyMessage
                  state={changesReviewWorkingTreeState()}
                  hasProject={!!workspace.activeRoot}
                />
              }
            >
              <ThisTurnEmptyMessage capturedAt={changesReviewCapturedAt()} />
            </Show>
          }
        >
          <FileNavigator files={files()} activeKey={activeKey()} onSelect={setActiveKey} />
          <DiffPane
            activeFile={activeFile()}
            diffState={() => ({
              diffable: diffState.diffable(),
              loading: diffState.loading(),
              error: diffState.error(),
              latest: diffState.latest(),
              loadingMore: diffState.loadingMore(),
              loadMoreError: diffState.loadMoreError(),
              onLoadMore: () => void diffState.loadMore(),
            })}
            collapsed={collapsed()}
            onToggleCollapse={() => setCollapsed((c) => !c)}
            onPrev={() => selectIndex(activeIndex() - 1)}
            onNext={() => selectIndex(activeIndex() + 1)}
            hasPrev={activeIndex() > 0}
            hasNext={activeIndex() >= 0 && activeIndex() < files().length - 1}
            viewMode={viewMode()}
            canSplit={canSplit()}
            onViewModeChange={setDiffViewMode}
            onOpenExternally={onOpenExternally()}
          />
        </Show>
      </div>
    </div>
  );
}
