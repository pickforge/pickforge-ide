// Chats pane body: chat list with three-dots + right-click menus, inline rename,
// archive/restore, and drag-to-reorder (persisted via sort_order).
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { FloatingMenu } from "../../components/FloatingMenu";
import { IconChevronDown, IconChevronRight, IconMore, IconPlus } from "../../components/icons";
import {
  addChat,
  deleteChat,
  renameChat,
  reorderChat,
  selectChat,
  workspace,
} from "../../stores/workspace";
import { archiveChat, isChatArchived, unarchiveChat } from "../../stores/chatArchive";

const CHAT_MIME = "application/x-pf-chat";

interface MenuState { id: string; x: number; y: number; align: "start" | "end" }

export function ChatsPane() {
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [showArchived, setShowArchived] = createSignal(false);
  const [dropOn, setDropOn] = createSignal<string | null>(null);

  const closeMenu = () => setMenu(null);
  onCleanup(closeMenu);

  const visible = createMemo(() => workspace.chats.filter((c) => !isChatArchived(c.chatId)));
  const archived = createMemo(() => workspace.chats.filter((c) => isChatArchived(c.chatId)));

  const openFromButton = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu((m) => (m?.id === id ? null : { id, x: r.right, y: r.bottom + 4, align: "end" }));
  };
  const openFromContext = (id: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY, align: "start" });
  };

  const doArchive = (id: string) => {
    archiveChat(id);
    if (workspace.activeChatId === id) {
      const next = visible().find((c) => c.chatId !== id);
      selectChat(next?.chatId ?? null);
    }
    closeMenu();
  };

  const allowDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(CHAT_MIME)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }
  };
  const drop = (beforeId: string | null, e: DragEvent) => {
    const id = e.dataTransfer?.getData(CHAT_MIME);
    setDropOn(null);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    void reorderChat(id, beforeId);
  };

  const RenameField = (props: { value: string; commit: (v: string) => void }) => (
    <input
      class="pf-input pf-rename"
      value={props.value}
      ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => { props.commit(e.currentTarget.value); setRenaming(null); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { props.commit(e.currentTarget.value); setRenaming(null); }
        else if (e.key === "Escape") setRenaming(null);
      }}
    />
  );

  const ChatMenu = (p: { id: string }) => (
    <>
      <button class="pf-menu-item" onClick={() => { selectChat(p.id); closeMenu(); }}>Open</button>
      <button class="pf-menu-item" onClick={() => { setRenaming(p.id); closeMenu(); }}>Rename</button>
      <button class="pf-menu-item" onClick={() => doArchive(p.id)}>Archive</button>
      <div class="pf-menu-sep" />
      <button class="pf-menu-item pf-menu-item--danger" onClick={() => { void deleteChat(p.id); closeMenu(); }}>Delete</button>
    </>
  );

  const ChatRow = (p: { chat: { chatId: string; title: string }; archived?: boolean }) => {
    const id = p.chat.chatId;
    return (
      <div
        class="pf-rail-row"
        classList={{
          active: workspace.activeChatId === id,
          "pf-rail-row--archived": p.archived,
          "pf-drop-target": dropOn() === id,
        }}
        draggable={!p.archived}
        onDragStart={(e) => {
          e.dataTransfer?.setData(CHAT_MIME, id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={p.archived ? undefined : (e) => { allowDrop(e); setDropOn(id); }}
        onDragLeave={() => setDropOn((d) => (d === id ? null : d))}
        onDrop={p.archived ? undefined : (e) => drop(id, e)}
        onClick={() => !p.archived && selectChat(id)}
        onContextMenu={(e) => !p.archived && openFromContext(id, e)}
      >
        <Show when={renaming() === id} fallback={<span class="pf-rail-row-label">{p.chat.title}</span>}>
          <RenameField value={p.chat.title} commit={(v) => void renameChat(id, v)} />
        </Show>
        <Show
          when={!p.archived}
          fallback={
            <button class="pf-rail-row-action pf-rail-row-action--shown" title="Unarchive chat" onClick={(e) => { e.stopPropagation(); unarchiveChat(id); }}>
              <IconPlus size={13} />
            </button>
          }
        >
          <button class="pf-rail-row-action" title="Chat options" onClick={(e) => openFromButton(id, e)}>
            <IconMore size={14} />
          </button>
        </Show>
      </div>
    );
  };

  return (
    <div class="pf-pane-scroll">
      <div class="pf-pane-toolbar pf-pane-toolbar--end">
        <button class="pf-icon-btn" title="New chat" disabled={!workspace.activeRoot} onClick={() => addChat("New chat", "claudeCode")}>
          <IconPlus />
        </button>
      </div>
      <div class="pf-rail-list" onDragOver={allowDrop} onDrop={(e) => drop(null, e)}>
        <Show when={visible().length > 0} fallback={<div class="pf-rail-empty">No chats</div>}>
          <For each={visible()}>{(chat) => <ChatRow chat={chat} />}</For>
        </Show>
        <Show when={archived().length > 0}>
          <button class="pf-rail-archived-toggle" onClick={() => setShowArchived((s) => !s)}>
            <Show when={showArchived()} fallback={<IconChevronRight size={12} />}>
              <IconChevronDown size={12} />
            </Show>
            Archived
            <span class="pf-group-count">{archived().length}</span>
          </button>
          <Show when={showArchived()}>
            <For each={archived()}>{(chat) => <ChatRow chat={chat} archived />}</For>
          </Show>
        </Show>
      </div>

      <Show when={menu()}>
        {(m) => (
          <FloatingMenu anchor={{ x: m().x, y: m().y, align: m().align }} onClose={closeMenu}>
            <ChatMenu id={m().id} />
          </FloatingMenu>
        )}
      </Show>
    </div>
  );
}
