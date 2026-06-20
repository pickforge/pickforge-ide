// Build the compact context markdown + filename PickForge hands to an AI agent
// for a selected widget. Kept short and machine-voiced — the bulk reasoning is
// the agent's job; this just orients it (type, source, props, tree, screenshot).
import type { WidgetNode, WidgetProp } from "./vm";

const stripScheme = (uri: string) => uri.replace(/^file:\/\//, "");
const safeType = (name: string) => (name || "Widget").replace(/[^A-Za-z0-9_]/g, "");

/** `<yyyymmddhhmmss>-<WidgetType>` — a stable, sortable, fs-safe base name. */
export function widgetBaseName(node: WidgetNode): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${ts}-${safeType(node.className)}`;
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
