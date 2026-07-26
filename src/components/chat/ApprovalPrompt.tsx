import { type JSX, For, Show } from "solid-js";
import {
  type AgentApproval,
  type AgentApprovalAnswers,
} from "../../stores/agentChat";
import { type AgentApprovalDecision } from "../../lib/agentChat";
import { MonoEyebrow } from "../ui";
import { QuestionPrompt } from "./QuestionPrompt";
import "./chat.css";

const KIND_LABEL: Record<AgentApproval["kind"], string> = {
  command: "Command",
  fileChange: "File change",
  toolUse: "Tool",
  question: "Question",
};

function headline(approval: AgentApproval): string {
  return approval.parsed?.command ?? approval.parsed?.toolName ?? approval.detail;
}

function ApprovalRow(props: {
  approval: AgentApproval;
  primary: boolean;
  onDecide: (approvalId: string, decision: AgentApprovalDecision) => void;
}): JSX.Element {
  const decide = (decision: AgentApprovalDecision) =>
    props.onDecide(props.approval.approvalId, decision);
  return (
    <div class="pf-approval">
      <MonoEyebrow text={KIND_LABEL[props.approval.kind]} tick />
      <code class="pf-approval-line">{headline(props.approval)}</code>
      <Show when={props.approval.parsed?.cwd}>
        {(cwd) => <span class="pf-approval-quiet">in {cwd()}</span>}
      </Show>
      <Show when={props.approval.parsed?.reason}>
        {(reason) => <span class="pf-approval-quiet">{reason()}</span>}
      </Show>
      <div class="pf-approval-actions">
        <button
          type="button"
          class="pf-approval-btn"
          classList={{ "pf-approval-btn--primary": props.primary }}
          onClick={() => decide("accept")}
        >
          Allow
        </button>
        <button
          type="button"
          class="pf-approval-btn"
          onClick={() => decide("acceptForSession")}
        >
          Allow for session
        </button>
        <button
          type="button"
          class="pf-approval-btn"
          onClick={() => decide("decline")}
        >
          Deny
        </button>
        <button
          type="button"
          class="pf-approval-btn pf-approval-btn--quiet"
          onClick={() => decide("cancel")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ApprovalPrompt(props: {
  approvals: AgentApproval[];
  onDecide: (
    approvalId: string,
    decision: AgentApprovalDecision,
    answers?: AgentApprovalAnswers,
  ) => void;
}): JSX.Element {
  return (
    <div class="pf-approvals" role="group" aria-label="Pending approvals">
      <For each={props.approvals}>
        {(approval, index) => (
          // A question is not an approval — rendering it as one is what made it
          // unanswerable (#364). Falls back to the generic prompt if the
          // questions could not be parsed, so a malformed payload degrades to
          // the old behaviour instead of an empty card.
          <Show
            when={approval.kind === "question" && (approval.parsed?.questions?.length ?? 0) > 0}
            fallback={
              <ApprovalRow approval={approval} primary={index() === 0} onDecide={props.onDecide} />
            }
          >
            <QuestionPrompt approval={approval} onDecide={props.onDecide} />
          </Show>
        )}
      </For>
    </div>
  );
}
