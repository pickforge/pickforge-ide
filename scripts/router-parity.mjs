#!/usr/bin/env node
import http from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const timeoutMs = Number.parseInt(process.env.PICKFORGE_ROUTER_TIMEOUT_MS ?? "60000", 10);

const commands = [
  { family: "project", text: "open project Billing" },
  { family: "chat", text: "send fix the failing login test to chat CI in Billing" },
  { family: "swarm", text: "start review swarm of 3 for the auth diff" },
  { family: "run", text: "run on Pixel 8" },
  { family: "device", text: "take a screenshot" },
];

const catalog = `Convert one PickForge developer command into exactly one JSON object.
Use only these actions: openProject, openChat, createChat, sendPrompt, startSwarm,
swarmStatus, interruptRun, steerRun, launchEmulator, launchRun, reloadRun, stopRun,
hotRestart, enterSelectMode, takeScreenshot, selectWidget.
Proposal shape: {"action":<payload>,"confidence":0..1,"projectRef":string|null optional}.
If unclear, return {"unclear":true,"reason":"short reason"}.
Never emit id, provenance, approval, cost, paths, or markdown. Output only JSON.`;

const backends = [
  {
    id: "claudeCode",
    label: "Claude Code",
    model: process.env.PICKFORGE_ROUTER_CLAUDE_MODEL,
    run: runClaude,
  },
  {
    id: "codex",
    label: "Codex",
    model: process.env.PICKFORGE_ROUTER_CODEX_MODEL,
    run: runCodex,
  },
  {
    id: "ollama",
    label: "Ollama",
    model: process.env.PICKFORGE_ROUTER_OLLAMA_MODEL,
    run: runOllama,
  },
].filter((backend) => backend.model);

if (backends.length === 0) {
  console.log("No router backends configured.");
  console.log("Set one or more of:");
  console.log("  PICKFORGE_ROUTER_CLAUDE_MODEL=claude-haiku-4-5");
  console.log("  PICKFORGE_ROUTER_CODEX_MODEL=gpt-5.5");
  console.log("  PICKFORGE_ROUTER_OLLAMA_MODEL=qwen2.5:3b");
  process.exit(1);
}

const rows = [];
for (const command of commands) {
  console.log(`\n## ${command.family}: ${command.text}`);
  for (const backend of backends) {
    const started = Date.now();
    try {
      const raw = await backend.run(buildPrompt(command.text), backend.model);
      const proposal = JSON.parse(extractJson(backend.id, raw));
      const action = proposal.unclear ? "unclear" : proposal.action?.action ?? "unknown";
      rows.push({ command, backend, action, ok: true });
      console.log(`${backend.label} (${backend.model}) ${Date.now() - started}ms`);
      console.log(JSON.stringify(proposal));
    } catch (error) {
      rows.push({ command, backend, action: "error", ok: false });
      console.log(`${backend.label} (${backend.model}) failed: ${message(error)}`);
    }
  }
}

console.log("\n## Parity summary");
for (const command of commands) {
  const matching = rows.filter((row) => row.command === command);
  const actions = [...new Set(matching.map((row) => row.action))];
  const status = actions.length === 1 && matching.every((row) => row.ok) ? "match" : "diff";
  console.log(`${status.padEnd(5)} ${command.family.padEnd(7)} ${actions.join(", ")}`);
}

function buildPrompt(commandText) {
  return `${catalog}\n\nCommand text as JSON string:\n${JSON.stringify(commandText)}\n`;
}

function runClaude(prompt, model) {
  return withIsolatedCwd((cwd) => {
    const result = spawnSync("claude", [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--safe-mode",
      "--strict-mcp-config",
      "--tools",
      "",
      "--permission-mode",
      "plan",
      "--no-session-persistence",
      "--model",
      model,
    ], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
    return processResult(result);
  });
}

function runCodex(prompt, model) {
  return withIsolatedCwd((cwd) => {
    const result = spawnSync("codex", [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--cd",
      cwd,
      "--sandbox",
      "read-only",
      "-c",
      'approval_policy="never"',
      "--ephemeral",
      "--ignore-rules",
      "--ignore-user-config",
      "-m",
      model,
      prompt,
    ], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
    return processResult(result);
  });
}

function runOllama(prompt, model) {
  const body = JSON.stringify({ model, prompt, format: "json", stream: false });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: 11434,
      path: "/api/generate",
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1024 * 1024) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) > 299) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(-500)}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

function processResult(result) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).slice(-500));
  }
  return result.stdout;
}

function withIsolatedCwd(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pickforge-router-"));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function extractJson(backend, raw) {
  if (backend === "claudeCode") return stripFences(JSON.parse(raw).result);
  if (backend === "ollama") return stripFences(JSON.parse(raw).response);

  let last = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      last = event.item.text;
    }
  }
  if (!last) throw new Error("no Codex agent_message");
  return stripFences(last);
}

function stripFences(value) {
  if (typeof value !== "string") throw new Error("model output text missing");
  const trimmed = value.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
