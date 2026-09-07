import { describe, expect, it } from "vitest";
import type { BoardNode } from "../src/domain";
import { anchorsFor, chooseAnchors, connectorLabelPoint, connectorPath } from "../src/connectors";

function node(id: string, x: number, y: number, width = 200, height = 100): BoardNode {
  return {
    id,
    kind: "rectangle",
    x,
    y,
    width,
    height,
    text: "",
    color: "slate",
    fontFamily: "inter",
    fontSize: 16,
    fontWeight: 600,
    textAlign: "center",
    locked: false,
    groupId: null,
  };
}

type Point = { x: number; y: number };

function parsePoints(d: string): Point[] {
  const points: Point[] = [];
  for (const match of d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

describe("anchorsFor", () => {
  it("returns four edge midpoints on the node border", () => {
    const anchors = anchorsFor(node("a", 100, 200, 200, 100));
    expect(anchors.map((anchor) => anchor.side)).toEqual(["top", "right", "bottom", "left"]);
    expect(anchors).toContainEqual({ x: 200, y: 200, side: "top" });
    expect(anchors).toContainEqual({ x: 300, y: 250, side: "right" });
    expect(anchors).toContainEqual({ x: 200, y: 300, side: "bottom" });
    expect(anchors).toContainEqual({ x: 100, y: 250, side: "left" });
  });
});

describe("chooseAnchors", () => {
  it("uses right -> left for a mostly-horizontal pair and puts them on the borders", () => {
    const source = node("a", 0, 0);
    const target = node("b", 500, 20);
    const { from, to } = chooseAnchors(source, target);
    expect(from.side).toBe("right");
    expect(to.side).toBe("left");
    expect(from).toMatchObject({ x: 200, y: 50 });
    expect(to).toMatchObject({ x: 500, y: 70 });
  });

  it("flips to left -> right when the target is to the left", () => {
    const { from, to } = chooseAnchors(node("a", 500, 0), node("b", 0, 0));
    expect(from.side).toBe("left");
    expect(to.side).toBe("right");
    expect(from.x).toBe(500);
    expect(to.x).toBe(200);
  });

  it("uses bottom -> top for a mostly-vertical pair, and top -> bottom when reversed", () => {
    const down = chooseAnchors(node("a", 0, 0), node("b", 10, 400));
    expect([down.from.side, down.to.side]).toEqual(["bottom", "top"]);
    expect(down.from).toMatchObject({ x: 100, y: 100 });
    expect(down.to).toMatchObject({ x: 110, y: 400 });

    const up = chooseAnchors(node("a", 0, 400), node("b", 0, 0));
    expect([up.from.side, up.to.side]).toEqual(["top", "bottom"]);
  });
});

describe("connectorPath", () => {
  it("draws a straight line between the chosen anchors", () => {
    const d = connectorPath(node("a", 0, 0), node("b", 500, 0), "straight");
    expect(d).toBe("M 200 50 L 500 50");
  });

  it("draws an orthogonal elbow: every segment shares an x or a y with the previous point", () => {
    for (const target of [node("b", 500, 300), node("b", 40, 600), node("b", -400, -80)]) {
      const points = parsePoints(connectorPath(node("a", 0, 0), target, "elbow"));
      expect(points.length).toBe(4);
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]!;
        const current = points[index]!;
        expect(previous.x === current.x || previous.y === current.y).toBe(true);
      }
    }
  });

  it("leaves each elbow anchor perpendicular to its side", () => {
    const points = parsePoints(connectorPath(node("a", 0, 0), node("b", 500, 300), "elbow"));
    expect(points[0]).toEqual({ x: 200, y: 50 });
    expect(points[1]!.y).toBe(points[0]!.y);
    expect(points[3]).toEqual({ x: 500, y: 350 });
    expect(points[2]!.y).toBe(points[3]!.y);
  });

  it("draws a cubic bezier with control points extending perpendicular from each side", () => {
    const d = connectorPath(node("a", 0, 0), node("b", 500, 0), "curved");
    const match = /^M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/.exec(d);
    expect(match).not.toBeNull();
    const numbers = match!.slice(1).map(Number);
    expect(numbers.every(Number.isFinite)).toBe(true);
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = numbers as [number, number, number, number, number, number, number, number];
    expect(c1x).toBeGreaterThan(x0);
    expect(c1y).toBe(y0);
    expect(c2x).toBeLessThan(x1);
    expect(c2y).toBe(y1);
  });

  it("produces finite coordinates for overlapping and identical nodes", () => {
    const same = node("a", 40, 40);
    for (const routing of ["straight", "elbow", "curved"] as const) {
      for (const pair of [[same, node("b", 40, 40)], [same, node("b", 60, 50)]] as const) {
        const d = connectorPath(pair[0], pair[1], routing);
        expect(d.length).toBeGreaterThan(0);
        expect(d).not.toMatch(/NaN|Infinity/);
        expect(parsePoints(d).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("connectorLabelPoint", () => {
  it("returns the midpoint of a straight connector", () => {
    expect(connectorLabelPoint(node("a", 0, 0), node("b", 500, 0), "straight")).toEqual({ x: 350, y: 50 });
  });

  it("sits on the middle segment of an elbow, not on the straight-line midpoint", () => {
    const source = node("a", 0, 0);
    const target = node("b", 500, 300, 300, 200);
    const point = connectorLabelPoint(source, target, "elbow");
    const points = parsePoints(connectorPath(source, target, "elbow"));
    const [, second, third] = points as [Point, Point, Point, Point];
    expect(point.x).toBe(second.x);
    expect(point.x).toBe(third.x);
    expect(point.y).toBe((second.y + third.y) / 2);
    expect(point.y).toBeGreaterThan(Math.min(second.y, third.y));
    expect(point.y).toBeLessThan(Math.max(second.y, third.y));
    // Not the centre-to-centre midpoint: the label tracks the routed path, not the raw line.
    expect(point).not.toEqual({ x: 375, y: 225 });
    expect(point).toEqual({ x: 350, y: 225 });
  });

  it("returns the bezier midpoint for a curved connector and stays finite when nodes overlap", () => {
    const curved = connectorLabelPoint(node("a", 0, 0), node("b", 500, 0), "curved");
    expect(curved).toEqual({ x: 350, y: 50 });
    const overlapping = connectorLabelPoint(node("a", 0, 0), node("b", 0, 0), "curved");
    expect(Number.isFinite(overlapping.x)).toBe(true);
    expect(Number.isFinite(overlapping.y)).toBe(true);
  });
});
