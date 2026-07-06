import { type JSX, Show, createSignal } from "solid-js";
import { compactInline, singleLine } from "../../lib/chatDisplay";
import { HairlinePanel, StatusPill, type StatusIntent } from "../ui";
import "./chat.css";

type CommandStatus = "running" | "completed" | "failed" | "interrupted";

const STATUS_INTENT: Record<CommandStatus, StatusIntent> = {
  running: "warning",
  completed: "connected",
  failed: "error",
  interrupted: "neutral",
};

export function CommandCard(props: {
  command: string;
  status: CommandStatus;
  exitCode: number | null;
  outputTail: string | null;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [commandOpen, setCommandOpen] = createSignal(false);
  const commandSummary = () => compactInline(props.command, 132);
  const hasHiddenCommand = () => commandSummary() !== singleLine(props.command);

  return (
    <HairlinePanel class="pf-chat-card pf-chat-command">
      <div class="pf-chat-command-head">
        <span class="pf-chat-command-glyph" aria-hidden="true">
          $
        </span>
        <code class="pf-chat-command-line" title={props.command}>
          {commandSummary()}
        </code>
        <StatusPill
          label={props.status}
          intent={STATUS_INTENT[props.status]}
          pulsing={props.status === "running"}
        />
      </div>
      <div class="pf-chat-command-foot">
        <Show when={props.exitCode !== null}>
          <span class="pf-chat-meta">exit {props.exitCode}</span>
        </Show>
        <Show when={hasHiddenCommand()}>
          <button
            type="button"
            class="pf-chat-tail-toggle"
            aria-expanded={commandOpen()}
            onClick={() => setCommandOpen((v) => !v)}
          >
            {commandOpen() ? "Hide command" : "Show command"}
          </button>
        </Show>
        <Show when={props.outputTail}>
          <button
            type="button"
            class="pf-chat-tail-toggle"
            aria-expanded={open()}
            onClick={() => setOpen((v) => !v)}
          >
            {open() ? "Hide output" : "Show output"}
          </button>
        </Show>
      </div>
      <Show when={commandOpen()}>
        <pre class="pf-chat-tail">{props.command}</pre>
      </Show>
      <Show when={props.outputTail && open()}>
        <pre class="pf-chat-tail">{props.outputTail}</pre>
      </Show>
    </HairlinePanel>
  );
}
