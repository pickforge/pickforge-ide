import { type JSX, For, Show, createMemo } from "solid-js";
import { Collapse, HairlinePanel, MonoEyebrow } from "../ui";
import { IconChevronDown, IconChevronRight } from "../icons";
import type { ChangeFileStatus, ChangeSet, ChangedFile } from "../../lib/changes";
import "./chat.css";

/** Resolution state of the receipt's backing `ChangeSet` (#231 PR2's
 *  `changes_list_turn_change_sets`, consumed — never re-folded — here):
 *  `loading` while the chat's turn ChangeSets are being fetched, `error` on a
 *  failed fetch, `unavailable` when the fetch succeeded but this turn's
 *  ordinal isn't in the result (legacy history edge case), `ready` once the
 *  matching ChangeSet is in hand. Only `ready` renders numbers — the other
 *  three never fabricate a 0. */
export type ChangesReceiptStatus = "loading" | "error" | "ready" | "unavailable";

const STATUS_LETTER: Record<ChangeFileStatus, string> = {
  add: "A",
  modify: "M",
  delete: "D",
  rename: "R",
  conflict: "C",
};

const STATUS_LABEL: Record<ChangeFileStatus, string> = {
  add: "Added",
  modify: "Modified",
  delete: "Deleted",
  rename: "Renamed",
  conflict: "Conflicting",
};

// Locked status vocabulary order (#231's ChangedFile.status) — counts render
// in this fixed order, skipping any status with zero files this turn.
const STATUS_ORDER: ChangeFileStatus[] = ["add", "modify", "delete", "rename", "conflict"];
const STATUS_COUNT_WORD: Record<ChangeFileStatus, string> = {
  add: "added",
  modify: "modified",
  delete: "deleted",
  rename: "renamed",
  conflict: "conflicting",
};

function statusCountsLabel(files: ChangedFile[]): string {
  const counts = new Map<ChangeFileStatus, number>();
  for (const file of files) counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
  return STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${counts.get(status)} ${STATUS_COUNT_WORD[status]}`)
    .join(" · ");
}

function FileStats(props: { file: ChangedFile }): JSX.Element {
  return (
    <Show
      when={props.file.additions !== null || props.file.deletions !== null}
      fallback={<span class="pf-chat-receipt-unknown">unknown</span>}
    >
      <span class="pf-chat-receipt-stat pf-chat-receipt-stat--add">
        {props.file.additions === null ? "+?" : `+${props.file.additions}`}
      </span>
      <span class="pf-chat-receipt-stat pf-chat-receipt-stat--del">
        {props.file.deletions === null ? "−?" : `−${props.file.deletions}`}
      </span>
    </Show>
  );
}

function FileRow(props: { file: ChangedFile }): JSX.Element {
  return (
    <li class="pf-chat-receipt-row">
      <span
        class={`pf-chat-receipt-status pf-chat-receipt-status--${props.file.status}`}
        title={STATUS_LABEL[props.file.status]}
        aria-hidden="true"
      >
        {STATUS_LETTER[props.file.status]}
      </span>
      <span class="pf-chat-receipt-path">
        <Show when={props.file.oldPath}>
          <span class="pf-chat-receipt-path-old">{props.file.oldPath}</span>
          <span class="pf-chat-receipt-path-arrow" aria-hidden="true">
            {" → "}
          </span>
        </Show>
        {props.file.path}
      </span>
      <span class="pf-chat-receipt-flags">
        <Show when={props.file.binary}>
          <span class="pf-chat-receipt-flag">binary</span>
        </Show>
        <Show when={props.file.truncated}>
          <span class="pf-chat-receipt-flag">truncated</span>
        </Show>
      </span>
      <span class="pf-chat-receipt-file-stats">
        <FileStats file={props.file} />
      </span>
      <span class="pf-chat-receipt-sr-status">
        {STATUS_LABEL[props.file.status]}
        {props.file.additions !== null ? `, ${props.file.additions} additions` : ", unknown additions"}
        {props.file.deletions !== null ? `, ${props.file.deletions} deletions` : ", unknown deletions"}
        {props.file.binary ? ", binary" : ""}
        {props.file.truncated ? ", truncated" : ""}
      </span>
    </li>
  );
}

/** One completed turn's compact, persistent changes receipt (#231 PR3) —
 *  replaces the raw always-inline `FileChangeCard` diff rendering once a
 *  turn closes. Purely props-driven: totals, dedup, and status all come from
 *  the already-folded `ChangeSet` the caller resolved via
 *  `changes_list_turn_change_sets`; this component never re-folds provider
 *  events itself. */
export function ChangesReceiptCard(props: {
  status: ChangesReceiptStatus;
  changeSet: ChangeSet | null;
  open?: boolean;
  onToggle?: () => void;
  onReviewChanges?: () => void;
}): JSX.Element {
  const open = () => props.open ?? false;
  const files = createMemo(() => props.changeSet?.files ?? []);
  const canExpand = () => props.status === "ready" && files().length > 0;
  // The backend sums only KNOWN per-file counts into totals (never invents a
  // count) — this flag says whether that sum might be an undercount, so the
  // header never implies a total is more complete than it is.
  const hasUnknownStats = createMemo(() =>
    files().some((file) => file.additions === null || file.deletions === null),
  );
  const countsLabel = createMemo(() => statusCountsLabel(files()));
  // "Attribution is honest" (#231): a provider-reported turn diff is agent-turn
  // changes; a Git snapshot captured only at turn completion is a fallback and
  // is labeled as such, not presented as proof the agent caused every change.
  const isWorkspaceSnapshot = () => props.changeSet?.source === "gitSnapshot";

  return (
    <HairlinePanel class="pf-chat-card pf-chat-receipt">
      <div class="pf-chat-receipt-head">
        <button
          type="button"
          class="pf-chat-receipt-toggle"
          aria-expanded={open()}
          aria-label={open() ? "Hide changed files" : "Show changed files"}
          disabled={!canExpand()}
          onClick={() => canExpand() && props.onToggle?.()}
        >
          <span class="pf-chat-line-chevron" aria-hidden="true">
            <Show when={canExpand()} fallback={<span class="pf-chat-line-chevron-spacer" />}>
              <Show when={open()} fallback={<IconChevronRight size={12} />}>
                <IconChevronDown size={12} />
              </Show>
            </Show>
          </span>
          <MonoEyebrow text="Changes" />
        </button>
        <div class="pf-chat-receipt-stats">
          <Show when={props.status === "ready" && props.changeSet}>
            {(changeSet) => (
              <>
                <span class="pf-chat-meta">
                  {changeSet().totals.files} file{changeSet().totals.files === 1 ? "" : "s"} changed
                </span>
                <span class="pf-chat-receipt-stat pf-chat-receipt-stat--add">
                  +{changeSet().totals.additions}
                </span>
                <span class="pf-chat-receipt-stat pf-chat-receipt-stat--del">
                  {"−"}
                  {changeSet().totals.deletions}
                </span>
                <Show when={hasUnknownStats()}>
                  <span
                    class="pf-chat-receipt-unknown-flag"
                    title="Some file line counts are unknown (binary, truncated, or unavailable) and are not included in these totals"
                  >
                    {"±?"}
                  </span>
                </Show>
                <Show when={countsLabel()}>
                  <span class="pf-chat-meta pf-chat-receipt-counts">{countsLabel()}</span>
                </Show>
                <Show when={isWorkspaceSnapshot()}>
                  <span class="pf-chat-receipt-badge" title="Captured from the workspace at turn completion — not a per-file provider report">
                    workspace snapshot
                  </span>
                </Show>
              </>
            )}
          </Show>
          <Show when={props.status === "loading"}>
            <span class="pf-chat-meta">Loading changes…</span>
          </Show>
          <Show when={props.status === "error"}>
            <span class="pf-chat-meta pf-chat-receipt-degraded">Changes unavailable</span>
          </Show>
          <Show when={props.status === "unavailable"}>
            <span class="pf-chat-meta pf-chat-receipt-degraded">No change details for this turn</span>
          </Show>
        </div>
        <Show when={props.status === "ready" && props.onReviewChanges}>
          <button
            type="button"
            class="pf-chat-receipt-review"
            onClick={() => props.onReviewChanges?.()}
          >
            Review changes
          </button>
        </Show>
      </div>
      <Collapse open={open() && canExpand()}>
        <ul class="pf-chat-receipt-list">
          <For each={files()}>{(file) => <FileRow file={file} />}</For>
        </ul>
      </Collapse>
    </HairlinePanel>
  );
}
