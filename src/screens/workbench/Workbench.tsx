// The 3-pane workbench: projects/chats/files | terminals | inspector.
// Each chat owns its own terminal host (its own panes/shells). Visited hosts
// stay mounted (visibility toggled) so switching chats/projects never kills a
// running shell; a host is disposed only when its chat is deleted.
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ProjectsChatsPanel } from "./ProjectsChatsPanel";
import { FileExplorer } from "./FileExplorer";
import { InspectorPanel } from "./InspectorPanel";
import {
  TerminalHost,
  type TerminalHostHandle,
} from "../../components/TerminalHost";
import { Chip, ForgeEmptyState, MonoEyebrow } from "../../components/ui";
import { IconGear, IconTerminal } from "../../components/icons";
import { detectBinaries } from "../../lib/process";
import {
  binaryForItem,
  commandForItem,
  hotkeyMatches,
  quickLaunchItems,
} from "../../stores/quickLaunch";
import { onChatDeleted, workspace } from "../../stores/workspace";
import { navigate, route } from "../../router";
import "./workbench.css";

interface MountedHost {
  chatId: string;
  projectRoot: string;
}

export function WorkbenchScreen() {
  const [mounted, setMounted] = createSignal<MountedHost[]>([]);
  const [available, setAvailable] = createSignal<Record<string, boolean>>({});
  const handles = new Map<string, TerminalHostHandle>();

  const typeToActive = (text: string) => {
    if (!text) return;
    handles.get(workspace.activeChatId ?? "")?.typeToFocused(text);
  };

  // Mount a host the first time its chat becomes active; keep it after.
  createEffect(() => {
    const id = workspace.activeChatId;
    if (!id || mounted().some((m) => m.chatId === id)) return;
    const chat = workspace.chats.find((c) => c.chatId === id);
    if (chat) setMounted([...mounted(), { chatId: id, projectRoot: chat.projectRoot }]);
  });

  onMount(() => {
    // Wire listeners + cleanup synchronously so they bind to this scope even if
    // the async detection below is still pending when the screen is disposed.

    // Tear down a chat's host (and shells) only when the chat is deleted.
    const offDelete = onChatDeleted((chatId) => {
      setMounted((m) => m.filter((h) => h.chatId !== chatId));
      handles.delete(chatId);
    });

    // Global quick-launch hotkeys. Capture phase so they win over the shell;
    // ignored while typing in a real form field (but not in the terminal).
    const onKey = (e: KeyboardEvent) => {
      if (route() !== "workbench") return; // hotkeys only act on the workbench
      const t = e.target as HTMLElement | null;
      const inXterm = !!t?.closest?.(".xterm");
      const inField =
        !inXterm &&
        !!t?.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        );
      if (inField) return;
      for (const item of quickLaunchItems()) {
        if (hotkeyMatches(e, item.hotkey)) {
          e.preventDefault();
          e.stopPropagation();
          typeToActive(commandForItem(item));
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey, true);

    onCleanup(() => {
      offDelete();
      window.removeEventListener("keydown", onKey, true);
    });

    // Binary availability for chip gating — async, fire-and-forget.
    void (async () => {
      const bins = [
        ...new Set(quickLaunchItems().map(binaryForItem).filter(Boolean) as string[]),
      ];
      if (!bins.length) return;
      try {
        const result = await detectBinaries(bins);
        const map: Record<string, boolean> = {};
        bins.forEach((b, i) => (map[b] = result[i]));
        setAvailable(map);
      } catch (err) {
        console.error("[pickforge] detect_binaries failed", err);
      }
    })();
  });

  return (
    <div class="pf-workbench">
      <aside class="pf-workbench-left pf-reveal" style={{ "--pf-reveal-delay": "70ms" }}>
        <ProjectsChatsPanel />
        <FileExplorer />
        <div class="pf-rail-footer">
          <span class="pf-rail-copy">© PICKFORGE · MIT</span>
          <button
            class="pf-icon-btn"
            title="Settings"
            onClick={() => navigate("settings")}
          >
            <IconGear size={15} />
          </button>
        </div>
      </aside>

      <main class="pf-workbench-center pf-reveal">
        <div class="pf-launch">
          <MonoEyebrow text="Quick launch" tick />
          <div class="pf-chips">
            <For each={quickLaunchItems()}>
              {(item, i) => {
                const bin = binaryForItem(item);
                return (
                  <Chip
                    label={item.label}
                    ember={i() === 0}
                    disabled={bin ? available()[bin] === false : false}
                    onClick={() => typeToActive(commandForItem(item))}
                  />
                );
              }}
            </For>
          </div>
        </div>

        <div class="pf-workbench-terminal">
          {/* All visited chats stay mounted; only the active one is shown. */}
          <For each={mounted()}>
            {(h) => (
              <div
                class="pf-term-slot"
                style={{ display: workspace.activeChatId === h.chatId ? "block" : "none" }}
              >
                <TerminalHost
                  cwd={h.projectRoot}
                  onReady={(handle) => handles.set(h.chatId, handle)}
                />
              </div>
            )}
          </For>
          <Show when={workspace.loaded && !workspace.activeChatId}>
            <div class="pf-term-empty">
              <ForgeEmptyState
                glyph={<IconTerminal size={28} />}
                eyebrow="Terminal"
                title="No chat open"
                hint="Create or select a chat to open a shell in its project."
              />
            </div>
          </Show>
        </div>
      </main>

      <aside class="pf-workbench-right pf-reveal" style={{ "--pf-reveal-delay": "140ms" }}>
        <InspectorPanel />
      </aside>
    </div>
  );
}
