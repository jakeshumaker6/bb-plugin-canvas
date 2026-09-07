import type { BoardEdge, BoardNode, BoardNodeKind } from "./domain";
import { SHAPE_KINDS, shapePath, type ShapeKind } from "./shapes";

export type SvgImportOptions = { origin?: { x: number; y: number } };

export type ImportedNode = {
  id: string;
  kind: BoardNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fontFamily: BoardNode["fontFamily"];
  fontSize: number;
  fontWeight: number;
  textAlign: BoardNode["textAlign"];
  imageData?: string;
};

export type ImportedEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  color: string;
  routing: BoardEdge["routing"];
  arrow: BoardEdge["arrow"];
};

export type SvgImportResult = { nodes: ImportedNode[]; edges: ImportedEdge[]; warnings: string[] };

// --------------------------------------------------------------- caps

const MAX_INPUT_CHARS = 5_000_000;
const MAX_ELEMENTS = 20_000;
const MAX_DEPTH = 64;
const MAX_ATTRS_PER_ELEMENT = 64;
const MAX_ATTR_CHARS = 100_000;
const MAX_PATH_COMMANDS = 20_000;
const MAX_POINTS = 4_000;
const MAX_NODES = 400;
const MAX_EDGES = 400;
const MAX_WARNINGS = 20;

const MIN_WIDTH = 40;
const MIN_HEIGHT = 32;
const MAX_SIDE = 4000;

const CURVE_SAMPLES = 16;
const RESAMPLE_POINTS = 64;
const SHAPE_SCORE_LIMIT = 0.06;
const POLYGON_TOLERANCE = 0.12;
const LABEL_RADIUS = 24;
const ARROWHEAD_SIDE = 40;
const ARROWHEAD_AREA = 800;
const SNAP_DISTANCE = 60;
const BACKGROUND: RGB = { r: 248, g: 250, b: 252 };
const INK = { r: 15, g: 23, b: 42 } as const;

/** Mirrors the palette portable.ts paints with, so an import round-trips through an export. */
const PALETTE: ReadonlyArray<{ id: string; rgb: RGB }> = [
  { id: "yellow", rgb: { r: 253, g: 230, b: 138 } },
  { id: "coral", rgb: { r: 253, g: 164, b: 175 } },
  { id: "blue", rgb: { r: 147, g: 197, b: 253 } },
  { id: "green", rgb: { r: 134, g: 239, b: 172 } },
  { id: "purple", rgb: { r: 196, g: 181, b: 253 } },
  { id: "gray", rgb: { r: 209, g: 213, b: 219 } },
  { id: "white", rgb: { r: 255, g: 255, b: 255 } },
];

const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  grey: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
};

/** Skipped whole: presentational-only, script-bearing, or a re-entry vector. */
const SKIPPED = new Set([
  "script",
  "style",
  "foreignobject",
  "switch",
  "use",
  "animate",
  "animatetransform",
  "animatemotion",
  "set",
  "clippath",
  "mask",
  "pattern",
  "filter",
  "marker",
  "symbol",
  "metadata",
  "desc",
  "title",
]);

/** Only these skips are worth telling the user about; the rest are structural in every export. */
const NOISY_SKIPS: Readonly<Record<string, string>> = {
  use: "Reused component instances (<use>) were skipped.",
  foreignobject: "Embedded HTML inside <foreignObject> was skipped.",
  switch: "Conditional <switch> content was skipped.",
  style: "An embedded CSS <style> block was ignored.",
};

const STYLE_PROPERTIES = new Set([
  "fill",
  "stroke",
  "opacity",
  "fill-opacity",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "stop-color",
]);

// --------------------------------------------------------------- warnings

const ROTATED = "{n} rotated or skewed objects were flattened to their bounding boxes.";
const STROKED = "{n} object outlines were dropped; Canvas paints its own edge.";
const OUTLINE_ONLY = "{n} outline-only shapes were filled white; Canvas has no outline-only shape.";
const ENLARGED = "{n} objects were smaller than Canvas allows and were enlarged.";
const UNCONNECTED = "{n} strokes did not connect two objects and were dropped.";

type Warnings = {
  once: (message: string) => void;
  count: (template: string) => void;
  list: () => string[];
};

function makeWarnings(): Warnings {
  const singles: string[] = [];
  const counted = new Map<string, number>();
  return {
    once(message) {
      if (!singles.includes(message)) singles.push(message);
    },
    count(template) {
      counted.set(template, (counted.get(template) ?? 0) + 1);
    },
    list() {
      const aggregated = [...counted].map(([template, n]) => template.replace("{n}", String(n)));
      return [...new Set([...aggregated, ...singles])].slice(0, MAX_WARNINGS);
    },
  };
}

// --------------------------------------------------------------- geometry

type RGB = { r: number; g: number; b: number };
type Pt = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
/** [a,b,c,d,e,f] maps (x,y) to (a*x + c*y + e, b*x + d*y + f). */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function isRotated(m: Matrix): boolean {
  return Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6;
}

function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

function boxOf(points: readonly Pt[]): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function boxContains(outer: Box, inner: Box, pad: number): boolean {
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.width <= outer.x + outer.width + pad &&
    inner.y + inner.height <= outer.y + outer.height + pad
  );
}

function centerOf(box: Box): Pt {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// --------------------------------------------------------------- scanning

type Attrs = Readonly<Record<string, string>>;
type Token =
  | { kind: "open"; name: string; attrs: Attrs; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Only the five predefined entities and safe numeric references resolve; anything else stays literal. */
function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * A DOCTYPE or ENTITY declaration is refused outright rather than bounded: that kills
 * billion-laughs expansion and external-DTD fetching before any parsing happens.
 */
function assertNoDeclarations(svg: string): void {
  let index = 0;
  let inTag = false;
  let quote = "";
  while (index < svg.length) {
    const char = svg[index]!;
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (inTag) {
      if (char === '"' || char === "'") quote = char;
      else if (char === ">") inTag = false;
    } else if (char === "<") {
      const head = svg.slice(index, index + 9).toUpperCase();
      if (head.startsWith("<!DOCTYPE") || head.startsWith("<!ENTITY")) {
        throw new Error("This SVG declares a DOCTYPE or an ENTITY, which Canvas refuses to parse.");
      }
      inTag = true;
    }
    index += 1;
  }
}

function isNameChar(char: string): boolean {
  return !/[\s/>=]/.test(char);
}

function tokenize(svg: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let depth = 0;
  let elements = 0;

  const pushText = (raw: string): void => {
    if (raw.trim() === "") return;
    tokens.push({ kind: "text", text: decodeEntities(raw) });
  };

  while (index < svg.length) {
    const open = svg.indexOf("<", index);
    if (open < 0) {
      pushText(svg.slice(index));
      break;
    }
    if (open > index) pushText(svg.slice(index, open));

    if (svg.startsWith("<!--", open)) {
      const end = svg.indexOf("-->", open + 4);
      if (end < 0) break;
      index = end + 3;
      continue;
    }
    if (svg.startsWith("<![CDATA[", open)) {
      const end = svg.indexOf("]]>", open + 9);
      if (end < 0) break;
      pushText(svg.slice(open + 9, end));
      index = end + 3;
      continue;
    }
    if (svg.startsWith("<?", open) || svg.startsWith("<!", open)) {
      const end = svg.indexOf(">", open + 2);
      if (end < 0) break;
      index = end + 1;
      continue;
    }
    if (svg.startsWith("</", open)) {
      const end = svg.indexOf(">", open + 2);
      if (end < 0) break;
      tokens.push({ kind: "close", name: svg.slice(open + 2, end).trim().toLowerCase() });
      depth = Math.max(0, depth - 1);
      index = end + 1;
      continue;
    }

    let cursor = open + 1;
    let name = "";
    while (cursor < svg.length && isNameChar(svg[cursor]!)) {
      name += svg[cursor]!;
      cursor += 1;
    }
    if (name === "") {
      // A stray "<" that starts no tag is content, not markup.
      pushText("<");
      index = open + 1;
      continue;
    }

    const attrs: Record<string, string> = {};
    let selfClosing = false;
    let truncated = true;
    let attrCount = 0;
    while (cursor < svg.length) {
      while (cursor < svg.length && /\s/.test(svg[cursor]!)) cursor += 1;
      if (cursor >= svg.length) break;
      if (svg[cursor] === ">") {
        cursor += 1;
        truncated = false;
        break;
      }
      if (svg[cursor] === "/") {
        selfClosing = true;
        cursor += 1;
        continue;
      }
      let attrName = "";
      while (cursor < svg.length && isNameChar(svg[cursor]!)) {
        attrName += svg[cursor]!;
        cursor += 1;
      }
      if (attrName === "") {
        cursor += 1;
        continue;
      }
      attrCount += 1;
      if (attrCount > MAX_ATTRS_PER_ELEMENT) {
        throw new Error(`An element in this SVG carries more than ${MAX_ATTRS_PER_ELEMENT} attributes.`);
      }
      let value = "";
      while (cursor < svg.length && /\s/.test(svg[cursor]!)) cursor += 1;
      if (svg[cursor] === "=") {
        cursor += 1;
        while (cursor < svg.length && /\s/.test(svg[cursor]!)) cursor += 1;
        const quote = svg[cursor];
        if (quote === '"' || quote === "'") {
          const end = svg.indexOf(quote, cursor + 1);
          if (end < 0) {
            cursor = svg.length;
            break;
          }
          value = svg.slice(cursor + 1, end);
          cursor = end + 1;
        } else {
          while (cursor < svg.length && !/[\s>]/.test(svg[cursor]!)) {
            value += svg[cursor]!;
            cursor += 1;
          }
        }
      }
      if (value.length > MAX_ATTR_CHARS) throw new Error("An attribute in this SVG is too long to parse.");
      const key = attrName.toLowerCase();
      // Event handlers are never read, so a scripted attribute cannot reach the board.
      if (!key.startsWith("on")) attrs[key] = decodeEntities(value);
    }
    index = cursor;
    if (truncated && cursor >= svg.length) break;

    elements += 1;
    if (elements > MAX_ELEMENTS) throw new Error(`This SVG has too many elements (over ${MAX_ELEMENTS}).`);
    tokens.push({ kind: "open", name: name.toLowerCase(), attrs, selfClosing });
    if (!selfClosing) {
      depth += 1;
      if (depth > MAX_DEPTH) throw new Error(`This SVG is nested too deep (over ${MAX_DEPTH} levels).`);
    }
  }
  return tokens;
}

// --------------------------------------------------------------- colour

function parseStyle(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined) return out;
  for (const part of raw.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim().toLowerCase();
    if (!STYLE_PROPERTIES.has(key)) continue;
    out[key] = part.slice(colon + 1).trim();
  }
  return out;
}

function hexToRgb(hex: string): { rgb: RGB; alpha: number } | null {
  const body = hex.slice(1);
  const expand = (value: string): number => Number.parseInt(value.length === 1 ? value + value : value, 16);
  if (/^[0-9a-fA-F]{3,4}$/.test(body)) {
    return {
      rgb: { r: expand(body[0]!), g: expand(body[1]!), b: expand(body[2]!) },
      alpha: body.length === 4 ? expand(body[3]!) / 255 : 1,
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(body) || /^[0-9a-fA-F]{8}$/.test(body)) {
    return {
      rgb: { r: expand(body.slice(0, 2)), g: expand(body.slice(2, 4)), b: expand(body.slice(4, 6)) },
      alpha: body.length === 8 ? expand(body.slice(6, 8)) / 255 : 1,
    };
  }
  return null;
}

function parseColor(raw: string): { rgb: RGB; alpha: number } | null {
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "none" || value === "transparent") return null;
  if (value === "currentcolor") return { rgb: { ...INK }, alpha: 1 };
  if (value.startsWith("#")) return hexToRgb(value);
  const named = NAMED_COLORS[value];
  if (named !== undefined) return hexToRgb(named);
  const rgbMatch = /^rgba?\(([^)]*)\)$/.exec(value);
  if (rgbMatch !== null) {
    const parts = rgbMatch[1]!.split(/[\s,/]+/).filter((part) => part !== "");
    if (parts.length < 3) return null;
    const channel = (part: string): number => {
      const number = Number.parseFloat(part);
      if (!Number.isFinite(number)) return 0;
      return Math.max(0, Math.min(255, Math.round(part.endsWith("%") ? (number / 100) * 255 : number)));
    };
    const alphaPart = parts[3];
    const alpha = alphaPart === undefined ? 1 : Math.max(0, Math.min(1, Number.parseFloat(alphaPart) || 0));
    return { rgb: { r: channel(parts[0]!), g: channel(parts[1]!), b: channel(parts[2]!) }, alpha };
  }
  return null;
}

function composite(rgb: RGB, alpha: number): RGB {
  return {
    r: Math.round(rgb.r * alpha + BACKGROUND.r * (1 - alpha)),
    g: Math.round(rgb.g * alpha + BACKGROUND.g * (1 - alpha)),
    b: Math.round(rgb.b * alpha + BACKGROUND.b * (1 - alpha)),
  };
}

/** Redmean: a dependency-free weighted RGB distance that tracks perceived difference well enough to snap. */
function distance(a: RGB, b: RGB): number {
  const mean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

function toHex(rgb: RGB): string {
  const part = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function snapColor(rgb: RGB): string {
  let best = PALETTE[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of PALETTE) {
    const value = distance(rgb, entry.rgb);
    if (value < bestDistance) {
      bestDistance = value;
      best = entry;
    }
  }
  return bestDistance <= SNAP_DISTANCE ? best.id : toHex(rgb);
}

// --------------------------------------------------------------- transforms

function numbersIn(raw: string): number[] {
  const matched = raw.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  return matched === null ? [] : matched.map(Number);
}

/** null means an unsupported function: the caller drops the subtree rather than misplacing it. */
function parseTransform(raw: string): Matrix | null {
  let result: Matrix = IDENTITY;
  const pattern = /([a-zA-Z]+)\s*\(([^()]*)\)/g;
  let match = pattern.exec(raw);
  if (match === null && raw.trim() !== "") return null;
  while (match !== null) {
    const args = numbersIn(match[2]!);
    const name = match[1]!.toLowerCase();
    let step: Matrix | null = null;
    if (name === "matrix" && args.length >= 6) {
      step = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!];
    } else if (name === "translate" && args.length >= 1) {
      step = [1, 0, 0, 1, args[0]!, args[1] ?? 0];
    } else if (name === "scale" && args.length >= 1) {
      step = [args[0]!, 0, 0, args[1] ?? args[0]!, 0, 0];
    } else if (name === "rotate" && args.length >= 1) {
      const radians = (args[0]! * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
      step =
        args.length >= 3
          ? multiply(multiply([1, 0, 0, 1, args[1]!, args[2]!], rotation), [1, 0, 0, 1, -args[1]!, -args[2]!])
          : rotation;
    } else if (name === "skewx" && args.length >= 1) {
      step = [1, 0, Math.tan((args[0]! * Math.PI) / 180), 1, 0, 0];
    } else if (name === "skewy" && args.length >= 1) {
      step = [1, Math.tan((args[0]! * Math.PI) / 180), 0, 1, 0, 0];
    }
    if (step === null) return null;
    result = multiply(result, step);
    match = pattern.exec(raw);
  }
  return result;
}

// --------------------------------------------------------------- paths

type Flat = { points: Pt[]; vertices: Pt[]; closed: boolean; curved: boolean };

function sampleCubic(from: Pt, c1: Pt, c2: Pt, to: Pt, out: Pt[]): void {
  for (let step = 1; step <= CURVE_SAMPLES; step += 1) {
    const t = step / CURVE_SAMPLES;
    const u = 1 - t;
    out.push({
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    });
  }
}

function sampleArc(from: Pt, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, to: Pt, out: Pt[]): void {
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    out.push(to);
    return;
  }
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;
  let ax = Math.abs(rx);
  let ay = Math.abs(ry);
  const lambda = (x1 * x1) / (ax * ax) + (y1 * y1) / (ay * ay);
  if (lambda > 1) {
    ax *= Math.sqrt(lambda);
    ay *= Math.sqrt(lambda);
  }
  const numerator = Math.max(0, ax * ax * ay * ay - ax * ax * y1 * y1 - ay * ay * x1 * x1);
  const denominator = ax * ax * y1 * y1 + ay * ay * x1 * x1;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(denominator === 0 ? 0 : numerator / denominator);
  const cx1 = (factor * ax * y1) / ay;
  const cy1 = (-factor * ay * x1) / ax;
  const cx = cosPhi * cx1 - sinPhi * cy1 + (from.x + to.x) / 2;
  const cy = sinPhi * cx1 + cosPhi * cy1 + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const cosine = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    return sign * Math.acos(Math.max(-1, Math.min(1, cosine)));
  };
  const start = angle(1, 0, (x1 - cx1) / ax, (y1 - cy1) / ay);
  let sweepAngle = angle((x1 - cx1) / ax, (y1 - cy1) / ay, (-x1 - cx1) / ax, (-y1 - cy1) / ay);
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  for (let step = 1; step <= CURVE_SAMPLES; step += 1) {
    const theta = start + (sweepAngle * step) / CURVE_SAMPLES;
    const px = ax * Math.cos(theta);
    const py = ay * Math.sin(theta);
    out.push({ x: cosPhi * px - sinPhi * py + cx, y: sinPhi * px + cosPhi * py + cy });
  }
}

function flattenPath(d: string): Flat {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  const points: Pt[] = [];
  const vertices: Pt[] = [];
  let closed = false;
  let curved = false;
  let current: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let lastCubic: Pt | null = null;
  let lastQuad: Pt | null = null;
  let command = "";
  let index = 0;
  let commands = 0;

  const number = (): number => {
    const token = tokens[index];
    index += 1;
    const value = token === undefined ? 0 : Number(token);
    return Number.isFinite(value) ? value : 0;
  };
  const move = (point: Pt, isVertex: boolean): void => {
    current = point;
    points.push(point);
    if (isVertex) vertices.push(point);
  };

  while (index < tokens.length && commands < MAX_PATH_COMMANDS) {
    const token = tokens[index]!;
    if (/[A-Za-z]/.test(token)) {
      command = token;
      index += 1;
    } else if (command === "") {
      index += 1;
      continue;
    } else if (command === "M") {
      command = "L";
    } else if (command === "m") {
      command = "l";
    }
    commands += 1;
    const relative = command === command.toLowerCase();
    const ox = relative ? current.x : 0;
    const oy = relative ? current.y : 0;

    switch (command.toUpperCase()) {
      case "M": {
        const point = { x: number() + ox, y: number() + oy };
        move(point, true);
        start = point;
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case "L": {
        move({ x: number() + ox, y: number() + oy }, true);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case "H": {
        move({ x: number() + ox, y: current.y }, true);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case "V": {
        move({ x: current.x, y: number() + oy }, true);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case "C":
      case "S": {
        curved = true;
        const c1: Pt =
          command.toUpperCase() === "C"
            ? { x: number() + ox, y: number() + oy }
            : lastCubic === null
              ? current
              : { x: 2 * current.x - lastCubic.x, y: 2 * current.y - lastCubic.y };
        const c2 = { x: number() + ox, y: number() + oy };
        const to = { x: number() + ox, y: number() + oy };
        sampleCubic(current, c1, c2, to, points);
        vertices.push(to);
        current = to;
        lastCubic = c2;
        lastQuad = null;
        break;
      }
      case "Q":
      case "T": {
        curved = true;
        const control: Pt =
          command.toUpperCase() === "Q"
            ? { x: number() + ox, y: number() + oy }
            : lastQuad === null
              ? current
              : { x: 2 * current.x - lastQuad.x, y: 2 * current.y - lastQuad.y };
        const to = { x: number() + ox, y: number() + oy };
        sampleCubic(
          current,
          { x: current.x + (2 / 3) * (control.x - current.x), y: current.y + (2 / 3) * (control.y - current.y) },
          { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) },
          to,
          points,
        );
        vertices.push(to);
        current = to;
        lastQuad = control;
        lastCubic = null;
        break;
      }
      case "A": {
        curved = true;
        const rx = number();
        const ry = number();
        const rotation = number();
        const large = number() !== 0;
        const sweep = number() !== 0;
        const to = { x: number() + ox, y: number() + oy };
        sampleArc(current, rx, ry, rotation, large, sweep, to, points);
        vertices.push(to);
        current = to;
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case "Z": {
        closed = true;
        move(start, true);
        break;
      }
      default:
        index += 1;
        break;
    }
  }
  return { points, vertices, closed, curved };
}

function resample(points: readonly Pt[], count: number): Pt[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: count }, () => points[0]!);
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  const total = lengths[lengths.length - 1]!;
  if (total === 0) return Array.from({ length: count }, () => points[0]!);
  const out: Pt[] = [];
  let cursor = 1;
  for (let step = 0; step < count; step += 1) {
    const target = (total * step) / (count - 1);
    while (cursor < lengths.length - 1 && lengths[cursor]! < target) cursor += 1;
    const spanStart = lengths[cursor - 1]!;
    const span = lengths[cursor]! - spanStart;
    const t = span === 0 ? 0 : (target - spanStart) / span;
    const a = points[cursor - 1]!;
    const b = points[cursor]!;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

const templateCache = new Map<string, Pt[]>();

/**
 * The shape's own exported path, refitted once so its painted bounding box matches the
 * candidate's. Actor and cloud do not fill their box, so one Newton-ish step is needed.
 */
function templatePoints(kind: ShapeKind, width: number, height: number): Pt[] {
  const key = `${kind}:${width.toFixed(2)}:${height.toFixed(2)}`;
  const cached = templateCache.get(key);
  if (cached !== undefined) return cached;
  let points = flattenPath(shapePath(kind, width, height)).points;
  if (points.length > 0) {
    const box = boxOf(points);
    if (box.width > 0.5 && box.height > 0.5 && (Math.abs(box.width - width) > 0.5 || Math.abs(box.height - height) > 0.5)) {
      points = flattenPath(shapePath(kind, (width * width) / box.width, (height * height) / box.height)).points;
    }
  }
  if (templateCache.size < 2000) templateCache.set(key, points);
  return points;
}

function scoreShape(points: readonly Pt[], box: Box): { kind: ShapeKind; score: number } {
  const candidate = resample(points, RESAMPLE_POINTS);
  const diagonal = Math.hypot(box.width, box.height) || 1;
  let best: { kind: ShapeKind; score: number } = { kind: "rectangle", score: Number.POSITIVE_INFINITY };
  for (const kind of SHAPE_KINDS) {
    const template = templatePoints(kind, Math.max(box.width, 1), Math.max(box.height, 1));
    if (template.length === 0) continue;
    const templateBox = boxOf(template);
    const dx = box.x - templateBox.x;
    const dy = box.y - templateBox.y;
    const sampled = resample(template, RESAMPLE_POINTS);
    let total = 0;
    for (let i = 0; i < candidate.length; i += 1) {
      total += Math.hypot(candidate[i]!.x - (sampled[i]!.x + dx), candidate[i]!.y - (sampled[i]!.y + dy));
    }
    const score = total / candidate.length / diagonal;
    if (score < best.score) best = { kind, score };
  }
  return best;
}

// --------------------------------------------------------------- polygons

function nearestWithin(point: Pt, pool: Pt[], tolerance: number): number {
  let bestIndex = -1;
  let bestDistance = tolerance;
  pool.forEach((candidate, index) => {
    const value = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (value <= bestDistance) {
      bestDistance = value;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function matchesTemplate(unit: readonly Pt[], template: readonly Pt[]): boolean {
  const pool = [...unit];
  for (const target of template) {
    const index = nearestWithin(target, pool, POLYGON_TOLERANCE);
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return pool.length === 0;
}

function classifyPolygon(unit: readonly Pt[]): ShapeKind | null {
  if (unit.length === 3) return "triangle";
  if (unit.length === 4) {
    if (matchesTemplate(unit, [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }])) return "diamond";
    const top = unit.filter((point) => point.y <= POLYGON_TOLERANCE);
    const bottom = unit.filter((point) => point.y >= 1 - POLYGON_TOLERANCE);
    if (top.length === 2 && bottom.length === 2) {
      const offset = Math.abs(Math.min(...top.map((p) => p.x)) - Math.min(...bottom.map((p) => p.x)));
      if (offset >= 0.05 && offset <= 0.45) return "parallelogram";
    }
    if (matchesTemplate(unit, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])) return "rectangle";
    return null;
  }
  if (unit.length === 6) {
    const tops = unit.filter((point) => point.y <= POLYGON_TOLERANCE).map((point) => point.x);
    if (tops.length !== 2) return null;
    const s = Math.min(...tops);
    if (s < 0.08 || s > 0.4) return null;
    const template = [
      { x: s, y: 0 },
      { x: 1 - s, y: 0 },
      { x: 1, y: 0.5 },
      { x: 1 - s, y: 1 },
      { x: s, y: 1 },
      { x: 0, y: 0.5 },
    ];
    return matchesTemplate(unit, template) ? "hexagon" : null;
  }
  return null;
}

// --------------------------------------------------------------- walk state

type Style = {
  fill: string | null;
  stroke: string | null;
  opacity: number;
  fillOpacity: number;
  fontFamily: string | null;
  fontSize: number | null;
  fontWeight: string | null;
  textAnchor: string | null;
};

const ROOT_STYLE: Style = {
  fill: null,
  stroke: null,
  opacity: 1,
  fillOpacity: 1,
  fontFamily: null,
  fontSize: null,
  fontWeight: null,
  textAnchor: null,
};

type Frame = { matrix: Matrix; style: Style; skip: boolean };

type TextLine = { baseline: Pt; text: string; align: BoardNode["textAlign"]; size: number };
type TextBlock = {
  lines: Array<{ box: Box; text: string; align: BoardNode["textAlign"] }>;
  style: Style;
  align: BoardNode["textAlign"];
  size: number;
};

type ShapeItem = {
  type: "shape";
  kind: BoardNodeKind;
  box: Box;
  color: string;
  rx: number;
  imageData?: string;
  arrowhead: boolean;
  centroid: Pt;
  text: string;
  fontFamily: BoardNode["fontFamily"];
  fontSize: number;
  fontWeight: number;
  textAlign: BoardNode["textAlign"];
  hasText: boolean;
  consumed: boolean;
};

type TextItem = {
  type: "text";
  box: Box;
  text: string;
  fontFamily: BoardNode["fontFamily"];
  fontSize: number;
  fontWeight: number;
  textAlign: BoardNode["textAlign"];
  consumed: boolean;
};

type Item = ShapeItem | TextItem;

type StrokeItem = {
  points: Pt[];
  vertices: Pt[];
  curved: boolean;
  markerStart: boolean;
  markerEnd: boolean;
  color: string;
};

type PendingEdge = {
  source: ShapeItem;
  target: ShapeItem;
  color: string;
  routing: BoardEdge["routing"];
  arrow: BoardEdge["arrow"];
  label: string;
  box: Box;
};

function mapFontFamily(raw: string | null): BoardNode["fontFamily"] {
  const value = (raw ?? "").toLowerCase();
  if (/mono|courier|consolas|menlo/.test(value)) return "mono";
  if (/georgia|times|serif/.test(value) && !/sans-serif/.test(value)) return "serif";
  return "inter";
}

function mapFontWeight(raw: string | null): number {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "normal") return 400;
  if (value === "bold" || value === "bolder") return 700;
  if (value === "lighter") return 400;
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 400;
  return Math.max(400, Math.min(800, Math.round(number)));
}

function mapTextAlign(raw: string | null): BoardNode["textAlign"] {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "middle") return "center";
  if (value === "end") return "right";
  return "left";
}

// --------------------------------------------------------------- importer

export function importSvgObjects(svg: string, options?: SvgImportOptions): SvgImportResult {
  if (typeof svg !== "string" || svg.trim() === "") throw new Error("The SVG file is empty.");
  if (svg.length > MAX_INPUT_CHARS) {
    throw new Error(`The SVG file is too large to import (over ${MAX_INPUT_CHARS.toLocaleString("en-US")} characters).`);
  }
  assertNoDeclarations(svg);
  if (!/<svg[\s>/]/i.test(svg)) throw new Error("The file does not contain an <svg> element.");

  const warnings = makeWarnings();
  const tokens = tokenize(svg);
  const gradients = collectGradients(tokens);
  const walked = walk(tokens, gradients, warnings);
  return assemble(walked, warnings, options?.origin ?? { x: 0, y: 0 });
}

function collectGradients(tokens: readonly Token[]): Map<string, string> {
  const stops = new Map<string, string>();
  let currentId: string | null = null;
  for (const token of tokens) {
    if (token.kind === "open") {
      const name = token.name;
      if (name === "lineargradient" || name === "radialgradient") {
        currentId = token.attrs.id ?? null;
      } else if (name === "stop" && currentId !== null && !stops.has(currentId)) {
        const style = parseStyle(token.attrs.style);
        const color = token.attrs["stop-color"] ?? style["stop-color"];
        if (color !== undefined) stops.set(currentId, color);
      }
    } else if (token.kind === "close" && (token.name === "lineargradient" || token.name === "radialgradient")) {
      currentId = null;
    }
  }
  return stops;
}

type Walked = { items: Item[]; strokes: StrokeItem[] };

function walk(tokens: readonly Token[], gradients: ReadonlyMap<string, string>, warnings: Warnings): Walked {
  const items: Item[] = [];
  const strokes: StrokeItem[] = [];
  const stack: Frame[] = [{ matrix: IDENTITY, style: ROOT_STYLE, skip: false }];
  let seenRoot = false;
  let textBlock: TextBlock | null = null;
  let line: TextLine | null = null;

  const top = (): Frame => stack[stack.length - 1]!;

  const resolvedFill = (style: Style): { color: string; visible: boolean; outline: boolean } => {
    const alpha = style.opacity * style.fillOpacity;
    const raw = style.fill ?? "#000000";
    const gradientMatch = /^url\(#([^)]+)\)$/.exec(raw.trim());
    let source = raw;
    if (gradientMatch !== null) {
      const stop = gradients.get(gradientMatch[1]!);
      warnings.once("Gradient fills were flattened to their first colour stop.");
      source = stop ?? "#d1d5db";
    }
    const parsed = parseColor(source);
    if (parsed === null) return { color: "white", visible: false, outline: true };
    const effective = alpha * parsed.alpha;
    if (effective <= 0.02) return { color: "white", visible: false, outline: false };
    return { color: snapColor(composite(parsed.rgb, effective)), visible: true, outline: false };
  };

  const strokeColor = (style: Style): string | null => {
    if (style.stroke === null) return null;
    const parsed = parseColor(style.stroke);
    if (parsed === null) return null;
    const effective = style.opacity * parsed.alpha;
    if (effective <= 0.02) return null;
    return snapColor(composite(parsed.rgb, effective));
  };

  const emitShape = (kind: BoardNodeKind, box: Box, style: Style, extra: Partial<ShapeItem>): void => {
    if (box.width <= 0 || box.height <= 0) return;
    const fill = resolvedFill(style);
    if (!fill.visible && !fill.outline) return;
    if (fill.outline) {
      if (strokeColor(style) === null) return;
      // Figma often emits the border of a shape as a second, identical outline path.
      const duplicate = items.some(
        (item) =>
          item.type === "shape" &&
          Math.abs(item.box.x - box.x) <= 2 &&
          Math.abs(item.box.y - box.y) <= 2 &&
          Math.abs(item.box.width - box.width) <= 2 &&
          Math.abs(item.box.height - box.height) <= 2,
      );
      if (duplicate) {
        warnings.count(STROKED);
        return;
      }
      warnings.count(OUTLINE_ONLY);
    } else if (strokeColor(style) !== null) {
      warnings.count(STROKED);
    }
    items.push({
      type: "shape",
      kind,
      box,
      color: fill.outline ? "white" : fill.color,
      rx: 0,
      arrowhead: false,
      centroid: centerOf(box),
      text: "",
      fontFamily: "inter",
      fontSize: kind === "sticky" ? 17 : 16,
      fontWeight: kind === "sticky" ? 500 : 600,
      textAlign: kind === "sticky" ? "left" : "center",
      hasText: false,
      consumed: false,
      ...extra,
    });
  };

  for (const token of tokens) {
    if (token.kind === "text") {
      if (line !== null) line.text += token.text;
      continue;
    }
    if (token.kind === "close") {
      if (token.name === "tspan" && line !== null && textBlock !== null) {
        textBlock.lines.push({ box: lineBox(line), text: line.text, align: line.align });
        line = null;
      } else if (token.name === "text" && textBlock !== null) {
        if (line !== null) {
          textBlock.lines.push({ box: lineBox(line), text: line.text, align: line.align });
          line = null;
        }
        finishTextBlock(textBlock, items);
        textBlock = null;
      }
      if (stack.length > 1) stack.pop();
      continue;
    }

    const { name, attrs, selfClosing } = token;
    const parent = top();
    const skip = parent.skip || SKIPPED.has(name) || (name === "svg" && seenRoot) || name === "defs";
    if (SKIPPED.has(name) && !parent.skip) {
      const note = NOISY_SKIPS[name];
      if (note !== undefined) warnings.once(note);
    }

    let matrix = parent.matrix;
    let dropped = false;
    if (!skip) {
      const raw = attrs.transform;
      if (raw !== undefined && raw.trim() !== "") {
        const own = parseTransform(raw);
        if (own === null) {
          warnings.once("An unsupported transform function was found, so its content was skipped.");
          dropped = true;
        } else {
          matrix = multiply(parent.matrix, own);
        }
      }
    }

    const style = inherit(parent.style, attrs);
    const frame: Frame = { matrix, style, skip: skip || dropped };
    if (!selfClosing) stack.push(frame);
    if (frame.skip) continue;

    switch (name) {
      case "svg": {
        seenRoot = true;
        const viewBox = numbersIn(attrs.viewbox ?? "");
        if (viewBox.length === 4) {
          frame.matrix = multiply(matrix, [1, 0, 0, 1, -viewBox[0]!, -viewBox[1]!]);
          if (!selfClosing) stack[stack.length - 1] = frame;
          const width = Number.parseFloat(attrs.width ?? "");
          const height = Number.parseFloat(attrs.height ?? "");
          if (
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            viewBox[2]! > 0 &&
            viewBox[3]! > 0 &&
            (Math.abs(width / viewBox[2]! - 1) > 0.001 || Math.abs(height / viewBox[3]! - 1) > 0.001)
          ) {
            warnings.once("The export was scaled; the diagram's own units were kept.");
          }
        }
        break;
      }
      case "rect": {
        const x = Number.parseFloat(attrs.x ?? "0") || 0;
        const y = Number.parseFloat(attrs.y ?? "0") || 0;
        const width = Number.parseFloat(attrs.width ?? "0") || 0;
        const height = Number.parseFloat(attrs.height ?? "0") || 0;
        if (width <= 0 || height <= 0) break;
        if (isRotated(frame.matrix)) warnings.count(ROTATED);
        const corners = [
          apply(frame.matrix, x, y),
          apply(frame.matrix, x + width, y),
          apply(frame.matrix, x + width, y + height),
          apply(frame.matrix, x, y + height),
        ];
        const rx = (Number.parseFloat(attrs.rx ?? attrs.ry ?? "0") || 0) * scaleOf(frame.matrix);
        emitShape("rectangle", boxOf(corners), style, { rx });
        break;
      }
      case "circle":
      case "ellipse": {
        const cx = Number.parseFloat(attrs.cx ?? "0") || 0;
        const cy = Number.parseFloat(attrs.cy ?? "0") || 0;
        const r = Number.parseFloat(attrs.r ?? "0") || 0;
        const rx = name === "circle" ? r : Number.parseFloat(attrs.rx ?? "0") || 0;
        const ry = name === "circle" ? r : Number.parseFloat(attrs.ry ?? "0") || 0;
        if (rx <= 0 || ry <= 0) break;
        const m = frame.matrix;
        const center = apply(m, cx, cy);
        const halfWidth = Math.hypot(m[0] * rx, m[2] * ry);
        const halfHeight = Math.hypot(m[1] * rx, m[3] * ry);
        emitShape(
          "ellipse",
          { x: center.x - halfWidth, y: center.y - halfHeight, width: halfWidth * 2, height: halfHeight * 2 },
          style,
          {},
        );
        break;
      }
      case "polygon": {
        const raw = numbersIn(attrs.points ?? "");
        if (raw.length < 6 || raw.length > MAX_POINTS * 2) break;
        if (isRotated(frame.matrix)) warnings.count(ROTATED);
        const points: Pt[] = [];
        for (let i = 0; i + 1 < raw.length; i += 2) points.push(apply(frame.matrix, raw[i]!, raw[i + 1]!));
        const box = boxOf(points);
        if (box.width <= 0 || box.height <= 0) break;
        const unit = points.map((point) => ({
          x: (point.x - box.x) / box.width,
          y: (point.y - box.y) / box.height,
        }));
        const kind = classifyPolygon(unit);
        if (kind === null) warnings.once(`A ${points.length}-point polygon was imported as a rectangle.`);
        emitShape(kind ?? "rectangle", box, style, {
          arrowhead: isArrowhead(box, points),
          centroid: centroidOf(points),
        });
        break;
      }
      case "polyline":
      case "line": {
        const color = strokeColor(style);
        if (color === null) break;
        const raw =
          name === "line"
            ? [
                Number.parseFloat(attrs.x1 ?? "0") || 0,
                Number.parseFloat(attrs.y1 ?? "0") || 0,
                Number.parseFloat(attrs.x2 ?? "0") || 0,
                Number.parseFloat(attrs.y2 ?? "0") || 0,
              ]
            : numbersIn(attrs.points ?? "");
        if (raw.length < 4 || raw.length > MAX_POINTS * 2) break;
        const points: Pt[] = [];
        for (let i = 0; i + 1 < raw.length; i += 2) points.push(apply(frame.matrix, raw[i]!, raw[i + 1]!));
        strokes.push({
          points,
          vertices: points,
          curved: false,
          markerStart: attrs["marker-start"] !== undefined,
          markerEnd: attrs["marker-end"] !== undefined,
          color,
        });
        break;
      }
      case "path": {
        const d = attrs.d;
        if (d === undefined || d.trim() === "") break;
        const flat = flattenPath(d);
        if (flat.points.length < 2) break;
        const points = flat.points.map((point) => apply(frame.matrix, point.x, point.y));
        const vertices = flat.vertices.map((point) => apply(frame.matrix, point.x, point.y));
        const fill = resolvedFill(style);
        const stroke = strokeColor(style);
        const filled = fill.visible;
        if (!filled && stroke !== null && !flat.closed) {
          strokes.push({
            points,
            vertices,
            curved: flat.curved,
            markerStart: attrs["marker-start"] !== undefined,
            markerEnd: attrs["marker-end"] !== undefined,
            color: stroke,
          });
          break;
        }
        if (!filled && stroke === null) break;
        if (isRotated(frame.matrix)) warnings.count(ROTATED);
        const box = boxOf(points);
        if (box.width <= 0 || box.height <= 0) break;
        const best = scoreShape(points, box);
        if (best.score > SHAPE_SCORE_LIMIT) {
          warnings.once("A path could not be matched to a Canvas shape and was approximated as a rectangle.");
        }
        emitShape(best.score <= SHAPE_SCORE_LIMIT ? best.kind : "rectangle", box, style, {
          arrowhead: isArrowhead(box, points),
          centroid: centroidOf(points),
        });
        break;
      }
      case "image": {
        const href = (attrs.href ?? attrs["xlink:href"] ?? "").trim();
        // Deliberately stricter than imageDataSchema: a nested SVG would be a re-entry vector.
        if (!/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(href)) {
          warnings.once("An image that was not embedded raster data was dropped.");
          break;
        }
        const x = Number.parseFloat(attrs.x ?? "0") || 0;
        const y = Number.parseFloat(attrs.y ?? "0") || 0;
        const width = Number.parseFloat(attrs.width ?? "0") || 0;
        const height = Number.parseFloat(attrs.height ?? "0") || 0;
        if (width <= 0 || height <= 0) break;
        const corners = [
          apply(frame.matrix, x, y),
          apply(frame.matrix, x + width, y),
          apply(frame.matrix, x + width, y + height),
          apply(frame.matrix, x, y + height),
        ];
        const box = boxOf(corners);
        items.push({
          type: "shape",
          kind: "image",
          box,
          color: "gray",
          rx: 0,
          imageData: href,
          arrowhead: false,
          centroid: centerOf(box),
          text: "",
          fontFamily: "inter",
          fontSize: 16,
          fontWeight: 600,
          textAlign: "center",
          hasText: false,
          consumed: false,
        });
        break;
      }
      case "text": {
        const size = clampFontSize((style.fontSize ?? 16) * scaleOf(frame.matrix), warnings);
        textBlock = { lines: [], style, align: mapTextAlign(style.textAnchor), size };
        const x = Number.parseFloat(attrs.x ?? "0") || 0;
        const y = Number.parseFloat(attrs.y ?? "0") || 0;
        line = { baseline: apply(frame.matrix, x, y), text: "", align: textBlock.align, size };
        break;
      }
      case "tspan": {
        if (textBlock === null) break;
        if (line !== null && line.text.trim() !== "") textBlock.lines.push({ box: lineBox(line), text: line.text, align: line.align });
        const size = clampFontSize((style.fontSize ?? textBlock.style.fontSize ?? 16) * scaleOf(frame.matrix), warnings);
        const x = Number.parseFloat(attrs.x ?? "0") || 0;
        const y = Number.parseFloat(attrs.y ?? "0") || 0;
        line = {
          baseline: apply(frame.matrix, x, y),
          text: "",
          align: mapTextAlign(style.textAnchor),
          size,
        };
        break;
      }
      default:
        break;
    }
  }

  if (textBlock !== null) {
    if (line !== null) textBlock.lines.push({ box: lineBox(line), text: line.text, align: line.align });
    finishTextBlock(textBlock, items);
  }
  return { items, strokes };
}

function inherit(parent: Style, attrs: Attrs): Style {
  const style = parseStyle(attrs.style);
  const own = (key: string): string | undefined => attrs[key] ?? style[key];
  const opacity = Number.parseFloat(own("opacity") ?? "");
  const fillOpacity = Number.parseFloat(own("fill-opacity") ?? "");
  const fontSize = Number.parseFloat(own("font-size") ?? "");
  return {
    fill: own("fill") ?? parent.fill,
    stroke: own("stroke") ?? parent.stroke,
    opacity: parent.opacity * (Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1),
    fillOpacity: parent.fillOpacity * (Number.isFinite(fillOpacity) ? Math.max(0, Math.min(1, fillOpacity)) : 1),
    fontFamily: own("font-family") ?? parent.fontFamily,
    fontSize: Number.isFinite(fontSize) ? fontSize : parent.fontSize,
    fontWeight: own("font-weight") ?? parent.fontWeight,
    textAnchor: own("text-anchor") ?? parent.textAnchor,
  };
}

function clampFontSize(raw: number, warnings: Warnings): number {
  const value = Number.isFinite(raw) ? raw : 16;
  const clamped = Math.max(10, Math.min(96, Math.round(value)));
  if (clamped !== Math.round(value)) warnings.once("A font size was clamped to the 10-96 range Canvas supports.");
  return clamped;
}

/** No font metrics exist in Node, so the box is estimated: 0.55em per character, 1.3 line height. */
function lineBox(line: TextLine): Box {
  const width = Math.max(1, line.text.length * line.size * 0.55);
  const left = line.align === "left" ? line.baseline.x : line.align === "center" ? line.baseline.x - width / 2 : line.baseline.x - width;
  return { x: left, y: line.baseline.y - line.size * 0.8, width, height: line.size * 1.3 };
}

function unionBox(boxes: readonly Box[]): Box {
  const points: Pt[] = [];
  for (const box of boxes) {
    points.push({ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height });
  }
  return boxOf(points);
}

function finishTextBlock(block: TextBlock, items: Item[]): void {
  const lines = block.lines.filter((entry) => entry.text.trim() !== "");
  if (lines.length === 0) return;
  items.push({
    type: "text",
    box: unionBox(lines.map((entry) => entry.box)),
    text: lines.map((entry) => entry.text.trim()).join("\n"),
    fontFamily: mapFontFamily(block.style.fontFamily),
    fontSize: block.size,
    fontWeight: mapFontWeight(block.style.fontWeight),
    textAlign: lines[0]!.align,
    consumed: false,
  });
}

function centroidOf(points: readonly Pt[]): Pt {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function isArrowhead(box: Box, points: readonly Pt[]): boolean {
  if (Math.max(box.width, box.height) > ARROWHEAD_SIDE) return false;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2 <= ARROWHEAD_AREA;
}

// --------------------------------------------------------------- assembly

function attachSlop(box: Box): number {
  return Math.min(40, Math.max(12, 0.25 * Math.min(box.width, box.height)));
}

function containsPoint(box: Box, point: Pt, pad: number): boolean {
  return (
    point.x >= box.x - pad &&
    point.x <= box.x + box.width + pad &&
    point.y >= box.y - pad &&
    point.y <= box.y + box.height + pad
  );
}

function routingOf(stroke: StrokeItem): BoardEdge["routing"] {
  if (stroke.curved) return "curved";
  if (stroke.vertices.length < 3) return "straight";
  const limit = Math.tan(Math.PI / 180);
  for (let i = 1; i < stroke.vertices.length; i += 1) {
    const dx = Math.abs(stroke.vertices[i]!.x - stroke.vertices[i - 1]!.x);
    const dy = Math.abs(stroke.vertices[i]!.y - stroke.vertices[i - 1]!.y);
    if (dx === 0 && dy === 0) continue;
    if (dy > dx * limit && dx > dy * limit) return "straight";
  }
  return "elbow";
}

function assemble(walked: Walked, warnings: Warnings, origin: { x: number; y: number }): SvgImportResult {
  const { items, strokes } = walked;
  const shapes = items.filter((item): item is ShapeItem => item.type === "shape");
  const texts = items.filter((item): item is TextItem => item.type === "text");

  // 4. Text association: innermost containing shape wins, repeats append.
  for (const text of texts) {
    let best: ShapeItem | null = null;
    for (const shape of shapes) {
      if (shape.kind === "image") continue;
      const pad = Math.max(4, 0.06 * Math.min(shape.box.width, shape.box.height));
      if (!boxContains(shape.box, text.box, pad)) continue;
      if (best === null || shape.box.width * shape.box.height < best.box.width * best.box.height) best = shape;
    }
    if (best === null) continue;
    best.text = best.text === "" ? text.text : `${best.text}\n${text.text}`;
    if (!best.hasText) {
      best.fontFamily = text.fontFamily;
      best.fontSize = text.fontSize;
      best.fontWeight = text.fontWeight;
      best.textAlign = text.textAlign;
    }
    best.hasText = true;
    text.consumed = true;
  }

  // Sticky-ness depends on carrying text, so it is settled after association.
  for (const shape of shapes) {
    const ratio = shape.box.width / shape.box.height;
    if (
      shape.kind === "rectangle" &&
      shape.rx > 0 &&
      shape.rx <= 16 &&
      shape.hasText &&
      shape.box.width >= 80 &&
      shape.box.width <= 420 &&
      shape.box.height >= 80 &&
      shape.box.height <= 420 &&
      ratio >= 0.6 &&
      ratio <= 1.6
    ) {
      shape.kind = "sticky";
    }
  }

  // 5a. Arrowheads are consumed before attachment, or an endpoint would snap to one.
  const arrows = new Map<StrokeItem, { start: boolean; end: boolean }>();
  for (const stroke of strokes) {
    const first = stroke.points[0]!;
    const last = stroke.points[stroke.points.length - 1]!;
    const marks = { start: stroke.markerStart, end: stroke.markerEnd };
    for (const shape of shapes) {
      if (!shape.arrowhead || shape.consumed) continue;
      if (Math.hypot(shape.centroid.x - first.x, shape.centroid.y - first.y) <= attachSlop(shape.box)) {
        marks.start = true;
        shape.consumed = true;
      } else if (Math.hypot(shape.centroid.x - last.x, shape.centroid.y - last.y) <= attachSlop(shape.box)) {
        marks.end = true;
        shape.consumed = true;
      }
    }
    arrows.set(stroke, marks);
  }

  // 5b. Endpoint attachment.
  const attachable = shapes.filter((shape) => !shape.consumed);
  const pending: PendingEdge[] = [];
  for (const stroke of strokes) {
    const marks = arrows.get(stroke) ?? { start: false, end: false };
    const pick = (point: Pt): ShapeItem | null => {
      let best: ShapeItem | null = null;
      for (const shape of attachable) {
        if (!containsPoint(shape.box, point, attachSlop(shape.box))) continue;
        if (best === null || shape.box.width * shape.box.height < best.box.width * best.box.height) best = shape;
      }
      return best;
    };
    const source = pick(stroke.points[0]!);
    const target = pick(stroke.points[stroke.points.length - 1]!);
    if (source === null || target === null || source === target) {
      warnings.count(UNCONNECTED);
      continue;
    }
    pending.push({
      source,
      target,
      color: stroke.color,
      routing: routingOf(stroke),
      arrow: marks.start && marks.end ? "both" : marks.end ? "end" : marks.start ? "both" : "none",
      label: "",
      box: boxOf(stroke.points),
    });
  }

  // 5c. Label adoption from the texts no shape claimed.
  for (const text of texts) {
    if (text.consumed) continue;
    const center = centerOf(text.box);
    let best: PendingEdge | null = null;
    let bestDistance = LABEL_RADIUS;
    for (const edge of pending) {
      if (edge.label !== "") continue;
      const edgeCenter = centerOf(edge.box);
      const value = Math.hypot(edgeCenter.x - center.x, edgeCenter.y - center.y);
      if (value <= bestDistance) {
        bestDistance = value;
        best = edge;
      }
    }
    if (best === null) continue;
    best.label = text.text;
    text.consumed = true;
  }

  // 6. Normalise: sizes, then placement, then ids.
  const kept = items.filter((item) => !item.consumed);
  const sized = kept.map((item) => {
    const width = Math.max(MIN_WIDTH, Math.min(MAX_SIDE, item.box.width));
    const height = Math.max(MIN_HEIGHT, Math.min(MAX_SIDE, item.box.height));
    if (width !== item.box.width || height !== item.box.height) warnings.count(ENLARGED);
    return {
      item,
      box: {
        x: item.box.x + (item.box.width - width) / 2,
        y: item.box.y + (item.box.height - height) / 2,
        width,
        height,
      },
    };
  });

  if (sized.length === 0) return { nodes: [], edges: [], warnings: warnings.list() };

  const bounds = unionBox(sized.map((entry) => entry.box));
  const dx = origin.x - bounds.x;
  const dy = origin.y - bounds.y;

  const truncated = sized.slice(0, MAX_NODES);
  if (sized.length > MAX_NODES) {
    warnings.once(`Only the first ${MAX_NODES} objects were imported; the rest were left out.`);
  }

  const ids = new Map<Item, string>();
  const nodes: ImportedNode[] = truncated.map((entry, index) => {
    const id = `svg-${index + 1}`;
    ids.set(entry.item, id);
    const base = {
      id,
      x: Math.round(entry.box.x + dx),
      y: Math.round(entry.box.y + dy),
      width: Math.max(MIN_WIDTH, Math.round(entry.box.width)),
      height: Math.max(MIN_HEIGHT, Math.round(entry.box.height)),
    };
    if (entry.item.type === "text") {
      return {
        ...base,
        kind: "text" as const,
        text: entry.item.text,
        color: "white",
        fontFamily: entry.item.fontFamily,
        fontSize: entry.item.fontSize,
        fontWeight: entry.item.fontWeight,
        textAlign: entry.item.textAlign,
      };
    }
    return {
      ...base,
      kind: entry.item.kind,
      text: entry.item.text,
      color: entry.item.color,
      fontFamily: entry.item.fontFamily,
      fontSize: entry.item.fontSize,
      fontWeight: entry.item.fontWeight,
      textAlign: entry.item.textAlign,
      ...(entry.item.imageData === undefined ? {} : { imageData: entry.item.imageData }),
    };
  });

  const edges: ImportedEdge[] = [];
  for (const edge of pending) {
    if (edges.length >= MAX_EDGES) break;
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    if (source === undefined || target === undefined) continue;
    edges.push({
      id: `svg-edge-${edges.length + 1}`,
      source,
      target,
      label: edge.label,
      color: edge.color,
      routing: edge.routing,
      arrow: edge.arrow,
    });
  }

  return { nodes, edges, warnings: warnings.list() };
}
