// Build the compact context markdown + filename PickForge hands to an AI agent
// for a selected widget. Kept short and machine-voiced — the bulk reasoning is
// the agent's job; this just orients it (type, source, props, tree, screenshot).
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

/** Build the context markdown for a selected UIAutomator accessibility node
 *  (React Native / native-Android). Unlike the Flutter capture there is NO source
 *  mapping — UIAutomator reports runtime accessibility info, not file:line — so the
 *  markdown leads with that disclaimer and hands the agent stable handles
 *  (resource-id, text, class) to search by instead. */
export function buildA11yMarkdown(opts: {
  node: A11yNode;
  ancestors: string[];
  children: string[];
  pngPath: string | null;
  instruction: string;
}): string {
  const { node, ancestors, children, pngPath, instruction } = opts;
  const b = node.bounds;
  const w = Math.round(b.right - b.left);
  const h = Math.round(b.bottom - b.top);
  const lines: string[] = [`# UI element: ${a11yLeaf(node)}`, ""];
  lines.push(`> Captured by PickForge Inspector (UIAutomator accessibility node)`, "");

  lines.push("## How to locate this in source");
  lines.push(
    "- This is a **runtime accessibility node**, not a source location. UIAutomator",
    "  has **no exact source mapping** (no file:line) — the framework that rendered it",
    "  (React Native, Jetpack Compose, native Views) is not recoverable from this dump.",
    "- Search the codebase by **resource-id**, then **text / content-description**, then",
    "  **class name**. Treat any single match as a candidate, not a certainty.",
  );
  lines.push("");

  lines.push("## Identity");
  lines.push(`- role: ${node.role}`);
  lines.push(`- class: ${node.className}`);
  if (node.resourceId) lines.push(`- resource-id: ${node.resourceId}`);
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
