// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SHAPE_KINDS,
  SHAPE_LABELS,
  shapeClipPath,
  shapePath,
  textInset,
  type ShapeKind,
} from "../src/shapes";
import { ShapeGlyph } from "../components/shape-glyph";

const OUTLINE_ONLY: ShapeKind[] = ["cylinder", "cloud", "actor"];
const CLIPPABLE = SHAPE_KINDS.filter((k) => !OUTLINE_ONLY.includes(k));
const BOXES: Array<[number, number]> = [
  [40, 32],
  [400, 40],
  [40, 400],
  [160, 120],
];

function arcRadii(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const chunk of d.match(/A[^MLCAZ]*/g) ?? []) {
    const nums = (chunk.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 6 < nums.length; i += 7) out.push([nums[i], nums[i + 1]]);
  }
  return out;
}

/** Pull drawn coordinates out of a path, accounting for arc flags/radii. */
function coords(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const chunks = d.match(/[MLCAZ][^MLCAZ]*/g) ?? [];
  for (const chunk of chunks) {
    const cmd = chunk[0];
    const nums = (chunk.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === "Z") continue;
    if (cmd === "A") {
      for (let i = 0; i + 6 < nums.length; i += 7) out.push([nums[i + 5], nums[i + 6]]);
    } else {
      for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
    }
  }
  return out;
}

describe("shape catalogue", () => {
  it("keeps SHAPE_KINDS and SHAPE_LABELS in sync", () => {
    expect([...SHAPE_KINDS].sort()).toEqual(Object.keys(SHAPE_LABELS).sort());
    expect(SHAPE_KINDS).toHaveLength(9);
    expect(new Set(SHAPE_KINDS).size).toBe(SHAPE_KINDS.length);
  });

  it("gives every kind a distinct non-empty label", () => {
    const labels = SHAPE_KINDS.map((k) => SHAPE_LABELS[k]);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("shapePath", () => {
  it("emits a closed path starting with M and no NaN", () => {
    for (const kind of SHAPE_KINDS) {
      const d = shapePath(kind, 160, 120);
      expect(d.startsWith("M"), kind).toBe(true);
      expect(d, kind).not.toMatch(/NaN|Infinity|undefined/);
      expect(d, kind).toContain("Z");
    }
  });

  it("stays inside the box at every aspect ratio", () => {
    for (const kind of SHAPE_KINDS) {
      for (const [w, h] of BOXES) {
        for (const [x, y] of coords(shapePath(kind, w, h))) {
          expect(Number.isFinite(x) && Number.isFinite(y), `${kind} ${w}x${h}`).toBe(true);
          expect(x, `${kind} ${w}x${h} x`).toBeGreaterThanOrEqual(-0.01);
          expect(x, `${kind} ${w}x${h} x`).toBeLessThanOrEqual(w + 0.01);
          expect(y, `${kind} ${w}x${h} y`).toBeGreaterThanOrEqual(-0.01);
          expect(y, `${kind} ${w}x${h} y`).toBeLessThanOrEqual(h + 0.01);
        }
      }
    }
  });

  it("uses the full box, not a degenerate sliver, at the 40x32 minimum", () => {
    for (const kind of SHAPE_KINDS) {
      const d = shapePath(kind, 40, 32);
      const points = coords(d);
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      // An arc carries its extent in the radii, not just in its endpoints.
      const radii = arcRadii(d);
      const spanX = Math.max(Math.max(...xs) - Math.min(...xs), ...radii.map((r) => r[0] * 2));
      const spanY = Math.max(Math.max(...ys) - Math.min(...ys), ...radii.map((r) => r[1] * 2));
      expect(spanX, kind).toBeGreaterThan(40 * 0.35);
      expect(spanY, kind).toBeGreaterThan(32 * 0.55);
    }
  });

  it("survives degenerate and hostile sizes", () => {
    const bad: Array<[number, number]> = [
      [0, 0],
      [-50, -20],
      [Number.NaN, 10],
      [10, Number.POSITIVE_INFINITY],
    ];
    for (const kind of SHAPE_KINDS) {
      for (const [w, h] of bad) {
        const d = shapePath(kind, w, h);
        expect(d, `${kind} ${w}x${h}`).not.toMatch(/NaN|Infinity/);
        expect(d.startsWith("M"), `${kind} ${w}x${h}`).toBe(true);
      }
    }
  });

  it("scales the cylinder rim with the box instead of a fixed constant", () => {
    const wide = coords(shapePath("cylinder", 400, 80));
    const tall = coords(shapePath("cylinder", 80, 400));
    // First point is (0, rimDepth) in both cases.
    expect(wide[0][1]).toBeCloseTo(80 * 0.18, 5);
    expect(tall[0][1]).toBeCloseTo(80 / 4, 5);
    expect(tall[0][1]).toBeGreaterThan(wide[0][1]);
  });

  it("draws the cloud as a ring of lobes that follows the perimeter", () => {
    const square = (shapePath("cloud", 120, 120).match(/A/g) ?? []).length;
    const wide = (shapePath("cloud", 600, 120).match(/A/g) ?? []).length;
    expect(square).toBeGreaterThanOrEqual(7);
    expect(wide).toBeGreaterThan(square);
    expect(shapePath("cloud", 200, 120)).not.toMatch(/L/);
  });

  it("draws the actor as a head plus a torso", () => {
    const d = shapePath("actor", 120, 160);
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect(d).toContain("A");
    expect(d).toContain("C");
  });
});

describe("shapeClipPath", () => {
  it("returns a CSS value for clippable shapes and null for outline shapes", () => {
    for (const kind of CLIPPABLE) expect(shapeClipPath(kind, 160, 120), kind).not.toBeNull();
    for (const kind of OUTLINE_ONLY) expect(shapeClipPath(kind, 160, 120), kind).toBeNull();
  });

  it("emits finite CSS functions", () => {
    for (const kind of CLIPPABLE) {
      for (const [w, h] of BOXES) {
        const value = shapeClipPath(kind, w, h) as string;
        expect(value, kind).not.toMatch(/NaN|Infinity/);
        expect(value, kind).toMatch(/^(polygon|ellipse|inset)\(/);
      }
    }
  });
});

describe("textInset", () => {
  it("leaves a usable, finite text box for every kind and size", () => {
    for (const kind of SHAPE_KINDS) {
      for (const [w, h] of BOXES) {
        const i = textInset(kind, w, h);
        for (const v of [i.top, i.right, i.bottom, i.left]) {
          expect(Number.isFinite(v), `${kind} ${w}x${h}`).toBe(true);
          expect(v, `${kind} ${w}x${h}`).toBeGreaterThanOrEqual(0);
        }
        expect(i.left + i.right, `${kind} ${w}x${h}`).toBeLessThanOrEqual(w - 2 + 1e-6);
        expect(i.top + i.bottom, `${kind} ${w}x${h}`).toBeLessThanOrEqual(h - 2 + 1e-6);
      }
    }
  });

  it("pushes triangle text into the lower half, inside the sloped sides", () => {
    const i = textInset("triangle", 200, 160);
    expect(i.top).toBeGreaterThanOrEqual(160 * 0.5);
    // At the text-box top the triangle is 2 * (h - top)/h * (w/2) wide; text must fit inside it.
    const halfWidthAtTop = ((160 - i.top) / 160) * (200 / 2);
    expect(200 / 2 - i.left).toBeLessThanOrEqual(halfWidthAtTop);
  });

  it("keeps cylinder text below the rim and above the bottom curve", () => {
    const w = 240;
    const h = 120;
    const rim = Math.min(h * 0.18, w / 4);
    const i = textInset("cylinder", w, h);
    expect(i.top).toBeGreaterThan(rim * 2);
    expect(i.bottom).toBeGreaterThan(rim);
  });

  it("keeps cloud text inside the lobes", () => {
    for (const [w, h] of BOXES) {
      const i = textInset("cloud", w, h);
      expect(i.left, `${w}x${h}`).toBeGreaterThanOrEqual(w * 0.15);
      expect(i.top, `${w}x${h}`).toBeGreaterThanOrEqual(h * 0.15);
      // Every corner of the text box must sit inside the cloud body ellipse.
      const nx = (w / 2 - i.left) / ((w / 2) * 0.92);
      const ny = (h / 2 - i.top) / ((h / 2) * 0.92);
      expect(nx * nx + ny * ny, `${w}x${h}`).toBeLessThan(1);
    }
  });

  it("derives insets from the box size rather than fixed constants", () => {
    for (const kind of ["cloud", "triangle", "diamond", "cylinder"] as ShapeKind[]) {
      const small = textInset(kind, 100, 100);
      const large = textInset(kind, 400, 400);
      expect(large.top, kind).toBeGreaterThan(small.top);
      expect(large.left, kind).toBeGreaterThan(small.left);
    }
  });
});

describe("ShapeGlyph", () => {
  it("renders 24x24 line art with a path for every kind", () => {
    for (const kind of SHAPE_KINDS) {
      const html = renderToStaticMarkup(<ShapeGlyph kind={kind} />);
      const host = document.createElement("div");
      host.innerHTML = html;
      const svg = host.querySelector("svg");
      expect(svg, kind).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.getAttribute("fill")).toBe("none");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(host.querySelectorAll("path").length, kind).toBeGreaterThanOrEqual(1);
      expect(html, kind).not.toMatch(/NaN|Infinity/);
    }
  });
});
