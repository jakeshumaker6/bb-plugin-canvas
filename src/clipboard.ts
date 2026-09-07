import { z } from "zod";
import {
  boardEdgeSchema,
  boardNodeSchema,
  type BoardDocument,
  type BoardEdge,
  type BoardNode,
  type BoardOperation,
} from "./domain";
import { boundingBox } from "./geometry";

/** Custom flavour we put on the DataTransfer so we can recognise our own text. */
export const CLIPBOARD_MIME = "application/x-bb-canvas";
export const CLIPBOARD_VERSION = 1 as const;

/** Clipboard text is untrusted OS input: cap it before anything parses it. */
const MAX_CLIPBOARD_CHARS = 5_000_000;
const MAX_IMAGE_DATA_CHARS = 7_000_000;
const DEFAULT_PASTE_OFFSET = 24;
const DEFAULT_IMAGE_SIZE = { width: 480, height: 320 } as const;

export type ClipboardPayload = { nodes: BoardNode[]; edges: BoardEdge[] };

const clipboardEnvelopeSchema = z
  .object({
    mime: z.literal(CLIPBOARD_MIME),
    version: z.literal(CLIPBOARD_VERSION),
    nodes: z.array(boardNodeSchema).max(2000),
    edges: z.array(boardEdgeSchema).max(4000),
  })
  .strict();

/**
 * Selected nodes plus only the connectors fully inside the selection — a copied
 * pair of boxes carries its connector, a copied single box carries none.
 */
export function serializeSelection(board: BoardDocument, selectedIds: readonly string[]): string {
  const ids = new Set(selectedIds);
  const nodes = board.nodes.filter((node) => ids.has(node.id));
  const kept = new Set(nodes.map((node) => node.id));
  const edges = board.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
  return JSON.stringify({ mime: CLIPBOARD_MIME, version: CLIPBOARD_VERSION, nodes, edges });
}

/** Null — never a throw — for foreign text, malformed JSON, a wrong version, or oversized input. */
export function parseClipboard(text: string): ClipboardPayload | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_CLIPBOARD_CHARS) return null;
  if (!text.includes(CLIPBOARD_MIME)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = clipboardEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { nodes, edges } = parsed.data;
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}

/**
 * Rebuild the payload with fresh ids so a paste never collides with the source
 * board or with an earlier paste. Groups survive as a new distinct group and
 * locked is cleared so the paste is immediately editable.
 */
export function pasteOperations(
  payload: ClipboardPayload,
  options: { at?: { x: number; y: number }; offset?: number; makeId: () => string },
): BoardOperation[] {
  if (payload.nodes.length === 0) return [];
  const offset = options.offset ?? DEFAULT_PASTE_OFFSET;
  const box = boundingBox(payload.nodes);
  const dx = options.at === undefined ? offset : options.at.x - box.minX;
  const dy = options.at === undefined ? offset : options.at.y - box.minY;

  const nodeIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const operations: BoardOperation[] = [];

  for (const node of payload.nodes) {
    const id = options.makeId();
    nodeIds.set(node.id, id);
    let groupId: string | null = null;
    if (node.groupId !== null) {
      groupId = groupIds.get(node.groupId) ?? options.makeId();
      groupIds.set(node.groupId, groupId);
    }
    operations.push({
      type: "add_node",
      node: {
        id,
        kind: node.kind,
        x: node.x + dx,
        y: node.y + dy,
        width: node.width,
        height: node.height,
        text: node.text,
        color: node.color,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        textAlign: node.textAlign,
        locked: false,
        groupId,
        ...(node.imageData === undefined ? {} : { imageData: node.imageData }),
      },
    });
  }

  for (const edge of payload.edges) {
    const source = nodeIds.get(edge.source);
    const target = nodeIds.get(edge.target);
    if (source === undefined || target === undefined) continue;
    operations.push({
      type: "add_edge",
      edge: {
        id: options.makeId(),
        source,
        target,
        label: edge.label,
        color: edge.color,
        routing: edge.routing,
        arrow: edge.arrow,
      },
    });
  }

  return operations;
}

/** Pasted or dropped image bytes, already read into a data URL by the caller. */
export function imageNodeOperation(
  dataUrl: string,
  at: { x: number; y: number },
  size?: { width: number; height: number },
): BoardOperation {
  if (dataUrl.length > MAX_IMAGE_DATA_CHARS) {
    throw new Error("That image is too large to place on the canvas. Use an image under 5 MB.");
  }
  return {
    type: "add_node",
    node: {
      kind: "image",
      x: at.x,
      y: at.y,
      width: size?.width ?? DEFAULT_IMAGE_SIZE.width,
      height: size?.height ?? DEFAULT_IMAGE_SIZE.height,
      text: "",
      color: "white",
      imageData: dataUrl,
    },
  };
}
