import { type JSX, For, Show, onCleanup, onMount } from "solid-js";
import { type AgentTimelineItem } from "../../stores/agentChat";
import { ForgeEmptyState } from "../ui";
import { ChatBubble } from "./ChatBubble";
import { ThinkingBubble } from "./ThinkingBubble";
import { CommandCard } from "./CommandCard";
import { FileChangeCard } from "./FileChangeCard";
import { ToolUseCard } from "./ToolUseCard";
import { McpCard } from "./McpCard";
import { WebSearchCard } from "./WebSearchCard";
import { PlanCard } from "./PlanCard";
import { TokenBadge } from "./TokenBadge";
import "./chat.css";

function EmptyGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path
        d="M4 5h16v11H9l-5 4V5Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function renderItem(item: AgentTimelineItem): JSX.Element {
  switch (item.type) {
    case "userMessage":
      return <ChatBubble role="user" text={item.text} images={item.images} />;
    case "assistantText":
      return <ChatBubble role="assistant" text={item.text} streaming={item.streaming} />;
    case "thinking":
      return <ThinkingBubble text={item.text} streaming={item.streaming} />;
    case "command":
      return (
        <CommandCard
          command={item.command}
          status={item.status}
          exitCode={item.exitCode}
          outputTail={item.outputTail}
        />
      );
    case "fileChange":
      return <FileChangeCard changes={item.changes} />;
    case "toolUse":
      return <ToolUseCard name={item.name} detail={item.detail} />;
    case "mcpToolCall":
      return <McpCard server={item.server} tool={item.tool} />;
    case "webSearch":
      return <WebSearchCard query={item.query} />;
    case "plan":
      return <PlanCard items={item.items} />;
    case "usage":
      return (
        <TokenBadge
          inputTokens={item.inputTokens}
          cachedInputTokens={item.cachedInputTokens}
          outputTokens={item.outputTokens}
          costUsd={item.costUsd}
          estimatedCostUsd={item.estimatedCostUsd}
        />
      );
  }
}

export function ChatTimeline(props: { items: AgentTimelineItem[] }): JSX.Element {
  let scroller!: HTMLDivElement;
  let content!: HTMLDivElement;
  let nearBottom = true;
  const THRESHOLD = 96;

  const pin = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };

  const onScroll = () => {
    nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < THRESHOLD;
  };

  onMount(() => {
    pin();
    const observer = new ResizeObserver(() => {
      if (nearBottom) pin();
    });
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="pf-chat-timeline" ref={scroller} onScroll={onScroll}>
      <div class="pf-chat-timeline-inner" ref={content}>
        <Show
          when={props.items.length > 0}
          fallback={
            <ForgeEmptyState
              glyph={<EmptyGlyph />}
              eyebrow="Agent"
              title="No messages yet"
              hint="Send a message to start the conversation."
            />
          }
        >
          <For each={props.items}>{(item) => renderItem(item)}</For>
        </Show>
      </div>
    </div>
  );
}
