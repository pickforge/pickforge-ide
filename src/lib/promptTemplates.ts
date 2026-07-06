export interface PromptTemplate {
  id: string;
  label: string;
  body: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "swarm",
    label: "/swarm",
    body: "/swarm of 3 agents review {{goal}}",
  },
  {
    id: "plan",
    label: "Plan task",
    body: [
      "Produce a numbered task plan for {{goal}}.",
      "",
      "Include likely file targets, key risks, and the narrowest useful verification commands.",
      "Do not edit files yet.",
    ].join("\n"),
  },
  {
    id: "build",
    label: "Build task",
    body: [
      "Implement {{goal}}.",
      "",
      "Files you may touch:",
      "{{files}}",
      "",
      "Constraints:",
      "- Make the smallest clean change.",
      "- Follow existing style.",
      "- Avoid unrelated refactors.",
      "",
      "Verification:",
      "{{verification}}",
    ].join("\n"),
  },
  {
    id: "review",
    label: "Review diff",
    body: [
      "Review this diff for correctness, contract mismatches, dead code, and missing tests.",
      "",
      "Return findings first as a list with severity, file/line, and rationale.",
      "If there are no findings, say that clearly.",
      "",
      "Diff:",
      "{{diff}}",
    ].join("\n"),
  },
  {
    id: "handoff-review",
    label: "Handoff review",
    body: [
      "Reviewer lane: review the following diff for correctness, contract mismatches, dead code, and test gaps.",
      "Return findings only, with severity and file/line when applicable.",
      "",
      "{{diff}}",
    ].join("\n"),
  },
  {
    id: "fix",
    label: "Fix findings",
    body: [
      "Address these findings with the smallest clean change.",
      "",
      "Findings:",
      "{{findings}}",
      "",
      "Files you may touch:",
      "{{files}}",
      "",
      "Verification:",
      "{{verification}}",
    ].join("\n"),
  },
];

export function matchTemplates(query: string): PromptTemplate[] {
  const needle = query.trim().replace(/^\/+/, "").toLowerCase();
  if (needle.length === 0) return PROMPT_TEMPLATES;
  return PROMPT_TEMPLATES.filter((template) => {
    const id = template.id.toLowerCase();
    const label = template.label.toLowerCase();
    return id.includes(needle) || label.includes(needle);
  });
}
