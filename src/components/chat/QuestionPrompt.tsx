import { type JSX, For, Show, createMemo, createSignal } from "solid-js";
import {
  type AgentApproval,
  type AgentApprovalAnswers,
  type AgentApprovalQuestion,
} from "../../stores/agentChat";
import { type AgentApprovalDecision } from "../../lib/agentChat";
import { MonoEyebrow } from "../ui";
import "./chat.css";

/** The label the CLI uses for a free-text answer, mirrored here so an agent
 *  reading the answer sees the same shape it would from the CLI. */
const OTHER = "Other";

/** Multi-select answers travel as one ", "-joined string — the tool expects a
 *  string per question, not an array. Kept here rather than in the caller so
 *  the joining rule lives next to the selection state that produces it. */
function joinSelections(labels: string[]): string {
  return labels.join(", ");
}

function QuestionBlock(props: {
  question: AgentApprovalQuestion;
  selected: string[];
  other: string;
  notes: string;
  onToggle: (label: string) => void;
  onOther: (value: string) => void;
  onNotes: (value: string) => void;
}): JSX.Element {
  const q = () => props.question;
  const isOn = (label: string) => props.selected.includes(label);
  return (
    <fieldset class="pf-question">
      <legend class="pf-question-legend">
        <Show when={q().header}>
          {(header) => <MonoEyebrow text={header()} tick />}
        </Show>
        <span class="pf-question-text">{q().question}</span>
      </legend>
      <div class="pf-question-options" role={q().multiSelect ? "group" : "radiogroup"}>
        <For each={q().options}>
          {(option) => (
            <button
              type="button"
              class="pf-question-option"
              classList={{ "pf-question-option--on": isOn(option.label) }}
              role={q().multiSelect ? "checkbox" : "radio"}
              aria-checked={isOn(option.label)}
              onClick={() => props.onToggle(option.label)}
            >
              <span class="pf-question-mark" aria-hidden="true">
                {isOn(option.label) ? "[x]" : "[ ]"}
              </span>
              <span class="pf-question-option-body">
                <span class="pf-question-option-label">{option.label}</span>
                <Show when={option.description}>
                  {(description) => (
                    <span class="pf-question-option-desc">{description()}</span>
                  )}
                </Show>
              </span>
            </button>
          )}
        </For>
        <button
          type="button"
          class="pf-question-option"
          classList={{ "pf-question-option--on": isOn(OTHER) }}
          role={q().multiSelect ? "checkbox" : "radio"}
          aria-checked={isOn(OTHER)}
          onClick={() => props.onToggle(OTHER)}
        >
          <span class="pf-question-mark" aria-hidden="true">
            {isOn(OTHER) ? "[x]" : "[ ]"}
          </span>
          <span class="pf-question-option-body">
            <span class="pf-question-option-label">{OTHER}</span>
          </span>
        </button>
      </div>
      <Show when={isOn(OTHER)}>
        <input
          class="pf-question-input"
          type="text"
          placeholder="Your answer"
          aria-label={`${q().question} — other`}
          value={props.other}
          onInput={(event) => props.onOther(event.currentTarget.value)}
        />
      </Show>
      <input
        class="pf-question-input pf-question-notes"
        type="text"
        placeholder="Notes (optional)"
        aria-label={`${q().question} — notes`}
        value={props.notes}
        onInput={(event) => props.onNotes(event.currentTarget.value)}
      />
    </fieldset>
  );
}

/** An `AskUserQuestion` rendered as the question it is, rather than the generic
 *  Allow/Deny prompt that made it unanswerable (#364). Submitting sends real
 *  answers keyed by question text; declining routes to the model so it can
 *  rephrase instead of failing the turn. */
export function QuestionPrompt(props: {
  approval: AgentApproval;
  onDecide: (
    approvalId: string,
    decision: AgentApprovalDecision,
    answers?: AgentApprovalAnswers,
  ) => void;
}): JSX.Element {
  const questions = () => props.approval.parsed?.questions ?? [];
  const [selected, setSelected] = createSignal<Record<string, string[]>>({});
  const [other, setOther] = createSignal<Record<string, string>>({});
  const [notes, setNotes] = createSignal<Record<string, string>>({});

  const toggle = (question: AgentApprovalQuestion, label: string) => {
    setSelected((current) => {
      const existing = current[question.question] ?? [];
      if (!question.multiSelect) {
        return { ...current, [question.question]: existing.includes(label) ? [] : [label] };
      }
      return {
        ...current,
        [question.question]: existing.includes(label)
          ? existing.filter((entry) => entry !== label)
          : [...existing, label],
      };
    });
  };

  /** A question counts as answered when it has a selection, and — if that
   *  selection is Other — some free text to go with it. */
  const answerFor = (question: AgentApprovalQuestion): string | null => {
    const picks = selected()[question.question] ?? [];
    if (picks.length === 0) return null;
    const text = (other()[question.question] ?? "").trim();
    const resolved = picks.map((pick) => (pick === OTHER ? text : pick)).filter(Boolean);
    if (resolved.length !== picks.length) return null;
    return joinSelections(resolved);
  };

  const complete = createMemo(() => questions().every((q) => answerFor(q) !== null));

  const submit = () => {
    const answers: Record<string, string> = {};
    const annotations: Record<string, { preview?: string; notes?: string }> = {};
    for (const question of questions()) {
      const answer = answerFor(question);
      // Never send an empty-string answer: the tool treats an absent key and a
      // blank one differently, and a blank one reads as a real reply.
      if (answer === null || answer.length === 0) continue;
      answers[question.question] = answer;
      const note = (notes()[question.question] ?? "").trim();
      if (note) annotations[question.question] = { notes: note };
    }
    props.onDecide(props.approval.approvalId, "accept", {
      answers,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    });
  };

  return (
    <div class="pf-approval pf-approval--question">
      <MonoEyebrow text="Question" tick />
      <For each={questions()}>
        {(question) => (
          <QuestionBlock
            question={question}
            selected={selected()[question.question] ?? []}
            other={other()[question.question] ?? ""}
            notes={notes()[question.question] ?? ""}
            onToggle={(label) => toggle(question, label)}
            onOther={(value) =>
              setOther((current) => ({ ...current, [question.question]: value }))
            }
            onNotes={(value) =>
              setNotes((current) => ({ ...current, [question.question]: value }))
            }
          />
        )}
      </For>
      <div class="pf-approval-actions">
        <button
          type="button"
          class="pf-approval-btn pf-approval-btn--primary"
          disabled={!complete()}
          title={complete() ? undefined : "Answer every question first"}
          onClick={submit}
        >
          Send answers
        </button>
        <button
          type="button"
          class="pf-approval-btn"
          onClick={() => props.onDecide(props.approval.approvalId, "decline")}
        >
          Ask differently
        </button>
        <button
          type="button"
          class="pf-approval-btn pf-approval-btn--quiet"
          onClick={() => props.onDecide(props.approval.approvalId, "cancel")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
