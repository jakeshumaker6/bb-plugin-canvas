// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BoardNode } from "../src/domain";
import { CanvasFind } from "../components/canvas-find";
import { CanvasMinimap } from "../components/canvas-minimap";
import {
  contentBounds,
  matchNodes,
  minimapTransform,
  viewportCenteredOn,
  viewportRectOnMinimap,
} from "../src/navigation";

function node(partial: Partial<BoardNode> & { id: string }): BoardNode {
  return {
    kind: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    text: "",
    color: "blue",
    fontFamily: "inter",
    fontSize: 16,
    fontWeight: 600,
    textAlign: "center",
    locked: false,
    groupId: null,
    ...partial,
  };
}

const surface = { width: 800, height: 600 };
const frame = { width: 180, height: 120 };

describe("navigation maths", () => {
  it("wraps a known node set in padded bounds", () => {
    const bounds = contentBounds([
      node({ id: "a", x: 100, y: 100, width: 200, height: 100 }),
      node({ id: "b", x: 600, y: 400, width: 200, height: 100 }),
    ]);
    expect(bounds.minX).toBeLessThan(100);
    expect(bounds.minY).toBeLessThan(100);
    expect(bounds.maxX).toBeGreaterThan(800);
    expect(bounds.maxY).toBeGreaterThan(500);
  });

  it("returns a finite, non-degenerate box for an empty board", () => {
    const bounds = contentBounds([]);
    for (const value of Object.values(bounds)) expect(Number.isFinite(value)).toBe(true);
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(0);
    const transform = minimapTransform(bounds, frame);
    expect(Number.isFinite(transform.scale)).toBe(true);
    expect(transform.scale).toBeGreaterThan(0);
  });

  it("uses the supplied fallback box when the board is empty", () => {
    const bounds = contentBounds([], { minX: 0, minY: 0, maxX: 1000, maxY: 800 });
    expect(bounds.minX).toBeLessThanOrEqual(0);
    expect(bounds.maxX).toBeGreaterThanOrEqual(1000);
  });

  it("fits a very wide board inside the minimap frame", () => {
    const bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 500 };
    const transform = minimapTransform(bounds, frame);
    expect(transform.scale).toBeCloseTo(180 / 4000, 6);
    expect(transform.offsetX).toBeCloseTo(0, 6);
    // Vertically centred inside the frame.
    expect(transform.offsetY).toBeCloseTo((120 - 500 * transform.scale) / 2, 6);
    const right = 4000 * transform.scale + transform.offsetX;
    expect(right).toBeLessThanOrEqual(frame.width + 0.001);
  });

  it("shrinks the viewport rect as zoom increases", () => {
    const transform = minimapTransform({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 }, frame);
    const wide = viewportRectOnMinimap({ x: 0, y: 0, zoom: 0.5 }, surface, transform);
    const tight = viewportRectOnMinimap({ x: 0, y: 0, zoom: 2 }, surface, transform);
    expect(tight.width).toBeLessThan(wide.width);
    expect(tight.height).toBeLessThan(wide.height);
    expect(wide.width / tight.width).toBeCloseTo(4, 6);
  });

  it("centres a known board point in the surface", () => {
    const viewport = viewportCenteredOn({ x: 1000, y: 500 }, surface, 0.5);
    expect(viewport.zoom).toBe(0.5);
    expect(viewport.x + 1000 * viewport.zoom).toBeCloseTo(surface.width / 2, 6);
    expect(viewport.y + 500 * viewport.zoom).toBeCloseTo(surface.height / 2, 6);
  });

  it("returns nothing for a blank query", () => {
    expect(matchNodes([node({ id: "a", text: "Payment" })], "   ")).toEqual([]);
  });

  it("ranks prefix matches ahead of mid-string matches", () => {
    const results = matchNodes(
      [
        node({ id: "mid", text: "Retry payment step" }),
        node({ id: "prefix", text: "Payment gateway" }),
      ],
      "pay",
    );
    expect(results.map((item) => item.id)).toEqual(["prefix", "mid"]);
  });

  it("matches case-insensitively, tolerates whitespace, and searches the node kind", () => {
    const nodes = [node({ id: "s", kind: "sticky", text: "Kick off" }), node({ id: "r", text: "Review" })];
    expect(matchNodes(nodes, "  STICKY ").map((item) => item.id)).toEqual(["s"]);
    expect(matchNodes(nodes, "kick   off").map((item) => item.id)).toEqual(["s"]);
  });
});

describe("CanvasMinimap", () => {
  const nodes = [
    node({ id: "a", x: 100, y: 100, color: "yellow" }),
    node({ id: "b", x: 900, y: 600, color: "blue" }),
  ];

  it("renders nothing for an empty board", () => {
    const { container } = render(<CanvasMinimap nodes={[]} viewport={{ x: 0, y: 0, zoom: 1 }} surface={surface} onNavigate={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("draws one rect per node plus the viewport rect", () => {
    render(<CanvasMinimap nodes={nodes} viewport={{ x: 0, y: 0, zoom: 1 }} surface={surface} onNavigate={() => undefined} />);
    expect(screen.getAllByTestId("minimap-node")).toHaveLength(2);
    expect(screen.getByTestId("minimap-viewport")).toBeTruthy();
  });

  it("recentres the board on the clicked point", () => {
    const onNavigate = vi.fn();
    render(<CanvasMinimap nodes={nodes} viewport={{ x: 12, y: 34, zoom: 0.5 }} surface={surface} onNavigate={onNavigate} />);
    const map = screen.getByTestId("minimap-frame");
    fireEvent.pointerDown(map, { clientX: 90, clientY: 60, button: 0, buttons: 1 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const bounds = contentBounds(nodes);
    const centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    expect(onNavigate.mock.calls[0]![0]).toEqual(viewportCenteredOn(centre, surface, 0.5));
  });

  it("keeps recentring while dragging with the button held", () => {
    const onNavigate = vi.fn();
    render(<CanvasMinimap nodes={nodes} viewport={{ x: 0, y: 0, zoom: 1 }} surface={surface} onNavigate={onNavigate} />);
    const map = screen.getByTestId("minimap-frame");
    fireEvent.pointerDown(map, { clientX: 40, clientY: 40, button: 0, buttons: 1 });
    fireEvent.pointerMove(map, { clientX: 120, clientY: 80, buttons: 1 });
    fireEvent.pointerMove(map, { clientX: 130, clientY: 90, buttons: 0 });
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});

describe("CanvasFind", () => {
  const nodes = [
    node({ id: "pay", text: "Payment gateway" }),
    node({ id: "retry", text: "Retry payment step" }),
    node({ id: "ship", kind: "sticky", text: "Shipping" }),
  ];

  function open(onFocus = vi.fn(), onClose = vi.fn()) {
    cleanup();
    render(<CanvasFind nodes={nodes} onFocus={onFocus} onClose={onClose} />);
    const input = screen.getByLabelText("Find on board");
    return { input, onFocus, onClose };
  }

  it("autofocuses the input and filters as you type", () => {
    const { input } = open();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "pay" } });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Payment gateway"),
      expect.stringContaining("Retry payment step"),
    ]);
    expect(screen.getByRole("status").textContent).toContain("2");
  });

  it("shows a no-matches state", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText(/no matches/i)).toBeTruthy();
  });

  it("moves the highlight with the arrow keys and focuses on Enter", () => {
    const { input, onFocus } = open();
    fireEvent.change(input, { target: { value: "pay" } });
    const first = () => within(screen.getByRole("listbox")).getAllByRole("option");
    expect(first()[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(first()[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(first()[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus.mock.calls[0]![0].id).toBe("retry");
  });

  it("closes on Escape", () => {
    const { input, onClose } = open();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const navCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/navigation.css"), "utf8");

/** Body of the first rule for `selector`, so a test can read declared values. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

function pxValue(block: string, property: string): number {
  const match = new RegExp(`${property}:\\s*([\\d.]+)px`).exec(block);
  return match === null ? 0 : Number(match[1]);
}

describe("CanvasFind focus management", () => {
  const findNodes = [node({ id: "pay", text: "Payment gateway" })];

  afterEach(() => {
    for (const stray of Array.from(document.querySelectorAll("body > button, body > textarea"))) stray.remove();
  });

  function opener(): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = "Find";
    document.body.append(button);
    button.focus();
    return button;
  }

  function openFind() {
    return render(<CanvasFind nodes={findNodes} onFocus={vi.fn()} onClose={vi.fn()} />);
  }

  it("restores focus to the control that opened it when it closes", () => {
    const trigger = opener();
    const view = openFind();
    expect(document.activeElement).toBe(screen.getByLabelText("Find on board"));
    view.unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves focus alone when closing already handed it to the board", () => {
    opener();
    const elsewhere = document.createElement("textarea");
    document.body.append(elsewhere);
    const view = openFind();
    elsewhere.focus();
    view.unmount();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("declares itself a modal dialog", () => {
    openFind();
    expect(screen.getByRole("dialog", { name: "Find objects" }).getAttribute("aria-modal")).toBe("true");
  });

  it("keeps Tab inside the palette, in both directions", () => {
    const trigger = opener();
    openFind();
    const input = screen.getByLabelText("Find on board");
    const close = screen.getByRole("button", { name: "Close find" });

    fireEvent.keyDown(input, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("gives Close find a 24px minimum touch target", () => {
    const block = ruleBody(navCss, ".canvas-find-close");
    expect(pxValue(block, "min-height")).toBeGreaterThanOrEqual(24);
    expect(pxValue(block, "min-width")).toBeGreaterThanOrEqual(24);
  });
});
