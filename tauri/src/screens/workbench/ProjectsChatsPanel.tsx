// Left-rail projects + chats list, backed by the workspace store.
import { For, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { MonoEyebrow } from "../../components/ui";
import {
  addChat,
  addProject,
  archiveProject,
  deleteChat,
  selectChat,
  selectProject,
  workspace,
} from "../../stores/workspace";
import "./workbench.css";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}

async function pickProject() {
  const dir = await open({ directory: true, title: "Add a project" });
  if (typeof dir === "string") await addProject(dir, basename(dir));
}

export function ProjectsChatsPanel() {
  return (
    <div class="pf-rail">
      <section class="pf-rail-section pf-rail-projects">
        <div class="pf-rail-head">
          <MonoEyebrow text="Projects" tick />
          <button class="pf-icon-btn" title="Add project" onClick={pickProject}>
            +
          </button>
        </div>
        <div class="pf-rail-list">
          <Show
            when={workspace.projects.length > 0}
            fallback={<div class="pf-rail-empty">No projects yet</div>}
          >
            <For each={workspace.projects}>
              {(project) => (
                <div
                  class="pf-rail-row"
                  classList={{ active: workspace.activeRoot === project.projectRoot }}
                  onClick={() => selectProject(project.projectRoot)}
                >
                  <span class="pf-rail-row-label">{project.displayName}</span>
                  <button
                    class="pf-rail-row-action"
                    title="Archive"
                    onClick={(e) => {
                      e.stopPropagation();
                      void archiveProject(project.projectRoot);
                    }}
                  >
                    ⌫
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>

      <section class="pf-rail-section pf-rail-chats">
        <div class="pf-rail-head">
          <MonoEyebrow text="Chats" tick />
          <button
            class="pf-icon-btn"
            title="New chat"
            disabled={!workspace.activeRoot}
            onClick={() => addChat("New chat", "claudeCode")}
          >
            +
          </button>
        </div>
        <div class="pf-rail-list">
          <Show
            when={workspace.chats.length > 0}
            fallback={<div class="pf-rail-empty">No chats</div>}
          >
            <For each={workspace.chats}>
              {(chat) => (
                <div
                  class="pf-rail-row"
                  classList={{ active: workspace.activeChatId === chat.chatId }}
                  onClick={() => selectChat(chat.chatId)}
                >
                  <span class="pf-rail-row-label">{chat.title}</span>
                  <button
                    class="pf-rail-row-action"
                    title="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteChat(chat.chatId);
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>
    </div>
  );
}
