import type { BoardEdge, BoardNode } from "./domain";
import { nodeCenter } from "./geometry";

export type AnchorSide = "top" | "right" | "bottom" | "left";
export type Anchor = { x: number; y: number; side: AnchorSide };
export type Point = { x: number; y: number };

const MIN_CURVE = 32;
const CURVE_RATIO = 0.35;

const NORMALS: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function format(value: number): string {
  return String(Math.round(safe(value) * 100) / 100);
}

function isHorizontal(side: AnchorSide): boolean {
  return side === "left" || side === "right";
}

export function anchorsFor(node: BoardNode): Anchor[] {
  const { x, y } = nodeCenter(node);
  const left = safe(node.x);
  const top = safe(node.y);
  const right = left + safe(node.width);
  const bottom = top + safe(node.height);
  return [
    { x: safe(x), y: top, side: "top" },
    { x: right, y: safe(y), side: "right" },
    { x: safe(x), y: bottom, side: "bottom" },
    { x: left, y: safe(y), side: "left" },
  ];
}

function anchorOn(node: BoardNode, side: AnchorSide): Anchor {
  const anchors = anchorsFor(node);
  return anchors.find((anchor) => anchor.side === side) ?? anchors[0]!;
}

export function chooseAnchors(source: BoardNode, target: BoardNode): { from: Anchor; to: Anchor } {
  const a = nodeCenter(source);
  const b = nodeCenter(target);
  const dx = safe(b.x - a.x);
  const dy = safe(b.y - a.y);
  if (Math.abs(dx) >= Math.abs(dy)) {
    const forward = dx >= 0;
    return {
      from: anchorOn(source, forward ? "right" : "left"),
      to: anchorOn(target, forward ? "left" : "right"),
    };
  }
  const downward = dy >= 0;
  return {
    from: anchorOn(source, downward ? "bottom" : "top"),
    to: anchorOn(target, downward ? "top" : "bottom"),
  };
}

function elbowPoints(from: Anchor, to: Anchor): readonly [Point, Point, Point, Point] {
  if (isHorizontal(from.side)) {
    const midX = (from.x + to.x) / 2;
    return [
      { x: from.x, y: from.y },
      { x: midX, y: from.y },
      { x: midX, y: to.y },
      { x: to.x, y: to.y },
    ];
  }
  const midY = (from.y + to.y) / 2;
  return [
    { x: from.x, y: from.y },
    { x: from.x, y: midY },
    { x: to.x, y: midY },
    { x: to.x, y: to.y },
  ];
}

function controlOffset(from: Anchor, to: Anchor): number {
  const distance = Math.hypot(safe(to.x - from.x), safe(to.y - from.y));
  return Math.max(MIN_CURVE, distance * CURVE_RATIO);
}

function curveControls(from: Anchor, to: Anchor): readonly [Point, Point] {
  const offset = controlOffset(from, to);
  const a = NORMALS[from.side];
  const b = NORMALS[to.side];
  return [
    { x: from.x + a.x * offset, y: from.y + a.y * offset },
    { x: to.x + b.x * offset, y: to.y + b.y * offset },
  ];
}

export function connectorPath(source: BoardNode, target: BoardNode, routing: BoardEdge["routing"]): string {
  const { from, to } = chooseAnchors(source, target);
  if (routing === "elbow") {
    const [start, ...rest] = elbowPoints(from, to);
    return `M ${format(start.x)} ${format(start.y)}${rest.map((point) => ` L ${format(point.x)} ${format(point.y)}`).join("")}`;
  }
  if (routing === "curved") {
    const [c1, c2] = curveControls(from, to);
    return `M ${format(from.x)} ${format(from.y)} C ${format(c1.x)} ${format(c1.y)}, ${format(c2.x)} ${format(c2.y)}, ${format(to.x)} ${format(to.y)}`;
  }
  return `M ${format(from.x)} ${format(from.y)} L ${format(to.x)} ${format(to.y)}`;
}

export function connectorLabelPoint(
  source: BoardNode,
  target: BoardNode,
  routing: BoardEdge["routing"],
): Point {
  const { from, to } = chooseAnchors(source, target);
  if (routing === "elbow") {
    const [, second, third] = elbowPoints(from, to);
    return { x: safe((second.x + third.x) / 2), y: safe((second.y + third.y) / 2) };
  }
  if (routing === "curved") {
    const [c1, c2] = curveControls(from, to);
    return {
      x: safe((from.x + 3 * c1.x + 3 * c2.x + to.x) / 8),
      y: safe((from.y + 3 * c1.y + 3 * c2.y + to.y) / 8),
    };
  }
  return { x: safe((from.x + to.x) / 2), y: safe((from.y + to.y) / 2) };
}
