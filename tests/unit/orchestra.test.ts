import { beforeEach, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return { invoke: vi.fn(), storage };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));

import type { OrchestraTask } from "../../src/lib/orchestra";
import {
  addSelectedLane,
  deleteTask,
  loadTasks,
  orchestra,
  removeSelectedLane,
  reorderSelectedLane,
  selectedLanes,
  tasksFor,
  upsertTask,
} from "../../src/stores/orchestra";

let rootCounter = 0;

function nextRoot(): string {
  rootCounter += 1;
  return `/project-${rootCounter}`;
}

function makeTask(
  projectRoot: string,
  id: string,
  sortOrder: number,
  title = id,
): OrchestraTask {
  return {
    id,
    projectRoot,
    title,
    status: "planned",
    builderChatId: null,
    reviewerChatId: null,
    note: null,
    sortOrder,
    createdAt: sortOrder,
    updatedAt: sortOrder,
  };
}

beforeEach(() => {
  testEnv.invoke.mockReset();
  testEnv.storage.clear();
});

describe("orchestra task store", () => {
  it("loads, upserts, and deletes tasks through invoke wrappers", async () => {
    const root = nextRoot();
    const first = makeTask(root, "task-1", 1);
    const second = makeTask(root, "task-2", 0);

    testEnv.invoke.mockImplementation((command: string) => {
      if (command === "orchestra_tasks_list") return Promise.resolve([first]);
      return Promise.resolve();
    });

    await loadTasks(root);
    expect(tasksFor(root)).toEqual([first]);

    await upsertTask(second);
    expect(tasksFor(root).map((task) => task.id)).toEqual(["task-2", "task-1"]);

    await deleteTask(root, "task-1");
    expect(tasksFor(root).map((task) => task.id)).toEqual(["task-2"]);
    expect(testEnv.invoke.mock.calls.map((call) => call[0])).toEqual([
      "orchestra_tasks_list",
      "orchestra_task_upsert",
      "orchestra_task_delete",
    ]);
  });

  it("reloads authoritative tasks after an optimistic write fails", async () => {
    const root = nextRoot();
    const persisted = makeTask(root, "persisted", 0);
    const optimistic = makeTask(root, "optimistic", 1);

    testEnv.invoke.mockImplementation((command: string) => {
      if (command === "orchestra_tasks_list") return Promise.resolve([persisted]);
      if (command === "orchestra_task_upsert") return Promise.reject(new Error("write failed"));
      return Promise.resolve();
    });

    await loadTasks(root);
    await expect(upsertTask(optimistic)).rejects.toThrow("write failed");

    expect(tasksFor(root)).toEqual([persisted]);
    expect(orchestra.tasksByRoot[root].error).toBe("write failed");
    expect(testEnv.invoke.mock.calls.map((call) => call[0])).toEqual([
      "orchestra_tasks_list",
      "orchestra_task_upsert",
      "orchestra_tasks_list",
    ]);
  });
});

describe("orchestra lane selection", () => {
  it("loads persisted lanes, persists changes, and caps selection at four chats", () => {
    const root = nextRoot();
    const key = `pickforge.orchestraLanes.${root}`;
    localStorage.setItem(key, JSON.stringify(["chat-1", "chat-2", "chat-1", 7, "chat-3"]));

    expect(selectedLanes(root)).toEqual(["chat-1", "chat-2", "chat-3"]);

    addSelectedLane(root, "chat-4");
    addSelectedLane(root, "chat-5");
    expect(selectedLanes(root)).toEqual(["chat-1", "chat-2", "chat-3", "chat-4"]);
    expect(JSON.parse(testEnv.storage.get(key)!)).toEqual([
      "chat-1",
      "chat-2",
      "chat-3",
      "chat-4",
    ]);

    removeSelectedLane(root, "chat-2");
    reorderSelectedLane(root, 2, 0);
    expect(selectedLanes(root)).toEqual(["chat-4", "chat-1", "chat-3"]);
    expect(JSON.parse(testEnv.storage.get(key)!)).toEqual(["chat-4", "chat-1", "chat-3"]);
  });
});
