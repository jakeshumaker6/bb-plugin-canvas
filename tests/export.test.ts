import { describe, expect, it } from "vitest";
import { parseBoardImport, serializeBoardJson, serializeBoardSvg } from "../src/portable";
import { connectorPath } from "../src/connectors";
import {
  applyBoardOperations,
  createEmptyBoard,
  type BoardDocument,
  type BoardOperation,
} from "../src/domain";

const NOW = "2026-09-06T12:00:00.000Z";

function counter(prefix = "id"): () => string {
  let index = 0;
  return () => `${prefix}-${(index += 1)}`;
}

function build(operations: BoardOperation[], title = "Board"): BoardDocument {
  const empty = createEmptyBoard({ id: "board-1", title, now: NOW });
  if (operations.length === 0) return empty;
  return applyBoardOperations(empty, operations, { now: NOW, makeId: counter() });
}

/** Two boxes side by side plus a connector — the shape most assertions here need. */
function linked(overrides: Partial<{ arrow: "none" | "end" | "both"; label: string }> = {}): BoardDocument {
  return build([
    { type: "add_node", node: { id: "a", kind: "rectangle", x: 100, y: 100, width: 200, height: 120, text: "A", color: "blue" } },
    { type: "add_node", node: { id: "b", kind: "rectangle", x: 600, y: 100, width: 200, height: 120, text: "B", color: "green" } },
    {
      type: "add_edge",
      edge: { id: "e1", source: "a", target: "b", color: "gray", routing: "straight", arrow: overrides.arrow ?? "end", label: overrides.label ?? "" },
    },
  ]);
}

describe("serializeBoardJson", () => {
  it("round-trips every node field exactly through parseBoardImport", () => {
    const board = build([
      { type: "add_node", node: { id: "a", kind: "sticky", x: 12.5, y: -40, width: 220, height: 160, text: "note\nline two", color: "yellow", fontFamily: "mono", fontSize: 24, fontWeight: 700, textAlign: "right", locked: true, groupId: "g1" } },
      { type: "add_node", node: { id: "b", kind: "ellipse", x: 500, y: 40, color: "purple" } },
      { type: "add_edge", edge: { id: "e1", source: "a", target: "b", color: "gray", routing: "curved", arrow: "both", label: "calls" } },
      { type: "add_comment", comment: { id: "c1", nodeId: "a", message: "check this" } },
    ]);
    const result = parseBoardImport({ fileName: "board.canvas.json", content: serializeBoardJson(board) });
    expect(result.kind).toBe("native");
    if (result.kind !== "native") throw new Error("expected native");
    expect(result.board).toEqual(board);
    expect(result.board.nodes).toEqual(board.nodes);
  });

  it("stamps the schema version and writes a stable key order", () => {
    const board = linked();
    expect(serializeBoardJson(board)).toBe(serializeBoardJson(structuredClone(board)));
    const text = serializeBoardJson(board);
    expect(text.indexOf('"schemaVersion"')).toBe(text.indexOf('"'));
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: 1 });
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(keys).toEqual(["schemaVersion", "id", "title", "projectId", "chatThreadId", "version", "createdAt", "updatedAt", "nodes", "edges", "comments"]);
  });
});

describe("serializeBoardSvg", () => {
  it("escapes every piece of user text", () => {
    const board = build(
      [{ type: "add_node", node: { id: "a", kind: "rectangle", x: 0, y: 0, text: 'API <gateway> & "edge"', color: "blue" } }],
      "A & B",
    );
    const svg = serializeBoardSvg(board);
    expect(svg).toContain("<title>A &amp; B</title>");
    expect(svg).toContain("API &lt;gateway&gt; &amp; &quot;edge&quot;");
    expect(svg).not.toContain("API <gateway>");
    expect(svg).not.toContain("<title>A & B");
  });

  it("derives a padded viewBox with a 1200x800 floor", () => {
    expect(serializeBoardSvg(build([]))).toContain('viewBox="-600 -400 1200 800"');
    const wide = build([
      { type: "add_node", node: { id: "a", kind: "rectangle", x: 0, y: 0, width: 2000, height: 200, color: "blue" } },
    ]);
    // 2000 wide + 80 padding each side; height floors at 800 and centres on the content.
    expect(serializeBoardSvg(wide)).toContain('viewBox="-80 -300 2160 800"');
  });

  it("draws connectors with connectorPath so the file matches the canvas", () => {
    const board = linked();
    const [source, target] = board.nodes;
    const expected = connectorPath(source!, target!, "straight");
    // Right border of the source, not its centre.
    expect(expected).toBe("M 300 160 L 600 160");
    const svg = serializeBoardSvg(board);
    expect(svg).toContain(`d="${expected}"`);
    expect(svg).toContain(`<path d="${expected}" fill="none"`);
  });

  it("places the connector label at connectorLabelPoint", () => {
    const svg = serializeBoardSvg(linked({ label: "calls & waits" }));
    expect(svg).toContain('x="450"');
    expect(svg).toContain("calls &amp; waits");
  });

  it("adds marker-start only for a two-way arrow", () => {
    const both = serializeBoardSvg(linked({ arrow: "both" }));
    expect(both).toContain("marker-start=");
    expect(both).toContain("marker-end=");
    const end = serializeBoardSvg(linked({ arrow: "end" }));
    expect(end).not.toContain("marker-start=");
    expect(end).toContain("marker-end=");
    const none = serializeBoardSvg(linked({ arrow: "none" }));
    expect(none).not.toContain("marker-start=");
    expect(none).not.toContain("marker-end=");
  });

  it("is a self-contained document with a defs marker, background and metadata", () => {
    const svg = serializeBoardSvg(linked());
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('orient="auto-start-reverse"');
    expect(svg).toContain('data-role="background"');
    expect(svg).toContain('<metadata id="bb-canvas-data" encoding="base64">');
  });

  it("renders each node kind with its palette fill and typography", () => {
    const board = build([
      { type: "add_node", node: { id: "a", kind: "sticky", x: 0, y: 0, color: "yellow", text: "s", fontFamily: "serif", fontSize: 24, fontWeight: 700, textAlign: "right" } },
      { type: "add_node", node: { id: "b", kind: "ellipse", x: 400, y: 0, color: "coral" } },
      { type: "add_node", node: { id: "c", kind: "diamond", x: 800, y: 0, color: "purple" } },
    ]);
    const svg = serializeBoardSvg(board);
    expect(svg).toContain('fill="#fde68a"');
    expect(svg).toContain("<ellipse");
    expect(svg).toContain("<polygon");
    expect(svg).toContain('font-size="24"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain("Georgia, serif");
  });
});

describe("parseBoardImport", () => {
  it("re-imports a Canvas SVG as a native board with identical nodes", () => {
    const board = linked({ label: "calls & <waits>" });
    const result = parseBoardImport({ fileName: "board.svg", content: serializeBoardSvg(board) });
    expect(result.kind).toBe("native");
    if (result.kind !== "native") throw new Error("expected native");
    expect(result.board).toEqual(board);
  });

  it("treats a foreign SVG as an inert picture", () => {
    const result = parseBoardImport({ fileName: "figma-export.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' });
    expect(result.kind).toBe("reference");
    if (result.kind !== "reference") throw new Error("expected reference");
    expect(result.node.kind).toBe("image");
    expect(result.node.imageData.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(result.node.width).toBeGreaterThan(0);
    expect(result.node.height).toBeGreaterThan(0);
  });

  it("accepts png and jpeg data URLs as references", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const result = parseBoardImport({ fileName: "shot.PNG", content: png });
    expect(result).toEqual({ kind: "reference", node: { kind: "image", imageData: png, width: 480, height: 320 } });
    expect(parseBoardImport({ fileName: "shot.jpeg", content: "data:image/jpeg;base64,/9j/4AA=" }).kind).toBe("reference");
    expect(() => parseBoardImport({ fileName: "shot.jpg", content: "not-a-data-url" })).toThrow(/data URL/i);
  });

  it("explains what to do with proprietary .fig and .jam files", () => {
    expect(() => parseBoardImport({ fileName: "design.fig", content: "x" })).toThrow(/Figma Design/);
    expect(() => parseBoardImport({ fileName: "jam.jam", content: "x" })).toThrow(/FigJam/);
    expect(() => parseBoardImport({ fileName: "design.fig", content: "x" })).toThrow(/SVG/);
  });

  it("rejects malformed JSON and the wrong schema version", () => {
    expect(() => parseBoardImport({ fileName: "b.canvas.json", content: "{ not json" })).toThrow(/valid JSON/i);
    const bumped = JSON.parse(serializeBoardJson(linked())) as Record<string, unknown>;
    bumped.schemaVersion = 99;
    expect(() => parseBoardImport({ fileName: "b.json", content: JSON.stringify(bumped) })).toThrow(/Canvas board/i);
  });

  it("rejects oversized input before parsing anything", () => {
    const huge = `{"schemaVersion":1,${"x".repeat(5_000_001)}`;
    expect(() => parseBoardImport({ fileName: "b.canvas.json", content: huge })).toThrow(/too large/i);
    expect(() => parseBoardImport({ fileName: "b.canvas.json", content: "" })).toThrow(/empty/i);
    expect(() => parseBoardImport({ fileName: "notes.txt", content: "hello" })).toThrow(/cannot import/i);
  });
});
