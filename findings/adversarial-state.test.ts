// @vitest-environment jsdom
//
// Adversarial pass: UI state, gesture races, and leaks.
//
// Every test here names the behaviour a FigJam-like canvas owes the user when a
// gesture is interrupted, when two overlays fight over a key, or when the board
// changes underneath a pointer that is still down. Tests that fail describe
// defects in app.tsx; they are detection only and fix nothing.
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { loadPluginApp, renderSlot, type RenderedSlot, type RpcCall } from "@get-bb/plugin-sdk/testing/app";
import type { BoardDocument, BoardNode, BoardOperation, BoardSummary } from "../src/domain";

function makeNode(over: Partial<BoardNode> & { id: string }): BoardNode {
  return {
    kind: "sticky",
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    text: "",
    color: "yellow",
    fontFamily: "inter",
    fontSize: 17,
    fontWeight: 500,
    textAlign: "left",
    locked: false,
    groupId: null,
    ...over,
  };
}

function makeBoard(id: string, title: string, nodes: BoardNode[]): BoardDocument {
  return {
    id,
    title,
    projectId: "proj_personal",
    chatThreadId: null,
    version: 1,
    createdAt: "now",
    updatedAt: "now",
    schemaVersion: 1,
    nodes,
    edges: [],
    comments: [],
  };
}

function summaryOf(board: BoardDocument): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    projectId: board.projectId,
    chatThreadId: board.chatThreadId,
    version: board.version,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

/**
 * A mutable board store so a test can change the board underneath a live
 * gesture — the realtime refresh an AI agent or a second window would cause.
 * `board_apply_operations` honours `remove_nodes` so a delete really removes.
 */
function makeStore(...boards: BoardDocument[]) {
  const state = new Map(boards.map((board) => [board.id, board]));
  const rpc = {
    boards_list: () => ({ boards: [...state.values()].map(summaryOf) }),
    board_get: ({ boardId }: { boardId: string }) => ({ board: state.get(boardId)! }),
    boards_create: () => ({ board: [...state.values()][0]! }),
    board_apply_operations: ({ boardId, operations }: { boardId: string; operations: BoardOperation[] }) => {
      const current = state.get(boardId)!;
      let next = current;
      for (const operation of operations) {
        if (operation.type === "remove_nodes") {
          next = { ...next, nodes: next.nodes.filter((node) => !operation.ids.includes(node.id)) };
        }
      }
      state.set(boardId, next);
      return { board: next };
    },
    board_import: ({ boardId }: { boardId: string }) => ({ board: state.get(boardId)! }),
    board_delete: () => ({ deleted: true }),
    board_start_chat: () => ({ threadId: "thr_1" }),
  };
  return { state, rpc };
}

async function openBoard(store: ReturnType<typeof makeStore>, subPath = "board-1") {
  const app = await loadPluginApp(() => import("../app"));
  const panel = app.navPanels[0]!;
  const view = renderSlot(panel, { subPath }, { rpc: store.rpc as never });
  await waitFor(() => expect(view.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy());
  return { view, component: panel.component as ComponentType<{ subPath: string }> };
}

function applies(calls: readonly RpcCall[]): BoardOperation[][] {
  return calls
    .filter((call) => call.method === "board_apply_operations")
    .map((call) => (call.input as { operations: BoardOperation[] }).operations);
}

function nodeElement(view: RenderedSlot, id: string): HTMLElement {
  const element = view.container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (element === null) throw new Error(`node ${id} is not on the board`);
  return element;
}

/** Viewport translate/scale read back off the rendered world transform. */
function worldViewport(view: RenderedSlot): { x: number; y: number; zoom: number } {
  const world = view.container.querySelector<HTMLElement>(".canvas-world");
  if (world === null) throw new Error("canvas world is not rendered");
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world.style.transform);
  if (match === null) throw new Error(`unreadable transform: ${world.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

/**
 * Counts window pointer listeners so a gesture interrupted by unmount can be
 * proven to leave its handlers behind.
 */
function trackWindowPointerListeners() {
  const balance: Record<string, number> = { pointermove: 0, pointerup: 0, pointercancel: 0 };
  const realAdd = window.addEventListener;
  const realRemove = window.removeEventListener;
  window.addEventListener = function patchedAdd(this: Window, type: string, ...rest: unknown[]) {
    if (type in balance) balance[type] = (balance[type] ?? 0) + 1;
    return (realAdd as (...args: unknown[]) => void).call(window, type, ...rest);
  } as typeof window.addEventListener;
  window.removeEventListener = function patchedRemove(this: Window, type: string, ...rest: unknown[]) {
    if (type in balance) balance[type] = (balance[type] ?? 0) - 1;
    return (realRemove as (...args: unknown[]) => void).call(window, type, ...rest);
  } as typeof window.removeEventListener;
  return {
    balance,
    restore() {
      window.addEventListener = realAdd;
      window.removeEventListener = realRemove;
    },
  };
}

const solo = makeNode({ id: "n1", x: 100, y: 100, text: "Alpha" });

describe("interrupted gestures leave the canvas haunted", () => {
  it("removes its window pointer listeners when the panel unmounts mid node-drag", async () => {
    const tracker = trackWindowPointerListeners();
    try {
      const store = makeStore(makeBoard("board-1", "B1", [solo]));
      const { view } = await openBoard(store);
      fireEvent.pointerDown(nodeElement(view, "n1"), { button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
      // The user closes the tab / navigates away without ever letting go.
      view.lifecycle.unmount();
      // Expected: a drag registered on window is torn down with the component.
      expect(tracker.balance.pointermove).toBe(0);
      expect(tracker.balance.pointerup).toBe(0);
    } finally {
      tracker.restore();
    }
  });

  it("removes its window pointer listeners when the panel unmounts mid marquee", async () => {
    const tracker = trackWindowPointerListeners();
    try {
      const store = makeStore(makeBoard("board-1", "B1", [solo]));
      const { view } = await openBoard(store);
      fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(window, { clientX: 400, clientY: 400 });
      expect(view.queryByTestId("selection-marquee")).not.toBeNull();
      view.lifecycle.unmount();
      // Expected: no marquee handler survives the component that owns it.
      expect(tracker.balance.pointermove).toBe(0);
      expect(tracker.balance.pointerup).toBe(0);
    } finally {
      tracker.restore();
    }
  });

  it("ends a drag when the pointer gesture is cancelled by the OS", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    fireEvent.pointerDown(nodeElement(view, "n1"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    expect(nodeElement(view, "n1").style.left).toBe("150px");

    fireEvent.pointerCancel(window, { clientX: 50, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 0 });
    // Expected: a cancelled gesture stops moving the object.
    expect(nodeElement(view, "n1").style.left).toBe("150px");
  });

  it("cancels the drag when Escape is pressed before the pointer is released", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    fireEvent.pointerDown(nodeElement(view, "n1"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 0 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 0 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const moves = applies(view.rpcCalls).flat().filter((operation) => operation.type === "update_node");
    // Expected: Escape aborts the drag, so nothing is written and the object snaps back.
    expect(moves).toEqual([]);
    expect(nodeElement(view, "n1").style.left).toBe("100px");
  });

  it("does not leave the marquee on screen after Escape", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500 });
    expect(view.queryByTestId("selection-marquee")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    // Expected: Escape abandons the in-flight marquee, not just the selection.
    expect(view.queryByTestId("selection-marquee")).toBeNull();
  });

  it("does not move an object it deleted mid-drag with the Delete key", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    fireEvent.pointerDown(nodeElement(view, "n1"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 0 });
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(applies(view.rpcCalls).flat().some((op) => op.type === "remove_nodes")).toBe(true));

    fireEvent.pointerUp(window, { clientX: 60, clientY: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const batches = applies(view.rpcCalls);
    const removedAt = batches.findIndex((batch) => batch.some((op) => op.type === "remove_nodes"));
    const after = batches.slice(removedAt + 1).flat();
    // Expected: releasing the pointer over a deleted object writes nothing.
    expect(after).toEqual([]);
  });

  it("does not move an object a realtime refresh deleted mid-drag", async () => {
    const board = makeBoard("board-1", "B1", [solo, makeNode({ id: "n2", x: 600, y: 600 })]);
    const store = makeStore(board);
    const { view } = await openBoard(store);
    fireEvent.pointerDown(nodeElement(view, "n1"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 0 });

    // The board chat agent removes the object the user is holding.
    store.state.set("board-1", { ...board, nodes: board.nodes.filter((item) => item.id !== "n1") });
    await view.behavior.emitRealtime("boards-changed", { boardId: "board-1" });
    await waitFor(() => expect(view.container.querySelector('[data-node-id="n1"]')).toBeNull());

    fireEvent.pointerUp(window, { clientX: 60, clientY: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const written = applies(view.rpcCalls).flat();
    // Expected: no operation targets an id that is no longer on the board.
    expect(written.filter((op) => op.type === "update_node" && op.id === "n1")).toEqual([]);
  });
});

describe("stale closures captured by live gestures", () => {
  it("uses the live zoom when the user zooms mid-drag", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    fireEvent.pointerDown(nodeElement(view, "n1"), { button: 0, clientX: 0, clientY: 0 });

    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(worldViewport(view).zoom).toBeGreaterThan(1.19));

    fireEvent.pointerMove(window, { clientX: 120, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 0 });
    await waitFor(() => expect(applies(view.rpcCalls).flat().length).toBeGreaterThan(0));

    const move = applies(view.rpcCalls).flat().find((op) => op.type === "update_node");
    // 120 screen px at 1.2x is 100 board px, so the object lands at x = 200.
    expect(move).toEqual({ type: "update_node", id: "n1", patch: { x: 200, y: 100 } });
  });

  it("keeps the marquee under the cursor when the board is panned mid-marquee", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    const surface = view.getByTestId("canvas-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    expect(view.queryByTestId("selection-marquee")).not.toBeNull();

    // Two-finger pan while the marquee is still open.
    fireEvent.wheel(surface, { deltaX: -200, deltaY: 0 });
    await waitFor(() => expect(worldViewport(view).x).toBe(280));
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });

    const marquee = view.getByTestId("selection-marquee");
    const viewport = worldViewport(view);
    const screenRight = viewport.x + Number.parseFloat(marquee.style.left) + Number.parseFloat(marquee.style.width);
    // Expected: the corner the user is dragging stays under the cursor at 400.
    expect(Math.abs(screenRight - 400)).toBeLessThanOrEqual(1);
  });
});

describe("overlays fight over the same keys", () => {
  it("does not nudge the selected object while arrowing through the context menu", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    fireEvent.contextMenu(nodeElement(view, "n1"), { clientX: 220, clientY: 180 });
    const menu = await waitFor(() => view.getByTestId("canvas-context-menu"));
    expect(menu).toBeTruthy();

    const focused = document.activeElement ?? menu;
    fireEvent.keyDown(focused, { key: "ArrowDown" });
    fireEvent.keyDown(focused, { key: "ArrowDown" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Expected: menu navigation is consumed by the menu, not also by the board.
    expect(applies(view.rpcCalls).flat()).toEqual([]);
  });

  it("closes the context menu when the find palette takes over", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    fireEvent.contextMenu(nodeElement(view, "n1"), { clientX: 220, clientY: 180 });
    await waitFor(() => expect(view.getByTestId("canvas-context-menu")).toBeTruthy());

    fireEvent.keyDown(document.activeElement ?? window, { key: "f", metaKey: true });
    await waitFor(() => expect(view.getByRole("dialog", { name: "Find objects" })).toBeTruthy());
    // Expected: only one overlay owns the keyboard at a time.
    expect(view.queryByTestId("canvas-context-menu")).toBeNull();
  });

  it("closes the context menu when the board is switched underneath it", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]), makeBoard("board-2", "B2", []));
    const { view, component } = await openBoard(store);
    fireEvent.contextMenu(nodeElement(view, "n1"), { clientX: 220, clientY: 180 });
    await waitFor(() => expect(view.getByTestId("canvas-context-menu")).toBeTruthy());

    view.lifecycle.rerender(createElement(component, { subPath: "board-2" }));
    await waitFor(() => expect(view.container.querySelector('[data-node-id="n1"]')).toBeNull());
    // Expected: an overlay anchored to the previous board does not survive it.
    expect(view.queryByTestId("canvas-context-menu")).toBeNull();
  });
});

describe("state that outlives the board it belongs to", () => {
  it("does not replay one board's undo history onto another board", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]), makeBoard("board-2", "B2", [makeNode({ id: "m1", text: "Beta" })]));
    const { view, component } = await openBoard(store);

    // Edit board 1 so it has undo history.
    fireEvent.click(view.getByRole("button", { name: "Sticky note" }));
    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 300, clientY: 200 });
    await waitFor(() => expect(view.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false));

    view.lifecycle.rerender(createElement(component, { subPath: "board-2" }));
    await waitFor(() => expect(view.container.querySelector('[data-node-id="m1"]')).not.toBeNull());

    const undo = view.getByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const imports = view.rpcCalls.filter((call) => call.method === "board_import");
    // Expected: undo never imports board 1's document over board 2 — that is
    // silent data loss on a board the user has not even edited yet.
    for (const call of imports) {
      const input = call.input as { boardId: string; content: string };
      const restored = JSON.parse(input.content) as { id: string; title: string };
      expect({ into: input.boardId, restoredId: restored.id, restoredTitle: restored.title })
        .toEqual({ into: "board-2", restoredId: "board-2", restoredTitle: "B2" });
    }
    // Expected: history is per board, so board 2 opens with nothing to undo.
    expect(undo.hasAttribute("disabled")).toBe(true);
  });

  it("does not put a returning object back into text-edit mode", async () => {
    const board = makeBoard("board-1", "B1", [solo]);
    const store = makeStore(board);
    const { view } = await openBoard(store);
    fireEvent.doubleClick(nodeElement(view, "n1"));
    await waitFor(() => expect(nodeElement(view, "n1").querySelector("textarea")!.readOnly).toBe(false));

    // The object is deleted remotely, then comes back (undo, or a second window).
    store.state.set("board-1", { ...board, nodes: [] });
    await view.behavior.emitRealtime("boards-changed", { boardId: "board-1" });
    await waitFor(() => expect(view.container.querySelector('[data-node-id="n1"]')).toBeNull());
    store.state.set("board-1", board);
    await view.behavior.emitRealtime("boards-changed", { boardId: "board-1" });
    await waitFor(() => expect(view.container.querySelector('[data-node-id="n1"]')).not.toBeNull());

    // Expected: editing ended when the object left; it must not silently steal focus back.
    expect(nodeElement(view, "n1").querySelector("textarea")!.readOnly).toBe(true);
  });
});

describe("wheel and zoom arithmetic", () => {
  it("ignores a pinch frame that reports no delta", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    expect(worldViewport(view).zoom).toBe(1);
    fireEvent.wheel(view.getByTestId("canvas-surface"), { ctrlKey: true, deltaX: 0, deltaY: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Expected: a zero-delta pinch frame is a no-op, not a zoom in.
    expect(worldViewport(view).zoom).toBe(1);
  });

  it("keeps the board point under the cursor across repeated zooms and at the clamp", async () => {
    const store = makeStore(makeBoard("board-1", "B1", [solo]));
    const { view } = await openBoard(store);
    const surface = view.getByTestId("canvas-surface");
    const anchorAt = () => {
      const viewport = worldViewport(view);
      return { x: (400 - viewport.x) / viewport.zoom, y: (300 - viewport.y) / viewport.zoom };
    };
    const start = anchorAt();
    for (let index = 0; index < 25; index += 1) {
      fireEvent.wheel(surface, { ctrlKey: true, clientX: 400, clientY: 300, deltaY: -1 });
    }
    await waitFor(() => expect(worldViewport(view).zoom).toBe(2.5));
    const end = anchorAt();
    expect(Math.abs(end.x - start.x)).toBeLessThan(0.5);
    expect(Math.abs(end.y - start.y)).toBeLessThan(0.5);
  });
});
