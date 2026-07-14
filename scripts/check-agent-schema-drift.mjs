#!/usr/bin/env node
import { isDeepStrictEqual } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const [committedDir, generatedDir] = process.argv.slice(2);

if (!committedDir || !generatedDir || process.argv.length !== 4) {
  console.error("Usage: check-agent-schema-drift.mjs <committed-schema-dir> <generated-schema-dir>");
  process.exit(2);
}

async function listFiles(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported schema entry: ${relativePath}`);
    }
  }

  return files.sort();
}

function describeFileSetDifference(committedFiles, generatedFiles) {
  const committed = new Set(committedFiles);
  const generated = new Set(generatedFiles);
  const missing = committedFiles.filter((file) => !generated.has(file));
  const extra = generatedFiles.filter((file) => !committed.has(file));

  return [
    ...missing.map((file) => `Missing generated schema file: ${file}`),
    ...extra.map((file) => `Unexpected generated schema file: ${file}`),
  ];
}

function parseSchema(json, side, file) {
  try {
    return JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${side} schema JSON: ${file}: ${message}`);
  }
}

try {
  const [committedFiles, generatedFiles] = await Promise.all([
    listFiles(committedDir),
    listFiles(generatedDir),
  ]);
  const failures = describeFileSetDifference(committedFiles, generatedFiles);

  if (failures.length === 0) {
    for (const file of committedFiles) {
      const [committedJson, generatedJson] = await Promise.all([
        readFile(path.join(committedDir, file), "utf8"),
        readFile(path.join(generatedDir, file), "utf8"),
      ]);

      if (!isDeepStrictEqual(parseSchema(committedJson, "committed", file), parseSchema(generatedJson, "generated", file))) {
        failures.push(`Schema content drift: ${file}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
