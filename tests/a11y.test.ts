import { describe, expect, it } from "vitest";
import { KIND_LABELS, connectorName, domId, nextObject, objectName, objectOrder, type ObjectRef } from "../src/a11y";
import { nodeKindSchema, type BoardEdge, type BoardNode } from "../src/domain";

function node(patch: Partial<BoardNode> & { id?: string } = {}): BoardNode {
  return {
    id: "n1",
    kind: "sticky",
    x: 120,
    y: 100,
    width: 220,
    height: 160,
    text: "",
    color: "yellow",
    fontFamily: "inter",
    fontSize: 17,
    fontWeight: 500,
    textAlign: "left",
    locked: false,
    groupId: null,
    ...patch,
  };
}

function edge(patch: Partial<BoardEdge> = {}): BoardEdge {
  return { id: "e1", source: "n1", target: "n2", label: "", color: "ink", routing: "straight", arrow: "end", ...patch };
}

describe("accessible names for canvas objects", () => {
  it("objectName uses the object's own text, collapsed and capped at 60 characters", () => {
    expect(objectName(node({ text: "  Customer\n  request   here \n" }))).toBe("Customer request here");

    const long = objectName(node({ text: "a".repeat(200) }));
    expect(long).toBe(`${"a".repeat(60)}…`);

    // The 60th code point is an emoji, so the cut must not land inside its surrogate pair.
    const emoji = objectName(node({ text: `${"a".repeat(59)}🙂${"b".repeat(100)}` }));
    expect(Array.from(emoji)).toHaveLength(61);
    expect(emoji.endsWith("🙂…")).toBe(true);
  });

  it("two empty objects of the same kind get different names", () => {
    expect(objectName(node({ id: "a", text: "", x: 120, y: 100 }))).toBe("Untitled sticky note at 120, 100");
    expect(objectName(node({ id: "b", text: "", x: 460, y: 100 }))).toBe("Untitled sticky note at 460, 100");
  });

  it("a locked object says so in its name", () => {
    expect(objectName(node({ locked: true, text: "Refund" }))).toBe("Refund, locked");
    expect(objectName(node({ locked: true, text: "" }))).toBe("Untitled sticky note at 120, 100, locked");
  });

  it("KIND_LABELS covers every node kind in the domain", () => {
    for (const kind of nodeKindSchema.options) {
      const label = KIND_LABELS[kind];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(label).toBe(label.toLowerCase());
    }
  });

  it("connectorName names both endpoints and the label", () => {
    const source = node({ id: "n1", text: "Customer request" });
    const target = node({ id: "n2", text: "Refund issued" });
    expect(connectorName(edge({ label: "then" }), source, target))
      .toBe('Connector "then" from Customer request to Refund issued');
    expect(connectorName(edge(), source, target)).toBe("Connector from Customer request to Refund issued");
    expect(connectorName(edge(), undefined, target)).toContain("unknown object");
    expect(connectorName(edge(), source, undefined)).toContain("unknown object");
  });

  it("objectOrder walks objects in reading order and puts connectors last", () => {
    const nodes = [
      node({ id: "d", x: 10, y: 400 }),
      node({ id: "b", x: 300, y: 100 }),
      node({ id: "c", x: 300, y: 100 }),
      node({ id: "a", x: 40, y: 100 }),
    ];
    const edges = [edge({ id: "e1", source: "d", target: "a" })];
    expect(objectOrder({ nodes, edges })).toEqual<ObjectRef[]>([
      { kind: "node", id: "a" },
      { kind: "node", id: "b" },
      { kind: "node", id: "c" },
      { kind: "node", id: "d" },
      { kind: "edge", id: "e1" },
    ]);
  });

  it("objectOrder sorts connectors by their endpoints' reading position", () => {
    const nodes = [node({ id: "a", x: 0, y: 0 }), node({ id: "b", x: 0, y: 200 }), node({ id: "c", x: 0, y: 400 })];
    const edges = [
      edge({ id: "z", source: "b", target: "c" }),
      edge({ id: "y", source: "a", target: "c" }),
      edge({ id: "x", source: "a", target: "b" }),
    ];
    expect(objectOrder({ nodes, edges }).filter((ref) => ref.kind === "edge").map((ref) => ref.id))
      .toEqual(["x", "y", "z"]);
  });

  it("nextObject does not wrap", () => {
    const order: ObjectRef[] = [
      { kind: "node", id: "a" },
      { kind: "node", id: "b" },
      { kind: "edge", id: "e1" },
    ];
    expect(nextObject(order, null, 1)).toEqual({ kind: "node", id: "a" });
    expect(nextObject(order, null, -1)).toEqual({ kind: "edge", id: "e1" });
    expect(nextObject(order, { kind: "node", id: "a" }, 1)).toEqual({ kind: "node", id: "b" });
    expect(nextObject(order, { kind: "edge", id: "e1" }, -1)).toEqual({ kind: "node", id: "b" });
    expect(nextObject(order, { kind: "edge", id: "e1" }, 1)).toBeNull();
    expect(nextObject(order, { kind: "node", id: "a" }, -1)).toBeNull();
    // A ref left behind by undo/redo is treated as no cursor at all.
    expect(nextObject(order, { kind: "node", id: "gone" }, 1)).toEqual({ kind: "node", id: "a" });
    expect(nextObject(order, { kind: "node", id: "gone" }, -1)).toEqual({ kind: "edge", id: "e1" });
    expect(nextObject([], null, 1)).toBeNull();
  });

  it("domId is stable per object", () => {
    expect(domId({ kind: "node", id: "sticky-1" })).toBe("canvas-object-sticky-1");
    expect(domId({ kind: "edge", id: "edge-1" })).toBe("canvas-object-edge-1");
  });
});
