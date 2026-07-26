// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

import { QuestionPrompt } from "../../src/components/chat/QuestionPrompt";
import type { AgentApproval, AgentApprovalAnswers } from "../../src/stores/agentChat";
import type { AgentApprovalDecision } from "../../src/lib/agentChat";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

type Decision = {
  approvalId: string;
  decision: AgentApprovalDecision;
  answers?: AgentApprovalAnswers;
};

function approval(questions: NonNullable<NonNullable<AgentApproval["parsed"]>["questions"]>): AgentApproval {
  return {
    approvalId: "req-1",
    kind: "question",
    detail: "{}",
    parsed: { toolName: "AskUserQuestion", questions },
  };
}

function mount(a: AgentApproval) {
  const decisions: Decision[] = [];
  dispose = render(
    () => (
      <QuestionPrompt
        approval={a}
        onDecide={(approvalId, decision, answers) =>
          decisions.push({ approvalId, decision, answers })
        }
      />
    ),
    root,
  );
  return decisions;
}

function options() {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(".pf-question-option"));
}

function optionByLabel(label: string) {
  const found = options().find(
    (el) => el.querySelector(".pf-question-option-label")?.textContent === label,
  );
  if (!found) throw new Error(`no option ${label}`);
  return found;
}

function submitButton() {
  return root.querySelector<HTMLButtonElement>(".pf-approval-btn--primary")!;
}

describe("QuestionPrompt (#364)", () => {
  it("renders each question with its options and descriptions", () => {
    mount(
      approval([
        {
          question: "Which database?",
          header: "DB",
          options: [
            { label: "Postgres", description: "Relational, boring, correct" },
            { label: "SQLite" },
          ],
        },
      ]),
    );

    expect(root.querySelector(".pf-question-text")?.textContent).toBe("Which database?");
    expect(optionByLabel("Postgres").querySelector(".pf-question-option-desc")?.textContent)
      .toBe("Relational, boring, correct");
    // Plus the always-present free-text option.
    expect(options()).toHaveLength(3);
  });

  it("sends answers keyed by the exact question text, not the header", () => {
    const decisions = mount(
      approval([
        { question: "Which database?", header: "DB", options: [{ label: "Postgres" }] },
      ]),
    );

    optionByLabel("Postgres").click();
    submitButton().click();

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe("accept");
    expect(decisions[0].answers?.answers).toEqual({ "Which database?": "Postgres" });
  });

  it("keeps a single-select question to one answer", () => {
    const decisions = mount(
      approval([
        { question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
      ]),
    );

    optionByLabel("Postgres").click();
    optionByLabel("SQLite").click();
    submitButton().click();

    expect(decisions[0].answers?.answers).toEqual({ "Which database?": "SQLite" });
  });

  it("joins a multi-select answer with ', ' rather than sending an array", () => {
    const decisions = mount(
      approval([
        {
          question: "Which regions?",
          multiSelect: true,
          options: [{ label: "us" }, { label: "eu" }, { label: "ap" }],
        },
      ]),
    );

    optionByLabel("us").click();
    optionByLabel("eu").click();
    submitButton().click();

    expect(decisions[0].answers?.answers).toEqual({ "Which regions?": "us, eu" });
    expect(typeof decisions[0].answers?.answers["Which regions?"]).toBe("string");
  });

  it("sends free text as the answer when Other is chosen", () => {
    const decisions = mount(
      approval([{ question: "Which database?", options: [{ label: "Postgres" }] }]),
    );

    optionByLabel("Other").click();
    const input = root.querySelector<HTMLInputElement>(".pf-question-input")!;
    input.value = "DuckDB";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    submitButton().click();

    expect(decisions[0].answers?.answers).toEqual({ "Which database?": "DuckDB" });
  });

  it("carries per-question notes as annotations", () => {
    const decisions = mount(
      approval([{ question: "Which database?", options: [{ label: "Postgres" }] }]),
    );

    optionByLabel("Postgres").click();
    const notes = root.querySelector<HTMLInputElement>(".pf-question-notes")!;
    notes.value = "only if managed";
    notes.dispatchEvent(new Event("input", { bubbles: true }));
    submitButton().click();

    expect(decisions[0].answers?.annotations).toEqual({
      "Which database?": { notes: "only if managed" },
    });
  });

  it("will not submit until every question is answered", () => {
    const decisions = mount(
      approval([
        { question: "Which database?", options: [{ label: "Postgres" }] },
        { question: "Which regions?", options: [{ label: "us" }] },
      ]),
    );

    expect(submitButton().disabled).toBe(true);
    optionByLabel("Postgres").click();
    expect(submitButton().disabled).toBe(true);

    optionByLabel("us").click();
    expect(submitButton().disabled).toBe(false);

    submitButton().click();
    expect(decisions[0].answers?.answers).toEqual({
      "Which database?": "Postgres",
      "Which regions?": "us",
    });
  });

  it("treats Other with no text as unanswered rather than sending an empty string", () => {
    // An empty-string answer reads as a real reply to the tool; absence does not.
    mount(approval([{ question: "Which database?", options: [{ label: "Postgres" }] }]));

    optionByLabel("Other").click();
    expect(submitButton().disabled).toBe(true);
  });

  it("maps the secondary action to decline so the model can rephrase", () => {
    const decisions = mount(
      approval([{ question: "Which database?", options: [{ label: "Postgres" }] }]),
    );

    root.querySelectorAll<HTMLButtonElement>(".pf-approval-btn")[1].click();

    expect(decisions[0].decision).toBe("decline");
    expect(decisions[0].answers).toBeUndefined();
  });

  it("marks options with bracket glyphs, never a filled chip", () => {
    mount(approval([{ question: "Which database?", options: [{ label: "Postgres" }] }]));

    const mark = optionByLabel("Postgres").querySelector(".pf-question-mark");
    expect(mark?.textContent).toBe("[ ]");
    optionByLabel("Postgres").click();
    expect(optionByLabel("Postgres").querySelector(".pf-question-mark")?.textContent).toBe("[x]");
    expect(root.querySelector(".pf-pill")).toBeNull();
  });

  it("exposes selection state to assistive tech", () => {
    mount(
      approval([
        { question: "Which regions?", multiSelect: true, options: [{ label: "us" }] },
      ]),
    );

    const option = optionByLabel("us");
    expect(option.getAttribute("role")).toBe("checkbox");
    expect(option.getAttribute("aria-checked")).toBe("false");
    option.click();
    expect(optionByLabel("us").getAttribute("aria-checked")).toBe("true");
  });
});
