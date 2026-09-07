export type ShapeKind =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "cylinder"
  | "cloud"
  | "parallelogram"
  | "hexagon"
  | "triangle"
  | "actor";

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle",
  "ellipse",
  "diamond",
  "cylinder",
  "cloud",
  "parallelogram",
  "hexagon",
  "triangle",
  "actor",
];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  cylinder: "Database",
  cloud: "Cloud",
  parallelogram: "Input / output",
  hexagon: "Process",
  triangle: "Decision",
  actor: "Actor",
};

export type TextInset = { top: number; right: number; bottom: number; left: number };

const MIN_SIDE = 1;

function side(value: number): number {
  return Number.isFinite(value) && value > MIN_SIDE ? value : MIN_SIDE;
}

function n(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1000) / 1000);
}

/** Depth of the cylinder's elliptical rim; capped by width so it stays a plausible perspective circle. */
function rimDepth(width: number, height: number): number {
  return Math.max(0.5, Math.min(height * 0.18, width / 4, (height - 0.5) / 2));
}

/** Horizontal bite taken out of parallelogram / hexagon corners. */
function slant(width: number, factor: number): number {
  return Math.max(0.5, Math.min(width * factor, width * 0.4));
}

/**
 * The actor keeps a person's proportions instead of stretching: a figure box of
 * roughly 1:1.9 is centred in the node, and the head and shoulders are derived from it.
 */
function actorMetrics(width: number, height: number): {
  headRadius: number;
  headCenterY: number;
  bodyTop: number;
  bodyControlY: number;
  bodyBottom: number;
  bodyLeft: number;
  bodyRight: number;
} {
  const figureWidth = Math.min(width, height * 0.55);
  const figureHeight = Math.min(height, figureWidth * 1.9);
  const top = (height - figureHeight) / 2;
  const bodyBottom = top + figureHeight;

  const headRadius = Math.max(0.25, Math.min(figureWidth * 0.3, figureHeight * 0.16));
  const headCenterY = top + headRadius + figureHeight * 0.04;
  const bodyTop = headCenterY + headRadius + figureHeight * 0.05;
  // Control y chosen so the cubic's apex lands exactly on bodyTop, tucking the shoulders under the head.
  const bodyControlY = (bodyTop - 0.25 * bodyBottom) / 0.75;
  const half = (figureWidth / 2) * 0.95;

  return {
    headRadius,
    headCenterY,
    bodyTop,
    bodyControlY,
    bodyBottom,
    bodyLeft: width / 2 - half,
    bodyRight: width / 2 + half,
  };
}

const LOBE_RADIUS = [0.66, 0.56];

/**
 * Cloud: lobes bulging outward from an inset ellipse. The lobe count follows the
 * perimeter, so a wide box gets more lobes rather than wider ones, and the ellipse
 * is inset by the lobe bulge so the outline stays in the box at any aspect ratio.
 */
function cloudLobes(width: number, height: number): number {
  const rx = width / 2;
  const ry = height / 2;
  const perimeter = Math.PI * (1.5 * (rx + ry) - Math.sqrt(rx * ry));
  return Math.min(16, Math.max(7, Math.round(perimeter / (Math.min(rx, ry) * 0.9))));
}

/** How far the lobe ellipse is pulled in so the bulges land on the edge of the box. */
function cloudInset(width: number, height: number): number {
  const rx = width / 2;
  const ry = height / 2;
  const perimeter = Math.PI * (1.5 * (rx + ry) - Math.sqrt(rx * ry));
  const chord = perimeter / cloudLobes(width, height);
  const bulge = chord * (LOBE_RADIUS[0] - Math.sqrt(LOBE_RADIUS[0] ** 2 - 0.25));
  return Math.min(0.92, Math.max(0.55, 1 - bulge / Math.min(rx, ry)));
}

function cloudPath(width: number, height: number): string {
  const rx = width / 2;
  const ry = height / 2;
  const count = cloudLobes(width, height);
  const inset = cloudInset(width, height);

  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    points.push([rx + inset * rx * Math.cos(angle), ry + inset * ry * Math.sin(angle)]);
  }

  let d = `M ${n(points[0][0])} ${n(points[0][1])}`;
  for (let i = 0; i < count; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % count];
    const c = Math.hypot(x1 - x0, y1 - y0);
    const r = Math.max(c * LOBE_RADIUS[i % LOBE_RADIUS.length], c / 2 + 0.01);
    d += ` A ${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y1)}`;
  }
  return `${d} Z`;
}

/** SVG path for a shape filling a width x height box at the origin. */
export function shapePath(kind: ShapeKind, width: number, height: number): string {
  const w = side(width);
  const h = side(height);

  switch (kind) {
    case "rectangle":
      return `M 0 0 L ${n(w)} 0 L ${n(w)} ${n(h)} L 0 ${n(h)} Z`;
    case "ellipse": {
      const rx = w / 2;
      const ry = h / 2;
      return `M 0 ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 1 0 ${n(ry)} Z`;
    }
    case "diamond":
      return `M ${n(w / 2)} 0 L ${n(w)} ${n(h / 2)} L ${n(w / 2)} ${n(h)} L 0 ${n(h / 2)} Z`;
    case "cylinder": {
      const ry = rimDepth(w, h);
      const rx = w / 2;
      const base = h - ry;
      const body =
        `M 0 ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)}` +
        ` L ${n(w)} ${n(base)} A ${n(rx)} ${n(ry)} 0 0 1 0 ${n(base)} Z`;
      // Near side of the top rim; wound the same way as the body so nonzero fill keeps the lid solid.
      const rim = `M ${n(w)} ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 1 0 ${n(ry)}`;
      return `${body} ${rim}`;
    }
    case "cloud":
      return cloudPath(w, h);
    case "parallelogram": {
      const s = slant(w, 0.2);
      return `M ${n(s)} 0 L ${n(w)} 0 L ${n(w - s)} ${n(h)} L 0 ${n(h)} Z`;
    }
    case "hexagon": {
      const s = slant(w, 0.22);
      return (
        `M ${n(s)} 0 L ${n(w - s)} 0 L ${n(w)} ${n(h / 2)}` +
        ` L ${n(w - s)} ${n(h)} L ${n(s)} ${n(h)} L 0 ${n(h / 2)} Z`
      );
    }
    case "triangle":
      return `M ${n(w / 2)} 0 L ${n(w)} ${n(h)} L 0 ${n(h)} Z`;
    case "actor": {
      const m = actorMetrics(w, h);
      const cx = w / 2;
      const head =
        `M ${n(cx - m.headRadius)} ${n(m.headCenterY)}` +
        ` A ${n(m.headRadius)} ${n(m.headRadius)} 0 0 1 ${n(cx + m.headRadius)} ${n(m.headCenterY)}` +
        ` A ${n(m.headRadius)} ${n(m.headRadius)} 0 0 1 ${n(cx - m.headRadius)} ${n(m.headCenterY)} Z`;
      // Shoulders: one symmetric cubic arch from the bottom-left to the bottom-right of the torso.
      const body =
        `M ${n(m.bodyLeft)} ${n(m.bodyBottom)}` +
        ` C ${n(m.bodyLeft)} ${n(m.bodyControlY)} ${n(m.bodyRight)} ${n(m.bodyControlY)}` +
        ` ${n(m.bodyRight)} ${n(m.bodyBottom)} Z`;
      return `${head} ${body}`;
    }
  }
}

function polygon(points: ReadonlyArray<readonly [number, number]>): string {
  return `polygon(${points.map(([x, y]) => `${n(x)}px ${n(y)}px`).join(", ")})`;
}

/** CSS clip-path polygon/ellipse value, or null when the shape needs an SVG outline instead. */
export function shapeClipPath(kind: ShapeKind, width: number, height: number): string | null {
  const w = side(width);
  const h = side(height);

  switch (kind) {
    case "rectangle":
      return "inset(0)";
    case "ellipse":
      return "ellipse(50% 50% at 50% 50%)";
    case "diamond":
      return polygon([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ]);
    case "parallelogram": {
      const s = slant(w, 0.2);
      return polygon([
        [s, 0],
        [w, 0],
        [w - s, h],
        [0, h],
      ]);
    }
    case "hexagon": {
      const s = slant(w, 0.22);
      return polygon([
        [s, 0],
        [w - s, 0],
        [w, h / 2],
        [w - s, h],
        [s, h],
        [0, h / 2],
      ]);
    }
    case "triangle":
      return polygon([
        [w / 2, 0],
        [w, h],
        [0, h],
      ]);
    case "cylinder":
    case "cloud":
    case "actor":
      return null;
  }
}

function fit(inset: TextInset, width: number, height: number): TextInset {
  const clampAxis = (a: number, b: number, extent: number): [number, number] => {
    const room = Math.max(extent - 2, 0);
    const total = a + b;
    if (total <= room) return [Math.max(a, 0), Math.max(b, 0)];
    const scale = total > 0 ? room / total : 0;
    return [a * scale, b * scale];
  };
  const [top, bottom] = clampAxis(inset.top, inset.bottom, height);
  const [left, right] = clampAxis(inset.left, inset.right, width);
  return { top, right, bottom, left };
}

/** Inset (in px) where text must sit so it stays inside the shape's outline. */
export function textInset(kind: ShapeKind, width: number, height: number): TextInset {
  const w = side(width);
  const h = side(height);
  const pad = Math.max(2, Math.min(w, h) * 0.08);

  switch (kind) {
    case "rectangle":
      return fit({ top: pad, right: pad, bottom: pad, left: pad }, w, h);
    case "ellipse":
      return fit(
        { top: h * 0.14 + pad, right: w * 0.14 + pad, bottom: h * 0.14 + pad, left: w * 0.14 + pad },
        w,
        h,
      );
    case "diamond":
      return fit({ top: h * 0.25, right: w * 0.25, bottom: h * 0.25, left: w * 0.25 }, w, h);
    case "cylinder": {
      const ry = rimDepth(w, h);
      return fit({ top: ry * 2 + pad, right: pad, bottom: ry + pad, left: pad }, w, h);
    }
    case "cloud": {
      // Largest rectangle inscribed in the cloud's inset ellipse (corner at ~0.66 of each radius).
      const body = cloudInset(w, h);
      const x = (w / 2) * (1 - 0.66 * body);
      const y = (h / 2) * (1 - 0.66 * body);
      return fit({ top: y, right: x, bottom: y, left: x }, w, h);
    }
    case "parallelogram": {
      const s = slant(w, 0.2);
      return fit({ top: pad, right: s + pad, bottom: pad, left: s + pad }, w, h);
    }
    case "hexagon": {
      const s = slant(w, 0.22);
      return fit({ top: pad, right: s + pad, bottom: pad, left: s + pad }, w, h);
    }
    case "triangle":
      // Text sits in the lower half, inside the widening base of the triangle.
      return fit({ top: h * 0.5, right: w * 0.28, bottom: pad, left: w * 0.28 }, w, h);
    case "actor": {
      const m = actorMetrics(w, h);
      const halfInner = (m.bodyRight - m.bodyLeft) * 0.28;
      // Capped so a very wide box still leaves a usable label width under the figure.
      const sideInset = Math.min(w / 2 - halfInner, w * 0.35);
      const top = m.bodyTop + (m.bodyBottom - m.bodyTop) * 0.18;
      return fit({ top, right: sideInset, bottom: h - m.bodyBottom + pad, left: sideInset }, w, h);
    }
  }
}
