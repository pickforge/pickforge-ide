import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const checker = join(repoRoot, "scripts", "check-agent-schema-drift.mjs");

function makeTempRoot(name) {
  return mkdtempSync(join(tmpdir(), `pickforge-schema-drift-${name}-`));
}

function writeSchema(directory, relativePath, value) {
  const file = join(directory, relativePath);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

function runChecker(committed, generated) {
  return spawnSync("node", [checker, committed, generated], { encoding: "utf8" });
}

function test(name, fn) {
  const root = makeTempRoot(name.replace(/[^a-z0-9]+/gi, "-"));
  try {
    fn(root);
    console.log(`ok - ${name}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fixture(root) {
  const committed = join(root, "committed");
  const generated = join(root, "generated");
  const schema = {
    type: "object",
    properties: {
      status: { enum: ["active", "inactive"] },
      name: { type: "string" },
    },
    required: ["name", "status"],
  };
  writeSchema(committed, "nested/schema.json", schema);
  writeSchema(generated, "nested/schema.json", schema);
  return { committed, generated };
}

test("ignores object member order", (root) => {
  const { committed, generated } = fixture(root);
  writeSchema(generated, "nested/schema.json", {
    required: ["name", "status"],
    properties: {
      name: { type: "string" },
      status: { enum: ["active", "inactive"] },
    },
    type: "object",
  });

  const result = runChecker(committed, generated);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects content drift", (root) => {
  const { committed, generated } = fixture(root);
  writeSchema(generated, "nested/schema.json", { type: "array" });

  const result = runChecker(committed, generated);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Schema content drift: nested\/schema\.json/);
});

test("rejects array order drift", (root) => {
  const { committed, generated } = fixture(root);
  writeSchema(generated, "nested/schema.json", {
    type: "object",
    properties: {
      status: { enum: ["inactive", "active"] },
      name: { type: "string" },
    },
    required: ["name", "status"],
  });

  const result = runChecker(committed, generated);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Schema content drift: nested\/schema\.json/);
});

test("rejects missing and extra files", (root) => {
  const { committed, generated } = fixture(root);
  rmSync(join(generated, "nested", "schema.json"));
  writeSchema(generated, "unexpected.json", {});

  const result = runChecker(committed, generated);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing generated schema file: nested\/schema\.json/);
  assert.match(result.stderr, /Unexpected generated schema file: unexpected\.json/);
});

test("identifies generated invalid JSON by relative path", (root) => {
  const { committed, generated } = fixture(root);
  writeSchema(generated, "nested/schema.json", "{");

  const result = runChecker(committed, generated);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid generated schema JSON: nested\/schema\.json:/);
});

test("identifies committed invalid JSON by relative path", (root) => {
  const { committed, generated } = fixture(root);
  writeSchema(committed, "nested/schema.json", "{");

  const result = runChecker(committed, generated);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid committed schema JSON: nested\/schema\.json:/);
});

{
  const result = spawnSync("node", [checker], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: check-agent-schema-drift\.mjs/);
  console.log("ok - rejects missing arguments with usage exit 2");
}
