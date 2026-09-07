import type { BoardNode, BoardOperation } from "./domain";
import { boundingBox } from "./geometry";

export type Placement = "front" | "back" | "forward" | "backward";
export type DistributeAxis = "horizontal" | "vertical";
export type TidyUpOptions = { gutter?: number; columns?: number };

export const DEFAULT_TIDY_GUTTER = 24;

/** Board array order is z-order, so re-ordering is a single domain operation. */
export function reorderOperation(ids: string[], placement: Placement): BoardOperation {
  return { type: "reorder_nodes", ids: [...new Set(ids)], placement };
}

function moveOperation(node: BoardNode, x: number, y: number): BoardOperation | null {
  const patch: { x?: number; y?: number } = {};
  if (x !== node.x) patch.x = x;
  if (y !== node.y) patch.y = y;
  if (patch.x === undefined && patch.y === undefined) return null;
  return { type: "update_node", id: node.id, patch };
}

function movable(nodes: readonly BoardNode[]): BoardNode[] {
  return nodes.filter((node) => !node.locked);
}

export function groupOperations(nodes: readonly BoardNode[], groupId: string): BoardOperation[] {
  return nodes
    .filter((node) => node.groupId !== groupId)
    .map((node) => ({ type: "update_node", id: node.id, patch: { groupId } }));
}

export function ungroupOperations(nodes: readonly BoardNode[]): BoardOperation[] {
  return nodes
    .filter((node) => node.groupId !== null)
    .map((node) => ({ type: "update_node", id: node.id, patch: { groupId: null } }));
}

export function lockOperations(nodes: readonly BoardNode[], locked: boolean): BoardOperation[] {
  return nodes
    .filter((node) => node.locked !== locked)
    .map((node) => ({ type: "update_node", id: node.id, patch: { locked } }));
}

/**
 * Touching one member of a group selects the whole group. Ungrouped nodes are
 * passed through untouched; the result keeps board order and is duplicate free.
 */
export function expandToGroups(all: readonly BoardNode[], selectedIds: readonly string[]): string[] {
  if (selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  const groups = new Set<string>();
  for (const node of all) {
    if (node.groupId !== null && selected.has(node.id)) groups.add(node.groupId);
  }
  return all
    .filter((node) => selected.has(node.id) || (node.groupId !== null && groups.has(node.groupId)))
    .map((node) => node.id);
}

/**
 * Figma-style distribute: hold the first and last object in place and give every
 * gap between the objects the same size. Needs three movable objects to mean
 * anything.
 */
export function distributeOperations(nodes: readonly BoardNode[], axis: DistributeAxis): BoardOperation[] {
  const items = movable(nodes);
  if (items.length < 3) return [];
  const horizontal = axis === "horizontal";
  const start = (node: BoardNode): number => (horizontal ? node.x : node.y);
  const size = (node: BoardNode): number => (horizontal ? node.width : node.height);

  const ordered = [...items].sort((a, b) => start(a) - start(b) || a.id.localeCompare(b.id));
  const box = boundingBox(ordered);
  const span = horizontal ? box.maxX - box.minX : box.maxY - box.minY;
  const occupied = ordered.reduce((total, node) => total + size(node), 0);
  const gap = (span - occupied) / (ordered.length - 1);

  const operations: BoardOperation[] = [];
  let cursor = start(ordered[0]!);
  for (const node of ordered) {
    const at = Math.round(cursor);
    const operation = horizontal ? moveOperation(node, at, node.y) : moveOperation(node, node.x, at);
    if (operation !== null) operations.push(operation);
    cursor += size(node) + gap;
  }
  return operations;
}

/**
 * FigJam-style tidy up: snap the selection into a uniform grid that preserves
 * reading order (top to bottom, then left to right), anchored at the selection's
 * existing top-left so nothing jumps across the board. Rows take the height of
 * their tallest member, columns the width of their widest.
 */
export function tidyUpOperations(nodes: readonly BoardNode[], options: TidyUpOptions = {}): BoardOperation[] {
  const items = movable(nodes);
  if (items.length < 2) return [];
  const gutter = options.gutter ?? DEFAULT_TIDY_GUTTER;
  const columns = Math.max(1, Math.floor(options.columns ?? Math.ceil(Math.sqrt(items.length))));
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const box = boundingBox(ordered);

  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  ordered.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, node.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, node.height);
  });

  const columnOffsets = columnWidths.map((_, index) =>
    columnWidths.slice(0, index).reduce((total, width) => total + width + gutter, 0),
  );
  const rowOffsets = rowHeights.map((_, index) =>
    rowHeights.slice(0, index).reduce((total, height) => total + height + gutter, 0),
  );

  const operations: BoardOperation[] = [];
  ordered.forEach((node, index) => {
    const x = box.minX + columnOffsets[index % columns]!;
    const y = box.minY + rowOffsets[Math.floor(index / columns)]!;
    const operation = moveOperation(node, Math.round(x), Math.round(y));
    if (operation !== null) operations.push(operation);
  });
  return operations;
}
