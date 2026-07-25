import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

// The design system defines one easing, exposed as --pf-ease-* tokens. Raw curves
// bypass it. `linear` and `steps()` stay legal: continuous loops (sweeps, spinners)
// are documented carve-outs that a curve would visibly wrong.
const DECLARATION = /(?:transition|animation)(?:-timing-function)?\s*:\s*([^;{}]*)/g;
const VAR_REFERENCE = /var\(\s*--[a-zA-Z0-9-]+\s*(?:,[^()]*)?\)/g;
const RAW_EASING = /\b(?:cubic-bezier|ease-in-out|ease-in|ease-out|ease)\b/;

function cssFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

const violations = cssFiles(SRC).flatMap((path) => {
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

console.log(`check-design-tokens: no raw easing in ${cssFiles(SRC).length} CSS files`);
