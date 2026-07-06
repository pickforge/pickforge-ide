import {
  type JSX,
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
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
  IconSplitTrigger,
} from "../icons";
import { type AgentProvider } from "../../lib/agentChat";
import { AGENTS, loadAgentModels } from "../../lib/agentModels";
import { isPrimaryChat } from "../../lib/chatLabels";
import { DEFAULT_CHAT_TITLE } from "../../lib/chatAutoName";
import { loadAskChatTitle, loadLastAgentProvider } from "../../lib/chatDefaults";
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
import { isChatArchived } from "../../stores/chatArchive";
import {
  type LaneDir,
  type LaneNode,
  type LaneRegion,
  type OrchestraLayout,
  MAX_LANES,
  addLaneAt,
  addSelectedLane,
  applyLayoutPreset,
  commitLaneLayout,
  deleteTask,
  detectLayoutPreset,
  laneTree,
  loadTasks,
  moveLane,
  newTaskId,
  refreshUsage,
  removeSelectedLane,
  selectedLanes,
  setLaneSplitRatio,
  taskList,
  tasksFor,
  upsertTask,
  usageSummary,
} from "../../stores/orchestra";
import {
  addChat,
  chatsFor,
  ensureChatsLoaded,
  findChat,
  setChatTitle,
  workspace,
} from "../../stores/workspace";
import { swarmRuns } from "../../stores/swarm";
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

// ---- lane split layout (mirrors TerminalHost.computeLayout) ----
interface LaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface LaneDividerRect {
  id: string;
  dir: "row" | "col";
  rect: LaneRect;
  bounds: LaneRect;
}

function computeLaneLayout(
  node: LaneNode | null,
  rect: LaneRect,
  leaves: Map<string, LaneRect>,
  dividers: LaneDividerRect[],
): void {
  if (!node) return;
  if (node.kind === "leaf") {
    leaves.set(node.chatId, rect);
    return;
  }
  if (node.dir === "row") {
    const aw = rect.w * node.ratio;
    computeLaneLayout(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, leaves, dividers);
    computeLaneLayout(node.b, { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h }, leaves, dividers);
    dividers.push({ id: node.id, dir: "row", rect: { x: rect.x + aw, y: rect.y, w: 0, h: rect.h }, bounds: rect });
  } else {
    const ah = rect.h * node.ratio;
    computeLaneLayout(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }, leaves, dividers);
    computeLaneLayout(node.b, { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah }, leaves, dividers);
    dividers.push({ id: node.id, dir: "col", rect: { x: rect.x, y: rect.y + ah, w: rect.w, h: 0 }, bounds: rect });
  }
}

const pct = (v: number) => `${v * 100}%`;

const SPLIT_TILES: { dir: LaneDir; label: string }[] = [
  { dir: "left", label: "Open left" },
  { dir: "right", label: "Open right" },
  { dir: "up", label: "Open top" },
  { dir: "down", label: "Open bottom" },
];

function pruneLaneTree(node: LaneNode | null, chatIds: Set<string>): LaneNode | null {
  if (!node) return null;
  if (node.kind === "leaf") return chatIds.has(node.chatId) ? node : null;
  const a = pruneLaneTree(node.a, chatIds);
  const b = pruneLaneTree(node.b, chatIds);
  if (!a) return b;
  if (!b) return a;
  if (a === node.a && b === node.b) return node;
  return { ...node, a, b };
}

function collectLaneIds(node: LaneNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.kind === "leaf") out.push(node.chatId);
  else {
    collectLaneIds(node.a, out);
    collectLaneIds(node.b, out);
  }
  return out;
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
  const [dragChat, setDragChat] = createSignal<string | null>(null);
  const [drop, setDrop] = createSignal<{ chatId: string; region: LaneRegion } | null>(null);
  const [splitMenu, setSplitMenu] = createSignal<{ chatId: string; x: number; y: number } | null>(null);
  const [renamingLane, setRenamingLane] = createSignal<string | null>(null);
  const [newLaneTitle, setNewLaneTitle] = createSignal("");
  // When set, the next lane picked from the add-menu is inserted beside a target
  // in a direction (from a lane's split menu) instead of appended to the root.
  const [pendingTarget, setPendingTarget] = createSignal<{ chatId: string; dir: LaneDir } | null>(null);
  const [flashChat, setFlashChat] = createSignal<string | null>(null);

  let orchEl: HTMLDivElement | undefined;
  let gridEl: HTMLDivElement | undefined;
  const laneEls = new Map<string, HTMLElement>();

  const rawTree = () => laneTree(props.projectRoot);
  const rawLanes = () => selectedLanes(props.projectRoot);
  const projectChats = () => chatsFor(props.projectRoot);
  const chatsLoaded = () => workspace.chatsByRoot[props.projectRoot] !== undefined;
  const liveProjectChatIds = createMemo(() =>
    new Set(
      projectChats()
        .filter((chat) => !isChatArchived(chat.chatId) && isPrimaryChat(chat))
        .map((chat) => chat.chatId),
    ),
  );
  const liveTree = createMemo(() => pruneLaneTree(rawTree(), liveProjectChatIds()));
  const liveLanes = createMemo(() => collectLaneIds(liveTree()));
  const activeSplitMenu = createMemo(() => {
    const menu = splitMenu();
    return menu && liveLanes().includes(menu.chatId) ? menu : null;
  });
  const activeHandoff = createMemo(() => {
    const menu = handoff();
    return menu && liveLanes().includes(menu.source) ? menu : null;
  });
  const pruneDeadLanes = () => {
    if (!chatsLoaded()) return;
    const chatIds = liveProjectChatIds();
    for (const chatId of rawLanes()) {
      if (!chatIds.has(chatId)) removeSelectedLane(props.projectRoot, chatId);
    }
  };
  const applyLiveLayoutPreset = (preset: OrchestraLayout) => {
    pruneDeadLanes();
    applyLayoutPreset(props.projectRoot, preset);
  };

  let resizing = false;
  const onResizeMove = (event: PointerEvent) => {
    if (!resizing || !orchEl) return;
    const rect = orchEl.getBoundingClientRect();
    const max = Math.round(rect.width * 0.5);
    const next = Math.max(LEDGER_MIN_WIDTH, Math.min(max, Math.round(event.clientX - rect.left)));
    setLedgerWidth(next);
  };
  const cleanupResize = () => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove("pf-resizing");
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", cancelResize);
  };
  const cancelResize = () => {
    cleanupResize();
  };
  const endResize = () => {
    if (!resizing) return;
    cleanupResize();
    localStorage.setItem(LEDGER_WIDTH_KEY, String(ledgerWidth()));
  };
  const startResize = (event: PointerEvent) => {
    event.preventDefault();
    resizing = true;
    document.body.classList.add("pf-resizing");
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", cancelResize);
  };
  onCleanup(endResize);

  let flashTimer: number | undefined;
  let lastFocusAt = 0;
  createEffect(() => {
    const target = props.focusChat;
    if (!target || target.at === lastFocusAt) return;
    lastFocusAt = target.at;
    if (!liveLanes().includes(target.chatId)) return;
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
    untrack(() => {
      void ensureChatsLoaded(root);
      void loadTasks(root).catch(() => undefined);
      void refreshUsage(root).catch(() => undefined);
    });
  });

  createEffect(() => {
    pruneDeadLanes();
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

  const tasks = () => taskList(props.projectRoot).items;
  const usage = () => usageSummary(props.projectRoot).items;
  const projectSwarms = () => swarmRuns().filter((run) => run.projectRoot === props.projectRoot);
  const preset = () => detectLayoutPreset(liveTree());

  // Absolute rects + divider seams recomputed whenever the tree changes.
  const layout = createMemo(() => {
    const map = new Map<string, LaneRect>();
    const divs: LaneDividerRect[] = [];
    computeLaneLayout(liveTree(), { x: 0, y: 0, w: 1, h: 1 }, map, divs);
    return { map, divs };
  });

  // ---- divider drag → live ratio (mirrors TerminalHost) ----
  let ratioDrag: { id: string; dir: "row" | "col"; bounds: LaneRect } | null = null;
  const onRatioMove = (e: PointerEvent) => {
    if (!ratioDrag || !gridEl) return;
    const box = gridEl.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    const local =
      ratioDrag.dir === "row"
        ? (fx - ratioDrag.bounds.x) / ratioDrag.bounds.w
        : (fy - ratioDrag.bounds.y) / ratioDrag.bounds.h;
    setLaneSplitRatio(props.projectRoot, ratioDrag.id, local);
  };
  const cleanupRatioDrag = () => {
    if (!ratioDrag) return;
    ratioDrag = null;
    document.body.classList.remove("pf-resizing");
    window.removeEventListener("pointermove", onRatioMove);
    window.removeEventListener("pointerup", endRatioDrag);
    window.removeEventListener("pointercancel", cancelRatioDrag);
  };
  const cancelRatioDrag = () => {
    cleanupRatioDrag();
  };
  const endRatioDrag = () => {
    if (!ratioDrag) return;
    cleanupRatioDrag();
    // Ratio moves are store-only while dragging; write-through once on release.
    commitLaneLayout(props.projectRoot);
  };
  const startRatioDrag = (e: PointerEvent, d: LaneDividerRect) => {
    e.preventDefault();
    ratioDrag = { id: d.id, dir: d.dir, bounds: d.bounds };
    document.body.classList.add("pf-resizing");
    window.addEventListener("pointermove", onRatioMove);
    window.addEventListener("pointerup", endRatioDrag);
    window.addEventListener("pointercancel", cancelRatioDrag);
  };
  onCleanup(endRatioDrag);

  // ---- lane rearrange: drag a lane by its header onto another lane ----
  // Drop on the centre swaps the two lanes; drop on an edge moves the dragged
  // lane to that side of the target. Chat ids are reused throughout, so the
  // dragged chat is repositioned, never remounted.
  let laneDrag: { chatId: string; startX: number; startY: number; active: boolean } | null = null;
  const hitTest = (cx: number, cy: number): { chatId: string; region: LaneRegion } | null => {
    if (!gridEl) return null;
    const box = gridEl.getBoundingClientRect();
    const fx = (cx - box.left) / box.width;
    const fy = (cy - box.top) / box.height;
    for (const [chatId, r] of layout().map) {
      if (fx < r.x || fx > r.x + r.w || fy < r.y || fy > r.y + r.h) continue;
      const lx = (fx - r.x) / r.w;
      const ly = (fy - r.y) / r.h;
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      let region: LaneRegion = "center";
      if (edge < 0.28) {
        if (edge === lx) region = "left";
        else if (edge === 1 - lx) region = "right";
        else if (edge === ly) region = "up";
        else region = "down";
      }
      return { chatId, region };
    }
    return null;
  };
  const onLaneDragMove = (e: PointerEvent) => {
    if (!laneDrag) return;
    if (!laneDrag.active) {
      if (Math.abs(e.clientX - laneDrag.startX) + Math.abs(e.clientY - laneDrag.startY) < 6) return;
      laneDrag.active = true;
      setDragChat(laneDrag.chatId);
      document.body.classList.add("pf-orch-moving");
    }
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY);
    setDrop(hit && hit.chatId !== laneDrag.chatId ? hit : null);
  };
  const cleanupLaneDrag = () => {
    const ld = laneDrag;
    const target = drop();
    laneDrag = null;
    window.removeEventListener("pointermove", onLaneDragMove);
    window.removeEventListener("pointerup", endLaneDrag);
    window.removeEventListener("pointercancel", cancelLaneDrag);
    document.body.classList.remove("pf-orch-moving");
    setDragChat(null);
    setDrop(null);
    return { ld, target };
  };
  const cancelLaneDrag = () => {
    cleanupLaneDrag();
  };
  const endLaneDrag = () => {
    const { ld, target } = cleanupLaneDrag();
    if (ld?.active && target && target.chatId !== ld.chatId) {
      moveLane(props.projectRoot, ld.chatId, target.chatId, target.region);
    }
  };
  const startLaneDrag = (e: PointerEvent, chatId: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".pf-orch-icon")) return; // controls aren't handles
    if (liveLanes().length <= 1) return; // nothing to rearrange against
    laneDrag = { chatId, startX: e.clientX, startY: e.clientY, active: false };
    window.addEventListener("pointermove", onLaneDragMove);
    window.addEventListener("pointerup", endLaneDrag);
    window.addEventListener("pointercancel", cancelLaneDrag);
  };
  onCleanup(() => {
    if (laneDrag) endLaneDrag();
  });

  const eligibleChats = () =>
    projectChats().filter(
      (chat) =>
        chat.kind === "agent" &&
        isPrimaryChat(chat) &&
        !isChatArchived(chat.chatId) &&
        !liveLanes().includes(chat.chatId),
    );

  const otherLanes = (source: string) => liveLanes().filter((id) => id !== source);

  const openAddMenu = (event: MouseEvent) => {
    event.stopPropagation();
    setPendingTarget(null); // grid-bar pill appends to the root
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setAddMenu({ x: rect.right, y: rect.bottom + 4, mode: "root" });
  };

  const openSplitMenu = (chatId: string, event: MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setSplitMenu({ chatId, x: rect.right, y: rect.bottom + 4 });
  };

  // A direction was chosen from a lane's split menu: remember the target + side,
  // then hand off to the normal add-lane flow (pick existing / create new). The
  // chosen chat lands via addLaneAt (see placeLane).
  const pickSplitDir = (chatId: string, dir: LaneDir, x: number, y: number) => {
    setSplitMenu(null);
    setPendingTarget({ chatId, dir });
    setAddMenu({ x, y, mode: "root" });
  };

  const placeLane = (chatId: string) => {
    pruneDeadLanes();
    const target = pendingTarget();
    if (target) addLaneAt(props.projectRoot, target.chatId, target.dir, chatId);
    else addSelectedLane(props.projectRoot, chatId);
    setPendingTarget(null);
  };

  const openHandoff = (source: string, event: MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setHandoff({ source, x: rect.right, y: rect.bottom + 4, mode: "root" });
  };

  const addExistingLane = (chatId: string) => {
    placeLane(chatId);
    setAddMenu(null);
  };

  const createLane = async (provider: string, title?: string) => {
    setAddMenu(null);
    setNewLaneTitle("");
    await addChat(title?.trim() || DEFAULT_CHAT_TITLE, provider, props.projectRoot, "agent");
    const created = workspace.activeChatId;
    if (created) placeLane(created);
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
    const capped = () => liveLanes().length >= MAX_LANES;
    return (
      <div
        class="pf-orch-lane-head"
        title="Drag to move this lane"
        onPointerDown={(e) => startLaneDrag(e, p.chatId)}
      >
        <span
          class="pf-orch-lane-dot"
          classList={{ "pf-orch-lane-dot--busy": busy(), "pf-orch-lane-dot--attention": attention() }}
        />
        <Show
          when={renamingLane() === p.chatId}
          fallback={
            <span
              class="pf-orch-lane-title"
              title="Double-click to rename"
              onDblClick={() => setRenamingLane(p.chatId)}
            >
              {laneTitle(p.chatId)}
            </span>
          }
        >
          <input
            class="pf-orch-lane-rename"
            value={laneTitle(p.chatId)}
            ref={(el) => setTimeout(() => { el.focus(); el.select(); })}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => setRenamingLane(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void setChatTitle(p.chatId, e.currentTarget.value);
                setRenamingLane(null);
              } else if (e.key === "Escape") {
                setRenamingLane(null);
              }
            }}
          />
        </Show>
        <span class="pf-orch-lane-mark">{PROVIDER_MARK[provider()] ?? "AI"}</span>
        <Show when={modelLabel(provider())}>
          <span class="pf-orch-lane-model">{modelLabel(provider())}</span>
        </Show>
        <span class="pf-orch-lane-spacer" />
        <Show when={!capped()}>
          <button
            class="pf-orch-icon"
            classList={{ "pf-orch-icon--active": splitMenu()?.chatId === p.chatId }}
            title="New lane beside…"
            onClick={(e) => openSplitMenu(p.chatId, e)}
          >
            <IconSplitTrigger size={14} />
          </button>
        </Show>
        <button class="pf-orch-icon" title="Handoff" onClick={(e) => openHandoff(p.chatId, e)}>
          <IconMore size={14} />
        </button>
        <button class="pf-orch-icon" title="Remove lane" onClick={() => removeLane(p.chatId)}>
          <IconClose size={13} />
        </button>
      </div>
    );
  };

  const Lane = (p: { chatId: string }) => {
    onCleanup(() => {
      laneEls.delete(p.chatId);
    });
    const rect = () => layout().map.get(p.chatId) ?? { x: 0, y: 0, w: 1, h: 1 };
    return (
      <div
        class="pf-orch-lane"
        style={{
          left: pct(rect().x),
          top: pct(rect().y),
          width: pct(rect().w),
          height: pct(rect().h),
        }}
      >
        <div
          class="pf-orch-lane-frame"
          ref={(el) => laneEls.set(p.chatId, el)}
          classList={{
            "pf-orch-lane-frame--flash": flashChat() === p.chatId,
            "pf-orch-lane-frame--dragging": dragChat() === p.chatId,
          }}
        >
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
      <For each={liveLanes()}>
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

  const SwarmDashboard = () => (
    <Show when={projectSwarms().length > 0}>
      <div class="pf-orch-card">
        <div class="pf-orch-swarm-head">
          <MonoEyebrow text="Swarms" />
          <span class="pf-orch-swarm-count">{projectSwarms().length}</span>
        </div>
        <div class="pf-orch-swarm-list">
          <For each={projectSwarms()}>
            {(run) => (
              <div class="pf-orch-swarm">
                <div class="pf-orch-swarm-top">
                  <span
                    class="pf-orch-status"
                    style={{ "--pf-status": run.status === "failed" ? "var(--pf-error)" : "var(--pf-info)" }}
                  >
                    <span class="pf-orch-status-dot" />
                    {run.status}
                  </span>
                  <span class="pf-orch-swarm-title">{run.mode} · {run.requestedCount}</span>
                </div>
                <div class="pf-orch-swarm-goal">{run.goal}</div>
                <div class="pf-orch-swarm-lanes">
                  <For each={run.lanes}>
                    {(lane) => (
                      <span class="pf-orch-swarm-lane">
                        {lane.provider === "codex" ? "CX" : "CC"} · {lane.status}
                      </span>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
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
            <div class="pf-orch-card">
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
            </div>
            <SwarmDashboard />
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
          when={liveLanes().length > 0}
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
              <Show when={liveLanes().length > 1}>
                <div class="pf-orch-layout-toggle" role="group" aria-label="Lane layout">
                  <button
                    class="pf-orch-layout-btn"
                    classList={{ "pf-orch-layout-btn--on": preset() === "columns" }}
                    title="Columns"
                    onClick={() => applyLiveLayoutPreset("columns")}
                  >
                    <IconSplit dir="left" size={13} />
                  </button>
                  <button
                    class="pf-orch-layout-btn"
                    classList={{ "pf-orch-layout-btn--on": preset() === "rows" }}
                    title="Rows"
                    onClick={() => applyLiveLayoutPreset("rows")}
                  >
                    <IconSplit dir="up" size={13} />
                  </button>
                  <button
                    class="pf-orch-layout-btn"
                    classList={{ "pf-orch-layout-btn--on": preset() === "grid" }}
                    title="Grid"
                    onClick={() => applyLiveLayoutPreset("grid")}
                  >
                    <IconGrid size={13} />
                  </button>
                </div>
              </Show>
              <Show when={liveLanes().length < MAX_LANES}>
                <button class="pf-orch-add-lane" onClick={openAddMenu}>
                  <IconPlus size={13} /> Add lane
                </button>
              </Show>
            </div>
          </div>
          {/* Free-form binary split canvas: lanes are absolutely positioned from
              the computed layout so a rearranged lane is repositioned, never
              remounted (AgentChatView keeps its composer/scroll). */}
          <div class="pf-orch-grid" ref={(el) => (gridEl = el)}>
            <For each={liveLanes()}>{(chatId) => <Lane chatId={chatId} />}</For>

            {/* draggable seams */}
            <For each={layout().divs}>
              {(d) => (
                <div
                  class="pf-orch-divider"
                  classList={{
                    "pf-orch-divider--row": d.dir === "row",
                    "pf-orch-divider--col": d.dir === "col",
                  }}
                  style={
                    d.dir === "row"
                      ? { left: pct(d.rect.x), top: pct(d.rect.y), height: pct(d.rect.h) }
                      : { left: pct(d.rect.x), top: pct(d.rect.y), width: pct(d.rect.w) }
                  }
                  onPointerDown={(e) => startRatioDrag(e, d)}
                >
                  <span class="pf-orch-divider-grip" />
                </div>
              )}
            </For>

            {/* drop indicator: highlights the side/centre the dragged lane lands */}
            <Show when={drop()}>
              {(d) => {
                const r = () => layout().map.get(d().chatId);
                return (
                  <Show when={r()}>
                    <div
                      class="pf-orch-drop"
                      style={{
                        left: pct(r()!.x),
                        top: pct(r()!.y),
                        width: pct(r()!.w),
                        height: pct(r()!.h),
                      }}
                    >
                      <div class={`pf-orch-drop-zone pf-orch-drop-zone--${d().region}`} />
                    </div>
                  </Show>
                );
              }}
            </Show>
          </div>
        </Show>
      </div>

      <Show when={activeSplitMenu()}>
        {(menu) => (
          <FloatingMenu
            anchor={{ x: menu().x, y: menu().y, align: "end" }}
            onClose={() => setSplitMenu(null)}
          >
            <div class="pf-menu-label">New lane beside</div>
            <div class="pf-orch-split-grid">
              <For each={SPLIT_TILES}>
                {(tile) => (
                  <button
                    class="pf-orch-split-tile"
                    onClick={() => pickSplitDir(menu().chatId, tile.dir, menu().x, menu().y)}
                  >
                    <IconSplit dir={tile.dir} size={26} />
                    <span class="pf-orch-split-tile-label">{tile.label}</span>
                  </button>
                )}
              </For>
            </div>
          </FloatingMenu>
        )}
      </Show>

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
                <Show when={loadAskChatTitle()}>
                  <input
                    class="pf-menu-input"
                    placeholder="Title (optional)"
                    value={newLaneTitle()}
                    ref={(el) => setTimeout(() => el.focus())}
                    onInput={(e) => setNewLaneTitle(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createLane(loadLastAgentProvider(), newLaneTitle());
                      }
                    }}
                  />
                </Show>
                <For each={AGENT_PROVIDERS}>
                  {(agent) => (
                    <button
                      class="pf-menu-item"
                      onClick={() => void createLane(agent.id, newLaneTitle())}
                    >
                      {agent.label}
                    </button>
                  )}
                </For>
              </Match>
            </Switch>
          </FloatingMenu>
        )}
      </Show>

      <Show when={activeHandoff()}>
        {(menu) => (
          <FloatingMenu anchor={{ x: menu().x, y: menu().y, align: "end" }} onClose={() => setHandoff(null)}>
            <Switch>
              <Match when={menu().mode === "root"}>
                <button
                  class="pf-menu-item"
                  onClick={() => {
                    const id = menu().source;
                    setHandoff(null);
                    setRenamingLane(id);
                  }}
                >
                  Rename chat…
                </button>
                <div class="pf-menu-sep" />
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
