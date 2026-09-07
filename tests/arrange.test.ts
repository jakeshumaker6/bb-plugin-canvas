import { describe, expect, it } from "vitest";
import {
  distributeOperations,
  expandToGroups,
  groupOperations,
  lockOperations,
  reorderOperation,
  tidyUpOperations,
  ungroupOperations,
} from "../src/arrange";
import { applyBoardOperations, createEmptyBoard, type BoardNode, type BoardOperation } from "../src/domain";

function node(overrides: Partial<BoardNode> & { id: string }): BoardNode {
  return {
    kind: "sticky",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    text: "",
    color: "yellow",
    fontFamily: "inter",
    fontSize: 17,
    fontWeight: 500,
    textAlign: "left",
    locked: false,
    groupId: null,
    ...overrides,
  };
}

const NOW = "2026-09-06T12:00:00.000Z";

function boardFrom(nodes: readonly BoardNode[]) {
  const board = createEmptyBoard({ id: "board-1", title: "Arrange", now: NOW });
  return applyBoardOperations(
    board,
    nodes.map((item): BoardOperation => ({
      type: "add_node",
      node: { id: item.id, kind: item.kind, x: item.x, y: item.y, width: item.width, height: item.height, color: item.color, locked: item.locked, groupId: item.groupId },
    })),
    { now: NOW, makeId: () => "unused" },
  );
}

describe("reorderOperation", () => {
  it("builds a reorder operation with de-duplicated ids", () => {
    expect(reorderOperation(["a", "b", "a"], "front")).toEqual({
      type: "reorder_nodes",
      ids: ["a", "b"],
      placement: "front",
    });
  });

  it("applies cleanly to a real board", () => {
    const board = boardFrom([node({ id: "a" }), node({ id: "b", x: 200 }), node({ id: "c", x: 400 })]);
    const next = applyBoardOperations(board, [reorderOperation(["a"], "front")], { now: NOW, makeId: () => "unused" });
    expect(next.nodes.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });
});

describe("grouping", () => {
  it("groups only the nodes that are not already in the group", () => {
    const nodes = [node({ id: "a" }), node({ id: "b", groupId: "g1" }), node({ id: "c", groupId: "other" })];
    expect(groupOperations(nodes, "g1")).toEqual([
      { type: "update_node", id: "a", patch: { groupId: "g1" } },
      { type: "update_node", id: "c", patch: { groupId: "g1" } },
    ]);
  });

  it("ungroups only grouped nodes and locks only changed nodes", () => {
    const nodes = [node({ id: "a", groupId: "g1" }), node({ id: "b" })];
    expect(ungroupOperations(nodes)).toEqual([{ type: "update_node", id: "a", patch: { groupId: null } }]);
    expect(lockOperations([node({ id: "a", locked: true }), node({ id: "b" })], true)).toEqual([
      { type: "update_node", id: "b", patch: { locked: true } },
    ]);
    expect(groupOperations([], "g1")).toEqual([]);
    expect(ungroupOperations([node({ id: "a" })])).toEqual([]);
  });

  it("expands a single member selection to every node sharing its group, in board order", () => {
    const all = [
      node({ id: "a", groupId: "g1" }),
      node({ id: "b" }),
      node({ id: "c", groupId: "g1" }),
      node({ id: "d", groupId: "g2" }),
      node({ id: "e", groupId: "g1" }),
    ];
    expect(expandToGroups(all, ["c"])).toEqual(["a", "c", "e"]);
    expect(expandToGroups(all, ["b"])).toEqual(["b"]);
    expect(expandToGroups(all, ["e", "d", "b"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(expandToGroups(all, [])).toEqual([]);
  });
});

describe("distributeOperations", () => {
  it("evens the gaps of four unevenly spaced nodes, holding the ends", () => {
    const nodes = [
      node({ id: "d", x: 700, width: 100 }),
      node({ id: "a", x: 0, width: 100 }),
      node({ id: "c", x: 400, width: 100 }),
      node({ id: "b", x: 150, width: 50 }),
    ];
    // span 0..800, widths 350, three gaps of 150 each.
    expect(distributeOperations(nodes, "horizontal")).toEqual([
      { type: "update_node", id: "b", patch: { x: 250 } },
      { type: "update_node", id: "c", patch: { x: 450 } },
    ]);
  });

  it("distributes vertically and returns [] for fewer than three movable nodes", () => {
    const nodes = [
      node({ id: "a", y: 0, height: 40 }),
      node({ id: "b", y: 60, height: 40 }),
      node({ id: "c", y: 300, height: 60 }),
    ];
    // span 0..360, heights 140, two gaps of 110 each.
    expect(distributeOperations(nodes, "vertical")).toEqual([
      { type: "update_node", id: "b", patch: { y: 150 } },
    ]);
    expect(distributeOperations(nodes.slice(0, 2), "vertical")).toEqual([]);
    expect(distributeOperations([], "horizontal")).toEqual([]);
  });

  it("skips locked nodes entirely", () => {
    const nodes = [
      node({ id: "a", x: 0, width: 100 }),
      node({ id: "locked", x: 150, width: 50, locked: true }),
      node({ id: "c", x: 400, width: 100 }),
      node({ id: "d", x: 700, width: 100 }),
    ];
    // Only a, c, d participate: span 0..800, widths 300, two gaps of 250.
    expect(distributeOperations(nodes, "horizontal")).toEqual([
      { type: "update_node", id: "c", patch: { x: 350 } },
    ]);
  });
});

describe("tidyUpOperations", () => {
  const grid = [
    node({ id: "n1", x: 10, y: 0, width: 100, height: 50 }),
    node({ id: "n2", x: 200, y: 5, width: 120, height: 60 }),
    node({ id: "n3", x: 400, y: 10, width: 80, height: 40 }),
    node({ id: "n4", x: 0, y: 300, width: 140, height: 70 }),
    node({ id: "n5", x: 250, y: 310, width: 90, height: 32 }),
  ];

  it("snaps five nodes into a 3-column grid anchored at the selection top-left", () => {
    // columns = ceil(sqrt(5)) = 3, gutter 24.
    // column widths 140/120/80 -> x offsets 0/164/308; row heights 60/70 -> y offsets 0/84.
    expect(tidyUpOperations(grid)).toEqual([
      { type: "update_node", id: "n1", patch: { x: 0 } },
      { type: "update_node", id: "n2", patch: { x: 164, y: 0 } },
      { type: "update_node", id: "n3", patch: { x: 308, y: 0 } },
      { type: "update_node", id: "n4", patch: { y: 84 } },
      { type: "update_node", id: "n5", patch: { x: 164, y: 84 } },
    ]);
  });

  it("honours explicit gutter and column overrides and leaves locked nodes alone", () => {
    const nodes = [
      node({ id: "a", x: 0, y: 0, width: 100, height: 50 }),
      node({ id: "b", x: 500, y: 0, width: 100, height: 50 }),
      node({ id: "pinned", x: 900, y: 900, width: 100, height: 50, locked: true }),
    ];
    expect(tidyUpOperations(nodes, { gutter: 10, columns: 1 })).toEqual([
      { type: "update_node", id: "b", patch: { x: 0, y: 60 } },
    ]);
    expect(tidyUpOperations([], {})).toEqual([]);
    expect(tidyUpOperations([node({ id: "solo", locked: true })])).toEqual([]);
  });

  it("produces a board that actually applies", () => {
    const board = boardFrom(grid);
    const next = applyBoardOperations(board, tidyUpOperations(grid), { now: NOW, makeId: () => "unused" });
    expect(next.nodes.map((item) => [item.id, item.x, item.y])).toEqual([
      ["n1", 0, 0],
      ["n2", 164, 0],
      ["n3", 308, 0],
      ["n4", 0, 84],
      ["n5", 164, 84],
    ]);
  });

  it("emits nothing when the selection is already tidy", () => {
    const tidy = tidyUpOperations(grid);
    const board = applyBoardOperations(boardFrom(grid), tidy, { now: NOW, makeId: () => "unused" });
    expect(tidyUpOperations(board.nodes)).toEqual([]);
  });
});
