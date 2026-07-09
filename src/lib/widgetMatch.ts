import { z } from "zod";
import type { SemanticWidgetNode } from "./vm";
import { extractRouterText, routeRawPrompt } from "./operatorRouter";

export const WIDGET_MATCH_MAX_NODES = 800;
export const WIDGET_MATCH_MAX_BYTES = 16 * 1024;
export const WIDGET_MATCH_PROMPT_MARGIN_BYTES = 256;
export const WIDGET_MATCH_LABEL_MAX_LENGTH = 60;
// Routed serialization caps global nodes (800), nesting levels (12), and children per node (16).
export const WIDGET_MATCH_MAX_DEPTH = 12;
export const WIDGET_MATCH_MAX_CHILDREN = 16;

const TREE_TRUNCATION_MARKER = "… subtree truncated";
const POSIX_PATH = /(?<![\w/])\/(?:[^\s/]+\/)*[^\s/]+/g;
const WINDOWS_PATH = /\b[A-Za-z]:[\\/](?:[^\s\\/]+[\\/])*[^\s\\/]+/g;
const HOST_PORT = /\b(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|(?:\d{1,3}\.){3}\d{1,3}):\d{2,5}\b/gi;
const LOCAL_HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local\b/gi;
const TAILNET_IP = /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g;
const LONG_SERIAL = /\b(?=[A-Za-z0-9_-]{12,}\b)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g;

export type IndexedWidgetNode = {
  index: number;
  valueId: string;
  className: string;
  label: string | null;
};

export type SerializedWidgetTree = {
  text: string;
  nodes: IndexedWidgetNode[];
  truncated: boolean;
};

export type WidgetMatchResult =
  | { kind: "match"; node: IndexedWidgetNode }
  | { kind: "ambiguous"; candidates: IndexedWidgetNode[] }
  | { kind: "notFound" }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string };

const indexedMatchSchema = z.strictObject({
  index: z.number().int().positive(),
});

export const widgetMatchResponseSchema = z.union([
  z.strictObject({ match: indexedMatchSchema }),
  z.strictObject({
    ambiguous: z.strictObject({
      candidates: z.array(z.strictObject({
        index: z.number().int().positive(),
        reason: z.string().optional(),
      })).min(1).max(3),
    }),
  }),
  z.strictObject({ notFound: z.literal(true) }),
]);

type WidgetMatchResponse = z.infer<typeof widgetMatchResponseSchema>;

type PendingWidgetEntry =
  | { kind: "node"; node: SemanticWidgetNode; depth: number }
  | { kind: "marker"; text: string };

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  const ellipsis = "…";
  if (byteLength(ellipsis) > maxBytes) return "";
  let output = "";
  for (const character of value) {
    if (byteLength(`${output}${character}${ellipsis}`) > maxBytes) break;
    output += character;
  }
  return `${output}${ellipsis}`;
}

function serializeLabel(label: string | null): string | null {
  if (!label) return null;
  const normalized = label
    .replace(/\s+/gu, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(WINDOWS_PATH, "…")
    .replace(POSIX_PATH, "…")
    .replace(HOST_PORT, "…")
    .replace(LOCAL_HOST, "…")
    .replace(TAILNET_IP, "…")
    .replace(LONG_SERIAL, "…")
    .trim();
  if (!normalized) return null;
  const characters = Array.from(normalized);
  return characters.length > WIDGET_MATCH_LABEL_MAX_LENGTH
    ? `${characters.slice(0, WIDGET_MATCH_LABEL_MAX_LENGTH - 1).join("")}…`
    : normalized;
}

function widgetLinePrefix(index: number, node: SemanticWidgetNode, depth: number): string {
  return `${"  ".repeat(depth)}${index} ${node.className}`;
}

function widgetLine(index: number, node: SemanticWidgetNode, depth: number): string {
  const label = serializeLabel(node.label);
  return `${widgetLinePrefix(index, node, depth)}${label ? ` — ${label}` : ""}`;
}

function appendTruncationMarker(lines: string[], bytes: number, maxBytes: number): number {
  const separator = lines.length > 0 ? "\n" : "";
  if (bytes + byteLength(separator) + byteLength(TREE_TRUNCATION_MARKER) > maxBytes) {
    return bytes;
  }
  lines.push(TREE_TRUNCATION_MARKER);
  return bytes + byteLength(separator) + byteLength(TREE_TRUNCATION_MARKER);
}

function limitMarker(depth: number, text: string): string {
  return `${"  ".repeat(depth)}${text}`;
}

export function serializeWidgetTree(
  root: SemanticWidgetNode,
  maxBytes = WIDGET_MATCH_MAX_BYTES,
): SerializedWidgetTree {
  const stack: PendingWidgetEntry[] = [{ kind: "node", node: root, depth: 0 }];
  const nodes: IndexedWidgetNode[] = [];
  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;
  const markerReserve = byteLength(`\n${TREE_TRUNCATION_MARKER}`);

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === "marker") {
      const separator = lines.length > 0 ? "\n" : "";
      if (bytes + byteLength(separator) + byteLength(current.text) > maxBytes) {
        truncated = true;
        bytes = appendTruncationMarker(lines, bytes, maxBytes);
        break;
      }
      lines.push(current.text);
      bytes += byteLength(separator) + byteLength(current.text);
      continue;
    }
    if (nodes.length >= WIDGET_MATCH_MAX_NODES) {
      truncated = true;
      bytes = appendTruncationMarker(lines, bytes, maxBytes);
      break;
    }
    const index = nodes.length + 1;
    const separator = lines.length > 0 ? "\n" : "";
    const needsMarker = stack.length > 0 || current.node.children.length > 0;
    const remaining = maxBytes - bytes - byteLength(separator) - (needsMarker ? markerReserve : 0);
    if (remaining <= 0) {
      truncated = true;
      bytes = appendTruncationMarker(lines, bytes, maxBytes);
      break;
    }
    if (byteLength(widgetLinePrefix(index, current.node, current.depth)) > remaining) {
      truncated = true;
      bytes = appendTruncationMarker(lines, bytes, maxBytes);
      break;
    }
    const fullLine = widgetLine(index, current.node, current.depth);
    const line = truncateUtf8(fullLine, remaining);
    if (!line) {
      truncated = true;
      bytes = appendTruncationMarker(lines, bytes, maxBytes);
      break;
    }
    if (line !== fullLine) {
      truncated = true;
      lines.push(line);
      bytes += byteLength(separator) + byteLength(line);
      nodes.push({
        index,
        valueId: current.node.id,
        className: current.node.className,
        label: current.node.label,
      });
      bytes = appendTruncationMarker(lines, bytes, maxBytes);
      break;
    }

    lines.push(line);
    bytes += byteLength(separator) + byteLength(line);
    nodes.push({
      index,
      valueId: current.node.id,
      className: current.node.className,
      label: current.node.label,
    });
    const nextDepth = current.depth + 1;
    if (current.node.children.length > 0 && current.depth >= WIDGET_MATCH_MAX_DEPTH) {
      truncated = true;
      stack.push({ kind: "marker", text: limitMarker(nextDepth, "… depth truncated") });
      continue;
    }
    const visibleChildren = current.node.children.slice(0, WIDGET_MATCH_MAX_CHILDREN);
    const omittedChildren = current.node.children.length - visibleChildren.length;
    if (omittedChildren > 0) {
      truncated = true;
      stack.push({
        kind: "marker",
        text: limitMarker(nextDepth, `… +${omittedChildren} more`),
      });
    }
    for (const child of [...visibleChildren].reverse()) {
      stack.push({ kind: "node", node: child, depth: nextDepth });
    }
  }

  if (stack.length > 0) truncated = true;
  return { text: lines.join("\n"), nodes, truncated };
}

export function buildWidgetMatchPrompt(
  description: string,
  tree: SerializedWidgetTree,
): string {
  const truncation = tree.truncated
    ? "The tree was truncated. Do not infer a match outside the listed nodes."
    : "The tree is complete.";
  return [
    "Select the one Flutter widget that best matches the user's description.",
    "The tree is sanitized: indices, class names, labels, and indentation only.",
    `Tree limits: ${WIDGET_MATCH_MAX_NODES} nodes, ${WIDGET_MATCH_MAX_DEPTH} levels, and ${WIDGET_MATCH_MAX_CHILDREN} children per node; omissions are marked.`,
    truncation,
    "Return only one JSON object with exactly one shape:",
    '{"match":{"index":number}}',
    '{"ambiguous":{"candidates":[{"index":number,"reason":string?}]}}',
    '{"notFound":true}',
    "Use one to three candidates only when the description cannot choose between them.",
    "Widget tree:",
    tree.text,
    "User description as JSON string:",
    JSON.stringify(description),
  ].join("\n");
}

function parseWidgetMatchResponse(
  value: unknown,
  nodes: IndexedWidgetNode[],
): WidgetMatchResult {
  const parsed = widgetMatchResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.message);
  const indexMap = new Map(nodes.map((node) => [node.index, node]));
  const resolveIndex = (index: number): IndexedWidgetNode => {
    const node = indexMap.get(index);
    if (!node) throw new Error(`widget index ${index} is outside the serialized tree`);
    return node;
  };
  return responseToResult(parsed.data, resolveIndex);
}

function responseToResult(
  response: WidgetMatchResponse,
  resolveIndex: (index: number) => IndexedWidgetNode,
): WidgetMatchResult {
  if ("match" in response) return { kind: "match", node: resolveIndex(response.match.index) };
  if ("ambiguous" in response) {
    return {
      kind: "ambiguous",
      candidates: response.ambiguous.candidates.map((candidate) => resolveIndex(candidate.index)),
    };
  }
  return { kind: "notFound" };
}

export function validateWidgetMatchResponse(
  value: unknown,
  nodes: IndexedWidgetNode[],
): WidgetMatchResult {
  return parseWidgetMatchResponse(value, nodes);
}

export async function matchWidget(
  description: string,
  root: SemanticWidgetNode,
): Promise<WidgetMatchResult> {
  const promptOverhead = byteLength(buildWidgetMatchPrompt(description, {
    text: "",
    nodes: [],
    truncated: true,
  }));
  const treeBudget = Math.max(
    0,
    WIDGET_MATCH_MAX_BYTES - promptOverhead - WIDGET_MATCH_PROMPT_MARGIN_BYTES,
  );
  const tree = serializeWidgetTree(root, treeBudget);
  const routed = await routeRawPrompt(buildWidgetMatchPrompt(description, tree));
  if (routed.kind === "unconfigured") return routed;
  if (routed.kind === "error") return routed;

  try {
    const response = JSON.parse(extractRouterText(routed.backend, routed.output)) as unknown;
    return parseWidgetMatchResponse(response, tree.nodes);
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
