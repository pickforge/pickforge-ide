import { z } from "zod";
import type { SemanticWidgetNode } from "./vm";
import { extractRouterText, routeRawPrompt } from "./operatorRouter";

export const WIDGET_MATCH_MAX_NODES = 800;
export const WIDGET_MATCH_MAX_BYTES = 16 * 1024;

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

type QueuedWidgetNode = {
  node: SemanticWidgetNode;
  depth: number;
};

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

function widgetLinePrefix(index: number, node: SemanticWidgetNode, depth: number): string {
  return `${"  ".repeat(depth)}${index} ${node.className}`;
}

function widgetLine(index: number, node: SemanticWidgetNode, depth: number): string {
  const label = node.label?.trim();
  return `${widgetLinePrefix(index, node, depth)}${label ? ` — ${label}` : ""}`;
}

export function serializeWidgetTree(root: SemanticWidgetNode): SerializedWidgetTree {
  const queue: QueuedWidgetNode[] = [{ node: root, depth: 0 }];
  const nodes: IndexedWidgetNode[] = [];
  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (nodes.length >= WIDGET_MATCH_MAX_NODES) {
      truncated = true;
      break;
    }
    const current = queue.shift()!;
    const index = nodes.length + 1;
    const separator = lines.length > 0 ? "\n" : "";
    const remaining = WIDGET_MATCH_MAX_BYTES - bytes - byteLength(separator);
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (byteLength(widgetLinePrefix(index, current.node, current.depth)) > remaining) {
      truncated = true;
      break;
    }
    const fullLine = widgetLine(index, current.node, current.depth);
    const line = truncateUtf8(fullLine, remaining);
    if (!line) {
      truncated = true;
      break;
    }
    if (line !== fullLine) truncated = true;

    lines.push(line);
    bytes += byteLength(separator) + byteLength(line);
    nodes.push({
      index,
      valueId: current.node.id,
      className: current.node.className,
      label: current.node.label,
    });
    for (const child of current.node.children) {
      queue.push({ node: child, depth: current.depth + 1 });
    }
  }

  if (queue.length > 0) truncated = true;
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
  const tree = serializeWidgetTree(root);
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
