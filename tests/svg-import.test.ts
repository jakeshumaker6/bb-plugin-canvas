import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardEdgeSchema, boardNodeSchema } from "../src/domain";
import { parseBoardImport, serializeBoardSvg } from "../src/portable";
import { SHAPE_KINDS, shapePath } from "../src/shapes";
import { importSvgObjects, type ImportedNode, type SvgImportResult } from "../src/svg-import";
import { createEmptyBoard, applyBoardOperations } from "../src/domain";

const fixture = readFileSync(new URL("./fixtures/figma-flow.svg", import.meta.url), "utf8");

/** Figma always writes fill="none" on the root, so the unit fixtures do too. */
function doc(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" fill="none">${body}</svg>`;
}

/** A 40x32 rect at the user-space origin, so normalisation's shift is knowable. */
const ANCHOR = '<rect x="0" y="0" width="40" height="32" fill="#93C5FD"/>';

function run(body: string): SvgImportResult {
  return importSvgObjects(doc(body));
}

function warned(result: SvgImportResult, pattern: RegExp): boolean {
  return result.warnings.some((warning) => pattern.test(warning));
}

describe("importSvgObjects — the Figma fixture", () => {
  it("resolves nested <g> transforms to absolute board coordinates", () => {
    const { nodes } = importSvgObjects(fixture);
    expect(nodes[0]).toMatchObject({ x: 0, y: 40, width: 180, height: 160 });
    expect(nodes[1]).toMatchObject({ x: 320, y: 0, width: 180, height: 180 });
    expect(nodes[2]).toMatchObject({ x: 600, y: 0, width: 180, height: 110 });
    expect(nodes[4]).toMatchObject({ x: 700, y: 260, width: 60, height: 40 });
  });

  it("maps each element to the right kind and drops the clipPath rect", () => {
    const { nodes } = importSvgObjects(fixture);
    expect(nodes.map((node) => node.kind)).toEqual(["sticky", "diamond", "ellipse", "text", "rectangle"]);
    expect(nodes).toHaveLength(5);
  });

  it("puts each label inside its shape and leaves the loose one free", () => {
    const { nodes } = importSvgObjects(fixture);
    expect(nodes[0]).toMatchObject({
      text: "Intake form",
      fontSize: 16,
      fontWeight: 600,
      textAlign: "center",
      fontFamily: "inter",
    });
    expect(nodes[1]?.text).toBe("Valid?");
    expect(nodes[2]?.text).toBe("Save");
    const free = nodes.filter((node) => node.kind === "text");
    expect(free).toHaveLength(1);
    expect(free[0]).toMatchObject({ text: "Draft — reviewed 3 Sep", fontSize: 21, fontWeight: 700, textAlign: "left" });
    // Text boxes are estimated, so position and width are asserted as ranges.
    expect(free[0]!.x).toBeCloseTo(0, 0);
    expect(free[0]!.width).toBeGreaterThan(180);
    expect(free[0]!.width).toBeLessThan(340);
  });

  it("emits exactly two connectors", () => {
    const { nodes, edges } = importSvgObjects(fixture);
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      source: nodes[0]!.id,
      target: nodes[1]!.id,
      routing: "straight",
      arrow: "end",
      label: "",
      color: "#94a3b8",
    });
    expect(edges[1]).toMatchObject({
      source: nodes[1]!.id,
      target: nodes[2]!.id,
      routing: "elbow",
      arrow: "end",
      label: "yes",
      color: "#94a3b8",
    });
  });

  it("does not leak the arrowhead triangle or the edge label as objects", () => {
    const result = importSvgObjects(fixture);
    expect(result.nodes.some((node) => node.kind === "triangle")).toBe(false);
    expect(result.nodes.some((node) => node.text === "yes")).toBe(false);
  });

  it("snaps Figma fills onto the Canvas palette", () => {
    const result = importSvgObjects(fixture);
    expect(result.nodes[0]?.color).toBe("yellow");
    expect(result.nodes[1]?.color).toBe("blue");
    expect(result.nodes[2]?.color).toBe("green");
    expect(result.nodes[4]?.color).toBe("purple");
    expect(warned(result, /gradient/i)).toBe(true);
  });

  it("emits nodes and edges that satisfy the board schemas", () => {
    const result = importSvgObjects(fixture);
    for (const node of result.nodes) expect(() => boardNodeSchema.parse({ ...node, locked: false, groupId: null })).not.toThrow();
    for (const edge of result.edges) expect(() => boardEdgeSchema.parse(edge)).not.toThrow();
  });

  it("places the import at the caller's origin", () => {
    const base = importSvgObjects(fixture);
    const moved = importSvgObjects(fixture, { origin: { x: 1000, y: -200 } });
    expect(moved.nodes).toHaveLength(base.nodes.length);
    moved.nodes.forEach((node, index) => {
      expect(node.x - base.nodes[index]!.x).toBe(1000);
      expect(node.y - base.nodes[index]!.y).toBe(-200);
      expect(node.width).toBe(base.nodes[index]!.width);
      expect(node.height).toBe(base.nodes[index]!.height);
    });
  });

  it("is deterministic and numbers ids in document order", () => {
    expect(importSvgObjects(fixture)).toEqual(importSvgObjects(fixture));
    expect(importSvgObjects(fixture).nodes.map((node) => node.id)).toEqual([
      "svg-1",
      "svg-2",
      "svg-3",
      "svg-4",
      "svg-5",
    ]);
  });

  it("can be replayed through applyBoardOperations without a validation error", () => {
    const result = importSvgObjects(fixture);
    const board = applyBoardOperations(
      createEmptyBoard({ id: "b", title: "t", now: "2026-01-01T00:00:00.000Z" }),
      [
        ...result.nodes.map((node) => ({ type: "add_node" as const, node })),
        ...result.edges.map((edge) => ({ type: "add_edge" as const, edge })),
      ],
      { now: "2026-01-01T00:00:00.000Z", makeId: () => "x" },
    );
    expect(board.nodes).toHaveLength(5);
    expect(board.edges).toHaveLength(2);
  });
});

describe("importSvgObjects — transforms", () => {
  it("composes nested translate and scale", () => {
    const { nodes } = run(`${ANCHOR}<g transform="translate(10 20) scale(2)"><g transform="translate(5 5)"><rect width="50" height="30" fill="#86EFAC"/></g></g>`);
    expect(nodes[1]).toMatchObject({ x: 20, y: 30, width: 100, height: 60 });
  });

  it("composes multi-function transforms left to right", () => {
    const { nodes } = run(`${ANCHOR}<g transform="translate(100 0) scale(2)"><rect x="10" y="0" width="50" height="30" fill="#86EFAC"/></g>`);
    expect(nodes[1]?.x).toBe(120);
  });

  it("accepts matrix() with comma or space separated arguments", () => {
    const commas = run(`${ANCHOR}<rect transform="matrix(1,0,0,1,10,20)" width="50" height="40" fill="#86EFAC"/>`);
    const spaces = run(`${ANCHOR}<rect transform="matrix(1 0 0 1 10 20)" width="50" height="40" fill="#86EFAC"/>`);
    expect(commas.nodes[1]).toMatchObject({ x: 10, y: 20, width: 50, height: 40 });
    expect(spaces.nodes[1]).toEqual(commas.nodes[1]);
  });

  it("flattens a rotation to its bounding box and warns", () => {
    const result = run(`${ANCHOR}<rect width="100" height="100" transform="rotate(45 50 50)" fill="#86EFAC"/>`);
    const rotated = result.nodes[1]!;
    const anchor = result.nodes[0]!;
    expect(rotated.width).toBe(141);
    expect(rotated.height).toBe(141);
    // Same centre as the unrotated square: 50,50 in user space.
    // 50,50 in user space for both, within the integer rounding the board applies.
    expect(Math.abs(rotated.x + rotated.width / 2 - (anchor.x + anchor.width / 2) - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(rotated.y + rotated.height / 2 - (anchor.y + anchor.height / 2) - 34)).toBeLessThanOrEqual(1);
    expect(warned(result, /rotat/i)).toBe(true);
  });

  it("handles rotate with a single argument about the origin", () => {
    const result = run(`${ANCHOR}<g transform="rotate(90)"><rect width="100" height="50" fill="#86EFAC"/></g>`);
    expect(result.nodes[1]).toMatchObject({ width: 50, height: 100 });
    expect(result.nodes[1]!.x - result.nodes[0]!.x).toBe(-50);
  });

  it("drops a subtree with an unknown transform function and warns", () => {
    const result = run(`${ANCHOR}<g transform="perspective(4)"><rect width="100" height="100" fill="#86EFAC"/></g>`);
    expect(result.nodes).toHaveLength(1);
    expect(warned(result, /transform/i)).toBe(true);
  });

  it("keeps a mirrored scale positive and in place", () => {
    const { nodes } = run(`${ANCHOR}<g transform="scale(-1 1)"><rect x="-150" y="10" width="100" height="50" fill="#86EFAC"/></g>`);
    expect(nodes[1]).toMatchObject({ x: 50, y: 10, width: 100, height: 50 });
  });
});

describe("importSvgObjects — shape classification", () => {
  it("classifies polygons by point count and normalised position", () => {
    expect(run('<polygon points="50,0 100,80 0,80" fill="#86EFAC"/>').nodes[0]?.kind).toBe("triangle");
    expect(run('<polygon points="44,0 156,0 200,50 156,100 44,100 0,50" fill="#86EFAC"/>').nodes[0]?.kind).toBe("hexagon");
    expect(run('<polygon points="20,0 100,0 80,60 0,60" fill="#86EFAC"/>').nodes[0]?.kind).toBe("parallelogram");
    expect(run('<polygon points="0,0 100,0 100,60 0,60" fill="#86EFAC"/>').nodes[0]?.kind).toBe("rectangle");
  });

  it("falls back to a rectangle for an unrecognised polygon and names the point count", () => {
    const result = run('<polygon points="0,0 100,0 100,60 50,80 0,60" fill="#86EFAC"/>');
    expect(result.nodes[0]?.kind).toBe("rectangle");
    expect(warned(result, /5-point polygon/i)).toBe(true);
  });

  it("round-trips every exported shape path back to its own kind", () => {
    for (const kind of SHAPE_KINDS) {
      const body = `<path d="${shapePath(kind, 180, 140)}" transform="translate(200 150)" fill="#86EFAC"/>`;
      const { nodes } = run(body);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.kind, `${kind} should round-trip`).toBe(kind);
      // The actor and the cloud do not paint into every corner of their box, so only
      // the box-filling geometries can be asserted at their exact size.
      if (kind !== "actor" && kind !== "cloud") {
        expect(nodes[0]).toMatchObject({ width: 180, height: 140 });
      }
    }
  });

  it("approximates a path that matches nothing as a rectangle", () => {
    const points: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const angle = (Math.PI * 2 * i) / 12;
      const radius = i % 2 === 0 ? 100 : 26;
      points.push(`${(120 + radius * Math.cos(angle)).toFixed(2)} ${(120 + radius * Math.sin(angle)).toFixed(2)}`);
    }
    const d = `M ${points[0]} ${points.slice(1).map((p) => `L ${p}`).join(" ")} Z`;
    const result = run(`<path d="${d}" fill="#86EFAC"/>`);
    expect(result.nodes[0]?.kind).toBe("rectangle");
    expect(warned(result, /approximat|could not/i)).toBe(true);
  });

  it("only calls a rounded, text-bearing, sticky-sized rect a sticky", () => {
    const label = '<text font-size="16" text-anchor="middle"><tspan x="100" y="100">Note</tspan></text>';
    expect(run(`<rect width="200" height="200" fill="#FDE68A"/>${label}`).nodes[0]?.kind).toBe("rectangle");
    expect(run(`<rect width="200" height="200" rx="40" fill="#FDE68A"/>${label}`).nodes[0]?.kind).toBe("rectangle");
    expect(run('<rect width="200" height="200" rx="8" fill="#FDE68A"/>').nodes[0]?.kind).toBe("rectangle");
    expect(run(`<rect width="200" height="200" rx="8" fill="#FDE68A"/>${label}`).nodes[0]?.kind).toBe("sticky");
  });
});

describe("importSvgObjects — text association", () => {
  it("leaves a text that straddles a border as a free node", () => {
    const result = run('<rect width="100" height="100" fill="#FDE68A"/><text font-size="16"><tspan x="90" y="50">Hello world</tspan></text>');
    expect(result.nodes.map((node) => node.kind)).toEqual(["rectangle", "text"]);
    expect(result.nodes[0]?.text).toBe("");
  });

  it("gives the text to the smaller of two nested shapes", () => {
    const result = run(
      '<rect width="400" height="400" fill="#FDE68A"/><rect x="100" y="100" width="120" height="120" fill="#93C5FD"/>' +
        '<text font-size="12" text-anchor="middle"><tspan x="160" y="160">hi</tspan></text>',
    );
    expect(result.nodes[0]?.text).toBe("");
    expect(result.nodes[1]?.text).toBe("hi");
  });

  it("concatenates sibling texts in document order", () => {
    const result = run(
      '<rect width="300" height="200" fill="#FDE68A"/>' +
        '<text font-size="14" text-anchor="middle"><tspan x="150" y="90">One</tspan></text>' +
        '<text font-size="14" text-anchor="middle"><tspan x="150" y="120">Two</tspan></text>',
    );
    expect(result.nodes[0]?.text).toBe("One\nTwo");
  });

  it("reads text-anchor from the tspan, the text element or the group", () => {
    expect(run('<text font-size="20"><tspan x="100" y="100" text-anchor="end">Ab</tspan></text>').nodes[0]?.textAlign).toBe("right");
    expect(run('<text font-size="20" text-anchor="middle"><tspan x="100" y="100">Ab</tspan></text>').nodes[0]?.textAlign).toBe("center");
    expect(run('<g text-anchor="start"><text font-size="20"><tspan x="100" y="100">Ab</tspan></text></g>').nodes[0]?.textAlign).toBe("left");
  });

  it("clamps font size and normalises font weight", () => {
    const small = run('<text font-size="4"><tspan x="10" y="10">Ab</tspan></text>');
    expect(small.nodes[0]?.fontSize).toBe(10);
    expect(warned(small, /font size/i)).toBe(true);
    const big = run('<text font-size="400"><tspan x="10" y="10">Ab</tspan></text>');
    expect(big.nodes[0]?.fontSize).toBe(96);
    expect(warned(big, /font size/i)).toBe(true);
    expect(run('<text font-size="20" font-weight="bold"><tspan x="10" y="10">Ab</tspan></text>').nodes[0]?.fontWeight).toBe(700);
  });

  it("maps font families onto the three Canvas faces", () => {
    expect(run('<text font-size="20" font-family="Georgia, serif"><tspan x="10" y="10">Ab</tspan></text>').nodes[0]?.fontFamily).toBe("serif");
    expect(run('<text font-size="20" font-family="Menlo"><tspan x="10" y="10">Ab</tspan></text>').nodes[0]?.fontFamily).toBe("mono");
    expect(run('<text font-size="20" font-family="Helvetica"><tspan x="10" y="10">Ab</tspan></text>').nodes[0]?.fontFamily).toBe("inter");
  });
});

describe("importSvgObjects — connectors", () => {
  const twoRects =
    '<rect x="0" y="0" width="100" height="100" fill="#FDE68A"/><rect x="400" y="0" width="100" height="100" fill="#93C5FD"/>';

  it("turns a <line> between two shapes into a straight edge with no arrow", () => {
    const result = run(`${twoRects}<line x1="100" y1="50" x2="400" y2="50" stroke="#94A3B8"/>`);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: "svg-1", target: "svg-2", routing: "straight", arrow: "none" });
  });

  it("reads arrow direction from markers", () => {
    const result = run(
      `${twoRects}<line x1="100" y1="50" x2="400" y2="50" stroke="#94A3B8" marker-start="url(#a)" marker-end="url(#a)"/>`,
    );
    expect(result.edges[0]?.arrow).toBe("both");
  });

  it("reads routing from the stroke's own geometry", () => {
    const elbow = run(`${twoRects}<polyline points="100,50 250,50 250,90 400,90" fill="none" stroke="#94A3B8"/>`);
    expect(elbow.edges[0]?.routing).toBe("elbow");
    const curved = run(`${twoRects}<path d="M100 50 C 200 -50 300 150 400 50" fill="none" stroke="#94A3B8"/>`);
    expect(curved.edges[0]?.routing).toBe("curved");
  });

  it("attaches an endpoint that stops just short but not one that stops far short", () => {
    const near = run(`${twoRects}<line x1="110" y1="50" x2="390" y2="50" stroke="#94A3B8"/>`);
    expect(near.edges).toHaveLength(1);
    const far = run(`${twoRects}<line x1="200" y1="50" x2="390" y2="50" stroke="#94A3B8"/>`);
    expect(far.edges).toHaveLength(0);
  });

  it("drops a stroke that only reaches one shape, and emits no node for it", () => {
    const result = run(`${twoRects}<line x1="100" y1="50" x2="250" y2="300" stroke="#94A3B8"/>`);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
    expect(warned(result, /connect/i)).toBe(true);
  });

  it("attaches to the smaller shape when two shapes overlap", () => {
    const result = run(
      '<rect x="0" y="0" width="400" height="400" fill="#FDE68A"/><rect x="150" y="150" width="100" height="100" fill="#93C5FD"/>' +
        '<rect x="600" y="150" width="100" height="100" fill="#86EFAC"/>' +
        '<line x1="250" y1="200" x2="600" y2="200" stroke="#94A3B8"/>',
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.source).toBe("svg-2");
  });

  it("never treats a filled closed path as a connector", () => {
    const result = run(`${twoRects}<path d="M100 48 L400 48 L400 52 L100 52 Z" fill="#94A3B8"/>`);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(3);
  });
});

describe("importSvgObjects — colour", () => {
  it("snaps near-palette fills and keeps everything else as lowercase hex", () => {
    expect(run('<rect width="100" height="80" fill="#FDE68B"/>').nodes[0]?.color).toBe("yellow");
    const kept = run('<rect width="100" height="80" fill="#94A3B8"/>').nodes[0]!.color;
    expect(kept).toBe("#94a3b8");
    expect(kept).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("parses rgb() with integer and percentage components", () => {
    expect(run('<rect width="100" height="80" fill="rgb(147, 197, 253)"/>').nodes[0]?.color).toBe("blue");
    expect(run('<rect width="100" height="80" fill="rgb(57.6%, 77.2%, 99.2%)"/>').nodes[0]?.color).toBe("blue");
  });

  it("inherits fill from an ancestor group", () => {
    expect(run('<g fill="#86EFAC"><rect width="100" height="80"/></g>').nodes[0]?.color).toBe("green");
  });

  it("turns an outline-only shape white and warns", () => {
    const result = run('<rect width="100" height="80" fill="none" stroke="#0F172A"/>');
    expect(result.nodes[0]?.color).toBe("white");
    expect(warned(result, /outline/i)).toBe(true);
  });

  it("composites opacity onto the board background and drops invisible elements", () => {
    expect(run('<rect width="100" height="80" fill="#FDE68A" opacity="0.5"/>').nodes[0]?.color).toBe("#fbf0c3");
    expect(run('<rect width="100" height="80" fill="#FDE68A" opacity="0"/>').nodes).toHaveLength(0);
  });

  it("applies and then drops the alpha of an 8-digit hex", () => {
    expect(run('<rect width="100" height="80" fill="#12345678"/>').nodes[0]?.color).toBe("#8c9dae");
  });
});

describe("importSvgObjects — hostile input", () => {
  it("refuses a billion-laughs payload without expanding it", () => {
    const entities = Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "&lol${i};&lol${i};&lol${i};&lol${i};">`).join("");
    const payload = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol">${entities}]><svg xmlns="http://www.w3.org/2000/svg"><text><tspan x="0" y="0">&lol9;</tspan></text></svg>`;
    const started = Date.now();
    expect(() => importSvgObjects(payload)).toThrow(/doctype|entity/i);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses a bare entity declaration", () => {
    expect(() => importSvgObjects('<!ENTITY x "y"><svg xmlns="http://www.w3.org/2000/svg"></svg>')).toThrow(/doctype|entity/i);
  });

  it("emits an unknown entity literally instead of resolving it", () => {
    const result = run('<text font-size="20"><tspan x="10" y="20">&xxe; &amp; &#65;</tspan></text>');
    expect(result.nodes[0]?.text).toBe("&xxe; & A");
  });

  it("executes nothing from script, style or event handlers", () => {
    const result = importSvgObjects(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'//evil\')" fill="none">' +
        '<script>alert("pwn");fetch("//evil")</script><style>rect{fill:red}</style>' +
        '<g onload="alert(1)"><rect width="0" height="0" fill="#FDE68A"/></g></svg>',
    );
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(JSON.stringify(result)).not.toMatch(/alert|fetch\(/);
  });

  it("skips foreignObject and warns once", () => {
    const result = run('<foreignObject width="200" height="100"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>');
    expect(result.nodes).toHaveLength(0);
    expect(warned(result, /foreignobject/i)).toBe(true);
  });

  it("only accepts inline raster image data", () => {
    const remote = run('<image x="0" y="0" width="100" height="100" href="https://attacker.example/x.png"/>');
    expect(remote.nodes).toHaveLength(0);
    expect(warned(remote, /image/i)).toBe(true);
    const nested = run('<image x="0" y="0" width="100" height="100" href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>');
    expect(nested.nodes).toHaveLength(0);
    const png = run('<image x="0" y="0" width="100" height="100" href="data:image/png;base64,iVBORw0KGgo="/>');
    expect(png.nodes).toHaveLength(1);
    expect(png.nodes[0]).toMatchObject({ kind: "image", imageData: "data:image/png;base64,iVBORw0KGgo=" });
  });

  it("caps elements, depth and input size", () => {
    const many = doc('<rect width="10" height="10" fill="#FDE68A"/>'.repeat(20_001));
    expect(() => importSvgObjects(many)).toThrow(/too many elements/i);
    const deep = doc(`${"<g>".repeat(65)}<rect width="50" height="50" fill="#FDE68A"/>${"</g>".repeat(65)}`);
    expect(() => importSvgObjects(deep)).toThrow(/deep|depth/i);
    expect(() => importSvgObjects(`<svg>${" ".repeat(5_000_001)}</svg>`)).toThrow(/too large|size/i);
    expect(() => importSvgObjects("")).toThrow(/empty/i);
    expect(() => importSvgObjects("<html><body>no svg here</body></html>")).toThrow(/svg/i);
  });

  it("truncates past the node cap instead of throwing", () => {
    const rects = Array.from(
      { length: 500 },
      (_, i) => `<rect x="${i * 60}" y="0" width="50" height="40" fill="#FDE68A"/>`,
    ).join("");
    const result = importSvgObjects(doc(rects));
    expect(result.nodes).toHaveLength(400);
    expect(warned(result, /400/)).toBe(true);
  });

  it("survives unclosed tags, stray angle brackets and truncation", () => {
    for (const broken of [
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="50" height="40" fill="#FDE68A">',
      '<svg xmlns="http://www.w3.org/2000/svg">a > b<rect width="50" height="40" fill="#FDE68A"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(10 10)"><rect width="50" hei',
      '<svg xmlns="http://www.w3.org/2000/svg"></g></g></svg>',
    ]) {
      let outcome: SvgImportResult | Error;
      try {
        outcome = importSvgObjects(broken);
      } catch (cause) {
        outcome = cause as Error;
      }
      if (outcome instanceof Error) {
        expect(outcome).not.toBeInstanceOf(TypeError);
        expect(outcome.message.length).toBeGreaterThan(0);
      } else {
        expect(Array.isArray(outcome.nodes)).toBe(true);
      }
    }
  });

  it("caps the warning list", () => {
    const result = importSvgObjects(fixture);
    expect(result.warnings.length).toBeLessThanOrEqual(20);
    expect(new Set(result.warnings).size).toBe(result.warnings.length);
  });
});

describe("parseBoardImport wiring", () => {
  it("routes a foreign Figma SVG through the object importer", () => {
    const result = parseBoardImport({ fileName: "figma-flow.svg", content: fixture });
    expect(result.kind).toBe("objects");
    if (result.kind !== "objects") throw new Error("expected objects");
    expect(result.nodes).toHaveLength(5);
    expect(result.edges).toHaveLength(2);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("still falls back to a reference picture when nothing maps", () => {
    const result = parseBoardImport({ fileName: "icon.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' });
    expect(result.kind).toBe("reference");
  });

  it("never routes a Canvas-authored SVG through the importer", () => {
    const board = createEmptyBoard({ id: "b", title: "Board", now: "2026-01-01T00:00:00.000Z" });
    const filled = applyBoardOperations(
      board,
      [
        { type: "add_node", node: { kind: "rectangle", x: 0, y: 0, color: "yellow", text: "A" } },
        { type: "add_node", node: { kind: "diamond", x: 400, y: 0, color: "blue", text: "B" } },
      ],
      { now: "2026-01-01T00:00:00.000Z", makeId: () => `n${Math.random()}` },
    );
    const result = parseBoardImport({ fileName: "board.svg", content: serializeBoardSvg(filled) });
    expect(result.kind).toBe("native");
  });
});

const _typecheck: ImportedNode["kind"] = "sticky";
void _typecheck;
