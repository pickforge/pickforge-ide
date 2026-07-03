import { type JSX, Show, createSignal } from "solid-js";
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
  return (
    <HairlinePanel class="pf-chat-card pf-chat-command">
      <div class="pf-chat-command-head">
        <span class="pf-chat-command-glyph" aria-hidden="true">
          $
        </span>
        <code class="pf-chat-command-line">{props.command}</code>
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
      <Show when={props.outputTail && open()}>
        <pre class="pf-chat-tail">{props.outputTail}</pre>
      </Show>
    </HairlinePanel>
  );
}
