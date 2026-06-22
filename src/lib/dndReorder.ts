// Pure helpers for list-reorder drag-and-drop in the projects tree (projects and
// their chats). Kept Tauri-free so the index math is unit-testable.

/** Where a drop on a row lands relative to that row. */
export type DropEdge = "before" | "after";

/** Decide whether a pointer at `pointerY` over a row spanning `[top, bottom]`
 *  should insert BEFORE or AFTER the row: above the vertical midpoint → before,
 *  at/below → after. This is what makes reordering work in both directions —
 *  dragging downward past an item must land AFTER it, not before. */
export function dropEdge(pointerY: number, top: number, bottom: number): DropEdge {
  return pointerY < (top + bottom) / 2 ? "before" : "after";
}

/** Convenience over `dropEdge` taking a DOMRect-shaped box (vertical lists). */
export function dropEdgeForRect(
  pointerY: number,
  rect: { top: number; bottom: number },
): DropEdge {
  return dropEdge(pointerY, rect.top, rect.bottom);
}

/** Horizontal-axis variant for left-to-right flows (e.g. the grid of project
 *  cards): left of the horizontal midpoint → before, at/right → after. */
export function dropEdgeForRectX(
  pointerX: number,
  rect: { left: number; right: number },
): DropEdge {
  return dropEdge(pointerX, rect.left, rect.right);
}

/** Translate a (targetId, edge) drop into the id the dragged item should sit
 *  BEFORE — the model `reorderChat`/`reorderProject` consume (null = move to the
 *  end). `before` keeps the target id; `after` resolves to the id of the row that
 *  follows the target in `order`, or null when the target is last.
 *
 *  `order` is the full ordered id list (including the dragged id). */
export function beforeIdForDrop(
  order: string[],
  targetId: string,
  edge: DropEdge,
): string | null {
  if (edge === "before") return targetId;
  const i = order.indexOf(targetId);
  if (i < 0) return null;
  return order[i + 1] ?? null;
}

/** Apply a (targetId, edge) drop to `order`, returning the new ordered id list.
 *  Returns `null` for a no-op — dropping an item onto itself, or onto the slot it
 *  already occupies (e.g. just below its current upper neighbor). The store and
 *  the tests share this so both-direction correctness is asserted on the exact
 *  ordering the model persists. */
export function reorder(
  order: string[],
  draggedId: string,
  targetId: string,
  edge: DropEdge,
): string[] | null {
  if (draggedId === targetId || order.indexOf(draggedId) < 0) return null;

  const beforeId = beforeIdForDrop(order, targetId, edge);
  if (beforeId === draggedId) return null; // already sits in that slot

  const rest = order.filter((id) => id !== draggedId);
  const insertAt = beforeId == null ? rest.length : rest.indexOf(beforeId);
  const next = [...rest];
  next.splice(insertAt < 0 ? rest.length : insertAt, 0, draggedId);

  // Unchanged order ⇒ no-op (the dragged item was already in this exact slot).
  return next.every((id, i) => id === order[i]) ? null : next;
}
