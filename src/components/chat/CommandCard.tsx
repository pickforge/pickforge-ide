import { type JSX, Show, createSignal } from "solid-js";
import { compactInline, hasHiddenDetail } from "../../lib/chatDisplay";
import { IconChevronDown, IconChevronRight } from "../icons";
import { StatusPill, type StatusIntent } from "../ui";
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
  const commandSummary = () => compactInline(props.command, 132);
  const hasHiddenCommand = () => hasHiddenDetail(props.command, 132);
  const hasOutput = () => Boolean(props.outputTail);
  const canExpand = () => hasHiddenCommand() || hasOutput();

  return (
    <div class="pf-chat-line pf-chat-line--command" classList={{ "pf-chat-line--open": open() }}>
      <button
        type="button"
        class="pf-chat-line-toggle"
        aria-expanded={open()}
        aria-label={open() ? "Hide command details" : "Show command details"}
        disabled={!canExpand()}
        onClick={() => canExpand() && setOpen((v) => !v)}
      >
        <span class="pf-chat-line-chevron" aria-hidden="true">
          <Show when={canExpand()} fallback={<span class="pf-chat-line-chevron-spacer" />}>
            <Show when={open()} fallback={<IconChevronRight size={12} />}>
              <IconChevronDown size={12} />
            </Show>
          </Show>
        </span>
        <span class="pf-chat-line-tag">cmd</span>
        <code class="pf-chat-line-name pf-chat-line-name--command" title={props.command}>
          {commandSummary()}
        </code>
        <span class="pf-chat-line-trail">
          <Show when={props.exitCode !== null}>
            <span class="pf-chat-meta">exit {props.exitCode}</span>
          </Show>
          <StatusPill
            label={props.status}
            intent={STATUS_INTENT[props.status]}
            pulsing={props.status === "running"}
          />
        </span>
      </button>
      <Show when={open()}>
        <div class="pf-chat-line-body">
          <Show when={hasHiddenCommand()}>
            <pre class="pf-chat-tail">{props.command}</pre>
          </Show>
          <Show when={props.outputTail}>
            <pre class="pf-chat-tail">{props.outputTail}</pre>
          </Show>
        </div>
      </Show>
    </div>
  );
}
