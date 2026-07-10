import { z } from "zod";
import type { SemanticWidgetNode } from "./vm";
import { extractRouterText, routeRawPrompt } from "./operatorRouter";
import { configuredRouterBackend } from "../stores/operatorRouterSettings";

export const WIDGET_MATCH_MAX_NODES = 800;
export const WIDGET_MATCH_MAX_BYTES = 16 * 1024;
export const WIDGET_MATCH_PROMPT_MARGIN_BYTES = 256;
export const WIDGET_MATCH_LABEL_MAX_LENGTH = 60;
export const WIDGET_MATCH_DESCRIPTION_MAX_LENGTH = 500;
// Phase 1 selects breadth-first within global node/byte caps, a 12-level depth cap, and 16-child cap.
// Phase 2 renders that selected set in preorder, preserving document indentation without starving siblings.
export const WIDGET_MATCH_MAX_DEPTH = 12;
export const WIDGET_MATCH_MAX_CHILDREN = 16;

const TREE_TRUNCATION_MARKER = "… subtree truncated";
const FILE_URI = /file:\/\/\/[^\s]+/gi;
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

type SelectedWidgetEntry = {
  node: SemanticWidgetNode;
  depth: number;
  markerReservation: number;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function sanitizeRoutedText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/\s+/gu, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(FILE_URI, "…")
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

function capWidgetMatchDescription(description: string): string {
  const characters = Array.from(description);
  return characters.length > WIDGET_MATCH_DESCRIPTION_MAX_LENGTH
    ? `${characters.slice(0, WIDGET_MATCH_DESCRIPTION_MAX_LENGTH - 1).join("")}…`
    : description;
}

function widgetLinePrefix(index: number, node: SemanticWidgetNode, depth: number): string {
  return `${"  ".repeat(depth)}${index} ${sanitizeRoutedText(node.className) ?? "<redacted>"}`;
}

function widgetLine(index: number, node: SemanticWidgetNode, depth: number): string {
  const label = sanitizeRoutedText(node.label);
  return `${widgetLinePrefix(index, node, depth)}${label ? ` — ${label}` : ""}`;
}

function limitMarker(depth: number, text: string): string {
  return `${"  ".repeat(depth)}${text}`;
}

function lineCost(line: string): number {
  return byteLength(line) + 1;
}

function nodeCost(node: SemanticWidgetNode, depth: number): number {
  return lineCost(widgetLine(WIDGET_MATCH_MAX_NODES, node, depth));
}

function markerCost(depth: number, omittedChildren: number): number {
  return lineCost(limitMarker(depth, `… +${omittedChildren} more`));
}

function selectWidgetNodes(root: SemanticWidgetNode, maxBytes: number): {
  selected: Set<SemanticWidgetNode>;
  truncated: boolean;
} {
  const selected = new Set<SemanticWidgetNode>();
  const queue: SelectedWidgetEntry[] = [];
  let bytes = 0;
  let truncated = false;

  const select = (node: SemanticWidgetNode, depth: number): boolean => {
    const reservation = node.children.length > 0
      ? markerCost(depth + 1, node.children.length)
      : 0;
    const cost = nodeCost(node, depth) + reservation;
    if (selected.size >= WIDGET_MATCH_MAX_NODES || bytes + cost > maxBytes) return false;
    selected.add(node);
    bytes += cost;
    queue.push({ node, depth, markerReservation: reservation });
    return true;
  };

  if (!select(root, 0)) return { selected, truncated: true };

  while (queue.length > 0) {
    const current = queue.shift()!;
    const visibleChildren = current.depth < WIDGET_MATCH_MAX_DEPTH
      ? current.node.children.slice(0, WIDGET_MATCH_MAX_CHILDREN)
      : [];
    let selectedChildren = 0;

    for (const child of visibleChildren) {
      if (!select(child, current.depth + 1)) break;
      selectedChildren += 1;
    }

    const omittedChildren = current.node.children.length - selectedChildren;
    if (omittedChildren === 0) {
      bytes -= current.markerReservation;
      continue;
    }

    truncated = true;
    bytes -= current.markerReservation - markerCost(current.depth + 1, omittedChildren);
    if (selectedChildren < visibleChildren.length) break;
  }

  return { selected, truncated };
}

export function serializeWidgetTree(
  root: SemanticWidgetNode,
  maxBytes = WIDGET_MATCH_MAX_BYTES,
): SerializedWidgetTree {
  const selection = selectWidgetNodes(root, maxBytes);
  const nodes: IndexedWidgetNode[] = [];
  const lines: string[] = [];
  let bytes = 0;
  let truncated = selection.truncated;

  const append = (line: string): boolean => {
    const separator = lines.length > 0 ? "\n" : "";
    const cost = byteLength(separator) + byteLength(line);
    if (bytes + cost > maxBytes) return false;
    lines.push(line);
    bytes += cost;
    return true;
  };

  const appendFallbackMarker = (): void => {
    if (append(TREE_TRUNCATION_MARKER)) return;
  };

  const render = (node: SemanticWidgetNode, depth: number): boolean => {
    const index = nodes.length + 1;
    if (!append(widgetLine(index, node, depth))) {
      truncated = true;
      appendFallbackMarker();
      return false;
    }
    nodes.push({
      index,
      valueId: node.id,
      className: node.className,
      label: node.label,
    });

    for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
      const child = node.children[childIndex];
      if (!selection.selected.has(child)) {
        truncated = true;
        if (!append(limitMarker(depth + 1, `… +${node.children.length - childIndex} more`))) {
          appendFallbackMarker();
          return false;
        }
        return true;
      }
      if (!render(child, depth + 1)) return false;
    }
    return true;
  };

  if (selection.selected.has(root)) render(root, 0);
  else appendFallbackMarker();
  return { text: lines.join("\n"), nodes, truncated };
}

export function buildWidgetMatchPrompt(
  description: string,
  tree: SerializedWidgetTree,
): string {
  const cappedDescription = capWidgetMatchDescription(description);
  const truncation = tree.truncated
    ? "The tree was truncated. Do not infer a match outside the listed nodes."
    : "The tree is complete.";
  return [
    "Select the one Flutter widget that best matches the user's description.",
    "The tree is sanitized: indices, class names, labels, and indentation only.",
    `Tree limits: ${WIDGET_MATCH_MAX_NODES} nodes and ${WIDGET_MATCH_MAX_BYTES / 1024} KiB, ${WIDGET_MATCH_MAX_DEPTH} levels, and ${WIDGET_MATCH_MAX_CHILDREN} children per node; selection is breadth-first and rendering is preorder.`,
    truncation,
    "Return only one JSON object with exactly one shape:",
    '{"match":{"index":number}}',
    '{"ambiguous":{"candidates":[{"index":number,"reason":string?}]}}',
    '{"notFound":true}',
    "Use one to three candidates only when the description cannot choose between them.",
    "Widget tree:",
    tree.text,
    "User description as JSON string:",
    JSON.stringify(cappedDescription),
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
  // Semantic selection runs only over the local/BYO raw transport; the hosted
  // endpoint does not accept widget-tree payloads yet, so degrade honestly
  // rather than route through an unconfigured transport and return an empty match.
  if (configuredRouterBackend() === "hosted") {
    return {
      kind: "error",
      message: "semantic widget selection uses a BYO router — set one in Settings",
    };
  }

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
