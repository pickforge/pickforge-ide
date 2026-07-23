import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("../scripts/check-osv-severity.mjs", import.meta.url));
const fixtures = fileURLToPath(new URL("fixtures/osv", import.meta.url));

function run(fixture) {
  return spawnSync(
    process.execPath,
    [script, `${fixtures}/${fixture}`, "Cargo.lock", "bun.lock"],
    { cwd: root, encoding: "utf8" },
  );
}

test("blocks a numeric severity of 8.1", () => {
  assert.equal(run("score-8.1.json").status, 1);
});

test("passes a numeric severity of 6.9", () => {
  assert.equal(run("score-6.9.json").status, 0);
});

test("blocks a missing severity", () => {
  assert.equal(run("missing-severity.json").status, 1);
});

test("blocks an empty severity", () => {
  assert.equal(run("empty-severity.json").status, 1);
});

test("skips an unscored informational advisory", () => {
  const result = run("informational-unscored.json");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped informational RUSTSEC-INFORMATIONAL/);
});

test("blocks an unscored non-informational advisory", () => {
  const result = run("non-informational-unscored.json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RUSTSEC-UNSCORED/);
});

test("blocks a CRITICAL severity label", () => {
  assert.equal(run("critical-label.json").status, 1);
});

test("fails when an expected lockfile was not scanned", () => {
  const result = run("missing-lockfile.json");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing lockfile: bun\.lock/);
});
