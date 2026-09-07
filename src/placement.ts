import type { BoardNode, BoardNodeKind } from "./domain";
import { intersects } from "./geometry";

export type PlaceableKind = Exclude<BoardNodeKind, "image">;

/** Breathing room between a new object and the one it was placed next to. */
export const PLACEMENT_GAP = 40;

/** Half-extents: a pointer-placed object is centred on the click. */
export const PLACEMENT_OFFSETS: Record<PlaceableKind, { x: number; y: number }> = {
  sticky: { x: 110, y: 80 },
  rectangle: { x: 110, y: 60 },
  ellipse: { x: 100, y: 65 },
  diamond: { x: 90, y: 90 },
  cylinder: { x: 90, y: 70 },
  cloud: { x: 110, y: 70 },
  parallelogram: { x: 110, y: 55 },
  hexagon: { x: 100, y: 60 },
  triangle: { x: 90, y: 75 },
  actor: { x: 60, y: 85 },
  text: { x: 120, y: 36 },
};

/** Derived from the offsets so keyboard and pointer placement can never disagree on size. */
export const DEFAULT_SIZE: Record<PlaceableKind, { width: number; height: number }> = Object.fromEntries(
  Object.entries(PLACEMENT_OFFSETS).map(([kind, offset]) => [kind, { width: offset.x * 2, height: offset.y * 2 }]),
) as Record<PlaceableKind, { width: number; height: number }>;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
/** Enough rows to clear a dense cluster, few enough that placement can never hang. */
const MAX_STEPS = 12;

function safeZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The board coordinate under the middle of the surface. Always finite, whatever the viewport holds. */
export function viewportCenterPoint(
  viewport: { x: number; y: number; zoom: number },
  surface: { width: number; height: number },
): { x: number; y: number } {
  const zoom = safeZoom(viewport.zoom);
  const x = Number.isFinite(viewport.x) ? viewport.x : 0;
  const y = Number.isFinite(viewport.y) ? viewport.y : 0;
  const width = Number.isFinite(surface.width) ? surface.width : 0;
  const height = Number.isFinite(surface.height) ? surface.height : 0;
  return { x: Math.round((width / 2 - x) / zoom), y: Math.round((height / 2 - y) / zoom) };
}

/** Top-left for a new object: beside the anchor when there is one, otherwise at the caret. */
export function insertionPoint(options: {
  anchor: BoardNode | null;
  caret: { x: number; y: number };
  size: { width: number; height: number };
  nodes: readonly BoardNode[];
}): { x: number; y: number } {
  const { anchor, caret, size, nodes } = options;
  const x = anchor === null ? caret.x : anchor.x + anchor.width + PLACEMENT_GAP;
  let y = anchor === null ? caret.y : anchor.y;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const box = { minX: x, minY: y, maxX: x + size.width, maxY: y + size.height };
    if (!nodes.some((node) => intersects(node, box))) break;
    y += size.height + PLACEMENT_GAP;
  }
  return { x, y };
}
