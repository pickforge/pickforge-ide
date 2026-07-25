// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ChangesReceiptCard, type ChangesReceiptStatus } from "../../src/components/chat/ChangesReceiptCard";
import type { ChangeSet, ChangedFile } from "../../src/lib/changes";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

function file(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: "src/lib.rs",
    oldPath: null,
    status: "modify",
    staged: null,
    unstaged: null,
    additions: 4,
    deletions: 1,
    binary: false,
    truncated: false,
    diffAvailable: true,
    ...overrides,
  };
}

function changeSet(files: ChangedFile[], overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: "turn:chat-1:1",
    scope: "turn",
    source: "providerSnapshot",
    chatId: "chat-1",
    turnSeq: 1,
    repoRoot: "/project",
    capturedAt: 1,
    stale: false,
    truncated: false,
    files,
    totals: {
      files: files.length,
      additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
      deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
    },
    ...overrides,
  };
}

function mount(
  props: {
    status: ChangesReceiptStatus;
    changeSet: ChangeSet | null;
    open?: boolean;
    onToggle?: () => void;
    onReviewChanges?: () => void;
  },
) {
  dispose = render(() => <ChangesReceiptCard {...props} />, root);
  return root;
}

describe("ChangesReceiptCard", () => {
  it("renders N files changed, +A -D totals, and a status breakdown for a ready multi-file set", () => {
    mount({
      status: "ready",
      changeSet: changeSet([
        file({ path: "src/a.rs", status: "add", additions: 10, deletions: 0 }),
        file({ path: "src/b.rs", status: "modify", additions: 2, deletions: 1 }),
        file({ path: "src/c.rs", status: "delete", additions: 0, deletions: 8 }),
      ]),
    });

    expect(root.querySelector(".pf-chat-meta")?.textContent).toBe("3 files changed");
    expect(root.querySelector(".pf-chat-receipt-stat--add")?.textContent).toBe("+12");
    expect(root.querySelector(".pf-chat-receipt-stat--del")?.textContent).toBe("−9");
    expect(root.querySelector(".pf-chat-receipt-counts")?.textContent).toBe(
      "1 added · 1 modified · 1 deleted",
    );
    expect(root.querySelectorAll(".pf-chat-receipt-row")).toHaveLength(3);
  });

  it("renders exactly one row per file in the given ChangeSet — it does not re-fold or dedup", () => {
    // The backend already dedups/folds repeated events per path (#231 PR1/PR2);
    // this component must trust that and render precisely what it's given.
    mount({
      status: "ready",
      changeSet: changeSet([
        file({ path: "src/a.rs" }),
        file({ path: "src/b.rs" }),
        file({ path: "src/c.rs" }),
        file({ path: "src/d.rs" }),
      ]),
    });

    expect(root.querySelectorAll(".pf-chat-receipt-row")).toHaveLength(4);
  });

  it("renders a rename row as old path arrow new path", () => {
    mount({
      status: "ready",
      changeSet: changeSet([
        file({ path: "src/new-name.rs", oldPath: "src/old-name.rs", status: "rename" }),
      ]),
    });

    const row = root.querySelector(".pf-chat-receipt-row");
    expect(row?.querySelector(".pf-chat-receipt-status")?.textContent).toBe("R");
    expect(row?.querySelector(".pf-chat-receipt-path-old")?.textContent).toBe("src/old-name.rs");
    expect(row?.querySelector(".pf-chat-receipt-path")?.textContent).toContain("src/new-name.rs");
  });

  it("flags binary and truncated files without fabricating a stat", () => {
    mount({
      status: "ready",
      changeSet: changeSet([
        file({ path: "assets/logo.png", binary: true, additions: null, deletions: null }),
        file({ path: "src/big.rs", truncated: true, additions: null, deletions: null }),
      ]),
    });

    const rows = root.querySelectorAll(".pf-chat-receipt-row");
    expect(rows[0].querySelector(".pf-chat-receipt-flag")?.textContent).toBe("binary");
    expect(rows[0].querySelector(".pf-chat-receipt-unknown")?.textContent).toBe("unknown");
    expect(rows[1].querySelector(".pf-chat-receipt-flag")?.textContent).toBe("truncated");
    expect(rows[1].querySelector(".pf-chat-receipt-unknown")?.textContent).toBe("unknown");
  });

  it("never renders a fabricated 0 for a file with unknown line counts", () => {
    mount({
      status: "ready",
      changeSet: changeSet([file({ additions: null, deletions: null })]),
    });

    const row = root.querySelector(".pf-chat-receipt-row");
    expect(row?.querySelector(".pf-chat-receipt-unknown")?.textContent).toBe("unknown");
    expect(row?.textContent).not.toContain("+0");
    expect(row?.textContent).not.toContain("−0");
  });

  it("flags the header total when some files carry unknown stats, without changing the numeric total", () => {
    mount({
      status: "ready",
      changeSet: changeSet([
        file({ path: "src/a.rs", additions: 3, deletions: 0 }),
        file({ path: "src/b.rs", additions: null, deletions: null }),
      ]),
    });

    expect(root.querySelector(".pf-chat-receipt-stat--add")?.textContent).toBe("+3");
    expect(root.querySelector(".pf-chat-receipt-unknown-flag")).not.toBeNull();
  });

  it("labels a gitSnapshot source as a workspace snapshot, not implied agent attribution", () => {
    mount({
      status: "ready",
      changeSet: changeSet([file()], { source: "gitSnapshot" }),
    });

    expect(root.querySelector(".pf-chat-receipt-badge")?.textContent).toBe("workspace snapshot");
  });

  it("shows no attribution badge for a providerSnapshot source", () => {
    mount({
      status: "ready",
      changeSet: changeSet([file()], { source: "providerSnapshot" }),
    });

    expect(root.querySelector(".pf-chat-receipt-badge")).toBeNull();
  });

  it("renders loading without any numbers and disables expand", () => {
    mount({ status: "loading", changeSet: null });

    expect(root.querySelector(".pf-chat-meta")?.textContent).toBe("Loading changes…");
    expect(root.querySelector(".pf-chat-receipt-toggle")).toHaveProperty("disabled", true);
    expect(root.querySelector(".pf-chat-receipt-stat--add")).toBeNull();
    expect(root.querySelector(".pf-chat-receipt-review")).toBeNull();
  });

  it("renders error without any numbers and disables expand", () => {
    mount({ status: "error", changeSet: null });

    expect(root.querySelector(".pf-chat-receipt-degraded")?.textContent).toBe("Changes unavailable");
    expect(root.querySelector(".pf-chat-receipt-toggle")).toHaveProperty("disabled", true);
    expect(root.querySelector(".pf-chat-receipt-stat--add")).toBeNull();
  });

  it("renders unavailable without any numbers and disables expand", () => {
    mount({ status: "unavailable", changeSet: null });

    expect(root.querySelector(".pf-chat-receipt-degraded")?.textContent).toBe(
      "No change details for this turn",
    );
    expect(root.querySelector(".pf-chat-receipt-toggle")).toHaveProperty("disabled", true);
  });

  it("toggles the collapsible file list through onToggle", () => {
    const onToggle = vi.fn();
    mount({ status: "ready", changeSet: changeSet([file()]), open: false, onToggle });

    const toggle = root.querySelector<HTMLButtonElement>(".pf-chat-receipt-toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    toggle?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("fires onReviewChanges when the Review changes button is clicked", () => {
    const onReviewChanges = vi.fn();
    mount({ status: "ready", changeSet: changeSet([file()]), onReviewChanges });

    root.querySelector<HTMLButtonElement>(".pf-chat-receipt-review")?.click();
    expect(onReviewChanges).toHaveBeenCalledTimes(1);
  });
});
