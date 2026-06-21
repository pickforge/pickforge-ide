// "Ask AI" popup for selected terminal text — mirrors the widget inspector's
// Ask-AI flow: pick an agent, choose a preset (fix / explain) or a custom
// prompt, and launch it in a new pane of the active chat with the selection as
// context. Positioned at the selection via the shared FloatingMenu.
import { createSignal, For, Show } from "solid-js";
import { FloatingMenu } from "./FloatingMenu";
import { MonoEyebrow } from "./ui";
import {
  commandForItem,
  isAskAiItem,
  quickLaunchItems,
  type QuickLaunchItem,
} from "../stores/quickLaunch";
import { getTerminalHost } from "../stores/terminalHosts";
import { workspace } from "../stores/workspace";
import { armChatAutoName } from "../lib/chatAutoName";
import { shquote } from "../lib/runTargets";
import "./AskAiMenu.css";

export interface TerminalSelection {
  text: string;
  x: number;
  y: number;
}

export function AskAiMenu(props: {
  selection: TerminalSelection;
  onClose: () => void;
}) {
  const agents = () => quickLaunchItems().filter(isAskAiItem);
  const [agent, setAgent] = createSignal<QuickLaunchItem | undefined>(agents()[0]);
  const [custom, setCustom] = createSignal(false);
  const [prompt, setPrompt] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const snippet = () => {
    const t = props.selection.text.replace(/\s+/g, " ").trim();
    return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  };

  const launch = (instruction: string) => {
    const a = agent();
    if (!a || !instruction.trim()) return;
    const host = getTerminalHost(workspace.activeChatId);
    if (!host) {
      setError("Open a chat first so the agent has a terminal.");
      return;
    }
    // Cap the embedded selection so a huge scrollback grab can't exceed the OS
    // per-argument limit (Linux MAX_ARG_STRLEN ~128 KB) and fail the launch.
    const MAX_SEL = 16000;
    const raw = props.selection.text;
    const clipped =
      raw.length > MAX_SEL ? `${raw.slice(0, MAX_SEL)}\n…[selection truncated]` : raw;
    const ask =
      `${instruction.trim()}\n\nSelected from the PickForge run console:\n\n` +
      "```\n" +
      clipped +
      "\n```";
    const paneId = host.openInNewPane(`${commandForItem(a)} ${shquote(ask)}`);
    if (paneId) armChatAutoName(workspace.activeChatId, paneId);
    props.onClose();
  };

  return (
    <FloatingMenu
      anchor={{ x: props.selection.x, y: props.selection.y }}
      onClose={props.onClose}
    >
      <div class="pf-askai">
        <MonoEyebrow text="Ask AI" tick />
        <div class="pf-askai-snip">{snippet()}</div>
        <Show
          when={agents().length > 0}
          fallback={<div class="pf-askai-empty">No AI agents configured.</div>}
        >
          <div class="pf-askai-agents">
            <For each={agents()}>
              {(a) => (
                <button
                  type="button"
                  class="pf-askai-agent"
                  classList={{ "pf-askai-agent--on": agent()?.id === a.id }}
                  onClick={() => setAgent(a)}
                >
                  {a.label}
                </button>
              )}
            </For>
          </div>
          <Show
            when={custom()}
            fallback={
              <div class="pf-askai-presets">
                <button type="button" class="pf-askai-preset" onClick={() => launch("Fix this:")}>
                  Fix this
                </button>
                <button type="button" class="pf-askai-preset" onClick={() => launch("Explain this:")}>
                  Explain this
                </button>
                <button type="button" class="pf-askai-preset" onClick={() => setCustom(true)}>
                  Ask…
                </button>
              </div>
            }
          >
            <div class="pf-askai-custom">
              <textarea
                class="pf-askai-input"
                placeholder="Ask about the selection…"
                rows={2}
                autofocus
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    launch(prompt());
                  }
                }}
              />
              <button
                type="button"
                class="pf-askai-send"
                disabled={!prompt().trim()}
                onClick={() => launch(prompt())}
              >
                Send
              </button>
            </div>
          </Show>
        </Show>
        <Show when={error()}>
          <div class="pf-askai-err">{error()}</div>
        </Show>
      </div>
    </FloatingMenu>
  );
}
