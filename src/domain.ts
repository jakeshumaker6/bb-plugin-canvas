import { z } from "zod";

export const BOARD_SCHEMA_VERSION = 1 as const;
export const nodeKindSchema = z.enum([
  "sticky",
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "image",
]);
export const colorSchema = z.string().trim().min(1).max(32);
export const fontFamilySchema = z.enum(["inter", "serif", "mono"]);
export const textAlignSchema = z.enum(["left", "center", "right"]);
export const edgeRoutingSchema = z.enum(["straight", "elbow", "curved"]);
export const edgeArrowSchema = z.enum(["none", "end", "both"]);
export const placementSchema = z.enum(["front", "back", "forward", "backward"]);

const persistedBoardNodeSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: nodeKindSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(40).max(4000),
    height: z.number().finite().min(32).max(4000),
    text: z.string().max(10_000),
    color: colorSchema,
    imageData: z.string().max(7_000_000).optional(),
    fontFamily: fontFamilySchema,
    fontSize: z.number().int().min(10).max(96),
    fontWeight: z.number().int().min(400).max(800),
    textAlign: textAlignSchema,
    locked: z.boolean(),
    groupId: z.string().min(1).max(100).nullable(),
  })
  .strict();

export const boardNodeSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const node = value as Record<string, unknown>;
  const kind = node.kind;
  return {
    fontFamily: "inter",
    fontSize: kind === "text" ? 21 : kind === "sticky" ? 17 : 16,
    fontWeight: kind === "text" ? 650 : kind === "sticky" ? 500 : 600,
    textAlign: kind === "sticky" ? "left" : "center",
    locked: false,
    groupId: null,
    ...node,
  };
}, persistedBoardNodeSchema);

export const boardEdgeSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return { routing: "straight", arrow: "end", ...(value as Record<string, unknown>) };
}, z
  .object({
    id: z.string().min(1).max(100),
    source: z.string().min(1).max(100),
    target: z.string().min(1).max(100),
    label: z.string().max(500).default(""),
    color: colorSchema,
    routing: edgeRoutingSchema,
    arrow: edgeArrowSchema,
  })
  .strict());

export const boardCommentSchema = z
  .object({
    id: z.string().min(1).max(100),
    nodeId: z.string().min(1).max(100),
    message: z.string().trim().min(1).max(4000),
    resolved: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

export const boardSummarySchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    projectId: z.string().nullable(),
    chatThreadId: z.string().nullable(),
    version: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const boardDocumentSchema = boardSummarySchema.extend({
  schemaVersion: z.literal(BOARD_SCHEMA_VERSION),
  nodes: z.array(boardNodeSchema).max(2000),
  edges: z.array(boardEdgeSchema).max(4000),
  comments: z.array(boardCommentSchema).max(4000),
});

const nodeInputSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    kind: nodeKindSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(40).max(4000).optional(),
    height: z.number().finite().min(32).max(4000).optional(),
    text: z.string().max(10_000).optional(),
    color: colorSchema,
    imageData: z.string().max(7_000_000).optional(),
    fontFamily: fontFamilySchema.optional(),
    fontSize: z.number().int().min(10).max(96).optional(),
    fontWeight: z.number().int().min(400).max(800).optional(),
    textAlign: textAlignSchema.optional(),
    locked: z.boolean().optional(),
    groupId: z.string().min(1).max(100).nullable().optional(),
  })
  .strict();

const nodePatchSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().min(40).max(4000).optional(),
    height: z.number().finite().min(32).max(4000).optional(),
    text: z.string().max(10_000).optional(),
    color: colorSchema.optional(),
    fontFamily: fontFamilySchema.optional(),
    fontSize: z.number().int().min(10).max(96).optional(),
    fontWeight: z.number().int().min(400).max(800).optional(),
    textAlign: textAlignSchema.optional(),
    locked: z.boolean().optional(),
    groupId: z.string().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Node patch cannot be empty");

const edgePatchSchema = z
  .object({
    label: z.string().max(500).optional(),
    color: colorSchema.optional(),
    routing: edgeRoutingSchema.optional(),
    arrow: edgeArrowSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Connector patch cannot be empty");

const edgeInputSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    source: z.string().min(1).max(100),
    target: z.string().min(1).max(100),
    label: z.string().max(500).optional(),
    color: colorSchema,
    routing: edgeRoutingSchema.optional(),
    arrow: edgeArrowSchema.optional(),
  })
  .strict();

const commentInputSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    nodeId: z.string().min(1).max(100),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

export const boardOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_node"), node: nodeInputSchema }).strict(),
  z.object({ type: z.literal("update_node"), id: z.string(), patch: nodePatchSchema }).strict(),
  z.object({ type: z.literal("remove_nodes"), ids: z.array(z.string()).min(1).max(200) }).strict(),
  z.object({ type: z.literal("add_edge"), edge: edgeInputSchema }).strict(),
  z.object({ type: z.literal("update_edge"), id: z.string(), patch: edgePatchSchema }).strict(),
  z.object({ type: z.literal("remove_edges"), ids: z.array(z.string()).min(1).max(400) }).strict(),
  z.object({ type: z.literal("reorder_nodes"), ids: z.array(z.string()).min(1).max(2000), placement: placementSchema }).strict(),
  z.object({ type: z.literal("add_comment"), comment: commentInputSchema }).strict(),
  z.object({ type: z.literal("resolve_comment"), id: z.string(), resolved: z.boolean() }).strict(),
  z.object({ type: z.literal("delete_comment"), id: z.string() }).strict(),
  z.object({ type: z.literal("rename_board"), title: z.string().trim().min(1).max(200) }).strict(),
]);

export type BoardNode = z.infer<typeof boardNodeSchema>;
export type BoardEdge = z.infer<typeof boardEdgeSchema>;
export type BoardComment = z.infer<typeof boardCommentSchema>;
export type BoardSummary = z.infer<typeof boardSummarySchema>;
export type BoardDocument = z.infer<typeof boardDocumentSchema>;
export type BoardOperation = z.infer<typeof boardOperationSchema>;
export type BoardNodeKind = z.infer<typeof nodeKindSchema>;

const DEFAULT_SIZE: Record<BoardNodeKind, { width: number; height: number }> = {
  sticky: { width: 220, height: 160 },
  rectangle: { width: 220, height: 120 },
  ellipse: { width: 200, height: 130 },
  diamond: { width: 180, height: 180 },
  text: { width: 240, height: 72 },
  image: { width: 480, height: 320 },
};

export function createEmptyBoard(input: {
  id: string;
  title: string;
  now: string;
  projectId?: string | null;
  chatThreadId?: string | null;
}): BoardDocument {
  return boardDocumentSchema.parse({
    schemaVersion: BOARD_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    projectId: input.projectId ?? null,
    chatThreadId: input.chatThreadId ?? null,
    nodes: [],
    edges: [],
    comments: [],
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export function applyBoardOperations(
  current: BoardDocument,
  rawOperations: readonly BoardOperation[],
  context: { now: string; makeId: () => string },
): BoardDocument {
  if (rawOperations.length === 0) throw new Error("At least one operation is required");
  if (rawOperations.length > 200) throw new Error("A maximum of 200 operations can be applied at once");
  const operations = z.array(boardOperationSchema).parse(rawOperations);
  const next = structuredClone(boardDocumentSchema.parse(current));

  for (const operation of operations) {
    switch (operation.type) {
      case "add_node": {
        const id = operation.node.id ?? context.makeId();
        if (next.nodes.some((node) => node.id === id)) throw new Error(`Node ${id} already exists`);
        const size = DEFAULT_SIZE[operation.node.kind];
        next.nodes.push(
          boardNodeSchema.parse({
            id,
            kind: operation.node.kind,
            x: operation.node.x,
            y: operation.node.y,
            width: operation.node.width ?? size.width,
            height: operation.node.height ?? size.height,
            text: operation.node.text ?? "",
            color: operation.node.color,
            ...(operation.node.fontFamily === undefined ? {} : { fontFamily: operation.node.fontFamily }),
            ...(operation.node.fontSize === undefined ? {} : { fontSize: operation.node.fontSize }),
            ...(operation.node.fontWeight === undefined ? {} : { fontWeight: operation.node.fontWeight }),
            ...(operation.node.textAlign === undefined ? {} : { textAlign: operation.node.textAlign }),
            ...(operation.node.locked === undefined ? {} : { locked: operation.node.locked }),
            ...(operation.node.groupId === undefined ? {} : { groupId: operation.node.groupId }),
            ...(operation.node.imageData === undefined ? {} : { imageData: operation.node.imageData }),
          }),
        );
        break;
      }
      case "update_node": {
        const index = next.nodes.findIndex((node) => node.id === operation.id);
        if (index < 0) throw new Error(`Node ${operation.id} is missing`);
        next.nodes[index] = boardNodeSchema.parse({ ...next.nodes[index], ...operation.patch });
        break;
      }
      case "remove_nodes": {
        const ids = new Set(operation.ids);
        next.nodes = next.nodes.filter((node) => !ids.has(node.id));
        next.edges = next.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
        next.comments = next.comments.filter((comment) => !ids.has(comment.nodeId));
        break;
      }
      case "add_edge": {
        const id = operation.edge.id ?? context.makeId();
        if (!next.nodes.some((node) => node.id === operation.edge.source)) {
          throw new Error(`Edge source ${operation.edge.source} is missing`);
        }
        if (!next.nodes.some((node) => node.id === operation.edge.target)) {
          throw new Error(`Edge target ${operation.edge.target} is missing`);
        }
        if (next.edges.some((edge) => edge.id === id)) throw new Error(`Edge ${id} already exists`);
        next.edges.push(
          boardEdgeSchema.parse({ id, label: "", ...operation.edge }),
        );
        break;
      }
      case "update_edge": {
        const edge = next.edges.find((candidate) => candidate.id === operation.id);
        if (edge === undefined) throw new Error(`Connector ${operation.id} is missing`);
        Object.assign(edge, boardEdgeSchema.parse({ ...edge, ...operation.patch }));
        break;
      }
      case "reorder_nodes": {
        const ids = new Set(operation.ids);
        for (const id of ids) {
          if (!next.nodes.some((node) => node.id === id)) throw new Error(`Node ${id} is missing`);
        }
        const moving = next.nodes.filter((node) => ids.has(node.id));
        const rest = next.nodes.filter((node) => !ids.has(node.id));
        if (operation.placement === "front") next.nodes = [...rest, ...moving];
        else if (operation.placement === "back") next.nodes = [...moving, ...rest];
        else {
          // One step at a time, walking from the edge the selection is moving toward.
          const step = operation.placement === "forward" ? 1 : -1;
          const order = [...next.nodes];
          const indexes = order.map((node, index) => ({ node, index })).filter(({ node }) => ids.has(node.id));
          for (const { node } of step === 1 ? [...indexes].reverse() : indexes) {
            const from = order.indexOf(node);
            const to = from + step;
            if (to < 0 || to >= order.length || ids.has(order[to]!.id)) continue;
            order.splice(from, 1);
            order.splice(to, 0, node);
          }
          next.nodes = order;
        }
        break;
      }
      case "remove_edges": {
        const ids = new Set(operation.ids);
        next.edges = next.edges.filter((edge) => !ids.has(edge.id));
        break;
      }
      case "add_comment": {
        if (!next.nodes.some((node) => node.id === operation.comment.nodeId)) {
          throw new Error(`Comment node ${operation.comment.nodeId} is missing`);
        }
        const id = operation.comment.id ?? context.makeId();
        if (next.comments.some((comment) => comment.id === id)) throw new Error(`Comment ${id} already exists`);
        next.comments.push(
          boardCommentSchema.parse({
            id,
            nodeId: operation.comment.nodeId,
            message: operation.comment.message,
            resolved: false,
            createdAt: context.now,
          }),
        );
        break;
      }
      case "resolve_comment": {
        const comment = next.comments.find((candidate) => candidate.id === operation.id);
        if (comment === undefined) throw new Error(`Comment ${operation.id} is missing`);
        comment.resolved = operation.resolved;
        break;
      }
      case "delete_comment": {
        next.comments = next.comments.filter((comment) => comment.id !== operation.id);
        break;
      }
      case "rename_board":
        next.title = operation.title;
        break;
    }
  }

  next.version += 1;
  next.updatedAt = context.now;
  return boardDocumentSchema.parse(next);
}

export function toBoardSummary(board: BoardDocument): BoardSummary {
  const { id, title, projectId, chatThreadId, version, createdAt, updatedAt } = board;
  return { id, title, projectId, chatThreadId, version, createdAt, updatedAt };
}
