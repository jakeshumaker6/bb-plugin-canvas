import type { JSX, PointerEvent as ReactPointerEvent } from "react";
import type { BoardNode } from "../src/domain";
import {
  MINIMAP_FRAME,
  contentBounds,
  minimapTransform,
  viewportCenteredOn,
  viewportRectOnMinimap,
  type Viewport,
} from "../src/navigation";

/** Mirrors the workspace palette; unknown ids fall back to grey, hex passes through. */
const SWATCHES: Record<string, string> = {
  yellow: "#fde68a",
  coral: "#fda4af",
  blue: "#93c5fd",
  green: "#86efac",
  purple: "#c4b5fd",
  gray: "#d1d5db",
  white: "#ffffff",
};

function swatch(color: string): string {
  return SWATCHES[color] ?? (/^#[0-9a-f]{3,8}$/i.test(color) ? color : "#d1d5db");
}

/**
 * Bird's-eye view of the board. Sits in the bottom-right of `.canvas-surface`,
 * stacked *above* the undo/redo cluster (`.canvas-history-controls`, bottom 14px)
 * so neither the zoom controls (bottom-left) nor history buttons are covered.
 * Click or drag anywhere inside it to recentre the board at the current zoom.
 */
export function CanvasMinimap({
  nodes,
  viewport,
  surface,
  onNavigate,
}: {
  nodes: readonly BoardNode[];
  viewport: Viewport;
  surface: { width: number; height: number };
  onNavigate: (viewport: Viewport) => void;
}): JSX.Element | null {
  if (nodes.length === 0) return null;

  const bounds = contentBounds(nodes);
  const transform = minimapTransform(bounds, MINIMAP_FRAME);
  const rect = viewportRectOnMinimap(viewport, surface, transform);

  const navigate = (event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - box.left;
    const localY = event.clientY - box.top;
    onNavigate(
      viewportCenteredOn(
        { x: (localX - transform.offsetX) / transform.scale, y: (localY - transform.offsetY) / transform.scale },
        surface,
        viewport.zoom,
      ),
    );
  };

  return (
    <div className="canvas-minimap" data-testid="canvas-minimap">
      <button
        type="button"
        className="canvas-minimap-frame"
        data-testid="minimap-frame"
        aria-label="Board minimap: click or drag to move the view"
        style={{ width: MINIMAP_FRAME.width, height: MINIMAP_FRAME.height }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const target = event.currentTarget;
          if (typeof target.setPointerCapture === "function") {
            try {
              target.setPointerCapture(event.pointerId);
            } catch {
              // Pointer capture is a nicety; dragging still works without it.
            }
          }
          navigate(event);
        }}
        onPointerMove={(event) => {
          if ((event.buttons & 1) === 0) return;
          navigate(event);
        }}
      >
        {nodes.map((node) => (
          <span
            key={node.id}
            className="canvas-minimap-node"
            data-testid="minimap-node"
            style={{
              left: node.x * transform.scale + transform.offsetX,
              top: node.y * transform.scale + transform.offsetY,
              width: Math.max(node.width * transform.scale, 2),
              height: Math.max(node.height * transform.scale, 2),
              background: swatch(node.color),
              borderRadius: node.kind === "ellipse" ? "999px" : "1px",
            }}
          />
        ))}
        <span
          className="canvas-minimap-viewport"
          data-testid="minimap-viewport"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      </button>
    </div>
  );
}
