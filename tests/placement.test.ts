import { describe, expect, it } from "vitest";
import type { BoardNode } from "../src/domain";
import { DEFAULT_SIZE, PLACEMENT_GAP, insertionPoint, viewportCenterPoint } from "../src/placement";

function node(id: string, x: number, y: number, width = 220, height = 160): BoardNode {
  return {
    id,
    kind: "sticky",
    x,
    y,
    width,
    height,
    text: "",
    color: "yellow",
    fontFamily: "inter",
    fontSize: 17,
    fontWeight: 500,
    textAlign: "left",
    locked: false,
    groupId: null,
  };
}

const size = { width: 220, height: 120 };

describe("keyboard placement", () => {
  it("with no anchor a new object lands at the caret", () => {
    expect(insertionPoint({ anchor: null, caret: { x: 300, y: 200 }, size, nodes: [] })).toEqual({ x: 300, y: 200 });
  });

  it("with one anchor a new object lands to its right with a 40px gap", () => {
    const anchor = node("a", 120, 100);
    expect(insertionPoint({ anchor, caret: { x: 0, y: 0 }, size, nodes: [anchor] }))
      .toEqual({ x: 120 + 220 + PLACEMENT_GAP, y: 100 });
  });

  it("an occupied insertion point steps down until it is clear", () => {
    const anchor = node("a", 120, 100);
    const blocker = node("b", 380, 100);
    const step = size.height + PLACEMENT_GAP;
    expect(insertionPoint({ anchor, caret: { x: 0, y: 0 }, size, nodes: [anchor, blocker] }))
      .toEqual({ x: 380, y: 100 + step });

    const second = node("c", 380, 100 + step);
    expect(insertionPoint({ anchor, caret: { x: 0, y: 0 }, size, nodes: [anchor, blocker, second] }))
      .toEqual({ x: 380, y: 100 + step * 2 });
  });

  it("placement always terminates and stays finite", () => {
    const anchor = node("a", 120, 100);
    const step = size.height + PLACEMENT_GAP;
    const blockers = Array.from({ length: 20 }, (_, index) => node(`b${index}`, 380, 100 + step * index));
    const at = insertionPoint({ anchor, caret: { x: 0, y: 0 }, size, nodes: [anchor, ...blockers] });
    expect(Number.isFinite(at.x)).toBe(true);
    expect(Number.isFinite(at.y)).toBe(true);
    expect(at.x).toBe(380);
    expect(at.y).toBe(100 + step * 12);
  });

  it("viewportCenterPoint is finite for degenerate viewports", () => {
    const surface = { width: 800, height: 600 };
    for (const zoom of [0, Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const point = viewportCenterPoint({ x: 80, y: 64, zoom }, surface);
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    }
    const empty = viewportCenterPoint({ x: 80, y: 64, zoom: 1 }, { width: 0, height: 0 });
    expect(empty).toEqual({ x: -80, y: -64 });
    expect(viewportCenterPoint({ x: 80, y: 64, zoom: 1 }, surface)).toEqual({ x: 320, y: 236 });
  });

  it("keyboard sizes agree with the pointer placement offsets", () => {
    expect(DEFAULT_SIZE.sticky).toEqual({ width: 220, height: 160 });
    expect(DEFAULT_SIZE.text).toEqual({ width: 240, height: 72 });
    expect(DEFAULT_SIZE.cylinder).toEqual({ width: 180, height: 140 });
  });
});
