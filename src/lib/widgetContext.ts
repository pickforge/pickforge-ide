// Build the compact context markdown + filename PickForge hands to an AI agent
// for a selected widget. Kept short and machine-voiced — the bulk reasoning is
// the agent's job; this just orients it (type, source, props, tree, screenshot).
import type { DomNode } from "./cdp";
import type { A11yNode } from "./device";
import type { WidgetNode, WidgetProp } from "./vm";

const stripScheme = (uri: string) => uri.replace(/^file:\/\//, "");
const safeType = (name: string) => (name || "Widget").replace(/[^A-Za-z0-9_]/g, "");

/** `<yyyymmddhhmmss>` — a stable, sortable timestamp prefix for capture folders. */
function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** `<yyyymmddhhmmss>-<WidgetType>` — a stable, sortable, fs-safe base name. */
export function widgetBaseName(node: WidgetNode): string {
  return `${timestamp()}-${safeType(node.className)}`;
}

export function buildWidgetMarkdown(opts: {
  node: WidgetNode;
  props: WidgetProp[];
  ancestors: string[];
  children: string[];
  pngPath: string | null;
  instruction: string;
}): string {
  const { node, props, ancestors, children, pngPath, instruction } = opts;
  const type = node.className || "Widget";
  const lines: string[] = [`# Widget: ${type}`, ""];
  lines.push(`> Captured by PickForge Inspector`, "");

  lines.push("## Source");
  if (node.creationLocation) {
    const loc = node.creationLocation;
    lines.push(`- File: ${stripScheme(loc.file)}:${loc.line}`);
  } else {
    lines.push("- File: <unknown> (run with --track-widget-creation)");
  }
  lines.push("");

  lines.push("## Screenshot");
  if (pngPath) {
    lines.push(`![${type}](${pngPath})`, "(rendered widget — open the PNG to view)");
  } else {
    lines.push("_(unavailable — widget had no paintable bounds)_");
  }
  lines.push("");

  if (props.length) {
    lines.push("## Properties");
    for (const p of props.slice(0, 50)) lines.push(`- ${p.name}: ${p.value}`);
    lines.push("");
  }

  lines.push("## Tree context");
  if (ancestors.length) lines.push(`- Parent chain: ${ancestors.join(" › ")}`);
  lines.push(`- This: ${type}`);
  if (children.length) lines.push(`- Children: ${children.join(", ")}`);
  lines.push("");

  lines.push("## User instruction", instruction.trim() || "(none)");
  lines.push("");
  return lines.join("\n");
}

/** A node's leaf name for the capture folder: resource-id leaf, else class basename. */
function a11yLeaf(node: A11yNode): string {
  const idLeaf = node.resourceId?.split("/").pop();
  if (idLeaf) return idLeaf;
  return node.className.split(".").pop() ?? node.className;
}

/** `<yyyymmddhhmmss>-<leaf>` — a stable, sortable, fs-safe base name. */
export function a11yBaseName(node: A11yNode): string {
  return `${timestamp()}-${safeType(a11yLeaf(node))}`;
}

/** Build the context markdown for a selected accessibility node — adb UIAutomator
 *  (React Native / native-Android) or `idb` (native iOS, via `source:
 *  "iosAccessibility"`). Unlike the Flutter capture there is NO source mapping —
 *  the dump reports runtime accessibility info, not file:line — so the markdown
 *  leads with that disclaimer and hands the agent stable handles to search by
 *  (resource-id / text / class on Android; identifier / label / role on iOS). */
export function buildA11yMarkdown(opts: {
  node: A11yNode;
  ancestors: string[];
  children: string[];
  pngPath: string | null;
  instruction: string;
  /** Which dump backend produced the node — selects the search-handle vocabulary.
   *  Defaults to adb UIAutomator, so existing Android output is unchanged. */
  source?: "uiAutomator" | "iosAccessibility";
}): string {
  const { node, ancestors, children, pngPath, instruction } = opts;
  const b = node.bounds;
  const w = Math.round(b.right - b.left);
  const h = Math.round(b.bottom - b.top);
  // Source-aware handle vocabulary: adb reports resource-id / text / class; idb
  // reports accessibility id / label / role. Keeps the capture honest per source.
  const v =
    opts.source === "iosAccessibility"
      ? { dump: "idb accessibility node", tool: "idb", frameworks: "SwiftUI, UIKit", id: "accessibility id", text: "label", cls: "role", idRow: "identifier" }
      : { dump: "UIAutomator accessibility node", tool: "UIAutomator", frameworks: "React Native, Jetpack Compose, native Views", id: "resource-id", text: "text / content-description", cls: "class name", idRow: "resource-id" };
  const lines: string[] = [`# UI element: ${a11yLeaf(node)}`, ""];
  lines.push(`> Captured by PickForge Inspector (${v.dump})`, "");

  lines.push("## How to locate this in source");
  lines.push(
    `- This is a **runtime accessibility node**, not a source location. ${v.tool}`,
    "  has **no exact source mapping** (no file:line) — the framework that rendered it",
    `  (${v.frameworks}) is not recoverable from this dump.`,
    `- Search the codebase by **${v.id}**, then **${v.text}**, then`,
    `  **${v.cls}**. Treat any single match as a candidate, not a certainty.`,
  );
  lines.push("");

  lines.push("## Identity");
  lines.push(`- role: ${node.role}`);
  lines.push(`- class: ${node.className}`);
  if (node.resourceId) lines.push(`- ${v.idRow}: ${node.resourceId}`);
  if (node.text) lines.push(`- text: ${node.text}`);
  if (node.contentDescription) lines.push(`- content-description: ${node.contentDescription}`);
  lines.push(`- bounds: ${b.left},${b.top} → ${b.right},${b.bottom} (${w}×${h})`);
  lines.push(
    `- flags: ${[
      node.enabled ? "enabled" : "disabled",
      node.clickable ? "clickable" : null,
      node.selected ? "selected" : null,
    ]
      .filter(Boolean)
      .join(", ")}`,
  );
  lines.push("");

  lines.push("## Screenshot");
  if (pngPath) {
    lines.push(`![${a11yLeaf(node)}](${pngPath})`, "(full device screenshot — open the PNG to view)");
  } else {
    lines.push("_(unavailable)_");
  }
  lines.push("");

  lines.push("## Tree context");
  if (ancestors.length) lines.push(`- Parent chain: ${ancestors.join(" › ")}`);
  lines.push(`- This: ${node.className}`);
  if (children.length) lines.push(`- Children: ${children.join(", ")}`);
  lines.push("");

  lines.push("## User instruction", instruction.trim() || "(none)");
  lines.push("");
  return lines.join("\n");
}

/** A DOM node's leaf name for the capture folder: `tag#id`, else `tag.class0`,
 *  else the tag. */
function domLeaf(node: DomNode): string {
  if (node.id) return `${node.tag}-${node.id}`;
  const cls = node.class?.split(/\s+/).filter(Boolean)[0];
  return cls ? `${node.tag}-${cls}` : node.tag;
}

/** `<yyyymmddhhmmss>-<leaf>` — a stable, sortable, fs-safe base name for a web
 *  (CDP) capture. */
export function cdpBaseName(node: DomNode): string {
  return `${timestamp()}-${safeType(domLeaf(node))}`;
}

/** A short CSS-ish selector for a DOM node — the agent's search handle when no
 *  exact source is known. */
function domSelector(node: DomNode): string {
  let sel = node.tag;
  if (node.id) sel += `#${node.id}`;
  const cls = node.class?.split(/\s+/).filter(Boolean).slice(0, 2);
  if (cls?.length) sel += `.${cls.join(".")}`;
  return sel;
}

/** Build the context markdown for a selected web DOM node (CDP). When the source
 *  mapped (a framework source attribute resolved, or a generated→authored
 *  source-map hit), the markdown leads with the exact `file:line:col`; otherwise
 *  it is honest that there is no exact mapping and hands the agent the selector
 *  (tag / id / class / text) to search by — the same certainty discipline as the
 *  A11y capture. */
export function buildCdpMarkdown(opts: {
  node: DomNode;
  /** Best-effort authored `file:line:col` (or `file:line`), or null. */
  source: string | null;
  ancestors: string[];
  children: string[];
  pageUrl: string | null;
  instruction: string;
}): string {
  const { node, source, ancestors, children, pageUrl, instruction } = opts;
  const leaf = domLeaf(node);
  const lines: string[] = [`# Web element: ${leaf}`, ""];
  lines.push(`> Captured by PickForge Inspector (web DOM node via CDP)`, "");

  lines.push("## How to locate this in source");
  if (source) {
    lines.push(
      `- Mapped source: **${stripScheme(source)}**`,
      "- Recovered from the page's source map / framework source attribute.",
      "  Confirm it still matches before editing — bundlers can drift.",
    );
  } else {
    lines.push(
      "- **No exact source mapping** for this element (no framework source attribute,",
      "  and no source map resolved). Search the codebase by the **selector** below:",
      `  \`${domSelector(node)}\`, then by **text**, then by **class name**.`,
      "- Treat any single match as a candidate, not a certainty.",
    );
  }
  lines.push("");

  lines.push("## Identity");
  lines.push(`- selector: ${domSelector(node)}`);
  lines.push(`- tag: ${node.tag}`);
  if (node.id) lines.push(`- id: ${node.id}`);
  if (node.class) lines.push(`- class: ${node.class}`);
  if (node.sourceAttr) lines.push(`- source attribute: ${node.sourceAttr}`);
  if (node.text) lines.push(`- text: ${node.text}`);
  if (pageUrl) lines.push(`- page: ${pageUrl}`);
  lines.push("");

  lines.push("## Tree context");
  if (ancestors.length) lines.push(`- Parent chain: ${ancestors.join(" › ")}`);
  lines.push(`- This: ${domSelector(node)}`);
  if (children.length) lines.push(`- Children: ${children.join(", ")}`);
  lines.push("");

  lines.push("## User instruction", instruction.trim() || "(none)");
  lines.push("");
  return lines.join("\n");
}
