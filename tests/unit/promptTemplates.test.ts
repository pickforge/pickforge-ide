import { describe, expect, it } from "vitest";

import { PROMPT_TEMPLATES, matchTemplates } from "../../src/lib/promptTemplates";

describe("matchTemplates", () => {
  it("returns every template for an empty query", () => {
    expect(matchTemplates("").map((template) => template.id)).toEqual(
      PROMPT_TEMPLATES.map((template) => template.id),
    );
  });

  it("matches ids and labels case-insensitively with slash prefixes allowed", () => {
    expect(matchTemplates("/pla").map((template) => template.id)).toEqual(["plan"]);
    expect(matchTemplates("REVIEW").map((template) => template.id)).toEqual([
      "review",
      "handoff-review",
    ]);
    expect(matchTemplates("findings").map((template) => template.id)).toEqual(["fix"]);
  });

  it("returns no templates when the query is unrelated", () => {
    expect(matchTemplates("deploy")).toEqual([]);
  });
});
