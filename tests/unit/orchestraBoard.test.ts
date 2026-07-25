import { describe, expect, it } from "vitest";

import type { OrchestraTask, OrchestraTaskStatus } from "../../src/lib/orchestra";
import {
  filterTaskLinkedChats,
  groupTasksByStatus,
  STATUS_ORDER,
  taskLinkedChatIds,
} from "../../src/stores/orchestraBoard";

let taskCounter = 0;

function task(overrides: Partial<OrchestraTask> = {}): OrchestraTask {
  taskCounter += 1;
  return {
    id: `task-${taskCounter}`,
    projectRoot: "/proj/a",
    title: `Task ${taskCounter}`,
    status: "planned",
    builderChatId: null,
    reviewerChatId: null,
    note: null,
    sortOrder: taskCounter,
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe("groupTasksByStatus", () => {
  it("returns one column per STATUS_ORDER entry, in order", () => {
    const columns = groupTasksByStatus([]);
    expect(columns.map((c) => c.status)).toEqual(STATUS_ORDER);
  });

  it("lands each task in its own status column", () => {
    const planned = task({ id: "t-planned", status: "planned" });
    const building = task({ id: "t-building", status: "building" });
    const reviewing = task({ id: "t-reviewing", status: "reviewing" });
    const fixing = task({ id: "t-fixing", status: "fixing" });
    const done = task({ id: "t-done", status: "done" });

    const columns = groupTasksByStatus([planned, building, reviewing, fixing, done]);

    const byStatus = Object.fromEntries(columns.map((c) => [c.status, c.tasks.map((t) => t.id)]));
    expect(byStatus.planned).toEqual(["t-planned"]);
    expect(byStatus.building).toEqual(["t-building"]);
    expect(byStatus.reviewing).toEqual(["t-reviewing"]);
    expect(byStatus.fixing).toEqual(["t-fixing"]);
    expect(byStatus.done).toEqual(["t-done"]);
  });

  it("preserves input order within a column and never adds/renames statuses", () => {
    const a = task({ id: "a", status: "building", sortOrder: 0 });
    const b = task({ id: "b", status: "building", sortOrder: 1 });
    const c = task({ id: "c", status: "building", sortOrder: 2 });

    const columns = groupTasksByStatus([a, b, c]);

    expect(columns).toHaveLength(5);
    const building = columns.find((col) => col.status === "building")!;
    expect(building.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    const statuses: OrchestraTaskStatus[] = ["planned", "building", "reviewing", "fixing", "done"];
    expect(STATUS_ORDER).toEqual(statuses);
  });

  it("leaves an empty column as an empty array, not omitted", () => {
    const columns = groupTasksByStatus([task({ status: "done" })]);
    const planned = columns.find((col) => col.status === "planned")!;
    expect(planned.tasks).toEqual([]);
  });
});

describe("taskLinkedChatIds / filterTaskLinkedChats — the locked subset rule", () => {
  it("collects both builder and reviewer chat ids across tasks", () => {
    const tasks = [
      task({ builderChatId: "chat-builder", reviewerChatId: "chat-reviewer" }),
      task({ builderChatId: "chat-builder-2", reviewerChatId: null }),
    ];

    const ids = taskLinkedChatIds(tasks);

    expect([...ids].sort()).toEqual(["chat-builder", "chat-builder-2", "chat-reviewer"]);
  });

  it("an ad-hoc chat with no OrchestraTask assignment is absent from the filtered set", () => {
    const tasks = [task({ builderChatId: "chat-tracked", reviewerChatId: null })];
    const chats = [{ chatId: "chat-tracked" }, { chatId: "chat-adhoc" }];

    const filtered = filterTaskLinkedChats(chats, tasks);

    expect(filtered.map((c) => c.chatId)).toEqual(["chat-tracked"]);
  });

  it("a task-linked chat (builder or reviewer) is present", () => {
    const tasks = [
      task({ builderChatId: "chat-builder", reviewerChatId: null }),
      task({ builderChatId: null, reviewerChatId: "chat-reviewer" }),
    ];
    const chats = [{ chatId: "chat-builder" }, { chatId: "chat-reviewer" }, { chatId: "chat-untracked" }];

    const filtered = filterTaskLinkedChats(chats, tasks);

    expect(filtered.map((c) => c.chatId).sort()).toEqual(["chat-builder", "chat-reviewer"]);
  });

  it("returns nothing when no task links any chat", () => {
    const filtered = filterTaskLinkedChats([{ chatId: "chat-adhoc" }], [task()]);
    expect(filtered).toEqual([]);
  });
});
