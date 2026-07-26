import { type JSX, Show, createSignal } from "solid-js";
import { compactInline, hasHiddenDetail } from "../../lib/chatDisplay";
import { IconChevronRight } from "../icons";
import { Disclosure, StatusPill, type StatusIntent } from "../ui";
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
  open?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  const toggle = () => (props.onToggle ? props.onToggle() : setLocalOpen((v) => !v));
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
        onClick={() => canExpand() && toggle()}
      >
        <span class="pf-chat-line-chevron" aria-hidden="true">
          <Show when={canExpand()} fallback={<span class="pf-chat-line-chevron-spacer" />}>
            <IconChevronRight size={12} />
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
      <Disclosure open={open()}>
        <div class="pf-chat-line-body">
          <Show when={hasHiddenCommand()}>
            <pre class="pf-chat-tail">{props.command}</pre>
          </Show>
          <Show when={props.outputTail}>
            <pre class="pf-chat-tail">{props.outputTail}</pre>
          </Show>
        </div>
      </Disclosure>
    </div>
  );
}
