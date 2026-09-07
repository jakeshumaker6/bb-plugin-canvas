import type { BoardEdge, BoardNode, BoardNodeKind } from "./domain";

/** Spoken name for each kind. Declared as a full Record so a new kind fails tsc here. */
export const KIND_LABELS: Record<BoardNodeKind, string> = {
  sticky: "sticky note",
  rectangle: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  cylinder: "cylinder",
  cloud: "cloud",
  parallelogram: "parallelogram",
  hexagon: "hexagon",
  triangle: "triangle",
  actor: "actor",
  text: "text box",
  image: "image",
};

export type ObjectRef = { kind: "node" | "edge"; id: string };

const NAME_LIMIT = 60;

/** A name that distinguishes this object from every other one on the board. */
export function objectName(node: BoardNode): string {
  const text = node.text.replace(/\s+/g, " ").trim();
  // Cut by code point so an emoji at the boundary is never split into lone surrogates.
  const points = Array.from(text);
  const base = text === ""
    ? `Untitled ${KIND_LABELS[node.kind]} at ${Math.round(node.x)}, ${Math.round(node.y)}`
    : points.length > NAME_LIMIT ? `${points.slice(0, NAME_LIMIT).join("")}…` : text;
  return node.locked ? `${base}, locked` : base;
}

export function connectorName(edge: BoardEdge, source: BoardNode | undefined, target: BoardNode | undefined): string {
  const from = source === undefined ? "unknown object" : objectName(source);
  const to = target === undefined ? "unknown object" : objectName(target);
  const label = edge.label.replace(/\s+/g, " ").trim();
  return label === "" ? `Connector from ${from} to ${to}` : `Connector "${label}" from ${from} to ${to}`;
}

/** Reading order: nodes top-to-bottom then left-to-right, with connectors appended. */
export function objectOrder(board: { nodes: readonly BoardNode[]; edges: readonly BoardEdge[] }): ObjectRef[] {
  const nodes = [...board.nodes].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const position = new Map(nodes.map((node, index) => [node.id, index]));
  const rank = (id: string): number => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  const edges = [...board.edges].sort((a, b) =>
    rank(a.source) - rank(b.source)
    || rank(a.target) - rank(b.target)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [
    ...nodes.map((node): ObjectRef => ({ kind: "node", id: node.id })),
    ...edges.map((edge): ObjectRef => ({ kind: "edge", id: edge.id })),
  ];
}

/** Steps the keyboard cursor. Returns null past either end so the canvas is never a tab trap. */
export function nextObject(order: readonly ObjectRef[], current: ObjectRef | null, step: 1 | -1): ObjectRef | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.findIndex((ref) => ref.kind === current.kind && ref.id === current.id);
  if (index === -1) return step === 1 ? order[0]! : order[order.length - 1]!;
  const next = index + step;
  return next < 0 || next >= order.length ? null : order[next]!;
}

export function domId(ref: ObjectRef): string {
  return `canvas-object-${ref.id}`;
}
