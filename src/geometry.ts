import type { BoardNode } from "./domain";

export type AlignEdge = "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom";
export type SelectionBox = { minX: number; minY: number; maxX: number; maxY: number };
export type SnapGuide = { axis: "x" | "y"; at: number; from: number; to: number };

export const ALIGN_EDGES: Array<{ id: AlignEdge; label: string }> = [
  { id: "left", label: "Align left edges" },
  { id: "horizontal-center", label: "Align horizontal centers" },
  { id: "right", label: "Align right edges" },
  { id: "top", label: "Align top edges" },
  { id: "vertical-center", label: "Align vertical centers" },
  { id: "bottom", label: "Align bottom edges" },
];

export const SNAP_TOLERANCE = 6;

export function nodeCenter(node: BoardNode): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

export function boundingBox(nodes: readonly BoardNode[]): SelectionBox {
  return {
    minX: Math.min(...nodes.map((node) => node.x)),
    minY: Math.min(...nodes.map((node) => node.y)),
    maxX: Math.max(...nodes.map((node) => node.x + node.width)),
    maxY: Math.max(...nodes.map((node) => node.y + node.height)),
  };
}

export function intersects(node: BoardNode, box: SelectionBox): boolean {
  return node.x < box.maxX && node.x + node.width > box.minX && node.y < box.maxY && node.y + node.height > box.minY;
}

export function alignedPosition(node: BoardNode, box: SelectionBox, edge: AlignEdge): { x: number; y: number } {
  if (edge === "left") return { x: box.minX, y: node.y };
  if (edge === "right") return { x: box.maxX - node.width, y: node.y };
  if (edge === "horizontal-center") return { x: Math.round((box.minX + box.maxX) / 2 - node.width / 2), y: node.y };
  if (edge === "top") return { x: node.x, y: box.minY };
  if (edge === "bottom") return { x: node.x, y: box.maxY - node.height };
  return { x: node.x, y: Math.round((box.minY + box.maxY) / 2 - node.height / 2) };
}

/**
 * Figma-style edge and centre snapping: nudge the dragged box onto the nearest
 * static edge within tolerance and report the guides that justify the nudge.
 */
export function snapToNeighbours(box: SelectionBox, neighbours: readonly BoardNode[], zoom: number): { dx: number; dy: number; guides: SnapGuide[] } {
  const tolerance = SNAP_TOLERANCE / Math.max(zoom, 0.2);
  const movingX = [box.minX, (box.minX + box.maxX) / 2, box.maxX];
  const movingY = [box.minY, (box.minY + box.maxY) / 2, box.maxY];
  let best: { dx: number; distance: number; guide: SnapGuide } | null = null;
  let bestY: { dy: number; distance: number; guide: SnapGuide } | null = null;
  for (const neighbour of neighbours) {
    const staticX = [neighbour.x, neighbour.x + neighbour.width / 2, neighbour.x + neighbour.width];
    const staticY = [neighbour.y, neighbour.y + neighbour.height / 2, neighbour.y + neighbour.height];
    for (const from of movingX) {
      for (const to of staticX) {
        const distance = Math.abs(to - from);
        if (distance > tolerance || (best !== null && distance >= best.distance)) continue;
        best = {
          dx: to - from,
          distance,
          guide: { axis: "x", at: to, from: Math.min(box.minY, neighbour.y), to: Math.max(box.maxY, neighbour.y + neighbour.height) },
        };
      }
    }
    for (const from of movingY) {
      for (const to of staticY) {
        const distance = Math.abs(to - from);
        if (distance > tolerance || (bestY !== null && distance >= bestY.distance)) continue;
        bestY = {
          dy: to - from,
          distance,
          guide: { axis: "y", at: to, from: Math.min(box.minX, neighbour.x), to: Math.max(box.maxX, neighbour.x + neighbour.width) },
        };
      }
    }
  }
  return {
    dx: best?.dx ?? 0,
    dy: bestY?.dy ?? 0,
    guides: [...(best === null ? [] : [best.guide]), ...(bestY === null ? [] : [bestY.guide])],
  };
}
