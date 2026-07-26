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
// The same declarations can be expressed from TS/TSX and bypass the CSS scan
// entirely: an inline `style={{ transition: "... 200ms ease-in" }}`, or a Web
// Animations `element.animate(..., { easing: "..." })`. There are zero of
// either today — this keeps it that way rather than fixing a live violation
// (#359). Matched on the quoted string so a `var(--pf-ease-*)` reference still
// passes through the same carve-out as CSS.
// `[,:=]` rather than `:` alone so the imperative forms are caught too —
// `el.style.transition = "..."` and `setProperty("transition", "...")` are as
// easy to reach for as the JSX style object. Interpolated values
// (`` `opacity 1s ${CURVE}` ``) still evade: a regex gate cannot chase
// dataflow, and that is a stated limit rather than a gap worth pretending to
// close.
const TS_DECLARATION =
  /(?:transition|animation|animationTimingFunction|transitionTimingFunction|easing)["']?\s*[,:=]\s*(`[^`]*`|"[^"]*"|'[^']*')/gi;
const VAR_REFERENCE = /var\(\s*--[a-zA-Z0-9-]+\s*(?:,[^()]*)?\)/gi;
const RAW_EASING = /\b(?:cubic-bezier|ease-in-out|ease-in|ease-out|ease\b|linear(?=\s*\())/i;

function filesWithExt(dir, test) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return filesWithExt(path, test);
    return test(path) ? [path] : [];
  });
}

const cssFiles = (dir) => filesWithExt(dir, (path) => path.endsWith(".css"));
const scriptFiles = (dir) => filesWithExt(dir, (path) => /\.tsx?$/.test(path));

const files = cssFiles(SRC);
const scripts = scriptFiles(SRC);
if (files.length === 0 || scripts.length === 0) {
  console.error(
    `check-design-tokens: found no ${files.length === 0 ? "CSS" : "TS/TSX"} under ${relative(ROOT, SRC)} — refusing to pass vacuously`,
  );
  process.exit(1);
}

function scan(paths, pattern) {
  return paths.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(pattern)].flatMap((match) => {
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
}

const violations = [...scan(files, DECLARATION), ...scan(scripts, TS_DECLARATION)];

if (violations.length > 0) {
  for (const { file, line, declaration } of violations) {
    console.error(`${file}:${line}  ${declaration}`);
  }
  console.error(
    `\n${violations.length} raw easing value(s). Use a --pf-ease-* token; see docs/design-system/motion.md.`,
  );
  process.exit(1);
}

console.log(
  `check-design-tokens: no raw easing in ${files.length} CSS files and ${scripts.length} TS/TSX files`,
);
