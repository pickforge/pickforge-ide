import { type JSX, For, Match, Show, Switch, createEffect, createSignal, onCleanup } from "solid-js";
import { AgentChatView } from "../chat/AgentChatView";
import { FloatingMenu } from "../FloatingMenu";
import { ForgeEmptyState, MonoEyebrow } from "../ui";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconGrid,
  IconMore,
  IconPlus,
  IconRefresh,
  IconSplit,
} from "../icons";
import { type AgentProvider } from "../../lib/agentChat";
import { AGENTS, loadAgentModels } from "../../lib/agentModels";
import { DEFAULT_CHAT_TITLE } from "../../lib/chatAutoName";
import { PROMPT_TEMPLATES } from "../../lib/promptTemplates";
import { gitDiff, gitStatus } from "../../lib/git";
import { buildWorkingDiff, fillDiffTemplate } from "./diff";
import {
  type AgentUsageSummary,
  type OrchestraTask,
  type OrchestraTaskStatus,
} from "../../lib/orchestra";
import { estimateCostUsd } from "../../lib/agentPricing";
import { agentChat, sendAgentMessage } from "../../stores/agentChat";
import { chatAttention, chatBusy } from "../../stores/chatActivity";
import {
  addSelectedLane,
  deleteTask,
  loadTasks,
  newTaskId,
  refreshUsage,
  removeSelectedLane,
  reorderSelectedLane,
  selectedLanes,
  selectedLayout,
  setSelectedLayout,
  taskList,
  tasksFor,
  upsertTask,
  usageSummary,
} from "../../stores/orchestra";
import { addChat, chatsFor, ensureChatsLoaded, findChat, workspace } from "../../stores/workspace";
import "./orchestra.css";

const AGENT_PROVIDERS = AGENTS.filter((a) => a.id === "claudeCode" || a.id === "codex");
const PROVIDER_MARK: Record<string, string> = { claudeCode: "CC", codex: "CX" };

const STATUS_ORDER: OrchestraTaskStatus[] = [
  "planned",
  "building",
  "reviewing",
  "fixing",
  "done",
];
const STATUS_INTENT: Record<OrchestraTaskStatus, string> = {
  planned: "var(--pf-text-low)",
  building: "var(--pf-info)",
  reviewing: "var(--pf-warning)",
  fixing: "var(--pf-error)",
  done: "var(--pf-connected)",
};

function providerOf(chatId: string): AgentProvider {
  const agentId = findChat(chatId)?.agentId ?? "claudeCode";
  return (agentId === "codex" ? "codex" : "claudeCode") as AgentProvider;
}

function modelLabel(provider: AgentProvider): string {
  const model = loadAgentModels()[provider];
  if (!model) return "";
  return AGENTS.find((a) => a.id === provider)?.models.find((m) => m.id === model)?.label ?? model;
}

function laneTitle(chatId: string): string {
  return findChat(chatId)?.title ?? DEFAULT_CHAT_TITLE;
}

function lastAssistantText(chatId: string): string {
  const timeline = agentChat(chatId)?.timeline ?? [];
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.type === "assistantText" && item.text.trim().length > 0) return item.text;
  }
  return "";
}

function nextStatus(status: OrchestraTaskStatus): OrchestraTaskStatus {
  const index = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
}

interface AddMenu {
  x: number;
  y: number;
  mode: "root" | "new";
}
interface HandoffMenu {
  source: string;
  x: number;
  y: number;
  mode: "root" | "reply" | "diff";
}

interface LaneNotice {
  text: string;
  error: boolean;
}

const LEDGER_MIN_WIDTH = 220;
const LEDGER_DEFAULT_WIDTH = 288;
const LEDGER_WIDTH_KEY = "pickforge.orchestraLedgerWidth";

function loadLedgerWidth(): number {
  const raw = Number(localStorage.getItem(LEDGER_WIDTH_KEY));
  return Number.isFinite(raw) && raw >= LEDGER_MIN_WIDTH ? raw : LEDGER_DEFAULT_WIDTH;
}

function formatK(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function OrchestraView(props: {
  projectRoot: string;
  focusChat?: { chatId: string; at: number } | null;
}): JSX.Element {
  const [ledgerOpen, setLedgerOpen] = createSignal(true);
  const [ledgerWidth, setLedgerWidth] = createSignal(loadLedgerWidth());
  const [addMenu, setAddMenu] = createSignal<AddMenu | null>(null);
  const [handoff, setHandoff] = createSignal<HandoffMenu | null>(null);
  const [draft, setDraft] = createSignal("");
  const [notices, setNotices] = createSignal<Record<string, LaneNotice>>({});
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  const [flashChat, setFlashChat] = createSignal<string | null>(null);

  let orchEl: HTMLDivElement | undefined;
  const laneEls = new Map<string, HTMLElement>();

  let resizing = false;
  const onResizeMove = (event: PointerEvent) => {
    if (!resizing || !orchEl) return;
    const rect = orchEl.getBoundingClientRect();
    const max = Math.round(rect.width * 0.5);
    const next = Math.max(LEDGER_MIN_WIDTH, Math.min(max, Math.round(event.clientX - rect.left)));
    setLedgerWidth(next);
  };
  const endResize = () => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove("pf-resizing");
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", endResize);
    localStorage.setItem(LEDGER_WIDTH_KEY, String(ledgerWidth()));
  };
  const startResize = (event: PointerEvent) => {
    event.preventDefault();
    resizing = true;
    document.body.classList.add("pf-resizing");
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", endResize);
  };
  onCleanup(endResize);

  let flashTimer: number | undefined;
  let lastFocusAt = 0;
  createEffect(() => {
    const target = props.focusChat;
    if (!target || target.at === lastFocusAt) return;
    lastFocusAt = target.at;
    if (!selectedLanes(props.projectRoot).includes(target.chatId)) return;
    const el = laneEls.get(target.chatId);
    if (el) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest", inline: "nearest" });
    }
    setFlashChat(target.chatId);
    if (flashTimer) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => setFlashChat(null), 900);
  });
  onCleanup(() => {
    if (flashTimer) window.clearTimeout(flashTimer);
  });

  createEffect(() => {
    const root = props.projectRoot;
    void ensureChatsLoaded(root);
    void loadTasks(root).catch(() => undefined);
    void refreshUsage(root).catch(() => undefined);
  });

  const setNotice = (chatId: string, text: string, error: boolean) =>
    setNotices((all) => ({ ...all, [chatId]: { text, error } }));
  const clearNotice = (chatId: string) =>
    setNotices((all) => {
      if (!(chatId in all)) return all;
      const next = { ...all };
      delete next[chatId];
      return next;
    });
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  const lanes = () => selectedLanes(props.projectRoot);
  const tasks = () => taskList(props.projectRoot).items;
  const usage = () => usageSummary(props.projectRoot).items;
  const layout = () => selectedLayout(props.projectRoot);

  const gridStyle = (): JSX.CSSProperties => {
    const count = lanes().length;
    const mode = layout();
    if (mode === "rows") {
      return {
        "grid-template-columns": "minmax(0, 1fr)",
        "grid-template-rows": `repeat(${count}, minmax(0, 1fr))`,
      };
    }
    if (mode === "grid") {
      const cols = Math.min(2, count);
      const rows = Math.max(1, Math.ceil(count / Math.max(1, cols)));
      return {
        "grid-template-columns": `repeat(${cols}, minmax(0, 1fr))`,
        "grid-template-rows": `repeat(${rows}, minmax(0, 1fr))`,
      };
    }
    return { "grid-template-columns": `repeat(${count}, minmax(0, 1fr))` };
  };

  const onLaneDrop = (index: number) => {
    const from = dragIndex();
    if (from !== null && from !== index) reorderSelectedLane(props.projectRoot, from, index);
    setDragIndex(null);
    setDropIndex(null);
  };

  const eligibleChats = () =>
    chatsFor(props.projectRoot).filter(
      (chat) => chat.kind === "agent" && !lanes().includes(chat.chatId),
    );

  const otherLanes = (source: string) => lanes().filter((id) => id !== source);

  const openAddMenu = (event: MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setAddMenu({ x: rect.right, y: rect.bottom + 4, mode: "root" });
  };

  const openHandoff = (source: string, event: MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setHandoff({ source, x: rect.right, y: rect.bottom + 4, mode: "root" });
  };

  const addExistingLane = (chatId: string) => {
    addSelectedLane(props.projectRoot, chatId);
    setAddMenu(null);
  };

  const createLane = async (provider: string) => {
    setAddMenu(null);
    await addChat(DEFAULT_CHAT_TITLE, provider, props.projectRoot, "agent");
    const created = workspace.activeChatId;
    if (created) addSelectedLane(props.projectRoot, created);
  };

  const patchTask = (task: OrchestraTask, patch: Partial<OrchestraTask>) => {
    void upsertTask({ ...task, ...patch, updatedAt: Date.now() }).catch(() => undefined);
  };

  const addTask = () => {
    const title = draft().trim();
    if (!title) return;
    const now = Date.now();
    const sortOrder = tasksFor(props.projectRoot).reduce(
      (max, task) => Math.max(max, task.sortOrder + 1),
      0,
    );
    void upsertTask({
      id: newTaskId(),
      projectRoot: props.projectRoot,
      title,
      status: "planned",
      builderChatId: null,
      reviewerChatId: null,
      note: null,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    }).catch(() => undefined);
    setDraft("");
  };

  const removeLane = (chatId: string) => {
    removeSelectedLane(props.projectRoot, chatId);
    for (const task of tasksFor(props.projectRoot)) {
      if (task.builderChatId !== chatId && task.reviewerChatId !== chatId) continue;
      patchTask(task, {
        builderChatId: task.builderChatId === chatId ? null : task.builderChatId,
        reviewerChatId: task.reviewerChatId === chatId ? null : task.reviewerChatId,
      });
    }
  };

  const sendReplyTo = (source: string, target: string) => {
    setHandoff(null);
    const reply = lastAssistantText(source);
    if (!reply) {
      setNotice(source, "No assistant reply to send yet.", false);
      return;
    }
    const template = PROMPT_TEMPLATES.find((t) => t.id === "handoff-review");
    const body = template ? template.body.replace(/\{\{diff\}\}/g, reply) : reply;
    void sendAgentMessage(target, body)
      .then(() => clearNotice(source))
      .catch((error) => setNotice(source, errorText(error), true));
  };

  const sendDiffTo = async (source: string, target: string) => {
    setHandoff(null);
    const template = PROMPT_TEMPLATES.find((t) => t.id === "review");
    try {
      const status = await gitStatus(props.projectRoot);
      const parts: { path: string; diff: string }[] = [];
      for (const file of status.files) {
        if (file.staged) {
          const diff = await gitDiff(props.projectRoot, file.path, true);
          if (diff.trim()) parts.push({ path: file.path, diff });
        }
        if (file.unstaged || file.untracked) {
          const diff = await gitDiff(props.projectRoot, file.path, false);
          if (diff.trim()) parts.push({ path: file.path, diff });
        }
      }
      const diff = buildWorkingDiff(parts);
      if (!diff) {
        setNotice(source, "No working diff to send.", false);
        return;
      }
      const body = template ? fillDiffTemplate(template.body, diff) : diff;
      await sendAgentMessage(target, body);
      clearNotice(source);
    } catch (error) {
      setNotice(source, errorText(error), true);
    }
  };

  const LaneHeader = (p: { chatId: string; index: number }) => {
    const provider = () => providerOf(p.chatId);
    const busy = () => chatBusy(p.chatId);
    const attention = () => chatAttention(p.chatId);
    return (
      <div
        class="pf-orch-lane-head"
        draggable={true}
        onDragStart={(e) => {
          setDragIndex(p.index);
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", p.chatId);
          }
        }}
        onDragEnd={() => {
          setDragIndex(null);
          setDropIndex(null);
        }}
      >
        <span
          class="pf-orch-lane-dot"
          classList={{ "pf-orch-lane-dot--busy": busy(), "pf-orch-lane-dot--attention": attention() }}
        />
        <span class="pf-orch-lane-title">{laneTitle(p.chatId)}</span>
        <span class="pf-orch-lane-mark">{PROVIDER_MARK[provider()] ?? "AI"}</span>
        <Show when={modelLabel(provider())}>
          <span class="pf-orch-lane-model">{modelLabel(provider())}</span>
        </Show>
        <span class="pf-orch-lane-spacer" />
        <button
          class="pf-orch-icon"
          title="Handoff"
          onClick={(e) => openHandoff(p.chatId, e)}
        >
          <IconMore size={14} />
        </button>
        <button
          class="pf-orch-icon"
          title="Remove lane"
          onClick={() => removeLane(p.chatId)}
        >
          <IconClose size={13} />
        </button>
      </div>
    );
  };

  const Lane = (p: { chatId: string; index: number }) => {
    onCleanup(() => {
      laneEls.delete(p.chatId);
    });
    return (
    <div
      class="pf-orch-lane"
      ref={(el) => laneEls.set(p.chatId, el)}
      classList={{
        "pf-orch-lane--flash": flashChat() === p.chatId,
        "pf-orch-lane--dragging": dragIndex() === p.index,
        "pf-orch-lane--drop":
          dragIndex() !== null && dragIndex() !== p.index && dropIndex() === p.index,
      }}
      onDragOver={(e) => {
        if (dragIndex() === null) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        setDropIndex(p.index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onLaneDrop(p.index);
      }}
    >
      <LaneHeader chatId={p.chatId} index={p.index} />
      <Show when={notices()[p.chatId]}>
        {(notice) => (
          <div
            class="pf-orch-lane-notice"
            classList={{ "pf-orch-lane-notice--error": notice().error }}
            role={notice().error ? "alert" : "status"}
          >
            {notice().text}
          </div>
        )}
      </Show>
      <div class="pf-orch-lane-body">
        <AgentChatView
          chatId={p.chatId}
          projectRoot={props.projectRoot}
          provider={providerOf(p.chatId)}
          model={loadAgentModels()[providerOf(p.chatId)] ?? null}
        />
      </div>
    </div>
    );
  };

  const LaneSelect = (p: {
    value: string | null;
    onSelect: (chatId: string | null) => void;
  }) => (
    <select
      class="pf-orch-select"
      value={p.value ?? ""}
      onChange={(e) => p.onSelect(e.currentTarget.value || null)}
    >
      <option value="">—</option>
      <For each={lanes()}>
        {(chatId) => <option value={chatId}>{laneTitle(chatId)}</option>}
      </For>
    </select>
  );

  const TaskRow = (p: { task: OrchestraTask }) => {
    const task = () => p.task;
    return (
      <div class="pf-orch-task">
        <div class="pf-orch-task-top">
          <button
            class="pf-orch-status"
            style={{ "--pf-status": STATUS_INTENT[task().status] }}
            onClick={() => patchTask(task(), { status: nextStatus(task().status) })}
          >
            <span class="pf-orch-status-dot" />
            {task().status}
          </button>
          <span class="pf-orch-task-title">{task().title}</span>
          <button
            class="pf-orch-task-del"
            title="Delete task"
            onClick={() => void deleteTask(props.projectRoot, task().id).catch(() => undefined)}
          >
            <IconClose size={12} />
          </button>
        </div>
        <div class="pf-orch-task-assign">
          <span class="pf-orch-task-key">build</span>
          <LaneSelect
            value={task().builderChatId}
            onSelect={(chatId) => patchTask(task(), { builderChatId: chatId })}
          />
          <span class="pf-orch-task-key">review</span>
          <LaneSelect
            value={task().reviewerChatId}
            onSelect={(chatId) => patchTask(task(), { reviewerChatId: chatId })}
          />
        </div>
        <input
          class="pf-orch-note"
          placeholder="Note…"
          value={task().note ?? ""}
          onChange={(e) => patchTask(task(), { note: e.currentTarget.value.trim() || null })}
        />
      </div>
    );
  };

  const rowCost = (row: AgentUsageSummary): string => {
    if (row.costUsd > 0) return `$${row.costUsd.toFixed(2)}`;
    const estimated = estimateCostUsd(row.model, row);
    return estimated != null ? `~$${estimated.toFixed(2)}` : `$${row.costUsd.toFixed(2)}`;
  };

  const UsageDashboard = () => (
    <div class="pf-orch-usage">
      <div class="pf-orch-usage-head">
        <MonoEyebrow text="Usage" />
        <button
          class="pf-orch-icon"
          title="Refresh usage"
          onClick={() => void refreshUsage(props.projectRoot).catch(() => undefined)}
        >
          <IconRefresh size={13} />
        </button>
      </div>
      <Show
        when={usage().length > 0}
        fallback={<div class="pf-orch-usage-empty">No usage recorded.</div>}
      >
        <div class="pf-orch-usage-cards">
          <For each={usage()}>
            {(row) => (
              <div class="pf-orch-usage-card">
                <div class="pf-orch-usage-card-head">
                  <span class="pf-orch-usage-card-prov">{row.provider}</span>
                  <Show when={row.model}>
                    <span class="pf-orch-usage-card-model">{row.model}</span>
                  </Show>
                </div>
                <div class="pf-orch-usage-card-meta">
                  {row.chats} chats · {row.turns == null ? "—" : `${row.turns} turns`}
                </div>
                <div class="pf-orch-usage-card-tokens">
                  {formatK(row.inputTokens)} in · {formatK(row.cachedInputTokens)} cached ·{" "}
                  {formatK(row.outputTokens)} out
                </div>
                <div class="pf-orch-usage-card-cost">{rowCost(row)}</div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );

  return (
    <div class="pf-orch" ref={(el) => (orchEl = el)}>
      <div
        class="pf-orch-ledger"
        classList={{ "pf-orch-ledger--closed": !ledgerOpen() }}
        style={ledgerOpen() ? { width: `${ledgerWidth()}px` } : undefined}
      >
        <div class="pf-orch-ledger-head">
          <button
            class="pf-orch-ledger-toggle"
            onClick={() => setLedgerOpen(!ledgerOpen())}
          >
            <Show when={ledgerOpen()} fallback={<IconChevronRight size={12} />}>
              <IconChevronDown size={12} />
            </Show>
            <MonoEyebrow text="Ledger" />
          </button>
        </div>
        <Show when={ledgerOpen()}>
          <div class="pf-orch-ledger-body">
            <div class="pf-orch-tasks">
              <For
                each={tasks()}
                fallback={<div class="pf-orch-tasks-empty">No tasks yet.</div>}
              >
                {(task) => <TaskRow task={task} />}
              </For>
            </div>
            <div class="pf-orch-add">
              <input
                class="pf-orch-add-input"
                placeholder="Add task…"
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTask();
                  }
                }}
              />
              <button class="pf-orch-add-btn" title="Add task" onClick={addTask}>
                <IconPlus size={14} />
              </button>
            </div>
            <UsageDashboard />
          </div>
        </Show>
      </div>

      <Show when={ledgerOpen()}>
        <div class="pf-orch-ledger-resizer" title="Drag to resize" onPointerDown={startResize}>
          <span class="pf-orch-ledger-resizer-grip" />
        </div>
      </Show>

      <div class="pf-orch-grid-wrap">
        <Show
          when={lanes().length > 0}
          fallback={
            <div class="pf-orch-empty">
              <ForgeEmptyState
                glyph={<IconGrid size={26} />}
                eyebrow="Orchestra"
                title="No lanes yet"
                hint="Add an agent chat as a lane to orchestrate it here."
                action={
                  <button class="pf-orch-add-lane" onClick={openAddMenu}>
                    <IconPlus size={13} /> Add lane
                  </button>
                }
              />
            </div>
          }
        >
          <div class="pf-orch-grid-bar">
            <MonoEyebrow text="Lanes" />
            <div class="pf-orch-grid-bar-tools">
              <Show when={lanes().length > 1}>
                <div class="pf-orch-layout-toggle" role="group" aria-label="Lane layout">
                  <button
                    class="pf-orch-layout-btn"
                    classList={{ "pf-orch-layout-btn--on": layout() === "columns" }}
                    title="Columns"
                    onClick={() => setSelectedLayout(props.projectRoot, "columns")}
                  >
                    <IconSplit dir="left" size={13} />
                  </button>
                  <button
                    class="pf-orch-layout-btn"
                    classList={{ "pf-orch-layout-btn--on": layout() === "rows" }}
                    title="Rows"
                    onClick={() => setSelectedLayout(props.projectRoot, "rows")}
                  >
                    <IconSplit dir="up" size={13} />
                  </button>
                  <button
                    class="pf-orch-layout-btn"
                    classList={{ "pf-orch-layout-btn--on": layout() === "grid" }}
                    title="Grid"
                    onClick={() => setSelectedLayout(props.projectRoot, "grid")}
                  >
                    <IconGrid size={13} />
                  </button>
                </div>
              </Show>
              <Show when={lanes().length < 4}>
                <button class="pf-orch-add-lane" onClick={openAddMenu}>
                  <IconPlus size={13} /> Add lane
                </button>
              </Show>
            </div>
          </div>
          <div class="pf-orch-grid" style={gridStyle()}>
            <For each={lanes()}>{(chatId, i) => <Lane chatId={chatId} index={i()} />}</For>
          </div>
        </Show>
      </div>

      <Show when={addMenu()}>
        {(menu) => (
          <FloatingMenu anchor={{ x: menu().x, y: menu().y, align: "end" }} onClose={() => setAddMenu(null)}>
            <Switch>
              <Match when={menu().mode === "root"}>
                <div class="pf-menu-label">Add lane</div>
                <For
                  each={eligibleChats()}
                  fallback={<div class="pf-menu-label">No spare agent chats</div>}
                >
                  {(chat) => (
                    <button class="pf-menu-item" onClick={() => addExistingLane(chat.chatId)}>
                      {chat.title}
                    </button>
                  )}
                </For>
                <div class="pf-menu-sep" />
                <button
                  class="pf-menu-item pf-menu-item--accent"
                  onClick={() => setAddMenu({ ...menu(), mode: "new" })}
                >
                  New agent chat…
                </button>
              </Match>
              <Match when={menu().mode === "new"}>
                <div class="pf-menu-label">New agent chat</div>
                <For each={AGENT_PROVIDERS}>
                  {(agent) => (
                    <button class="pf-menu-item" onClick={() => void createLane(agent.id)}>
                      {agent.label}
                    </button>
                  )}
                </For>
              </Match>
            </Switch>
          </FloatingMenu>
        )}
      </Show>

      <Show when={handoff()}>
        {(menu) => (
          <FloatingMenu anchor={{ x: menu().x, y: menu().y, align: "end" }} onClose={() => setHandoff(null)}>
            <Switch>
              <Match when={menu().mode === "root"}>
                <button
                  class="pf-menu-item"
                  onClick={() => setHandoff({ ...menu(), mode: "reply" })}
                >
                  Send last reply to…
                </button>
                <button
                  class="pf-menu-item"
                  onClick={() => setHandoff({ ...menu(), mode: "diff" })}
                >
                  Send working diff to…
                </button>
              </Match>
              <Match when={menu().mode === "reply"}>
                <div class="pf-menu-label">Send last reply to</div>
                <For
                  each={otherLanes(menu().source)}
                  fallback={<div class="pf-menu-label">No other lanes</div>}
                >
                  {(target) => (
                    <button
                      class="pf-menu-item"
                      onClick={() => sendReplyTo(menu().source, target)}
                    >
                      {laneTitle(target)}
                    </button>
                  )}
                </For>
              </Match>
              <Match when={menu().mode === "diff"}>
                <div class="pf-menu-label">Send working diff to</div>
                <For
                  each={otherLanes(menu().source)}
                  fallback={<div class="pf-menu-label">No other lanes</div>}
                >
                  {(target) => (
                    <button class="pf-menu-item" onClick={() => void sendDiffTo(menu().source, target)}>
                      {laneTitle(target)}
                    </button>
                  )}
                </For>
              </Match>
            </Switch>
          </FloatingMenu>
        )}
      </Show>
    </div>
  );
}
