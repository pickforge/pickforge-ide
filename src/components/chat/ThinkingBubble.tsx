import { type JSX, Show, createSignal } from "solid-js";
import { Collapse, MonoEyebrow } from "../ui";
import "./chat.css";

export function ThinkingBubble(props: {
  text: string;
  streaming?: boolean;
  open?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  const toggle = () => (props.onToggle ? props.onToggle() : setLocalOpen((v) => !v));
  return (
    <div class="pf-chat-thinking">
      <button
        type="button"
        class="pf-chat-thinking-toggle"
        aria-expanded={open()}
        onClick={toggle}
      >
        <MonoEyebrow text="Thinking" />
        <Show when={props.streaming}>
          <span class="pf-chat-working" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </Show>
        <span
          class="pf-chat-thinking-chevron"
          classList={{ "pf-chat-thinking-chevron--open": open() }}
          aria-hidden="true"
        />
      </button>
      <Collapse open={open()}>
        <div class="pf-chat-thinking-body">{props.text}</div>
      </Collapse>
    </div>
  );
}
