import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseOperatorIntent, riskTier } from "../../src/lib/operatorIntent";

const fixtureRoot = join(
  process.cwd(),
  "crates/pickforge-core/tests/fixtures/operator_intents",
);

function fixtures(kind: "valid" | "invalid") {
  const dir = join(fixtureRoot, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      raw: readFileSync(join(dir, name), "utf8"),
    }));
}

function parseValid(raw: string) {
  const parsed = parseOperatorIntent(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.intent;
}

describe("operatorIntent fixtures", () => {
  it("accepts and round-trips every valid fixture", () => {
    const files = fixtures("valid");
    expect(files).toHaveLength(17);

    for (const file of files) {
      const intent = parseValid(file.raw);
      const expected =
        file.name === "omittedOptionals.json"
          ? {
              v: 2,
              id: "intent-omitted-optionals",
              provenance: "typed",
              confidence: 0.83,
              projectRef: null,
              action: {
                action: "openChat",
                chat: null,
              },
            }
          : JSON.parse(file.raw);
      expect(JSON.parse(JSON.stringify(intent)), file.name).toEqual(expected);
    }
  });

  it("upgrades v1 envelopes on read", () => {
    const parsed = parseOperatorIntent(JSON.stringify({
      v: 1,
      id: "intent-v1",
      provenance: "typed",
      confidence: 0.9,
      projectRef: null,
      action: { action: "launchRun", target: "flutter" },
    }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.intent).toEqual({
      v: 2,
      id: "intent-v1",
      provenance: "typed",
      confidence: 0.9,
      projectRef: null,
      action: { action: "launchRun", target: "flutter" },
    });
  });

  it("rejects every invalid fixture", () => {
    const files = fixtures("invalid");
    expect(files.length).toBeGreaterThanOrEqual(16);

    for (const file of files) {
      expect(parseOperatorIntent(file.raw).ok, file.name).toBe(false);
    }
  });

  it("maps risk tiers in parity with Rust", () => {
    const sendPrompt = parseValid(
      readFileSync(join(fixtureRoot, "valid/sendPrompt.json"), "utf8"),
    );
    const swarmStatus = parseValid(
      readFileSync(join(fixtureRoot, "valid/swarmStatus.json"), "utf8"),
    );
    const hotRestart = parseValid(
      readFileSync(join(fixtureRoot, "valid/hotRestart.json"), "utf8"),
    );

    expect(riskTier(sendPrompt.action)).toBe(1);
    expect(riskTier(swarmStatus.action)).toBe(0);
    expect(riskTier(hotRestart.action)).toBe(0);
  });
});
