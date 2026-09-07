import {
  BOARD_SCHEMA_VERSION,
  boardDocumentSchema,
  type BoardComment,
  type BoardDocument,
  type BoardEdge,
  type BoardNode,
} from "./domain";
import { connectorLabelPoint, connectorPath } from "./connectors";
import { shapePath } from "./shapes";

/** Imported files are untrusted: cap the text before anything parses it. */
const MAX_IMPORT_CHARS = 5_000_000;
const VIEWPORT_PADDING = 80;
const MIN_VIEWPORT = { width: 1200, height: 800 } as const;
const REFERENCE_SIZE = { width: 480, height: 320 } as const;
const METADATA_ID = "bb-canvas-data";
const ARROW_MARKER = "bb-canvas-arrow";
const INK = "#0f172a";
const BACKGROUND = "#f8fafc";
const TEXT_PADDING = 12;
const LINE_RATIO = 1.3;

/** Mirrors the palette app.tsx paints with, so an export matches the screen. */
const PALETTE: Record<string, string> = {
  yellow: "#fde68a",
  coral: "#fda4af",
  blue: "#93c5fd",
  green: "#86efac",
  purple: "#c4b5fd",
  gray: "#d1d5db",
  white: "#ffffff",
};

const FONT_STACKS: Record<BoardNode["fontFamily"], string> = {
  inter: "Inter, system-ui, sans-serif",
  serif: "Georgia, serif",
  mono: "ui-monospace, SFMono-Regular, monospace",
};

const TEXT_ANCHORS: Record<BoardNode["textAlign"], string> = {
  left: "start",
  center: "middle",
  right: "end",
};

export type ImportedReferenceNode = {
  kind: "image";
  imageData: string;
  width: number;
  height: number;
};

export type BoardImport =
  | { kind: "native"; board: BoardDocument }
  | { kind: "reference"; node: ImportedReferenceNode };

function colorValue(id: string): string {
  return PALETTE[id] ?? (/^#[0-9a-f]{6}$/i.test(id) ? id : PALETTE.gray!);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function num(value: number): string {
  return String(Math.round((Number.isFinite(value) ? value : 0) * 100) / 100);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value.trim()), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function orderedNode(node: BoardNode): Record<string, unknown> {
  return {
    id: node.id,
    kind: node.kind,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    text: node.text,
    color: node.color,
    ...(node.imageData === undefined ? {} : { imageData: node.imageData }),
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    textAlign: node.textAlign,
    locked: node.locked,
    groupId: node.groupId,
  };
}

function orderedEdge(edge: BoardEdge): Record<string, unknown> {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    color: edge.color,
    routing: edge.routing,
    arrow: edge.arrow,
  };
}

function orderedComment(comment: BoardComment): Record<string, unknown> {
  return {
    id: comment.id,
    nodeId: comment.nodeId,
    message: comment.message,
    resolved: comment.resolved,
    createdAt: comment.createdAt,
  };
}

export function serializeBoardJson(board: BoardDocument): string {
  return JSON.stringify(
    {
      schemaVersion: BOARD_SCHEMA_VERSION,
      id: board.id,
      title: board.title,
      projectId: board.projectId,
      chatThreadId: board.chatThreadId,
      version: board.version,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      nodes: board.nodes.map(orderedNode),
      edges: board.edges.map(orderedEdge),
      comments: board.comments.map(orderedComment),
    },
    null,
    2,
  );
}

type ViewBox = { x: number; y: number; width: number; height: number };

function viewBoxFor(nodes: readonly BoardNode[]): ViewBox {
  const minX = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.x));
  const minY = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.y));
  const maxX = nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => node.y + node.height));
  const padded = {
    x: minX - VIEWPORT_PADDING,
    y: minY - VIEWPORT_PADDING,
    width: maxX - minX + VIEWPORT_PADDING * 2,
    height: maxY - minY + VIEWPORT_PADDING * 2,
  };
  // Below the floor the box grows outward from the centre, keeping the content centred.
  const growX = Math.max(0, MIN_VIEWPORT.width - padded.width) / 2;
  const growY = Math.max(0, MIN_VIEWPORT.height - padded.height) / 2;
  return {
    x: padded.x - growX,
    y: padded.y - growY,
    width: padded.width + growX * 2,
    height: padded.height + growY * 2,
  };
}

function textElements(node: BoardNode): string {
  if (node.kind === "image" || node.text === "") return "";
  const lines = node.text.split("\n");
  const lineHeight = node.fontSize * LINE_RATIO;
  const x =
    node.textAlign === "left"
      ? node.x + TEXT_PADDING
      : node.textAlign === "right"
        ? node.x + node.width - TEXT_PADDING
        : node.x + node.width / 2;
  const first = node.y + node.height / 2 - ((lines.length - 1) * lineHeight) / 2 + node.fontSize * 0.34;
  const spans = lines
    .map((line, index) => `<tspan x="${num(x)}" y="${num(first + index * lineHeight)}">${escapeXml(line)}</tspan>`)
    .join("");
  return (
    `<text font-family="${escapeXml(FONT_STACKS[node.fontFamily])}" font-size="${node.fontSize}"` +
    ` font-weight="${node.fontWeight}" text-anchor="${TEXT_ANCHORS[node.textAlign]}" fill="${INK}">${spans}</text>`
  );
}

function shapeElement(node: BoardNode): string {
  const fill = colorValue(node.color);
  const common = `fill="${fill}" stroke="${INK}" stroke-opacity="0.18"`;
  switch (node.kind) {
    case "sticky":
      return `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" rx="8" ${common} />`;
    case "rectangle":
      return `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" rx="12" ${common} />`;
    case "ellipse":
      return `<ellipse cx="${num(node.x + node.width / 2)}" cy="${num(node.y + node.height / 2)}" rx="${num(node.width / 2)}" ry="${num(node.height / 2)}" ${common} />`;
    case "diamond":
    case "cylinder":
    case "cloud":
    case "parallelogram":
    case "hexagon":
    case "triangle":
    case "actor":
      // One source of truth for geometry: the same path the canvas draws, moved into place.
      return `<path d="${shapePath(node.kind, node.width, node.height)}" transform="translate(${num(node.x)} ${num(node.y)})" ${common} />`;
    case "image":
      return node.imageData === undefined
        ? `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" fill="${PALETTE.gray}" stroke="${INK}" stroke-opacity="0.18" stroke-dasharray="6 4" />`
        : `<image x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(node.imageData)}" />`;
    case "text":
      return "";
  }
}

function nodeElement(node: BoardNode): string {
  return `<g data-node-id="${escapeXml(node.id)}">${shapeElement(node)}${textElements(node)}</g>`;
}

function edgeElement(edge: BoardEdge, source: BoardNode, target: BoardNode): string {
  const stroke = colorValue(edge.color);
  const marker = `url(#${ARROW_MARKER})`;
  const start = edge.arrow === "both" ? ` marker-start="${marker}"` : "";
  const end = edge.arrow === "none" ? "" : ` marker-end="${marker}"`;
  const path =
    `<path d="${connectorPath(source, target, edge.routing)}" fill="none" stroke="${stroke}"` +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${start}${end} />`;
  if (edge.label === "") return `<g data-edge-id="${escapeXml(edge.id)}">${path}</g>`;
  const point = connectorLabelPoint(source, target, edge.routing);
  const label =
    `<text x="${num(point.x)}" y="${num(point.y - 8)}" text-anchor="middle" font-family="${escapeXml(FONT_STACKS.inter)}"` +
    ` font-size="13" fill="${INK}">${escapeXml(edge.label)}</text>`;
  return `<g data-edge-id="${escapeXml(edge.id)}">${path}${label}</g>`;
}

export function serializeBoardSvg(board: BoardDocument): string {
  const box = viewBoxFor(board.nodes);
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  const edges = board.edges
    .map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      return source === undefined || target === undefined ? "" : edgeElement(edge, source, target);
    })
    .join("");
  const nodes = board.nodes.map(nodeElement).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(box.width)}" height="${num(box.height)}"` +
      ` viewBox="${num(box.x)} ${num(box.y)} ${num(box.width)} ${num(box.height)}" role="img" aria-label="${escapeXml(board.title)}">`,
    `<title>${escapeXml(board.title)}</title>`,
    `<defs><marker id="${ARROW_MARKER}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>`,
    `<rect data-role="background" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" fill="${BACKGROUND}" />`,
    `<g data-role="connectors">${edges}</g>`,
    `<g data-role="nodes">${nodes}</g>`,
    `<metadata id="${METADATA_ID}" encoding="base64">${encodeBase64(serializeBoardJson(board))}</metadata>`,
    "</svg>",
  ].join("\n");
}

function extensionOf(fileName: string): string {
  const lower = fileName.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot + 1);
}

function parseNativeJson(text: string, fileName: string): BoardDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} is not valid JSON.`);
  }
  const parsed = boardDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${fileName} is not a Canvas board file for schema version ${BOARD_SCHEMA_VERSION}.`);
  }
  return parsed.data;
}

function metadataFrom(svg: string): string | null {
  const match = /<metadata\b[^>]*\bid="bb-canvas-data"[^>]*>([\s\S]*?)<\/metadata>/i.exec(svg);
  return match === null ? null : (match[1] ?? null);
}

function reference(imageData: string): BoardImport {
  return { kind: "reference", node: { kind: "image", imageData, ...REFERENCE_SIZE } };
}

export function parseBoardImport(input: { fileName: string; content: string }): BoardImport {
  const { fileName, content } = input;
  if (typeof content !== "string" || content.length === 0) throw new Error(`${fileName} is empty.`);
  if (content.length > MAX_IMPORT_CHARS) {
    throw new Error(`${fileName} is too large to import (over ${MAX_IMPORT_CHARS.toLocaleString("en-US")} characters).`);
  }

  switch (extensionOf(fileName)) {
    case "json":
      return { kind: "native", board: parseNativeJson(content, fileName) };
    case "svg": {
      const encoded = metadataFrom(content);
      if (encoded === null) return reference(`data:image/svg+xml;base64,${encodeBase64(content)}`);
      let decoded: string;
      try {
        decoded = decodeBase64(encoded);
      } catch {
        throw new Error(`${fileName} carries damaged Canvas data.`);
      }
      return { kind: "native", board: parseNativeJson(decoded, fileName) };
    }
    case "png":
    case "jpg":
    case "jpeg": {
      if (!/^data:image\/(png|jpe?g);base64,/i.test(content)) {
        throw new Error(`${fileName} could not be read as an image data URL.`);
      }
      return reference(content);
    }
    case "fig":
    case "jam":
      throw new Error(
        `${fileName} is a proprietary Figma file that no tool outside Figma can read. ` +
          "In Figma Design use File > Export as SVG, or in FigJam use File > Export as PNG or PDF, then import that instead.",
      );
    default:
      throw new Error(`Cannot import ${fileName}. Supported files are .canvas.json, .json, .svg, .png, .jpg and .jpeg.`);
  }
}
