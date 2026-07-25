import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

// The design system defines one easing, exposed as --pf-ease-* tokens. Raw curves
// bypass it. The `linear` and `steps()` keywords stay legal: continuous loops (the
// ember sweep, the spinner, the caret blink) need constant velocity, and the forge
// curve would visibly pump their speed. The `linear()` function is an arbitrary
// custom curve, so it is caught rather than carved out.
const DECLARATION = /(?:transition|animation)(?:-timing-function)?\s*:\s*([^;{}]*)/gi;
const VAR_REFERENCE = /var\(\s*--[a-zA-Z0-9-]+\s*(?:,[^()]*)?\)/gi;
const RAW_EASING = /\b(?:cubic-bezier|ease-in-out|ease-in|ease-out|ease\b|linear(?=\s*\())/i;

function cssFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

const files = cssFiles(SRC);
if (files.length === 0) {
  console.error(`check-design-tokens: found no CSS under ${relative(ROOT, SRC)} — refusing to pass vacuously`);
  process.exit(1);
}

const violations = files.flatMap((path) => {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(DECLARATION)].flatMap((match) => {
    if (!RAW_EASING.test(match[1].replace(VAR_REFERENCE, ""))) return [];
    return [
      {
        file: relative(ROOT, path),
        line: source.slice(0, match.index).split("\n").length,
        declaration: match[0].replace(/\s+/g, " ").trim(),
      },
    ];
  });
});

if (violations.length > 0) {
  for (const { file, line, declaration } of violations) {
    console.error(`${file}:${line}  ${declaration}`);
  }
  console.error(
    `\n${violations.length} raw easing value(s). Use a --pf-ease-* token; see docs/design-system/motion.md.`,
  );
  process.exit(1);
}

console.log(`check-design-tokens: no raw easing in ${files.length} CSS files`);
