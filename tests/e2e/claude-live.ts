// Opt-in LIVE Claude bridge E2E (#364).
//
// Nothing else in this repo reaches the real CLI. The bridge unit tests mock
// the SDK and put a zero-byte `claude` on PATH; the Rust tests spawn `#!/bin/sh`
// fakes; VRT runs against `tauriMock.ts`; `bun run e2e` mocks `invoke`. So the
// one contract that actually matters for AskUserQuestion — that returning
// `{behavior: "allow", updatedInput: {...input, answers}}` makes the tool
// report answers instead of "The user did not answer the questions." — was
// asserted against a reading of the SDK, never against the SDK.
//
// This drives the REAL bridge against the REAL `claude` binary, forces an
// AskUserQuestion, answers it through the same approve op the GUI uses, and
// asserts the tool's own result text.
//
// Opt-in, in the style of the device tiers next door:
//
//   PICKFORGE_E2E_CLAUDE=1 bun run tests/e2e/claude-live.ts
//
// Unset → prints SKIP and exits 0, so CI and `bun run e2e` stay green without
// credentials. Set but `claude` missing or unauthenticated → FAIL FAST, because
// a silent pass here would be worse than no test.
//
// Costs a real API call. Pinned to a cheap model per the repo's testing
// convention (CLAUDE.md: prefer Haiku 4.5 for dogfooding).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";

const GATE = "PICKFORGE_E2E_CLAUDE";
const MODEL = process.env.PICKFORGE_E2E_CLAUDE_MODEL ?? "haiku";
const CHAT_ID = "e2e-askuserquestion";
/** Long enough for a real turn on a cheap model, short enough to fail a hang. */
const TURN_TIMEOUT_MS = 120_000;

/** The tool's own refusal string. Seeing this means the host allowed the call
 *  without attaching answers — the exact bug #364 fixed. */
const DID_NOT_ANSWER = "did not answer";

function skip(reason: string): never {
  console.log(`SKIP claude-live: ${reason}`);
  process.exit(0);
}

function fail(reason: string): never {
  console.error(`FAIL claude-live: ${reason}`);
  process.exit(1);
}

function onPath(binary: string): boolean {
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  return dirs.some((dir) => existsSync(join(dir, binary)));
}

type BridgeEvent = Record<string, unknown> & { ev?: string; chatId?: string };

async function main(): Promise<void> {
  if (!process.env[GATE]) skip(`${GATE} is unset`);
  if (!onPath("claude")) fail("`claude` is not on PATH — the gate is set, so this is a real failure");

  const repoRoot = new URL("../..", import.meta.url).pathname;
  const bridge = spawn("bun", ["run", join(repoRoot, "scripts/claude-bridge.ts")], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  const events: BridgeEvent[] = [];
  const waiters: ((event: BridgeEvent) => boolean)[] = [];
  const rl = createInterface({ input: bridge.stdout });
  rl.on("line", (line) => {
    let event: BridgeEvent;
    try {
      event = JSON.parse(line) as BridgeEvent;
    } catch {
      return; // the bridge also emits plain diagnostics
    }
    events.push(event);
    for (const [index, matches] of [...waiters.entries()].reverse()) {
      if (matches(event)) waiters.splice(index, 1);
    }
  });
  bridge.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[bridge] ${chunk}`));

  const send = (command: unknown) => bridge.stdin.write(`${JSON.stringify(command)}\n`);

  /** Resolves on the first event matching `predicate`, including ones already
   *  seen — otherwise a fast bridge can answer before we start listening. */
  const waitFor = (label: string, predicate: (event: BridgeEvent) => boolean) =>
    new Promise<BridgeEvent>((resolve, reject) => {
      const existing = events.find(predicate);
      if (existing) return resolve(existing);
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label} after ${TURN_TIMEOUT_MS}ms`)),
        TURN_TIMEOUT_MS,
      );
      waiters.push((event) => {
        if (!predicate(event)) return false;
        clearTimeout(timer);
        resolve(event);
        return true;
      });
    });

  try {
    send({ op: "start", chatId: CHAT_ID, cwd: repoRoot, model: MODEL, permissionMode: "default" });
    await waitFor("started", (event) => event.ev === "started" && event.chatId === CHAT_ID);

    // A prompt that leaves the model no useful way to proceed without asking.
    send({
      op: "send",
      chatId: CHAT_ID,
      text:
        "Use the AskUserQuestion tool right now to ask me exactly one question: " +
        "\"Which database?\" with the options Postgres and SQLite. " +
        "Do not guess, do not proceed, and do not use any other tool first.",
    });

    const approval = await waitFor(
      "an AskUserQuestion approval",
      (event) => event.ev === "approvalRequest" && event.toolName === "AskUserQuestion",
    );

    const input = approval.input as { questions?: { question: string }[] } | undefined;
    const question = input?.questions?.[0]?.question;
    if (!question) {
      fail(`approval carried no questions: ${JSON.stringify(approval.input)}`);
    }
    console.log(`  asked: ${question}`);

    // The GUI's exact path: approve WITH answers, keyed by the question text.
    send({
      op: "approve",
      chatId: CHAT_ID,
      requestId: approval.requestId,
      decision: "accept",
      payload: { answers: { [question]: "Postgres" } },
    });

    // A `result` message ends the TURN. `turnClosed` is not the signal here —
    // the bridge emits that only when the whole query iterator ends, because a
    // session stays open for follow-up sends.
    const result = await waitFor(
      "the turn's result",
      (event) =>
        event.ev === "raw" &&
        (event.message as { type?: string } | undefined)?.type === "result",
    );
    const outcome = (result.message as { subtype?: string }).subtype;
    if (outcome !== "success") fail(`the turn ended as ${outcome}, not success`);

    // The tool's own result text is the verdict. It rides in a raw `user`
    // message as a tool_result block.
    const transcript = JSON.stringify(events);
    if (transcript.toLowerCase().includes(DID_NOT_ANSWER)) {
      fail(
        "the tool reported that the user did not answer — the answers payload " +
          "did not reach it. This is the #364 regression.",
      );
    }
    if (!transcript.includes("Postgres")) {
      fail("the answer never appeared in the transcript at all");
    }

    console.log("PASS claude-live: AskUserQuestion was answered and the tool accepted it");
  } finally {
    send({ op: "shutdown" });
    bridge.stdin.end();
    setTimeout(() => bridge.kill("SIGKILL"), 3_000).unref();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
