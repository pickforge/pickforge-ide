import { type JSX, For, Match, Show, Switch, createEffect, createSignal } from "solid-js";
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
  selectedLanes,
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

export function OrchestraView(props: { projectRoot: string }): JSX.Element {
  const [ledgerOpen, setLedgerOpen] = createSignal(true);
  const [addMenu, setAddMenu] = createSignal<AddMenu | null>(null);
  const [handoff, setHandoff] = createSignal<HandoffMenu | null>(null);
  const [draft, setDraft] = createSignal("");
  const [notices, setNotices] = createSignal<Record<string, LaneNotice>>({});

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

  const LaneHeader = (p: { chatId: string }) => {
    const provider = () => providerOf(p.chatId);
    const busy = () => chatBusy(p.chatId);
    const attention = () => chatAttention(p.chatId);
    return (
      <div class="pf-orch-lane-head">
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

  const Lane = (p: { chatId: string }) => (
    <div class="pf-orch-lane">
      <LaneHeader chatId={p.chatId} />
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
        <div class="pf-orch-usage-table">
          <div class="pf-orch-usage-row pf-orch-usage-row--head">
            <span>provider</span>
            <span>chats</span>
            <span>turns</span>
            <span>in</span>
            <span>cached</span>
            <span>out</span>
            <span>cost</span>
          </div>
          <For each={usage()}>
            {(row) => (
              <div class="pf-orch-usage-row">
                <span class="pf-orch-usage-prov">
                  {row.provider}
                  <Show when={row.model}>
                    <span class="pf-orch-usage-model">{row.model}</span>
                  </Show>
                </span>
                <span>{row.chats}</span>
                <span>{row.turns ?? "—"}</span>
                <span>{row.inputTokens}</span>
                <span>{row.cachedInputTokens}</span>
                <span>{row.outputTokens}</span>
                <span>{rowCost(row)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );

  return (
    <div class="pf-orch">
      <div class="pf-orch-ledger" classList={{ "pf-orch-ledger--closed": !ledgerOpen() }}>
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
          <div
            class="pf-orch-grid"
            style={{ "grid-template-columns": `repeat(${lanes().length}, minmax(0, 1fr))` }}
          >
            <For each={lanes()}>{(chatId) => <Lane chatId={chatId} />}</For>
          </div>
          <Show when={lanes().length < 4}>
            <button class="pf-orch-add-lane pf-orch-add-lane--corner" onClick={openAddMenu}>
              <IconPlus size={13} /> Add lane
            </button>
          </Show>
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
