import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_MIME,
  CLIPBOARD_VERSION,
  imageNodeOperation,
  parseClipboard,
  pasteOperations,
  serializeSelection,
} from "../src/clipboard";
import {
  applyBoardOperations,
  boardDocumentSchema,
  boardNodeSchema,
  type BoardDocument,
  type BoardNode,
} from "../src/domain";

function node(overrides: Partial<BoardNode> & { id: string }): BoardNode {
  return boardNodeSchema.parse({
    kind: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    text: "",
    color: "yellow",
    ...overrides,
  });
}

function board(): BoardDocument {
  return boardDocumentSchema.parse({
    schemaVersion: 1,
    id: "board-1",
    title: "Board",
    projectId: null,
    chatThreadId: null,
    version: 1,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    nodes: [
      node({ id: "a", x: 100, y: 100, text: "A" }),
      node({ id: "b", x: 400, y: 260, text: "B", locked: true }),
      node({ id: "c", x: 900, y: 900, text: "C" }),
    ],
    edges: [
      { id: "e-ab", source: "a", target: "b", label: "flows", color: "ink", routing: "elbow", arrow: "both" },
      { id: "e-bc", source: "b", target: "c", label: "", color: "ink", routing: "straight", arrow: "end" },
    ],
    comments: [],
  });
}

function counter(prefix = "new"): () => string {
  let index = 0;
  return () => `${prefix}-${(index += 1)}`;
}

describe("clipboard serialization", () => {
  it("round-trips a two-node selection with its connector", () => {
    const payload = parseClipboard(serializeSelection(board(), ["a", "b"]));
    expect(payload).not.toBeNull();
    expect(payload?.nodes.map((item) => item.id)).toEqual(["a", "b"]);
    expect(payload?.edges.map((item) => item.id)).toEqual(["e-ab"]);
    expect(payload?.edges[0]?.routing).toBe("elbow");
  });

  it("excludes edges pointing at unselected nodes", () => {
    const payload = parseClipboard(serializeSelection(board(), ["b", "c"]));
    expect(payload?.edges.map((item) => item.id)).toEqual(["e-bc"]);
    const only = parseClipboard(serializeSelection(board(), ["b"]));
    expect(only?.edges).toEqual([]);
  });

  it("stamps the payload with our mime type and version", () => {
    const envelope: unknown = JSON.parse(serializeSelection(board(), ["a"]));
    expect(envelope).toMatchObject({ mime: CLIPBOARD_MIME, version: CLIPBOARD_VERSION });
  });

  it("returns null for foreign text, bad JSON, and a wrong version", () => {
    expect(parseClipboard("hello from another app")).toBeNull();
    expect(parseClipboard('{"mime":"application/x-bb-canvas",')).toBeNull();
    expect(parseClipboard(JSON.stringify({ mime: "text/plain", version: 1, nodes: [], edges: [] }))).toBeNull();
    expect(
      parseClipboard(JSON.stringify({ mime: CLIPBOARD_MIME, version: CLIPBOARD_VERSION + 1, nodes: [], edges: [] })),
    ).toBeNull();
    expect(parseClipboard(JSON.stringify({ mime: CLIPBOARD_MIME, version: CLIPBOARD_VERSION, nodes: [{ id: "x" }], edges: [] }))).toBeNull();
  });

  it("returns null for oversized clipboard text", () => {
    expect(parseClipboard("x".repeat(5_000_001))).toBeNull();
  });
});

describe("paste operations", () => {
  it("remaps node ids and rewrites edge endpoints", () => {
    const payload = parseClipboard(serializeSelection(board(), ["a", "b"]))!;
    const operations = pasteOperations(payload, { makeId: counter() });
    const nodeIds = operations.flatMap((op) => (op.type === "add_node" ? [op.node.id] : []));
    expect(nodeIds).toEqual(["new-1", "new-2"]);
    const edge = operations.find((op) => op.type === "add_edge");
    expect(edge).toMatchObject({ edge: { source: "new-1", target: "new-2", label: "flows", arrow: "both" } });
  });

  it("pasting twice yields four distinct ids that never collide", () => {
    const payload = parseClipboard(serializeSelection(board(), ["a", "b"]))!;
    const makeId = counter();
    const ids = [...pasteOperations(payload, { makeId }), ...pasteOperations(payload, { makeId })]
      .flatMap((op) => (op.type === "add_node" ? [op.node.id ?? ""] : []));
    expect(new Set(ids).size).toBe(4);
    expect(ids.some((id) => id === "a" || id === "b")).toBe(false);
  });

  it("remaps a group to one fresh shared group id and clears locked", () => {
    const grouped = board();
    grouped.nodes[0]!.groupId = "group-1";
    grouped.nodes[1]!.groupId = "group-1";
    const payload = parseClipboard(serializeSelection(grouped, ["a", "b"]))!;
    const nodes = pasteOperations(payload, { makeId: counter() }).flatMap((op) => (op.type === "add_node" ? [op.node] : []));
    expect(nodes[0]?.groupId).toBe(nodes[1]?.groupId);
    expect(nodes[0]?.groupId).not.toBe("group-1");
    expect(nodes.every((item) => item.locked === false)).toBe(true);
  });

  it("offsets in place by 24 units by default and honours an explicit offset", () => {
    const payload = parseClipboard(serializeSelection(board(), ["a", "b"]))!;
    const nudged = pasteOperations(payload, { makeId: counter() }).flatMap((op) => (op.type === "add_node" ? [op.node] : []));
    expect(nudged.map((item) => [item.x, item.y])).toEqual([[124, 124], [424, 284]]);
    const far = pasteOperations(payload, { makeId: counter(), offset: 100 }).flatMap((op) => (op.type === "add_node" ? [op.node] : []));
    expect(far.map((item) => [item.x, item.y])).toEqual([[200, 200], [500, 360]]);
  });

  it("places the bounding box top-left at `at` and preserves relative layout", () => {
    const payload = parseClipboard(serializeSelection(board(), ["a", "b"]))!;
    const nodes = pasteOperations(payload, { makeId: counter(), at: { x: 0, y: 0 } }).flatMap((op) =>
      op.type === "add_node" ? [op.node] : [],
    );
    expect(nodes.map((item) => [item.x, item.y])).toEqual([[0, 0], [300, 160]]);
  });

  it("applies a cross-board paste to a real board document", () => {
    const payload = parseClipboard(serializeSelection(board(), ["a", "b"]))!;
    const target = boardDocumentSchema.parse({ ...board(), id: "board-2", nodes: [], edges: [] });
    const next = applyBoardOperations(target, pasteOperations(payload, { makeId: counter("p"), at: { x: 20, y: 40 } }), {
      now: "2026-09-06T13:00:00.000Z",
      makeId: () => "fallback",
    });
    expect(next.nodes.map((item) => item.text)).toEqual(["A", "B"]);
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0]!.source).toBe(next.nodes[0]!.id);
    expect(next.edges[0]!.target).toBe(next.nodes[1]!.id);
    expect(next.nodes[1]!.locked).toBe(false);
    expect(next.nodes.map((item) => [item.x, item.y])).toEqual([[20, 40], [320, 200]]);
  });

  it("returns no operations for an empty payload", () => {
    expect(pasteOperations({ nodes: [], edges: [] }, { makeId: counter() })).toEqual([]);
  });
});

describe("image nodes", () => {
  it("builds an image add_node at the drop point with a default size", () => {
    const operation = imageNodeOperation("data:image/png;base64,AAAA", { x: 10, y: 20 });
    expect(operation).toMatchObject({
      type: "add_node",
      node: { kind: "image", x: 10, y: 20, width: 480, height: 320, imageData: "data:image/png;base64,AAAA" },
    });
    const sized = imageNodeOperation("data:image/png;base64,AAAA", { x: 0, y: 0 }, { width: 120, height: 90 });
    expect(sized).toMatchObject({ node: { width: 120, height: 90 } });
  });

  it("refuses an oversized image data URL", () => {
    expect(() => imageNodeOperation(`data:image/png;base64,${"A".repeat(7_000_001)}`, { x: 0, y: 0 })).toThrow(/too large/i);
  });
});
