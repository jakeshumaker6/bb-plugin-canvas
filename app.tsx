import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  ThreadChat,
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import type {
  BoardComment,
  BoardDocument,
  BoardEdge,
  BoardNode,
  BoardNodeKind,
  BoardOperation,
  BoardSummary,
} from "./src/domain";
import { KIND_LABELS, connectorName, domId, nextObject, objectName, objectOrder, type ObjectRef } from "./src/a11y";
import { DEFAULT_SIZE, PLACEMENT_GAP, PLACEMENT_OFFSETS, insertionPoint, viewportCenterPoint, type PlaceableKind } from "./src/placement";
import { serializeBoardJson, serializeBoardSvg } from "./src/portable";
import { connectorLabelPoint, connectorPath } from "./src/connectors";
import { SHAPE_KINDS, SHAPE_LABELS, shapeClipPath, shapePath, textInset, type ShapeKind } from "./src/shapes";
import { ShapeGlyph } from "./components/shape-glyph";
import { CLIPBOARD_MIME, imageNodeOperation, parseClipboard, pasteOperations, serializeSelection } from "./src/clipboard";
import {
  distributeOperations,
  expandToGroups,
  groupOperations,
  reorderOperation,
  tidyUpOperations,
  ungroupOperations,
} from "./src/arrange";
import {
  ALIGN_EDGES,
  alignedPosition,
  boundingBox,
  intersects,
  nodeCenter,
  snapToNeighbours,
  type AlignEdge,
  type SelectionBox,
  type SnapGuide,
} from "./src/geometry";
import { Button } from "./components/ui/button";
import { Icon } from "./components/ui/icon";
import { Input } from "./components/ui/input";
import { CanvasContextMenu } from "./components/canvas-context-menu";
import { CanvasFind } from "./components/canvas-find";
import { CanvasMinimap } from "./components/canvas-minimap";
import { menuItemsFor, type MenuAction } from "./src/menu-items";
import { viewportCenteredOn } from "./src/navigation";
import "./app.css";
import "./styles/context-menu.css";
import "./styles/navigation.css";
import "./styles/shapes.css";

type Tool = "select" | "hand" | "sticky" | ShapeKind | "text" | "connector" | "comment";
type DockTool = "select" | "hand" | "sticky" | "shapes" | "text" | "connector" | "comment";

const COLORS = [
  { id: "yellow", value: "#fde68a", label: "Yellow" },
  { id: "coral", value: "#fda4af", label: "Coral" },
  { id: "blue", value: "#93c5fd", label: "Blue" },
  { id: "green", value: "#86efac", label: "Green" },
  { id: "purple", value: "#c4b5fd", label: "Purple" },
  { id: "gray", value: "#d1d5db", label: "Gray" },
  { id: "white", value: "#ffffff", label: "White" },
] as const;

const TOOL_SHORTCUTS: Array<{ id: Tool; key: string }> = [
  { id: "select", key: "v" },
  { id: "hand", key: "h" },
  { id: "sticky", key: "s" },
  { id: "rectangle", key: "r" },
  { id: "ellipse", key: "o" },
  { id: "diamond", key: "d" },
  { id: "text", key: "t" },
  { id: "connector", key: "l" },
  { id: "comment", key: "c" },
];

const DOCK_ITEMS: Array<{ id: DockTool; label: string; key: string }> = [
  { id: "select", label: "Select", key: "V" },
  { id: "hand", label: "Hand tool", key: "H" },
  { id: "sticky", label: "Sticky note", key: "S" },
  { id: "shapes", label: "Shapes", key: "R" },
  { id: "text", label: "Text", key: "T" },
  { id: "connector", label: "Connector", key: "L" },
  { id: "comment", label: "Comment", key: "C" },
];

/** Caret nudge in board units; Shift takes the long stride. */
const CARET_STEP = 20;
const CARET_STEP_FAR = 100;
/** A comment pin is a fixed-size marker, not a node, but placement still needs a box. */
const COMMENT_PIN_SIZE = { width: 32, height: 32 };

const NUDGE_KEYS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const FONT_FAMILIES = [
  { value: "inter", label: "Inter" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
] as const;
const FONT_SIZES = [12, 14, 16, 17, 18, 21, 24, 32, 40, 48] as const;
/** The domain rejects more than this many operations in one call. */
const OPERATION_BATCH = 200;
const SHAPE_TOOLS = SHAPE_KINDS as readonly ShapeKind[];
function isShapeKind(value: string): value is ShapeKind {
  return SHAPE_TOOLS.includes(value as ShapeKind);
}

/** Tools that put a node on the board, so Cmd/Ctrl+Enter has something to place. */
function isPlaceableKind(value: Tool | DockTool): value is PlaceableKind {
  return value === "sticky" || value === "text" || isShapeKind(value);
}
function isCreationTool(value: Tool): boolean {
  return value === "comment" || isPlaceableKind(value);
}
/** The caret chip reads the tool out, so it needs a capitalised name. */
function toolName(value: Tool): string {
  const label = value === "comment" ? "comment" : isPlaceableKind(value) ? KIND_LABELS[value] : value;
  return `${label.slice(0, 1).toUpperCase()}${label.slice(1)}`;
}

function AlignGlyph({ edge }: { edge: AlignEdge }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const };
  const vertical = edge === "left" || edge === "horizontal-center" || edge === "right";
  const rail = edge === "left" ? 4 : edge === "right" ? 20 : 12;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {vertical
        ? <><path {...common} d={`M${rail} 3v18`} strokeDasharray="2 2" /><rect {...common} x={edge === "right" ? 8 : edge === "left" ? 4 : 6} y="5" width="12" height="5" rx="1" /><rect {...common} x={edge === "right" ? 12 : edge === "left" ? 4 : 8} y="14" width="8" height="5" rx="1" /></>
        : <><path {...common} d={`M3 ${rail}h18`} strokeDasharray="2 2" /><rect {...common} x="5" y={edge === "bottom" ? 8 : edge === "top" ? 4 : 6} width="5" height="12" rx="1" /><rect {...common} x="14" y={edge === "bottom" ? 12 : edge === "top" ? 4 : 8} width="5" height="8" rx="1" /></>}
    </svg>
  );
}

function duplicateNodeOperation(node: BoardNode): BoardOperation {
  return {
    type: "add_node",
    node: {
      kind: node.kind,
      x: node.x + 32,
      y: node.y + 32,
      width: node.width,
      height: node.height,
      text: node.text,
      color: node.color,
      fontFamily: node.fontFamily,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      textAlign: node.textAlign,
      ...(node.imageData === undefined ? {} : { imageData: node.imageData }),
    },
  };
}

function colorValue(id: string): string {
  return COLORS.find((color) => color.id === id)?.value ?? (/^#[0-9a-f]{6}$/i.test(id) ? id : "#d1d5db");
}

function fileSafe(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "canvas-board";
}

function downloadBlob(name: string, type: string, content: BlobPart): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readImportFile(file: File): Promise<string> {
  if (!/\.(png|jpe?g)$/i.test(file.name)) return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function downloadPng(board: BoardDocument): Promise<void> {
  const svg = serializeBoardSvg(board);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = Math.min(4096, Math.max(1200, image.naturalWidth));
    const height = Math.min(4096, Math.max(800, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("PNG rendering is unavailable in this browser");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob === null) throw new Error("Could not encode PNG");
    downloadBlob(`${fileSafe(board.title)}.png`, "image/png", blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function useBoardLibrary() {
  const rpc = useRpc<typeof rpcContract>();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc.call("boards_list").then(
      ({ boards: next }) => {
        setBoards(next);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime("boards-changed", refresh);
  return { rpc, boards, error, refresh };
}

function BoardLibrary({
  boards,
  activeId,
  onOpen,
  onCreate,
}: {
  boards: BoardSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="canvas-library" aria-label="Board library">
      <div className="canvas-library-heading">
        <span>Boards</span>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Create board" onClick={onCreate}>
          <Icon name="Plus" className="size-4" />
        </Button>
      </div>
      <div className="canvas-library-list">
        {boards.map((board) => (
          <button
            key={board.id}
            className={`canvas-library-row ${board.id === activeId ? "is-active" : ""}`}
            onClick={() => onOpen(board.id)}
          >
            <span className="canvas-library-thumbnail"><Icon name="Workflow" className="size-4" /></span>
            <span className="min-w-0 text-left">
              <span className="canvas-library-title">{board.title}</span>
              <span className="canvas-library-meta">{board.version === 0 ? "New board" : `Version ${board.version}`}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="canvas-library-foot">Local, single-player boards</div>
    </aside>
  );
}

function ToolGlyph({ id }: { id: DockTool | BoardNodeKind }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "select") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 3.5 19 11l-6.2 2.1L10.5 20 5 3.5Z" /></svg>;
  if (id === "hand") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M7.5 11V6.5a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V10m0-3a1.5 1.5 0 0 1 3 0v4m0-2a1.5 1.5 0 0 1 3 0v4.5c0 4.5-2.7 7-7 7-2.2 0-3.6-.8-4.9-2.3L4 14.2A1.6 1.6 0 0 1 6.3 12l1.2 1.1" /></svg>;
  if (id === "sticky") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 3.5h14v12l-5 5H5v-17Z" /><path {...common} d="M14 20.5v-5h5" /></svg>;
  if (id === "shapes") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="3.5" y="4" width="8" height="8" rx="1" /><circle {...common} cx="16" cy="16" r="4.5" /></svg>;
  if (id === "rectangle") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="3" y="5" width="18" height="14" rx="2" /></svg>;
  if (id === "ellipse") return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse {...common} cx="12" cy="12" rx="9" ry="7" /></svg>;
  if (id === "diamond") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2.8 9.2 9.2-9.2 9.2L2.8 12 12 2.8Z" /></svg>;
  if (id === "text") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 5h14M12 5v14M8.5 19h7" /></svg>;
  if (id === "connector") return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 18 18 4m-6 0h6v6" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 4h14v11H9l-4 4V4Z" /></svg>;
}

function ToolButton({ item, active, onClick }: {
  item: (typeof DOCK_ITEMS)[number];
  active: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className={`canvas-tool ${active ? "is-active" : ""}`}
      aria-label={item.label}
      aria-keyshortcuts={item.key}
      title={`${item.label} (${item.key}, then ⌘/Ctrl+Enter)`}
      onClick={onClick}
    >
      <ToolGlyph id={item.id} />
      <span className="canvas-tool-tooltip">{item.label}<kbd>{item.key}</kbd></span>
    </button>
  );
}

function DiagramNode({
  node,
  selected,
  focused,
  soloSelected,
  editing,
  comments,
  zoom,
  connectorSource,
  onSelect,
  onContextMenu,
  onBeginEdit,
  onEndEdit,
  onBeginDrag,
  onTextCommit,
  onResize,
}: {
  node: BoardNode;
  selected: boolean;
  focused: boolean;
  soloSelected: boolean;
  editing: boolean;
  comments: number;
  zoom: number;
  connectorSource: boolean;
  onSelect: (additive: boolean) => void;
  onContextMenu: (event: ReactPointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
  onBeginDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextCommit: (text: string) => void;
  onResize: (width: number, height: number) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const shape = isShapeKind(node.kind) ? node.kind : null;
  const clip = shape === null ? null : shapeClipPath(shape, node.width, node.height);
  const inset = shape === null ? null : textInset(shape, node.width, node.height);
  const [draft, setDraft] = useState(node.text);
  useEffect(() => setDraft(node.text), [node.text]);
  useEffect(() => {
    if (!editing || textRef.current === null) return;
    textRef.current.focus();
    textRef.current.setSelectionRange(textRef.current.value.length, textRef.current.value.length);
  }, [editing]);
  return (
    <div
      ref={nodeRef}
      id={domId({ kind: "node", id: node.id })}
      role="option"
      aria-selected={selected}
      aria-roledescription={KIND_LABELS[node.kind]}
      aria-label={objectName(node)}
      tabIndex={-1}
      className={`diagram-node diagram-${node.kind} ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""} ${soloSelected && !node.locked ? "is-solo" : ""} ${editing ? "is-editing" : ""} ${connectorSource ? "is-connector-source" : ""}`}
      data-shape={shape ?? undefined}
      data-shape-outline={shape !== null && clip === null ? "true" : undefined}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        backgroundColor: node.kind === "text" || node.kind === "image" ? "transparent" : colorValue(node.color),
        ...(clip === null ? {} : { "--shape-clip": clip }),
        ...(shape === null ? {} : { "--diagram-node-bg": colorValue(node.color) }),
        ...(inset === null ? {} : {
          "--shape-pad-top": `${inset.top}px`,
          "--shape-pad-right": `${inset.right}px`,
          "--shape-pad-bottom": `${inset.bottom}px`,
          "--shape-pad-left": `${inset.left}px`,
        }),
      } as CSSProperties}
      data-node-id={node.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(event.shiftKey);
        if (!editing) onBeginDrag(event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (node.kind !== "image" && !node.locked) onBeginEdit();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event);
      }}
      onPointerUp={() => {
        if (!soloSelected || node.locked || nodeRef.current === null) return;
        const rect = nodeRef.current.getBoundingClientRect();
        const width = Math.round(rect.width / zoom);
        const height = Math.round(rect.height / zoom);
        if (Math.abs(width - node.width) > 2 || Math.abs(height - node.height) > 2) onResize(width, height);
      }}
    >
      {shape !== null && clip === null ? (
        <svg className="diagram-shape-outline" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={shapePath(shape, node.width, node.height)} />
        </svg>
      ) : null}
      {node.kind === "image" && node.imageData !== undefined ? (
        <img src={node.imageData} alt={node.text || "Imported diagram"} draggable={false} />
      ) : (
        <textarea
          ref={textRef}
          aria-label={`Edit ${KIND_LABELS[node.kind]} text: ${objectName(node)}`}
          tabIndex={editing ? 0 : -1}
          aria-hidden={!editing}
          readOnly={!editing}
          value={draft}
          placeholder={node.kind === "sticky" ? "Type a note…" : "Type text…"}
          style={{
            fontFamily: node.fontFamily === "serif" ? "Georgia, serif" : node.fontFamily === "mono" ? "ui-monospace, SFMono-Regular, monospace" : "Inter, system-ui, sans-serif",
            fontSize: node.fontSize,
            fontWeight: node.fontWeight,
            textAlign: node.textAlign,
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            textRef.current?.blur();
            onEndEdit();
          }}
          onBlur={() => { if (draft !== node.text) onTextCommit(draft); }}
        />
      )}
      {node.locked ? <span className="lock-badge" aria-label="Locked object"><Icon name="Lock" className="size-3" /></span> : null}
      {comments > 0 ? <span className="comment-badge" aria-label={`${comments} open comments`}>{comments}</span> : null}
      {soloSelected ? <span className="canvas-resize-handle" aria-hidden="true" /> : null}
    </div>
  );
}

function Inspector({
  board,
  node,
  onApply,
  onClose,
}: {
  board: BoardDocument;
  node: BoardNode;
  onApply: (operations: BoardOperation[]) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const comments = board.comments.filter((item) => item.nodeId === node.id);
  return (
    <aside className="canvas-inspector" aria-label="Object inspector">
      <div className="canvas-inspector-head">
        <div><strong>{node.kind === "sticky" ? "Sticky note" : node.kind}</strong><span>Object settings</span></div>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close inspector" onClick={onClose}><Icon name="X" className="size-4" /></Button>
      </div>
      <section>
        <h3>Color</h3>
        <div className="color-grid">
          {COLORS.map((color) => (
            <button
              key={color.id}
              className={node.color === color.id ? "is-active" : ""}
              style={{ background: color.value }}
              aria-label={color.label}
              onClick={() => onApply([{ type: "update_node", id: node.id, patch: { color: color.id } }])}
            />
          ))}
          <label className="custom-color" title="Custom color">
            <span className="sr-only">Custom fill color</span>
            <input
              type="color"
              aria-label="Custom fill color"
              value={colorValue(node.color)}
              onChange={(event) => onApply([{ type: "update_node", id: node.id, patch: { color: event.target.value } }])}
            />
          </label>
        </div>
      </section>
      <section>
        <div className="section-title"><h3>Comments</h3><span>{comments.filter((item) => !item.resolved).length} open</span></div>
        <form className="comment-compose"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim() === "") return;
            onApply([{ type: "add_comment", comment: { nodeId: node.id, message: comment.trim() } }]);
            setComment("");
          }}
        >
          <Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Write a note to yourself…" aria-label="New comment" />
          <Button type="submit" size="sm">Add comment</Button>
        </form>
        <div className="comment-list">
          {comments.length === 0 ? <p>No comments yet.</p> : comments.map((item) => (
            <article key={item.id} className={item.resolved ? "is-resolved" : ""}>
              <p>{item.message}</p>
              <div>
                <button onClick={() => onApply([{ type: "resolve_comment", id: item.id, resolved: !item.resolved }])}>{item.resolved ? "Reopen" : "Resolve"}</button>
                <button onClick={() => onApply([{ type: "delete_comment", id: item.id }])}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <Button variant="destructive" size="sm" onClick={() => onApply([{ type: "remove_nodes", ids: [node.id] }])}>
        <Icon name="Trash2" className="size-4" /> Delete object
      </Button>
      <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => onApply([duplicateNodeOperation(node)])}>
        <Icon name="Copy" className="size-4" /> Duplicate object
      </Button>
    </aside>
  );
}

function SelectionToolbar({
  nodes,
  position,
  colorOpen,
  onColorOpenChange,
  onApply,
  onComments,
  onDuplicate,
  onDelete,
  onAlign,
  locked,
  onLockChange,
  grouped,
  mutable,
  onGroupChange,
  onTidy,
  onDistribute,
}: {
  nodes: BoardNode[];
  position: CSSProperties;
  colorOpen: boolean;
  onColorOpenChange: (open: boolean) => void;
  onApply: (patch: Extract<BoardOperation, { type: "update_node" }>["patch"]) => void;
  onComments: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAlign: (edge: AlignEdge) => void;
  locked: boolean;
  onLockChange: (locked: boolean) => void;
  grouped: boolean;
  mutable: boolean;
  onGroupChange: () => void;
  onTidy: () => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
}) {
  const lead = nodes[0]!;
  const many = nodes.length > 1;
  const noun = many ? `${nodes.length} objects` : "object";
  const typographic = nodes.every((node) => node.kind !== "image") && !locked;
  const nextAlign = lead.textAlign === "left" ? "center" : lead.textAlign === "center" ? "right" : "left";
  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Selection properties" style={position} onPointerDown={(event) => event.stopPropagation()}>
      {many ? <span className="selection-count">{nodes.length}</span> : null}
      <div className="selection-color-wrap">
        <button className="selection-action fill-action" aria-label="Change fill color" title={mutable ? "Fill color" : "Unlock to restyle"} disabled={!mutable} onClick={() => onColorOpenChange(!colorOpen)}>
          <span style={{ background: colorValue(lead.color) }} />
          <Icon name="ArrowDown" className="size-3" />
        </button>
        {colorOpen ? (
          <div className="selection-color-menu" aria-label="Fill colors">
            {COLORS.map((color) => (
              <button
                key={color.id}
                aria-label={`Set ${color.label} fill`}
                className={nodes.every((node) => node.color === color.id) ? "is-active" : ""}
                style={{ background: color.value }}
                onClick={() => { onApply({ color: color.id }); onColorOpenChange(false); }}
              />
            ))}
            <label title="Custom fill">
              <Icon name="Palette" className="size-4" />
              <input type="color" aria-label="Custom selection fill color" value={colorValue(lead.color)} onChange={(event) => onApply({ color: event.target.value })} />
            </label>
          </div>
        ) : null}
      </div>
      {typographic ? <>
        <select aria-label="Font family" value={lead.fontFamily} onChange={(event) => onApply({ fontFamily: event.target.value as BoardNode["fontFamily"] })}>
          {FONT_FAMILIES.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>
        <select aria-label="Font size" value={lead.fontSize} onChange={(event) => onApply({ fontSize: Number(event.target.value) })}>
          {FONT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <button className={`selection-action text-action ${lead.fontWeight >= 700 ? "is-active" : ""}`} aria-label="Bold" aria-pressed={lead.fontWeight >= 700} title="Bold" onClick={() => onApply({ fontWeight: lead.fontWeight >= 700 ? 500 : 700 })}>B</button>
        <button className="selection-action" aria-label="Change text alignment" title={`Align ${nextAlign}`} onClick={() => onApply({ textAlign: nextAlign })}><Icon name="AlignLeft" className="size-4" /></button>
      </> : null}
      {many ? <>
        <span className="selection-divider" />
        {ALIGN_EDGES.map((edge) => (
          <button key={edge.id} className="selection-action" aria-label={edge.label} title={edge.label} disabled={!mutable} onClick={() => onAlign(edge.id)}>
            <AlignGlyph edge={edge.id} />
          </button>
        ))}
        <button className="selection-action" aria-label="Tidy up selection" title="Tidy up" disabled={!mutable} onClick={onTidy}><Icon name="GridView" className="size-4" /></button>
        <button className="selection-action" aria-label="Distribute horizontally" title="Distribute horizontally" disabled={nodes.length < 3 || !mutable} onClick={() => onDistribute("horizontal")}><span className="glyph-rotate"><Icon name="ArrowUpDown" className="size-4" /></span></button>
        <button className="selection-action" aria-label="Distribute vertically" title="Distribute vertically" disabled={nodes.length < 3 || !mutable} onClick={() => onDistribute("vertical")}><Icon name="ArrowUpDown" className="size-4" /></button>
        <button className={`selection-action ${grouped ? "is-active" : ""}`} aria-label={grouped ? "Ungroup selection" : "Group selection"} aria-pressed={grouped} aria-keyshortcuts={grouped ? "Meta+Shift+G Control+Shift+G" : "Meta+G Control+G"} title={grouped ? "Ungroup (Cmd/Ctrl+Shift+G)" : "Group (Cmd/Ctrl+G)"} onClick={onGroupChange}><Icon name="Layers" className="size-4" /></button>
      </> : null}
      <span className="selection-divider" />
      {many ? null : <button className="selection-action" aria-label="Add comment" title="Add a private comment" onClick={onComments}><ToolGlyph id="comment" /></button>}
      <button className="selection-action" aria-label={`Duplicate selected ${noun}`} aria-keyshortcuts="Meta+D Control+D" title="Duplicate (Cmd/Ctrl+D)" onClick={onDuplicate}><Icon name="Copy" className="size-4" /></button>
      <button
        className={`selection-action ${locked ? "is-active" : ""}`}
        aria-label={locked ? "Unlock selection" : "Lock selection"}
        aria-pressed={locked}
        aria-keyshortcuts="Meta+Shift+L Control+Shift+L"
        title={locked ? "Unlock" : "Lock in place"}
        onClick={() => onLockChange(!locked)}
      >
        <Icon name={locked ? "SquareUnlock02" : "Lock"} className="size-4" />
      </button>
      <button className="selection-action danger" aria-label={`Delete selected ${noun}`} aria-keyshortcuts="Backspace Delete" title={mutable ? "Delete (Backspace)" : "Unlock to delete"} disabled={!mutable} onClick={onDelete}><Icon name="Trash2" className="size-4" /></button>
    </div>
  );
}

function CommentPin({
  comment,
  open,
  onOpenChange,
  onMessage,
  onResolve,
  onDelete,
}: {
  comment: BoardComment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMessage: (message: string) => void;
  onResolve: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(comment.message);
  useEffect(() => setDraft(comment.message), [comment.message]);
  return (
    <div className={`canvas-pin ${comment.resolved ? "is-resolved" : ""}`} style={{ left: comment.x ?? 0, top: comment.y ?? 0 }} data-comment-id={comment.id}>
      <button
        className="canvas-pin-dot"
        aria-label={`Comment: ${comment.message}`}
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onOpenChange(!open)}
      >
        <ToolGlyph id="comment" />
      </button>
      {open ? (
        <div className="canvas-pin-editor" role="dialog" aria-label="Edit comment" onPointerDown={(event) => event.stopPropagation()}>
          <textarea
            aria-label="Comment text"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (draft.trim() !== "" && draft !== comment.message) onMessage(draft.trim()); }}
          />
          <div className="canvas-pin-actions">
            <button onClick={onResolve}>{comment.resolved ? "Reopen" : "Resolve"}</button>
            <button onClick={onDelete}>Delete</button>
            <button onClick={() => onOpenChange(false)}>Done</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConnectorToolbar({
  edge,
  position,
  toolbarRef,
  onApply,
  onDelete,
  onEscape,
}: {
  edge: BoardEdge;
  position: CSSProperties;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  onApply: (patch: Extract<BoardOperation, { type: "update_edge" }>["patch"]) => void;
  onDelete: () => void;
  onEscape: () => void;
}) {
  const [label, setLabel] = useState(edge.label);
  const hintId = useId();
  useEffect(() => setLabel(edge.label), [edge.label]);
  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar connector-toolbar"
      role="toolbar"
      aria-label="Connector properties"
      aria-describedby={hintId}
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // The canvas must not also act on it: Escape here keeps the connector selected.
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
    >
      <p id={hintId} className="sr-only">Escape returns to the canvas.</p>
      <input
        className="connector-label-input"
        aria-label="Connector label"
        placeholder="Label…"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={() => { if (label !== edge.label) onApply({ label }); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <select aria-label="Connector routing" value={edge.routing} onChange={(event) => onApply({ routing: event.target.value as BoardEdge["routing"] })}>
        <option value="straight">Straight</option>
        <option value="elbow">Elbow</option>
        <option value="curved">Curved</option>
      </select>
      <select aria-label="Connector arrows" value={edge.arrow} onChange={(event) => onApply({ arrow: event.target.value as BoardEdge["arrow"] })}>
        <option value="end">One way</option>
        <option value="both">Two way</option>
        <option value="none">No arrow</option>
      </select>
      <span className="selection-divider" />
      <button className="selection-action danger" aria-label="Delete connector" title="Delete connector" onClick={onDelete}><Icon name="Trash2" className="size-4" /></button>
    </div>
  );
}

function BoardWorkspace({ board, onBoardChange }: { board: BoardDocument; onBoardChange: (board: BoardDocument) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<SelectionBox | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; at: { x: number; y: number }; target: "canvas" | "object" } | null>(null);
  const [pinnedComment, setPinnedComment] = useState<string | null>(null);
  const lastShapeRef = useRef<ShapeKind>("rectangle");
  const [canPaste, setCanPaste] = useState(false);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focused, setFocused] = useState<ObjectRef | null>(null);
  const [connectorSource, setConnectorSource] = useState<string | null>(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [viewport, setViewport] = useState({ x: 80, y: 64, zoom: 1 });
  const [surfaceFocused, setSurfaceFocused] = useState(false);
  /** Board-space insertion point; null means "the centre of whatever is on screen". */
  const [caret, setCaret] = useState<{ x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const helpId = useId();
  const [undo, setUndo] = useState<BoardDocument[]>([]);
  const [redo, setRedo] = useState<BoardDocument[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const fitRef = useRef<() => void>(() => undefined);
  const boardRef = useRef(board);
  const selectionRef = useRef<string[]>(selectedIds);
  const viewportRef = useRef(viewport);
  const surfaceRef = useRef<HTMLDivElement>(null);
  /** The control that opened the find palette, so closing it can hand focus back. */
  const findInvokerRef = useRef<HTMLElement | null>(null);
  const connectorToolbarRef = useRef<HTMLDivElement>(null);
  const toolRef = useRef<Tool>(tool);
  boardRef.current = board;
  toolRef.current = tool;
  selectionRef.current = selectedIds;
  viewportRef.current = viewport;

  const persist = useCallback(async (operations: BoardOperation[], snapshot: BoardDocument | null = boardRef.current) => {
    if (operations.length === 0) return;
    const before = boardRef.current;
    if (snapshot !== null) {
      setUndo((history) => [...history.slice(-39), snapshot]);
      setRedo([]);
    }
    try {
      let latest = before;
      for (let index = 0; index < operations.length; index += OPERATION_BATCH) {
        const batch = await rpc.call("board_apply_operations", { boardId: before.id, operations: operations.slice(index, index + OPERATION_BATCH) });
        latest = batch.board;
      }
      onBoardChange(latest);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onBoardChange, rpc]);

  const restore = useCallback(async (target: BoardDocument, destination: "undo" | "redo") => {
    const current = boardRef.current;
    try {
      const result = await rpc.call("board_import", {
        boardId: current.id,
        fileName: "history.canvas.json",
        content: serializeBoardJson(target),
      });
      if (destination === "undo") setRedo((history) => [...history, current]);
      else setUndo((history) => [...history, current]);
      onBoardChange(result.board);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onBoardChange, rpc]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target !== null && target.matches("input, textarea, [contenteditable=true]")) return;
      // Focus on a control means that control owns Enter, Space, Backspace and plain
      // letters. Only chorded shortcuts stay global.
      const onControl = target !== null && target.closest("button, a, select, [role='menuitem'], [role='option']") !== null;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          const targetBoard = redo.at(-1);
          if (targetBoard !== undefined) { setRedo((items) => items.slice(0, -1)); void restore(targetBoard, "redo"); }
        } else {
          const targetBoard = undo.at(-1);
          if (targetBoard !== undefined) { setUndo((items) => items.slice(0, -1)); void restore(targetBoard, "undo"); }
        }
        return;
      }
      const selectedNow = boardRef.current.nodes.filter((node) => selectionRef.current.includes(node.id));
      const chosen = selectedNow.filter((node) => !node.locked);
      if (event.shiftKey && !event.metaKey && !event.ctrlKey && event.code === "Digit1") {
        event.preventDefault();
        fitRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l" && selectedNow.length > 0) {
        event.preventDefault();
        const locking = selectedNow.some((node) => !node.locked);
        void persist(selectedNow.filter((node) => node.locked !== locking).map((node) => ({ type: "update_node" as const, id: node.id, patch: { locked: locking } })));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "t" && chosen.length > 1) {
        event.preventDefault();
        void persist(tidyUpOperations(chosen));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        findInvokerRef.current = null;
        setFindOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(boardRef.current.nodes.filter((node) => !node.locked).map((node) => node.id));
        setEditingId(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g" && chosen.length > 0) {
        event.preventDefault();
        void persist(event.shiftKey ? ungroupOperations(chosen) : groupOperations(chosen, globalThis.crypto.randomUUID()));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "]" || event.key === "[") && chosen.length > 0) {
        event.preventDefault();
        const placement = event.key === "]"
          ? (event.shiftKey ? "front" : "forward")
          : (event.shiftKey ? "back" : "backward");
        void persist([reorderOperation(chosen.map((node) => node.id), placement)]);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selectedNow.length > 0) {
        event.preventDefault();
        void persist(selectedNow.map(duplicateNodeOperation));
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const nudge = NUDGE_KEYS[event.key];
      if (nudge !== undefined && chosen.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        void persist(chosen.map((node) => ({ type: "update_node" as const, id: node.id, patch: { x: node.x + nudge.x * step, y: node.y + nudge.y * step } })));
        return;
      }
      // The surface handler owns Enter while the connector tool is armed; this is the fallback.
      if (event.key === "Enter" && !onControl && toolRef.current !== "connector" && chosen.length === 1 && selectedNow.length === 1) {
        event.preventDefault();
        setEditingId(chosen[0]!.id);
        return;
      }
      if (onControl) return;
      const match = TOOL_SHORTCUTS.find((item) => item.key === event.key.toLowerCase());
      if (match !== undefined) setTool(match.id);
      if ((event.key === "Backspace" || event.key === "Delete") && chosen.length > 0) {
        void persist([{ type: "remove_nodes", ids: chosen.map((node) => node.id) }]);
        setSelectedIds([]);
        setEditingId(null);
      } else if ((event.key === "Backspace" || event.key === "Delete") && selectedEdgeId !== null) {
        void persist([{ type: "remove_edges", ids: [selectedEdgeId] }]);
        setSelectedEdgeId(null);
      }
      if (event.key === "Escape") { setSelectedIds([]); setEditingId(null); setSelectedEdgeId(null); setFocused(null); setCaret(null); setConnectorSource(null); setShapeMenuOpen(false); setColorMenuOpen(false); setInspectorOpen(false); setTool("select"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [persist, redo, restore, selectedEdgeId, undo]);

  const applyPaste = useCallback((text: string, at: { x: number; y: number } | undefined) => {
    const payload = parseClipboard(text);
    if (payload === null) return false;
    const operations = pasteOperations(payload, { makeId: () => globalThis.crypto.randomUUID(), ...(at === undefined ? {} : { at }) });
    if (operations.length === 0) return false;
    void persist(operations);
    return true;
  }, [persist]);

  const addImage = useCallback((file: File, at: { x: number; y: number }) => {
    const reader = new FileReader();
    reader.onerror = () => toast.error(`Could not read ${file.name}`);
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      try {
        void persist([imageNodeOperation(reader.result, at)]);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    };
    reader.readAsDataURL(file);
  }, [persist]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const editingText = (target: EventTarget | null) =>
      target instanceof HTMLElement && target.matches("input, textarea, [contenteditable=true]");
    const pointerBoardPoint = () => {
      const point = pointerRef.current;
      if (point === null) return undefined;
      const rect = surface.getBoundingClientRect();
      return {
        x: Math.round((point.x - rect.left - viewportRef.current.x) / viewportRef.current.zoom),
        y: Math.round((point.y - rect.top - viewportRef.current.y) / viewportRef.current.zoom),
      };
    };
    const onCopy = (event: ClipboardEvent, cut: boolean) => {
      if (editingText(event.target) || selectionRef.current.length === 0) return;
      const payload = serializeSelection(boardRef.current, selectionRef.current);
      event.preventDefault();
      setCanPaste(true);
      event.clipboardData?.setData(CLIPBOARD_MIME, payload);
      event.clipboardData?.setData("text/plain", payload);
      if (!cut) return;
      const removable = boardRef.current.nodes.filter((node) => selectionRef.current.includes(node.id) && !node.locked);
      if (removable.length === 0) return;
      void persist([{ type: "remove_nodes", ids: removable.map((node) => node.id) }]);
      setSelectedIds([]);
    };
    const copy = (event: ClipboardEvent) => onCopy(event, false);
    const cut = (event: ClipboardEvent) => onCopy(event, true);
    const paste = (event: ClipboardEvent) => {
      if (editingText(event.target)) return;
      const at = pointerBoardPoint();
      const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
      if (image !== undefined) {
        event.preventDefault();
        addImage(image, at ?? { x: 0, y: 0 });
        return;
      }
      const text = event.clipboardData?.getData(CLIPBOARD_MIME) || event.clipboardData?.getData("text/plain") || "";
      if (text !== "" && applyPaste(text, at)) event.preventDefault();
    };
    const track = (event: PointerEvent) => { pointerRef.current = { x: event.clientX, y: event.clientY }; };
    const dragOver = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) => candidate.type.startsWith("image/"));
      if (file === undefined) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      addImage(file, {
        x: Math.round((event.clientX - rect.left - viewportRef.current.x) / viewportRef.current.zoom),
        y: Math.round((event.clientY - rect.top - viewportRef.current.y) / viewportRef.current.zoom),
      });
    };
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", paste);
    surface.addEventListener("pointermove", track);
    surface.addEventListener("dragover", dragOver);
    surface.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", paste);
      surface.removeEventListener("pointermove", track);
      surface.removeEventListener("dragover", dragOver);
      surface.removeEventListener("drop", drop);
    };
  }, [addImage, applyPaste, persist]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey) {
        setViewport((value) => ({ ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }));
        return;
      }
      const rect = surface.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      setViewport((value) => {
        const step = event.deltaY > 0 ? 0.9 : event.deltaY < 0 ? 1.1 : 1;
        const zoom = Math.max(0.2, Math.min(2.5, value.zoom * step));
        const scale = zoom / value.zoom;
        return { zoom, x: pointerX - (pointerX - value.x) * scale, y: pointerY - (pointerY - value.y) * scale };
      });
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, []);

  const canvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return {
      x: Math.round((clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom),
      y: Math.round((clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom),
    };
  }, [viewport]);

  const surfaceSize = { width: surfaceRef.current?.clientWidth ?? 800, height: surfaceRef.current?.clientHeight ?? 600 };

  /** Adds a node whose TOP-LEFT is (left, top) and returns its id. */
  const createNodeAt = useCallback((kind: PlaceableKind, left: number, top: number) => {
    const id = globalThis.crypto.randomUUID();
    void persist([{ type: "add_node", node: { id, kind, x: left, y: top, color: kind === "sticky" ? "yellow" : kind === "text" ? "white" : "blue" } }]);
    setSelectedIds([id]);
    setEditingId(id);
    setSelectedEdgeId(null);
    setInspectorOpen(false);
    setTool("select");
    return id;
  }, [persist]);

  const caretPoint = () => caret ?? viewportCenterPoint(viewport, surfaceSize);

  /** Where a keyboard-placed object goes: beside a single selection, else at the caret. */
  const nextPlacement = (size: { width: number; height: number }) => {
    const anchor = selectedIds.length === 1 ? board.nodes.find((node) => node.id === selectedIds[0]) ?? null : null;
    return insertionPoint({ anchor, caret: caretPoint(), size, nodes: board.nodes });
  };

  const placeObject = (kind: PlaceableKind) => {
    const size = DEFAULT_SIZE[kind];
    const at = nextPlacement(size);
    const id = createNodeAt(kind, at.x, at.y);
    setFocused({ kind: "node", id });
    setCaret({ x: at.x, y: at.y + size.height + PLACEMENT_GAP });
    setAnnouncement(`${toolName(kind)} added at ${at.x}, ${at.y}. Editing.`);
  };

  const placeComment = () => {
    const at = nextPlacement(COMMENT_PIN_SIZE);
    const id = globalThis.crypto.randomUUID();
    void persist([{ type: "add_comment", comment: { id, message: "New note", x: at.x, y: at.y } }]);
    setPinnedComment(id);
    setSelectedIds([]);
    setEditingId(null);
    setTool("select");
    setCaret({ x: at.x, y: at.y + COMMENT_PIN_SIZE.height + PLACEMENT_GAP });
    setAnnouncement(`Comment added at ${at.x}, ${at.y}.`);
  };

  // Undo, redo and realtime replace the whole document, so the cursor can outlive its object.
  useEffect(() => {
    setFocused((current) => {
      if (current === null) return null;
      const items: ReadonlyArray<{ id: string }> = current.kind === "node" ? board.nodes : board.edges;
      return items.some((item) => item.id === current.id) ? current : null;
    });
  }, [board]);

  const onEndEdit = () => {
    setEditingId(null);
    surfaceRef.current?.focus();
  };

  /** Keyboard context menu: over the focused object if there is one, else at the caret. */
  const openContextMenu = () => {
    const node = focused === null || focused.kind !== "node" ? undefined : board.nodes.find((item) => item.id === focused.id);
    const at = node === undefined ? caretPoint() : { x: node.x, y: node.y };
    const rect = surfaceRef.current?.getBoundingClientRect();
    setContextMenu({
      x: (rect?.left ?? 0) + viewport.x + at.x * viewport.zoom,
      y: (rect?.top ?? 0) + viewport.y + at.y * viewport.zoom,
      at,
      target: focused === null ? "canvas" : "object",
    });
  };

  /** The surface owns placement and Tab; every other key stays with the window handler. */
  const onSurfaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (isPlaceableKind(tool)) placeObject(tool);
      else if (tool === "comment") placeComment();
      else setAnnouncement("Pick a tool first (S, R, T, C), then press Command or Control and Enter.");
      return;
    }
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      openContextMenu();
      return;
    }
    if (event.key === "Escape" && connectorSource !== null) {
      // The window handler clears the state; the announcement is all that is missing.
      setAnnouncement("Connector cancelled. Nothing was added to the board.");
      return;
    }
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && focused !== null) {
      if (focused.kind === "edge") {
        event.preventDefault();
        connectorToolbarRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
        return;
      }
      const node = board.nodes.find((item) => item.id === focused.id);
      if (node !== undefined && tool === "connector") {
        // Never let the window handler also open the text editor for this key.
        event.preventDefault();
        const from = connectorSource === null ? null : board.nodes.find((item) => item.id === connectorSource) ?? null;
        selectNode(node, false);
        if (from === null) setAnnouncement(`Connector started from ${objectName(node)}. Tab to the target object and press Enter.`);
        else if (from.id !== node.id) setAnnouncement(`Connector added from ${objectName(from)} to ${objectName(node)}.`);
        else setAnnouncement("Connector cancelled. A connector needs two different objects.");
        return;
      }
      // Any other tool falls through to the window handler's edit-text behaviour.
    }
    const caretNudge = NUDGE_KEYS[event.key];
    if (event.altKey && caretNudge !== undefined) {
      event.preventDefault();
      const step = event.shiftKey ? CARET_STEP_FAR : CARET_STEP;
      const from = caretPoint();
      const to = { x: from.x + caretNudge.x * step, y: from.y + caretNudge.y * step };
      setCaret(to);
      setAnnouncement(`Insertion point at ${to.x}, ${to.y}.`);
      return;
    }
    if (event.key !== "Tab") return;
    const next = nextObject(objectOrder(board), focused, event.shiftKey ? -1 : 1);
    if (next === null) {
      // Past either end the canvas releases, so it costs a passer-by exactly one tab stop.
      setFocused(null);
      return;
    }
    event.preventDefault();
    setFocused(next);
    if (next.kind === "node") {
      setSelectedIds(expandToGroups(board.nodes, [next.id]));
      setSelectedEdgeId(null);
      setEditingId(null);
    } else {
      setSelectedEdgeId(next.id);
      setSelectedIds([]);
    }
  };

  const onSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    surfaceRef.current?.focus();
    if (event.button !== 0) return;
    if (tool === "hand") {
      const start = { clientX: event.clientX, clientY: event.clientY, ...viewport };
      const move = (next: PointerEvent) => setViewport((value) => ({ ...value, x: start.x + next.clientX - start.clientX, y: start.y + next.clientY - start.clientY }));
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      return;
    }
    if (isPlaceableKind(tool)) {
      const point = canvasPoint(event.clientX, event.clientY);
      const offset = PLACEMENT_OFFSETS[tool];
      createNodeAt(tool, point.x - offset.x, point.y - offset.y);
      return;
    }
    setEditingId(null);
    setSelectedEdgeId(null);
    setColorMenuOpen(false);
    setInspectorOpen(false);
    setShapeMenuOpen(false);
    if (tool === "comment") {
      const point = canvasPoint(event.clientX, event.clientY);
      const id = globalThis.crypto.randomUUID();
      void persist([{ type: "add_comment", comment: { id, message: "New note", x: point.x, y: point.y } }]);
      setPinnedComment(id);
      setTool("select");
      return;
    }
    if (connectorSource !== null) {
      setConnectorSource(null);
      toast.message("Connector cancelled — click an object to start, then a second one to finish.");
      return;
    }
    setConnectorSource(null);
    const base = event.shiftKey ? selectionRef.current : [];
    setSelectedIds(base);
    if (tool !== "select") return;
    const origin = canvasPoint(event.clientX, event.clientY);
    const move = (next: PointerEvent) => {
      const point = canvasPoint(next.clientX, next.clientY);
      const box = {
        minX: Math.min(origin.x, point.x),
        minY: Math.min(origin.y, point.y),
        maxX: Math.max(origin.x, point.x),
        maxY: Math.max(origin.y, point.y),
      };
      setMarquee(box);
      const inside = boardRef.current.nodes.filter((node) => !node.locked && intersects(node, box)).map((node) => node.id);
      setSelectedIds(expandToGroups(boardRef.current.nodes, [...new Set([...base, ...inside])]));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const selectNode = (node: BoardNode, additive: boolean) => {
    if (tool === "connector") {
      if (connectorSource === null) {
        setConnectorSource(node.id);
        toast.message("Now click the object to connect it to.");
      } else if (connectorSource === node.id) {
        setConnectorSource(null);
        setTool("select");
        toast.message("Connector cancelled — a connector needs two different objects.");
      } else if (connectorSource !== node.id) {
        void persist([{ type: "add_edge", edge: { source: connectorSource, target: node.id, color: "ink", routing: "elbow" } }]);
        setConnectorSource(null);
        setTool("select");
      }
      return;
    }
    setSelectedIds((current) => {
      if (tool === "comment") return [node.id];
      const next = additive
        ? (current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id])
        : (current.includes(node.id) ? current : [node.id]);
      return expandToGroups(boardRef.current.nodes, next);
    });
    if (node.id !== editingId) setEditingId(null);
    setSelectedEdgeId(null);
    setFocused({ kind: "node", id: node.id });
    setColorMenuOpen(false);
    if (tool === "comment") { setInspectorOpen(true); setTool("select"); }
  };

  const beginNodeDrag = (event: ReactPointerEvent<HTMLDivElement>, node: BoardNode) => {
    if (tool !== "select") return;
    const before = boardRef.current;
    const grouped = event.shiftKey || selectionRef.current.includes(node.id);
    const moving = (grouped
      ? before.nodes.filter((item) => item.id === node.id || selectionRef.current.includes(item.id))
      : [node]).filter((item) => !item.locked);
    if (moving.length === 0) return;
    const origins = new Map(moving.map((item) => [item.id, { x: item.x, y: item.y }]));
    const anchor = boundingBox(moving);
    const neighbours = before.nodes.filter((item) => !origins.has(item.id));
    const start = { clientX: event.clientX, clientY: event.clientY };

    const offsetFor = (next: PointerEvent) => {
      let dx = (next.clientX - start.clientX) / viewport.zoom;
      let dy = (next.clientY - start.clientY) / viewport.zoom;
      if (next.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const snap = snapToNeighbours(
        { minX: anchor.minX + dx, minY: anchor.minY + dy, maxX: anchor.maxX + dx, maxY: anchor.maxY + dy },
        neighbours,
        viewport.zoom,
      );
      return { dx: Math.round(dx + snap.dx), dy: Math.round(dy + snap.dy), guides: snap.guides };
    };

    const move = (next: PointerEvent) => {
      const { dx, dy, guides: nextGuides } = offsetFor(next);
      setGuides(nextGuides);
      onBoardChange({
        ...boardRef.current,
        nodes: boardRef.current.nodes.map((item) => {
          const origin = origins.get(item.id);
          return origin === undefined ? item : { ...item, x: origin.x + dx, y: origin.y + dy };
        }),
      });
    };
    const up = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      setGuides([]);
      const { dx, dy } = offsetFor(next);
      if (dx === 0 && dy === 0) return;
      const alive = moving.filter((item) => boardRef.current.nodes.some((current) => current.id === item.id));
      if (alive.length === 0) return;
      void persist(
        alive.map((item) => {
          const origin = origins.get(item.id)!;
          return { type: "update_node" as const, id: item.id, patch: { x: origin.x + dx, y: origin.y + dy } };
        }),
        before,
      );
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const selectedEdge = board.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const connectorToolbarPosition: CSSProperties = (() => {
    if (selectedEdge === null) return {};
    const source = board.nodes.find((node) => node.id === selectedEdge.source);
    const target = board.nodes.find((node) => node.id === selectedEdge.target);
    if (source === undefined || target === undefined) return {};
    const point = connectorLabelPoint(source, target, selectedEdge.routing);
    const width = surfaceRef.current?.clientWidth ?? 800;
    return {
      left: Math.max(190, Math.min(width - 190, viewport.x + point.x * viewport.zoom)),
      top: Math.max(12, viewport.y + point.y * viewport.zoom - 60),
    };
  })();
  const caretAt = caretPoint();
  const selectedNodes = board.nodes.filter((node) => selectedIds.includes(node.id));
  const selected = selectedNodes.length === 1 ? selectedNodes[0]! : null;
  const selectionBox = selectedNodes.length === 0 ? null : boundingBox(selectedNodes);
  const unlockedSelection = selectedNodes.filter((node) => !node.locked);
  const allLocked = selectedNodes.length > 0 && unlockedSelection.length === 0;
  const duplicateSelected = () => void persist(selectedNodes.map(duplicateNodeOperation));
  const mutable = unlockedSelection.length > 0;
  const setSelectionLocked = (locked: boolean) =>
    void persist(selectedNodes.filter((node) => node.locked !== locked).map((node) => ({ type: "update_node" as const, id: node.id, patch: { locked } })));
  const deleteSelected = () => {
    if (selectedNodes.length === 0) return;
    const ids = unlockedSelection.map((node) => node.id);
    const removals: BoardOperation[] = [];
    // `remove_nodes` accepts at most OPERATION_BATCH ids, so a select-all delete spans several operations.
    for (let index = 0; index < ids.length; index += OPERATION_BATCH) removals.push({ type: "remove_nodes", ids: ids.slice(index, index + OPERATION_BATCH) });
    void persist(removals);
    setSelectedIds([]);
    setEditingId(null);
    setInspectorOpen(false);
  };
  const groupSelected = () => void persist(groupOperations(unlockedSelection, globalThis.crypto.randomUUID()));
  const ungroupSelected = () => void persist(ungroupOperations(unlockedSelection));
  const tidySelected = () => void persist(tidyUpOperations(unlockedSelection));
  const distributeSelected = (axis: "horizontal" | "vertical") => void persist(distributeOperations(unlockedSelection, axis));
  const reorderSelected = (placement: "front" | "back" | "forward" | "backward") => {
    if (selectedNodes.length === 0) return;
    void persist([reorderOperation(selectedNodes.map((node) => node.id), placement)]);
  };
  const grouped = selectedNodes.length > 1 && selectedNodes.every((node) => node.groupId !== null && node.groupId === selectedNodes[0]!.groupId);
  const writeSelection = (cut: boolean) => {
    if (selectedNodes.length === 0) return;
    const payload = serializeSelection(board, selectedNodes.map((node) => node.id));
    void navigator.clipboard?.writeText?.(payload).then(() => setCanPaste(true), () => toast.error("Canvas could not write to the clipboard"));
    setCanPaste(true);
    if (!cut || unlockedSelection.length === 0) return;
    void persist([{ type: "remove_nodes", ids: unlockedSelection.map((node) => node.id) }]);
    setSelectedIds([]);
  };
  const runMenuAction = (action: MenuAction, at: { x: number; y: number }) => {
    if (action === "cut" || action === "copy") { writeSelection(action === "cut"); return; }
    if (action === "paste" || action === "paste-here") {
      void navigator.clipboard?.readText?.().then(
        (text) => { if (!applyPaste(text, action === "paste-here" ? at : undefined)) toast.error("Nothing on the clipboard for Canvas"); },
        () => toast.error("Canvas could not read the clipboard"),
      );
      return;
    }
    if (action === "duplicate") return duplicateSelected();
    if (action === "delete") return deleteSelected();
    if (action === "select-all") return setSelectedIds(board.nodes.filter((node) => !node.locked).map((node) => node.id));
    if (action === "zoom-to-fit") return fit();
    if (action === "edit-text") return setEditingId(selected === null || selected.locked ? null : selected.id);
    if (action === "add-comment") return setInspectorOpen(true);
    if (action === "group") return groupSelected();
    if (action === "ungroup") return ungroupSelected();
    if (action === "lock") return setSelectionLocked(true);
    if (action === "unlock") return setSelectionLocked(false);
    if (action === "tidy-up") return tidySelected();
    if (action === "distribute-horizontal") return distributeSelected("horizontal");
    if (action === "distribute-vertical") return distributeSelected("vertical");
    if (action === "bring-front") return reorderSelected("front");
    if (action === "bring-forward") return reorderSelected("forward");
    if (action === "send-backward") return reorderSelected("backward");
    if (action === "send-back") return reorderSelected("back");
    const edge = action.replace("align-", "") as AlignEdge;
    if (ALIGN_EDGES.some((item) => item.id === edge)) alignSelected(edge);
  };
  const alignSelected = (edge: AlignEdge) => {
    if (selectionBox === null || selectedNodes.length < 2) return;
    void persist(unlockedSelection.map((node) => ({ type: "update_node" as const, id: node.id, patch: alignedPosition(node, selectionBox, edge) })));
  };
  const fit = () => {
    if (board.nodes.length === 0 || surfaceRef.current === null) { setViewport({ x: 80, y: 64, zoom: 1 }); return; }
    const minX = Math.min(...board.nodes.map((node) => node.x));
    const minY = Math.min(...board.nodes.map((node) => node.y));
    const maxX = Math.max(...board.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...board.nodes.map((node) => node.y + node.height));
    const rect = surfaceRef.current.getBoundingClientRect();
    const zoom = Math.max(0.25, Math.min(1.5, Math.min((rect.width - 160) / (maxX - minX), (rect.height - 160) / (maxY - minY))));
    setViewport({ x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom, zoom });
  };

  fitRef.current = fit;

  return (
    <div className="canvas-stage">
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {selectionBox === null || marquee !== null ? null : (
        <SelectionToolbar
          nodes={selectedNodes}
          position={{
            left: (surfaceRef.current?.clientWidth ?? 800) < 500
              ? (surfaceRef.current?.clientWidth ?? 800) / 2
              : Math.max(185, Math.min((surfaceRef.current?.clientWidth ?? 800) - 185, viewport.x + (selectionBox.minX + selectionBox.maxX) / 2 * viewport.zoom)),
            top: Math.max(12, viewport.y + selectionBox.minY * viewport.zoom - 60),
          }}
          colorOpen={colorMenuOpen}
          onColorOpenChange={setColorMenuOpen}
          onApply={(patch) => void persist(unlockedSelection.map((node) => ({ type: "update_node" as const, id: node.id, patch })))}
          onComments={() => setInspectorOpen(true)}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onAlign={alignSelected}
          locked={allLocked}
          onLockChange={setSelectionLocked}
          grouped={grouped}
          mutable={mutable}
          onGroupChange={() => (grouped ? ungroupSelected() : groupSelected())}
          onTidy={tidySelected}
          onDistribute={distributeSelected}
        />
      )}
      {contextMenu === null ? null : (
        <CanvasContextMenu
          items={menuItemsFor({
            target: contextMenu.target,
            selectionCount: selectedNodes.length,
            locked: allLocked,
            grouped,
            canPaste,
          })}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onSelect={(action) => { const point = contextMenu.at; setContextMenu(null); runMenuAction(action, point); }}
          onClose={() => { setContextMenu(null); surfaceRef.current?.focus(); }}
        />
      )}
      {selectedEdge === null ? null : (
        <ConnectorToolbar
          edge={selectedEdge}
          position={connectorToolbarPosition}
          toolbarRef={connectorToolbarRef}
          onApply={(patch) => void persist([{ type: "update_edge", id: selectedEdge.id, patch }])}
          onDelete={() => { void persist([{ type: "remove_edges", ids: [selectedEdge.id] }]); setSelectedEdgeId(null); }}
          onEscape={() => surfaceRef.current?.focus()}
        />
      )}
      {shapeMenuOpen ? (
        <div className="canvas-shape-picker" role="toolbar" aria-label="Shape choices">
          {SHAPE_TOOLS.map((kind) => (
            <button
              key={kind}
              aria-label={SHAPE_LABELS[kind]}
              className={tool === kind ? "is-active" : ""}
              onClick={(event) => {
                lastShapeRef.current = kind;
                setTool(kind);
                setShapeMenuOpen(false);
                // detail 0 is a keyboard activation: there is no follow-up click to place with.
                if (event.detail !== 0) return;
                surfaceRef.current?.focus();
                placeObject(kind);
              }}
            >
              <ShapeGlyph kind={kind} />
              <span>{SHAPE_LABELS[kind]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools" data-placement="bottom">
        {DOCK_ITEMS.map((item) => (
          <ToolButton
            key={item.id}
            item={item}
            active={item.id === "shapes" ? isShapeKind(tool) || shapeMenuOpen : tool === item.id}
            onClick={(event) => {
              if (item.id === "shapes") {
                setShapeMenuOpen((open) => !open);
                if (!isShapeKind(tool)) setTool(lastShapeRef.current);
                return;
              }
              setShapeMenuOpen(false);
              setTool(item.id);
              if (event.detail !== 0) return;
              surfaceRef.current?.focus();
              if (item.id === "comment") placeComment();
              else if (isPlaceableKind(item.id)) placeObject(item.id);
            }}
          />
        ))}
      </div>
      <div
        ref={surfaceRef}
        className={`canvas-surface tool-${tool}`}
        data-testid="canvas-surface"
        role="application"
        aria-roledescription="canvas"
        aria-label={`Canvas board: ${board.title}`}
        tabIndex={0}
        aria-activedescendant={focused === null ? undefined : domId(focused)}
        aria-describedby={helpId}
        onKeyDown={onSurfaceKeyDown}
        onFocus={() => setSurfaceFocused(true)}
        onBlur={() => setSurfaceFocused(false)}
        onPointerDown={onSurfacePointerDown}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, at: canvasPoint(event.clientX, event.clientY), target: "canvas" });
        }}
      >
        <p id={helpId} className="sr-only">Tab and Shift+Tab move between objects. Enter edits. Escape releases the canvas.</p>
        <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {surfaceFocused && isCreationTool(tool) ? (
            <div className="canvas-caret" data-testid="placement-caret" aria-hidden="true" style={{ left: caretAt.x, top: caretAt.y }}>
              <span>{toolName(tool)}</span>
            </div>
          ) : null}
          <svg className="canvas-edges" width="10000" height="10000" role="listbox" aria-label="Connectors">
            <defs aria-hidden="true"><marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
            {board.edges.map((edge) => {
              const source = board.nodes.find((node) => node.id === edge.source);
              const target = board.nodes.find((node) => node.id === edge.target);
              if (source === undefined || target === undefined) return null;
              const path = connectorPath(source, target, edge.routing);
              const label = connectorLabelPoint(source, target, edge.routing);
              const select = (event: ReactPointerEvent<SVGElement>) => {
                event.stopPropagation();
                setSelectedEdgeId(edge.id);
                setSelectedIds([]);
                setEditingId(null);
                setFocused({ kind: "edge", id: edge.id });
              };
              return (
                <g
                  key={edge.id}
                  id={domId({ kind: "edge", id: edge.id })}
                  role="option"
                  aria-selected={edge.id === selectedEdgeId}
                  aria-roledescription="connector"
                  aria-label={connectorName(edge, source, target)}
                >
                  <path className="canvas-edge-hit" d={path} onPointerDown={select} />
                  <path
                    className={`canvas-edge ${edge.id === selectedEdgeId ? "is-selected" : ""} ${focused !== null && focused.kind === "edge" && focused.id === edge.id ? "is-focused" : ""}`}
                    d={path}
                    fill="none"
                    stroke={colorValue(edge.color)}
                    markerEnd={edge.arrow === "none" ? undefined : "url(#canvas-arrow)"}
                    markerStart={edge.arrow === "both" ? "url(#canvas-arrow)" : undefined}
                    onPointerDown={select}
                  />
                  {edge.label === "" ? null : <text x={label.x} y={label.y - 8}>{edge.label}</text>}
                </g>
              );
            })}
          </svg>
          {guides.length === 0 ? null : (
            <svg className="canvas-guides" width="10000" height="10000" aria-hidden="true">
              {guides.map((guide) => guide.axis === "x"
                ? <line key={`x${guide.at}`} x1={guide.at} y1={guide.from - 24} x2={guide.at} y2={guide.to + 24} />
                : <line key={`y${guide.at}`} x1={guide.from - 24} y1={guide.at} x2={guide.to + 24} y2={guide.at} />)}
            </svg>
          )}
          {selectionBox === null || selectedNodes.length < 2 ? null : (
            <div
              className="canvas-selection-box"
              aria-hidden="true"
              data-testid="selection-bounds"
              style={{ left: selectionBox.minX, top: selectionBox.minY, width: selectionBox.maxX - selectionBox.minX, height: selectionBox.maxY - selectionBox.minY }}
            />
          )}
          {marquee === null ? null : (
            <div
              className="canvas-marquee"
              aria-hidden="true"
              data-testid="selection-marquee"
              style={{ left: marquee.minX, top: marquee.minY, width: marquee.maxX - marquee.minX, height: marquee.maxY - marquee.minY }}
            />
          )}
          {board.comments.filter((comment) => comment.nodeId === null).map((comment) => (
            <CommentPin
              key={comment.id}
              comment={comment}
              open={pinnedComment === comment.id}
              onOpenChange={(open) => setPinnedComment(open ? comment.id : null)}
              onMessage={(message) => void persist([{ type: "update_comment", id: comment.id, message }])}
              onResolve={() => void persist([{ type: "resolve_comment", id: comment.id, resolved: !comment.resolved }])}
              onDelete={() => { void persist([{ type: "delete_comment", id: comment.id }]); setPinnedComment(null); }}
            />
          ))}
          <div className="canvas-objects" role="listbox" aria-multiselectable="true" aria-label="Board objects">
          {board.nodes.map((node) => (
            <DiagramNode
              key={node.id}
              node={node}
              selected={selectedIds.includes(node.id)}
              focused={focused !== null && focused.kind === "node" && focused.id === node.id}
              soloSelected={selectedIds.length === 1 && selectedIds[0] === node.id}
              editing={node.id === editingId}
              comments={board.comments.filter((comment) => comment.nodeId === node.id && !comment.resolved).length}
              zoom={viewport.zoom}
              connectorSource={node.id === connectorSource}
              onSelect={(additive) => selectNode(node, additive)}
              onContextMenu={(event) => {
                if (!selectionRef.current.includes(node.id)) selectNode(node, false);
                setContextMenu({ x: event.clientX, y: event.clientY, at: canvasPoint(event.clientX, event.clientY), target: "object" });
              }}
              onBeginEdit={() => setEditingId(node.id)}
              onEndEdit={onEndEdit}
              onBeginDrag={(event) => beginNodeDrag(event, node)}
              onTextCommit={(text) => void persist([{ type: "update_node", id: node.id, patch: { text } }])}
              onResize={(width, height) => void persist([{ type: "update_node", id: node.id, patch: { width, height } }])}
            />
          ))}
          </div>
        </div>
        {board.nodes.length === 0 ? <div className="canvas-empty"><span><Icon name="Workflow" className="size-6" /></span><strong>Map your first flow</strong><p>Add a sticky note or ask the Canvas chat to build a diagram.</p></div> : null}
        <div className="canvas-zoom-controls">
          <Button variant="outline" size="icon" className="size-8" aria-label="Zoom out" onClick={() => setViewport((value) => ({ ...value, zoom: Math.max(.2, value.zoom - .1) }))}><Icon name="ZoomOut" className="size-4" /></Button>
          <button onClick={fit} aria-label="Fit to content">{Math.round(viewport.zoom * 100)}%</button>
          <Button variant="outline" size="icon" className="size-8" aria-label="Zoom in" onClick={() => setViewport((value) => ({ ...value, zoom: Math.min(2.5, value.zoom + .1) }))}><Icon name="ZoomIn" className="size-4" /></Button>
        </div>
        <CanvasMinimap nodes={board.nodes} viewport={viewport} surface={surfaceSize} onNavigate={setViewport} />
        {findOpen ? (
          <CanvasFind
            nodes={board.nodes}
            onFocus={(node) => {
              setViewport(viewportCenteredOn({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, surfaceSize, viewport.zoom));
              setSelectedIds([node.id]);
              setSelectedEdgeId(null);
              setFindOpen(false);
            }}
            onClose={() => {
              setFindOpen(false);
              (findInvokerRef.current ?? surfaceRef.current)?.focus();
            }}
          />
        ) : null}
        <div className="canvas-history-controls">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Find on board"
            aria-keyshortcuts="Meta+F Control+F"
            onClick={(event) => { findInvokerRef.current = event.currentTarget; setFindOpen(true); }}
          ><Icon name="Search" className="size-4" /></Button>
          <Button variant="outline" size="icon" className="size-8" aria-label="Undo" disabled={undo.length === 0} onClick={() => { const target = undo.at(-1); if (target !== undefined) { setUndo((items) => items.slice(0, -1)); void restore(target, "undo"); } }}><Icon name="ArrowTurnBackward" className="size-4" /></Button>
          <Button variant="outline" size="icon" className="size-8" aria-label="Redo" disabled={redo.length === 0} onClick={() => { const target = redo.at(-1); if (target !== undefined) { setRedo((items) => items.slice(0, -1)); void restore(target, "redo"); } }}><Icon name="ArrowTurnForward" className="size-4" /></Button>
        </div>
      </div>
      {selected === null || !inspectorOpen ? null : <Inspector board={board} node={selected} onApply={(operations) => void persist(operations)} onClose={() => setInspectorOpen(false)} />}
    </div>
  );
}

function CanvasPage({ subPath }: { subPath: string }) {
  const { rpc, boards, error, refresh } = useBoardLibrary();
  const navigate = useBbNavigate();
  const [board, setBoard] = useState<BoardDocument | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const boardId = subPath.split("/")[0] || boards?.[0]?.id || null;

  useEffect(() => {
    if (subPath === "" && boards?.[0] !== undefined) navigate.toPluginPanel("board", { subPath: boards[0].id, replace: true });
  }, [boards, navigate, subPath]);
  useEffect(() => {
    if (boardId === null) return;
    rpc.call("board_get", { boardId }).then(({ board: next }) => { setBoard(next); setTitleDraft(next.title); }, (cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)));
  }, [boardId, rpc]);
  useRealtime("boards-changed", (payload) => {
    const signal = payload as { boardId?: string };
    if (signal.boardId === boardId && boardId !== null) rpc.call("board_get", { boardId }).then(({ board: next }) => setBoard(next), () => undefined);
  });

  const create = async () => {
    const result = await rpc.call("boards_create", { title: "Untitled board" });
    refresh();
    navigate.toPluginPanel("board", { subPath: result.board.id });
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined || board === null) return;
    try {
      const result = await rpc.call("board_import", { boardId: board.id, fileName: file.name, content: await readImportFile(file) });
      setBoard(result.board);
      toast.success(`Imported ${file.name}`);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : String(cause)); }
  };

  const saveTitle = async () => {
    if (board === null) return;
    const title = titleDraft.trim();
    if (title === "") { toast.error("Board title cannot be empty"); return; }
    try {
      const result = await rpc.call("board_apply_operations", { boardId: board.id, operations: [{ type: "rename_board", title }] });
      setBoard(result.board);
      setTitleDraft(result.board.title);
      setEditingTitle(false);
      refresh();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : String(cause)); }
  };

  if (boards === null) return <div className="canvas-loading">Loading Canvas…</div>;
  if (error !== null) return <div className="canvas-error" role="alert">{error}<Button onClick={refresh}>Try again</Button></div>;
  return (
    <div className="canvas-app-shell">
      <BoardLibrary boards={boards} activeId={boardId} onOpen={(id) => navigate.toPluginPanel("board", { subPath: id })} onCreate={() => void create()} />
      <main className="canvas-main">
        {board === null ? <div className="canvas-loading">Opening board…</div> : <>
          <header className="canvas-board-header">
            <div className="canvas-title-group">
              {editingTitle ? <>
                <Input
                  className="canvas-title-input"
                  value={titleDraft}
                  aria-label="Board title"
                  autoFocus
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveTitle();
                    if (event.key === "Escape") { setTitleDraft(board.title); setEditingTitle(false); }
                  }}
                />
                <Button variant="ghost" size="icon" className="size-8 title-confirm" aria-label="Save board title" onClick={() => void saveTitle()}><Icon name="Check" className="size-4" /></Button>
              </> : <>
                <strong className="canvas-title-label" title={board.title}>{board.title}</strong>
                <Button variant="ghost" size="icon" className="size-8 rename-board" aria-label="Rename board" onClick={() => { setTitleDraft(board.title); setEditingTitle(true); }}><Icon name="Edit" className="size-4" /></Button>
              </>}
            </div>
            <div className="canvas-header-actions">
              <input ref={importRef} type="file" accept=".canvas.json,.json,.svg,.png,.jpg,.jpeg,.fig,.jam" className="sr-only" onChange={(event) => void importFile(event)} />
              <Button variant="outline" size="sm" aria-label="Import board" onClick={() => importRef.current?.click()}><Icon name="FolderExport" className="size-4" /><span className="action-label">Import</span></Button>
              <div className="canvas-download-wrap">
                <Button variant="outline" size="sm" aria-label="Download or export board" onClick={() => setMenuOpen((open) => !open)}><Icon name="Download" className="size-4" /><span className="action-label">Export</span></Button>
                {menuOpen ? <div className="canvas-download-menu">
                  <button onClick={() => { downloadBlob(`${fileSafe(board.title)}.canvas.json`, "application/json", serializeBoardJson(board)); setMenuOpen(false); }}>Editable Canvas JSON<span>Best for reopening here</span></button>
                  <button onClick={() => { downloadBlob(`${fileSafe(board.title)}.svg`, "image/svg+xml", serializeBoardSvg(board)); setMenuOpen(false); }}>SVG<span>Scalable and shareable</span></button>
                  <button onClick={() => { void downloadPng(board).catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause))); setMenuOpen(false); }}>PNG<span>Easy visual sharing</span></button>
                </div> : null}
              </div>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Delete board" onClick={async () => {
                if (!window.confirm(`Delete “${board.title}”?`)) return;
                await rpc.call("board_delete", { boardId: board.id }); refresh();
                const next = boards.find((item) => item.id !== board.id); navigate.toPluginPanel("board", { subPath: next?.id ?? "", replace: true });
              }}><Icon name="Trash2" className="size-4" /></Button>
            </div>
          </header>
          <BoardWorkspace key={board.id} board={board} onBoardChange={setBoard} />
        </>}
      </main>
    </div>
  );
}

function CanvasChat({ subPath }: { subPath: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [board, setBoard] = useState<BoardDocument | null>(null);
  const boardId = subPath.split("/")[0];
  useEffect(() => {
    if (boardId === "") return;
    rpc.call("board_get", { boardId }).then(({ board: next }) => setBoard(next), () => setBoard(null));
  }, [boardId, rpc]);
  if (boardId === "" || board === null) return <div className="canvas-chat-empty">Open a board to start diagramming with AI.</div>;
  if (board.chatThreadId === null) return <div className="canvas-chat-empty"><Icon name="Bot" className="size-6" /><strong>AI diagram partner</strong><p>Chat could not be provisioned for this board.</p><Button onClick={() => void rpc.call("board_start_chat", { boardId }).then(({ threadId }) => setBoard({ ...board, chatThreadId: threadId }))}>Start chat</Button></div>;
  return (
    <ThreadChat
      threadId={board.chatThreadId}
      variant="compact"
      layout="contained"
      permissionPolicy="inherit"
      leadingContent={<div className="canvas-chat-leading"><Icon name="Workflow" className="size-4" /><span><strong>AI diagram partner</strong> for {board.title}. Describe a workflow or architecture and I’ll build it on the canvas.</span></div>}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "canvas",
    title: "Canvas",
    icon: "Workflow",
    path: "board",
    component: CanvasPage,
    fixedTabs: [
      {
        panelId: "canvas",
        id: "chat",
        title: "Chat",
        icon: "SideChat",
        component: CanvasChat,
        layout: "flush",
      },
    ],
  });
});
