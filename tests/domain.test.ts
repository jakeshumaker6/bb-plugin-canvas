import { describe, expect, it } from "vitest";
import {
  applyBoardOperations,
  boardDocumentSchema,
  createEmptyBoard,
  toBoardSummary,
  type BoardDocument,
  type BoardOperation,
} from "../src/domain";

const NOW = "2026-09-06T12:00:00.000Z";
const LATER = "2026-09-06T18:45:00.000Z";

function empty(): BoardDocument {
  return createEmptyBoard({ id: "board-1", title: "Order flow", now: NOW });
}

/** Ids are handed out as gen-1, gen-2, … so generated ids stay assertable. */
function apply(board: BoardDocument, operations: BoardOperation[], now: string = NOW): BoardDocument {
  let issued = 0;
  return applyBoardOperations(board, operations, { now, makeId: () => `gen-${++issued}` });
}

function addNode(id: string, kind: BoardDocument["nodes"][number]["kind"], x: number, y: number, color: string): BoardOperation {
  return { type: "add_node", node: { id, kind, x, y, color } };
}

function twoNodeBoard(): BoardDocument {
  return apply(empty(), [addNode("a", "sticky", 0, 0, "yellow"), addNode("b", "rectangle", 400, 0, "blue")]);
}

describe("createEmptyBoard", () => {
  it("starts at version 0 with no content and a matching summary", () => {
    const board = createEmptyBoard({ id: "board-1", title: "Order flow", now: NOW, chatThreadId: "thr_1" });
    expect(board).toEqual({
      schemaVersion: 1,
      id: "board-1",
      title: "Order flow",
      projectId: null,
      chatThreadId: "thr_1",
      nodes: [],
      edges: [],
      comments: [],
      version: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(toBoardSummary(board)).toEqual({
      id: "board-1",
      title: "Order flow",
      projectId: null,
      chatThreadId: "thr_1",
      version: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
});

describe("add_node", () => {
  it("gives every kind its default size and typography", () => {
    const board = apply(empty(), [
      { type: "add_node", node: { id: "note", kind: "sticky", x: 0, y: 0, color: "yellow", text: "Customer request" } },
      { type: "add_node", node: { id: "box", kind: "rectangle", x: 300, y: 0, color: "blue" } },
      { type: "add_node", node: { id: "oval", kind: "ellipse", x: 600, y: 0, color: "green" } },
      { type: "add_node", node: { id: "gate", kind: "diamond", x: 900, y: 0, color: "purple" } },
      { type: "add_node", node: { id: "title", kind: "text", x: 0, y: 400, color: "white", text: "Checkout" } },
      { type: "add_node", node: { id: "shot", kind: "image", x: 300, y: 400, color: "gray", imageData: "data:image/png;base64,iVBORw0KGgo=" } },
    ]);

    expect(board.nodes.map((node) => node.id)).toEqual(["note", "box", "oval", "gate", "title", "shot"]);
    expect(board.nodes[0]).toEqual({
      id: "note",
      kind: "sticky",
      x: 0,
      y: 0,
      width: 220,
      height: 160,
      text: "Customer request",
      color: "yellow",
      fontFamily: "inter",
      fontSize: 17,
      fontWeight: 500,
      textAlign: "left",
      locked: false,
      groupId: null,
    });
    expect(board.nodes[1]).toEqual({
      id: "box",
      kind: "rectangle",
      x: 300,
      y: 0,
      width: 220,
      height: 120,
      text: "",
      color: "blue",
      fontFamily: "inter",
      fontSize: 16,
      fontWeight: 600,
      textAlign: "center",
      locked: false,
      groupId: null,
    });
    expect(board.nodes[2]).toMatchObject({ kind: "ellipse", width: 200, height: 130, fontSize: 16, fontWeight: 600, textAlign: "center" });
    expect(board.nodes[3]).toMatchObject({ kind: "diamond", width: 180, height: 180, fontSize: 16, fontWeight: 600, textAlign: "center" });
    expect(board.nodes[4]).toEqual({
      id: "title",
      kind: "text",
      x: 0,
      y: 400,
      width: 240,
      height: 72,
      text: "Checkout",
      color: "white",
      fontFamily: "inter",
      fontSize: 21,
      fontWeight: 650,
      textAlign: "center",
      locked: false,
      groupId: null,
    });
    expect(board.nodes[5]).toEqual({
      id: "shot",
      kind: "image",
      x: 300,
      y: 400,
      width: 480,
      height: 320,
      text: "",
      color: "gray",
      imageData: "data:image/png;base64,iVBORw0KGgo=",
      fontFamily: "inter",
      fontSize: 16,
      fontWeight: 600,
      textAlign: "center",
      locked: false,
      groupId: null,
    });
    expect(board.version).toBe(1);
    expect(board.updatedAt).toBe(NOW);
  });

  it("honours explicit size, typography, lock, and group over the defaults", () => {
    const board = apply(empty(), [
      {
        type: "add_node",
        node: {
          id: "custom",
          kind: "sticky",
          x: 12,
          y: 34,
          width: 400,
          height: 320,
          text: "Pinned",
          color: "#ff8800",
          fontFamily: "mono",
          fontSize: 32,
          fontWeight: 800,
          textAlign: "right",
          locked: true,
          groupId: "group-a",
        },
      },
    ]);
    expect(board.nodes[0]).toEqual({
      id: "custom",
      kind: "sticky",
      x: 12,
      y: 34,
      width: 400,
      height: 320,
      text: "Pinned",
      color: "#ff8800",
      fontFamily: "mono",
      fontSize: 32,
      fontWeight: 800,
      textAlign: "right",
      locked: true,
      groupId: "group-a",
    });
  });

  it("mints an id when the caller omits one, and refuses a duplicate id", () => {
    const board = apply(empty(), [
      { type: "add_node", node: { kind: "sticky", x: 0, y: 0, color: "yellow" } },
      { type: "add_node", node: { kind: "text", x: 0, y: 200, color: "white" } },
    ]);
    expect(board.nodes.map((node) => node.id)).toEqual(["gen-1", "gen-2"]);
    expect(() => apply(board, [addNode("gen-1", "rectangle", 0, 0, "blue")])).toThrow("Node gen-1 already exists");
  });
});

describe("update_node", () => {
  it("edits geometry, text, colour, and typography on every kind", () => {
    const board = apply(empty(), [
      addNode("note", "sticky", 0, 0, "yellow"),
      addNode("box", "rectangle", 300, 0, "blue"),
      addNode("oval", "ellipse", 600, 0, "green"),
      addNode("gate", "diamond", 900, 0, "purple"),
      addNode("title", "text", 0, 400, "white"),
    ]);
    const edited = apply(
      board,
      [
        { type: "update_node", id: "note", patch: { text: "Refund requested", color: "coral" } },
        { type: "update_node", id: "box", patch: { x: 320, y: 40, width: 260, height: 140 } },
        { type: "update_node", id: "oval", patch: { fontFamily: "serif", fontSize: 24 } },
        { type: "update_node", id: "gate", patch: { fontWeight: 800, textAlign: "left" } },
        { type: "update_node", id: "title", patch: { text: "Refunds", fontSize: 40 } },
      ],
      LATER,
    );
    expect(edited.nodes[0]).toMatchObject({ text: "Refund requested", color: "coral", fontSize: 17, textAlign: "left" });
    expect(edited.nodes[1]).toMatchObject({ x: 320, y: 40, width: 260, height: 140 });
    expect(edited.nodes[2]).toMatchObject({ fontFamily: "serif", fontSize: 24, fontWeight: 600 });
    expect(edited.nodes[3]).toMatchObject({ fontWeight: 800, textAlign: "left" });
    expect(edited.nodes[4]).toMatchObject({ text: "Refunds", fontSize: 40, fontWeight: 650 });
    expect(edited.version).toBe(board.version + 1);
    expect(edited.updatedAt).toBe(LATER);
    // The source board is never mutated in place.
    expect(board.nodes[0]!.text).toBe("");
  });

  it("groups, locks, and clears a groupId back to null through the patch", () => {
    const board = twoNodeBoard();
    const grouped = apply(board, [
      { type: "update_node", id: "a", patch: { groupId: "group-1" } },
      { type: "update_node", id: "b", patch: { groupId: "group-1" } },
    ]);
    expect(grouped.nodes.map((node) => node.groupId)).toEqual(["group-1", "group-1"]);

    const locked = apply(grouped, [
      { type: "update_node", id: "a", patch: { locked: true } },
      { type: "update_node", id: "b", patch: { locked: true } },
    ]);
    expect(locked.nodes.every((node) => node.locked)).toBe(true);
    expect(locked.nodes.map((node) => node.groupId)).toEqual(["group-1", "group-1"]);

    const ungrouped = apply(locked, [
      { type: "update_node", id: "a", patch: { groupId: null } },
      { type: "update_node", id: "b", patch: { groupId: null } },
    ]);
    expect(ungrouped.nodes.map((node) => node.groupId)).toEqual([null, null]);
    // Unlocking is a separate patch; grouping never touched it.
    expect(ungrouped.nodes.every((node) => node.locked)).toBe(true);
    expect(apply(ungrouped, [{ type: "update_node", id: "a", patch: { locked: false } }]).nodes[0]!.locked).toBe(false);
  });
});

describe("backwards compatibility", () => {
  // A board persisted before typography, locked, groupId, routing, and arrow existed.
  const legacy = {
    schemaVersion: 1,
    id: "board-legacy",
    title: "Saved last year",
    projectId: null,
    chatThreadId: null,
    version: 12,
    createdAt: "2025-01-02T03:04:05.000Z",
    updatedAt: "2025-01-02T03:04:05.000Z",
    nodes: [
      { id: "old-sticky", kind: "sticky", x: 0, y: 0, width: 220, height: 160, text: "Old note", color: "yellow" },
      { id: "old-text", kind: "text", x: 300, y: 0, width: 240, height: 72, text: "Heading", color: "white" },
      { id: "old-box", kind: "rectangle", x: 0, y: 300, width: 220, height: 120, text: "", color: "blue" },
    ],
    edges: [{ id: "old-edge", source: "old-sticky", target: "old-box", label: "then", color: "ink" }],
    comments: [{ id: "old-comment", nodeId: "old-sticky", message: "Revisit", resolved: false, createdAt: "2025-01-02T03:04:05.000Z" }],
  };

  it("parses a pre-typography board and fills deterministic defaults", () => {
    const parsed = boardDocumentSchema.parse(legacy);
    expect(parsed.nodes[0]).toEqual({
      id: "old-sticky",
      kind: "sticky",
      x: 0,
      y: 0,
      width: 220,
      height: 160,
      text: "Old note",
      color: "yellow",
      fontFamily: "inter",
      fontSize: 17,
      fontWeight: 500,
      textAlign: "left",
      locked: false,
      groupId: null,
    });
    expect(parsed.nodes[1]).toMatchObject({ fontFamily: "inter", fontSize: 21, fontWeight: 650, textAlign: "center", locked: false, groupId: null });
    expect(parsed.nodes[2]).toMatchObject({ fontFamily: "inter", fontSize: 16, fontWeight: 600, textAlign: "center", locked: false, groupId: null });
    expect(parsed.edges[0]).toEqual({
      id: "old-edge",
      source: "old-sticky",
      target: "old-box",
      label: "then",
      color: "ink",
      routing: "straight",
      arrow: "end",
    });
    // Deterministic: the same stored bytes always yield the same document.
    expect(boardDocumentSchema.parse(legacy)).toEqual(parsed);
    // And re-parsing the filled document is a no-op.
    expect(boardDocumentSchema.parse(parsed)).toEqual(parsed);
  });

  it("keeps editing an upgraded legacy board without losing its defaults", () => {
    const parsed = boardDocumentSchema.parse(legacy);
    const next = apply(parsed, [{ type: "update_node", id: "old-sticky", patch: { text: "Still here" } }], LATER);
    expect(next.nodes[0]).toMatchObject({ text: "Still here", fontSize: 17, fontWeight: 500, textAlign: "left", locked: false, groupId: null });
    expect(next.edges[0]).toMatchObject({ routing: "straight", arrow: "end" });
    expect(next.version).toBe(13);
    expect(next.updatedAt).toBe(LATER);
  });
});

describe("add_edge", () => {
  it("connects nodes by id and defaults label, routing, and arrow", () => {
    const board = apply(twoNodeBoard(), [{ type: "add_edge", edge: { source: "a", target: "b", color: "ink" } }]);
    expect(board.edges).toEqual([
      { id: "gen-1", source: "a", target: "b", label: "", color: "ink", routing: "straight", arrow: "end" },
    ]);
  });

  it("keeps the caller's id, label, routing, and arrow", () => {
    const board = apply(twoNodeBoard(), [
      { type: "add_edge", edge: { id: "e1", source: "a", target: "b", label: "then", color: "blue", routing: "elbow", arrow: "both" } },
    ]);
    expect(board.edges[0]).toEqual({ id: "e1", source: "a", target: "b", label: "then", color: "blue", routing: "elbow", arrow: "both" });
    expect(() => apply(board, [{ type: "add_edge", edge: { id: "e1", source: "b", target: "a", color: "ink" } }])).toThrow("Edge e1 already exists");
  });

  it("stays attached to the nodes when they move", () => {
    const board = apply(twoNodeBoard(), [{ type: "add_edge", edge: { id: "e1", source: "a", target: "b", color: "ink" } }]);
    const moved = apply(board, [
      { type: "update_node", id: "a", patch: { x: 1200, y: 900 } },
      { type: "update_node", id: "b", patch: { x: -400, y: -300 } },
    ]);
    expect(moved.edges).toEqual(board.edges);
    expect(moved.edges[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("rejects a dangling connector at either end", () => {
    const board = twoNodeBoard();
    expect(() => apply(board, [{ type: "add_edge", edge: { source: "ghost", target: "b", color: "ink" } }]))
      .toThrow("Edge source ghost is missing");
    expect(() => apply(board, [{ type: "add_edge", edge: { source: "a", target: "ghost", color: "ink" } }]))
      .toThrow("Edge target ghost is missing");
    expect(board.edges).toEqual([]);
  });
});

describe("update_edge", () => {
  function connected(): BoardDocument {
    return apply(twoNodeBoard(), [{ type: "add_edge", edge: { id: "e1", source: "a", target: "b", color: "ink" } }]);
  }

  it("changes label, routing, and arrow without touching the endpoints", () => {
    const labelled = apply(connected(), [{ type: "update_edge", id: "e1", patch: { label: "approves" } }]);
    expect(labelled.edges[0]).toEqual({ id: "e1", source: "a", target: "b", label: "approves", color: "ink", routing: "straight", arrow: "end" });

    const routed = apply(labelled, [{ type: "update_edge", id: "e1", patch: { routing: "curved" } }]);
    expect(routed.edges[0]).toMatchObject({ label: "approves", routing: "curved", arrow: "end" });

    const arrowed = apply(routed, [{ type: "update_edge", id: "e1", patch: { arrow: "none", color: "coral" } }]);
    expect(arrowed.edges[0]).toEqual({ id: "e1", source: "a", target: "b", label: "approves", color: "coral", routing: "curved", arrow: "none" });
  });

  it("clears a label back to empty", () => {
    const board = apply(connected(), [{ type: "update_edge", id: "e1", patch: { label: "approves" } }]);
    expect(apply(board, [{ type: "update_edge", id: "e1", patch: { label: "" } }]).edges[0]!.label).toBe("");
  });

  it("throws for a missing connector and for an empty patch", () => {
    const board = connected();
    expect(() => apply(board, [{ type: "update_edge", id: "nope", patch: { label: "x" } }])).toThrow("Connector nope is missing");
    expect(() => apply(board, [{ type: "update_edge", id: "e1", patch: {} }])).toThrow(/Connector patch cannot be empty/);
  });
});

describe("remove_nodes", () => {
  it("cleans up the connectors and comments that hung off the node", () => {
    const board = apply(empty(), [
      addNode("a", "sticky", 0, 0, "yellow"),
      addNode("b", "rectangle", 400, 0, "blue"),
      addNode("c", "ellipse", 800, 0, "green"),
      { type: "add_edge", edge: { id: "ab", source: "a", target: "b", color: "ink" } },
      { type: "add_edge", edge: { id: "bc", source: "b", target: "c", color: "ink" } },
      { type: "add_comment", comment: { id: "ca", nodeId: "a", message: "On A" } },
      { type: "add_comment", comment: { id: "cc", nodeId: "c", message: "On C" } },
    ]);

    const next = apply(board, [{ type: "remove_nodes", ids: ["a"] }]);
    expect(next.nodes.map((node) => node.id)).toEqual(["b", "c"]);
    expect(next.edges.map((edge) => edge.id)).toEqual(["bc"]);
    expect(next.comments.map((comment) => comment.id)).toEqual(["cc"]);
  });

  it("drops connectors pointing at the node from either end, and ignores unknown ids", () => {
    const board = apply(empty(), [
      addNode("a", "sticky", 0, 0, "yellow"),
      addNode("b", "rectangle", 400, 0, "blue"),
      { type: "add_edge", edge: { id: "ab", source: "a", target: "b", color: "ink" } },
    ]);
    expect(apply(board, [{ type: "remove_nodes", ids: ["b"] }]).edges).toEqual([]);
    const untouched = apply(board, [{ type: "remove_nodes", ids: ["ghost"] }]);
    expect(untouched.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(untouched.edges.map((edge) => edge.id)).toEqual(["ab"]);
  });
});

describe("remove_edges", () => {
  it("removes only the named connectors and leaves the nodes in place", () => {
    const board = apply(empty(), [
      addNode("a", "sticky", 0, 0, "yellow"),
      addNode("b", "rectangle", 400, 0, "blue"),
      { type: "add_edge", edge: { id: "ab", source: "a", target: "b", color: "ink" } },
      { type: "add_edge", edge: { id: "ba", source: "b", target: "a", color: "ink" } },
    ]);
    const next = apply(board, [{ type: "remove_edges", ids: ["ab"] }]);
    expect(next.edges.map((edge) => edge.id)).toEqual(["ba"]);
    expect(next.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(apply(next, [{ type: "remove_edges", ids: ["ba", "ghost"] }]).edges).toEqual([]);
  });
});

describe("comments", () => {
  function commented(): BoardDocument {
    return apply(twoNodeBoard(), [{ type: "add_comment", comment: { nodeId: "a", message: "  Chase the customer  " } }], LATER);
  }

  it("adds a comment against a node, trimmed, unresolved, stamped with now", () => {
    const board = commented();
    expect(board.comments).toEqual([
      { id: "gen-1", nodeId: "a", message: "Chase the customer", resolved: false, createdAt: LATER },
    ]);
  });

  it("resolves, reopens, and deletes", () => {
    const board = commented();
    const resolved = apply(board, [{ type: "resolve_comment", id: "gen-1", resolved: true }]);
    expect(resolved.comments[0]).toMatchObject({ id: "gen-1", resolved: true, message: "Chase the customer" });

    const reopened = apply(resolved, [{ type: "resolve_comment", id: "gen-1", resolved: false }]);
    expect(reopened.comments[0]!.resolved).toBe(false);

    const deleted = apply(reopened, [{ type: "delete_comment", id: "gen-1" }]);
    expect(deleted.comments).toEqual([]);
    // Deleting an id that is already gone is a no-op, not an error.
    expect(apply(deleted, [{ type: "delete_comment", id: "gen-1" }]).comments).toEqual([]);
  });

  it("refuses a comment on a missing node and resolving a missing comment", () => {
    const board = commented();
    expect(() => apply(board, [{ type: "add_comment", comment: { nodeId: "ghost", message: "Hello" } }]))
      .toThrow("Comment node ghost is missing");
    expect(() => apply(board, [{ type: "resolve_comment", id: "ghost", resolved: true }]))
      .toThrow("Comment ghost is missing");
  });
});

describe("reorder_nodes", () => {
  function four(): BoardDocument {
    return apply(empty(), [
      addNode("a", "sticky", 0, 0, "yellow"),
      addNode("b", "rectangle", 200, 0, "blue"),
      addNode("c", "ellipse", 400, 0, "green"),
      addNode("d", "diamond", 600, 0, "purple"),
    ]);
  }
  const order = (board: BoardDocument) => board.nodes.map((node) => node.id);

  it("brings a node to the front and sends one to the back", () => {
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["a"], placement: "front" }]))).toEqual(["b", "c", "d", "a"]);
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["d"], placement: "back" }]))).toEqual(["d", "a", "b", "c"]);
  });

  it("steps a node one place forward and one place backward", () => {
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["b"], placement: "forward" }]))).toEqual(["a", "c", "b", "d"]);
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["c"], placement: "backward" }]))).toEqual(["a", "c", "b", "d"]);
  });

  it("leaves the extremes alone", () => {
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["d"], placement: "forward" }]))).toEqual(["a", "b", "c", "d"]);
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["a"], placement: "backward" }]))).toEqual(["a", "b", "c", "d"]);
  });

  it("moves several nodes at once and keeps their relative order", () => {
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["c", "a"], placement: "front" }]))).toEqual(["b", "d", "a", "c"]);
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["d", "b"], placement: "back" }]))).toEqual(["b", "d", "a", "c"]);
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["a", "c"], placement: "forward" }]))).toEqual(["b", "a", "d", "c"]);
    expect(order(apply(four(), [{ type: "reorder_nodes", ids: ["b", "d"], placement: "backward" }]))).toEqual(["b", "a", "d", "c"]);
  });

  it("throws when the reorder names a missing node", () => {
    const board = four();
    for (const placement of ["front", "back", "forward", "backward"] as const) {
      expect(() => apply(board, [{ type: "reorder_nodes", ids: ["a", "ghost"], placement }])).toThrow("Node ghost is missing");
    }
    expect(order(board)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("rename_board", () => {
  it("renames the board and trims the title, leaving content untouched", () => {
    const board = apply(twoNodeBoard(), [{ type: "rename_board", title: "  Support escalation  " }], LATER);
    expect(board.title).toBe("Support escalation");
    expect(board.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(board.id).toBe("board-1");
    expect(board.createdAt).toBe(NOW);
    expect(board.updatedAt).toBe(LATER);
    expect(toBoardSummary(board).title).toBe("Support escalation");
  });

  it("rejects a blank title", () => {
    expect(() => apply(empty(), [{ type: "rename_board", title: "   " }])).toThrow();
  });
});

describe("rejections", () => {
  it("requires at least one operation", () => {
    expect(() => apply(empty(), [])).toThrow("At least one operation is required");
  });

  it("caps a single call at 200 operations", () => {
    const board = empty();
    const rename = (index: number): BoardOperation => ({ type: "rename_board", title: `Title ${index}` });
    const twoHundred = Array.from({ length: 200 }, (_, index) => rename(index));
    expect(apply(board, twoHundred).title).toBe("Title 199");
    expect(() => apply(board, [...twoHundred, rename(200)]))
      .toThrow("A maximum of 200 operations can be applied at once");
  });

  it("refuses a patch against a missing node, and an empty patch", () => {
    const board = twoNodeBoard();
    expect(() => apply(board, [{ type: "update_node", id: "ghost", patch: { x: 10 } }])).toThrow("Node ghost is missing");
    expect(() => apply(board, [{ type: "update_node", id: "a", patch: {} }])).toThrow(/Node patch cannot be empty/);
    expect(board.nodes[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("refuses out-of-range geometry and unknown enum values", () => {
    const board = twoNodeBoard();
    expect(() => apply(board, [{ type: "update_node", id: "a", patch: { width: 10 } }])).toThrow();
    expect(() => apply(board, [{ type: "update_node", id: "a", patch: { fontSize: 200 } }])).toThrow();
    expect(() => apply(board, [{ type: "update_node", id: "a", patch: { x: Number.POSITIVE_INFINITY } }])).toThrow();
  });

  it("stops the whole batch when a later operation fails", () => {
    const board = twoNodeBoard();
    expect(() =>
      apply(board, [
        { type: "update_node", id: "a", patch: { text: "First" } },
        { type: "update_node", id: "ghost", patch: { text: "Second" } },
      ]),
    ).toThrow("Node ghost is missing");
    expect(board.nodes[0]!.text).toBe("");
  });
});

describe("extended shape kinds", () => {
  const SHAPES = ["cylinder", "cloud", "parallelogram", "hexagon", "triangle", "actor"] as const;

  it("accepts every shape the shape library can draw", () => {
    const board = applyBoardOperations(
      createEmptyBoard({ id: "shapes", title: "Shapes", now: "2026-09-07T12:00:00.000Z" }),
      SHAPES.map((kind, index) => ({
        type: "add_node" as const,
        node: { id: kind, kind, x: index * 260, y: 0, color: "blue" },
      })),
      { now: "2026-09-07T12:00:00.000Z", makeId: () => "generated" },
    );
    expect(board.nodes.map((node) => node.kind)).toEqual([...SHAPES]);
    for (const node of board.nodes) {
      expect(node.width).toBeGreaterThanOrEqual(40);
      expect(node.height).toBeGreaterThanOrEqual(32);
    }
  });

  it("gives every shape a default size and typography", () => {
    const board = applyBoardOperations(
      createEmptyBoard({ id: "shapes", title: "Shapes", now: "2026-09-07T12:00:00.000Z" }),
      [{ type: "add_node", node: { id: "db", kind: "cylinder", x: 0, y: 0, color: "blue" } }],
      { now: "2026-09-07T12:00:00.000Z", makeId: () => "generated" },
    );
    expect(board.nodes[0]).toMatchObject({ fontFamily: "inter", fontWeight: 600, textAlign: "center", locked: false, groupId: null });
  });

  it("connects and reshapes an extended shape like any other node", () => {
    let board = applyBoardOperations(
      createEmptyBoard({ id: "shapes", title: "Shapes", now: "2026-09-07T12:00:00.000Z" }),
      [
        { type: "add_node", node: { id: "a", kind: "actor", x: 0, y: 0, color: "yellow" } },
        { type: "add_node", node: { id: "b", kind: "cylinder", x: 400, y: 0, color: "blue" } },
        { type: "add_edge", edge: { id: "e", source: "a", target: "b", color: "ink", routing: "elbow" } },
      ],
      { now: "2026-09-07T12:00:00.000Z", makeId: () => "generated" },
    );
    board = applyBoardOperations(board, [{ type: "update_node", id: "b", patch: { text: "Orders" } }], { now: "n", makeId: () => "g" });
    expect(board.nodes[1]?.text).toBe("Orders");
    expect(board.edges).toHaveLength(1);
  });
});
