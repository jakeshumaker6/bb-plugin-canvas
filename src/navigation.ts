import type { BoardNode } from "./domain";
import { boundingBox, type SelectionBox } from "./geometry";

export type Viewport = { x: number; y: number; zoom: number };

/** Matches the zoom clamp used by the workspace zoom controls and wheel handler. */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;

/** Frame the minimap is drawn at; exported so callers and CSS stay in step. */
export const MINIMAP_FRAME = { width: 180, height: 120 } as const;

/** Board region shown when there is nothing to fit around. */
const DEFAULT_BOUNDS: SelectionBox = { minX: 0, minY: 0, maxX: 1600, maxY: 1000 };
/** Never let a board collapse to a sliver: division by ~0 gives Infinity. */
const MIN_SPAN = 200;
/** Breathing room so edge objects are not flush against the minimap border. */
const PAD_RATIO = 0.08;
const MIN_PAD = 32;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Padded bounding box of everything on the board. Always finite and always
 * non-zero in both axes, so every downstream division is safe.
 */
export function contentBounds(nodes: readonly BoardNode[], fallback?: SelectionBox): SelectionBox {
  const base = nodes.length === 0 ? fallback ?? DEFAULT_BOUNDS : boundingBox(nodes);
  const minX = finite(base.minX, DEFAULT_BOUNDS.minX);
  const minY = finite(base.minY, DEFAULT_BOUNDS.minY);
  const maxX = finite(base.maxX, DEFAULT_BOUNDS.maxX);
  const maxY = finite(base.maxY, DEFAULT_BOUNDS.maxY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = Math.max(Math.abs(maxX - minX), MIN_SPAN);
  const height = Math.max(Math.abs(maxY - minY), MIN_SPAN);
  const padX = Math.max(width * PAD_RATIO, MIN_PAD);
  const padY = Math.max(height * PAD_RATIO, MIN_PAD);
  return {
    minX: centerX - width / 2 - padX,
    minY: centerY - height / 2 - padY,
    maxX: centerX + width / 2 + padX,
    maxY: centerY + height / 2 + padY,
  };
}

/**
 * Uniform scale + centring offsets mapping a board box into a fixed frame:
 * a board point (bx, by) lands at (bx * scale + offsetX, by * scale + offsetY).
 */
export function minimapTransform(
  bounds: SelectionBox,
  frame: { width: number; height: number },
): { scale: number; offsetX: number; offsetY: number } {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const frameWidth = Math.max(finite(frame.width, MINIMAP_FRAME.width), 1);
  const frameHeight = Math.max(finite(frame.height, MINIMAP_FRAME.height), 1);
  const scale = Math.min(frameWidth / width, frameHeight / height);
  return {
    scale,
    offsetX: (frameWidth - width * scale) / 2 - bounds.minX * scale,
    offsetY: (frameHeight - height * scale) / 2 - bounds.minY * scale,
  };
}

/**
 * The slice of board currently visible in the surface, expressed in minimap
 * pixels. Higher zoom shows less board, so the rect shrinks.
 */
export function viewportRectOnMinimap(
  viewport: Viewport,
  surface: { width: number; height: number },
  transform: { scale: number; offsetX: number; offsetY: number },
): { left: number; top: number; width: number; height: number } {
  const zoom = clamp(finite(viewport.zoom, 1), MIN_ZOOM, MAX_ZOOM);
  const boardLeft = -finite(viewport.x, 0) / zoom;
  const boardTop = -finite(viewport.y, 0) / zoom;
  const boardWidth = Math.max(finite(surface.width, 0), 0) / zoom;
  const boardHeight = Math.max(finite(surface.height, 0), 0) / zoom;
  return {
    left: boardLeft * transform.scale + transform.offsetX,
    top: boardTop * transform.scale + transform.offsetY,
    width: boardWidth * transform.scale,
    height: boardHeight * transform.scale,
  };
}

/** Viewport that puts a board point in the middle of the surface. */
export function viewportCenteredOn(
  point: { x: number; y: number },
  surface: { width: number; height: number },
  zoom: number,
): Viewport {
  const safeZoom = clamp(finite(zoom, 1), MIN_ZOOM, MAX_ZOOM);
  return {
    x: Math.max(finite(surface.width, 0), 0) / 2 - finite(point.x, 0) * safeZoom,
    y: Math.max(finite(surface.height, 0), 0) / 2 - finite(point.y, 0) * safeZoom,
    zoom: safeZoom,
  };
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Case-insensitive, whitespace-tolerant substring search over node text and
 * kind. Prefix hits rank above word-start hits, which rank above mid-string
 * hits; ties keep board order.
 */
export function matchNodes(nodes: readonly BoardNode[], query: string): BoardNode[] {
  const needle = normalise(query);
  if (needle === "") return [];
  const scored: Array<{ node: BoardNode; rank: number; at: number; order: number }> = [];
  nodes.forEach((node, order) => {
    const text = normalise(node.text);
    const haystack = normalise(`${node.text} ${node.kind}`);
    const at = haystack.indexOf(needle);
    if (at < 0) return;
    const textAt = text.indexOf(needle);
    const rank = textAt === 0 || at === 0 ? 0 : / /.test(haystack.charAt(at - 1)) ? 1 : 2;
    scored.push({ node, rank, at, order });
  });
  scored.sort((a, b) => a.rank - b.rank || a.at - b.at || a.order - b.order);
  return scored.map((item) => item.node);
}
