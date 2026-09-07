// @vitest-environment jsdom
/**
 * ADVERSARIAL PASS — lens: FUNCTIONAL ABUSE AND DEAD CONTROLS.
 *
 * Every test is named with one of two prefixes:
 *   FAILS  — asserts the behaviour a FigJam user would expect. It fails today.
 *            The failure IS the finding.
 *   PASSES — documents surprising-but-current behaviour so a future change to
 *            it is visible in the diff.
 *
 * Nothing here modifies app.tsx, src/*, server.ts, or any existing test.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RpcCall } from "@get-bb/plugin-sdk/testing/app";
import type { BoardDocument, BoardNode, BoardSummary } from "../src/domain";

const summary: BoardSummary = {
  id: "board-1",
  title: "Customer workflow",
  projectId: "proj_personal",
  chatThreadId: "thr_canvas_1",
  version: 0,
  createdAt: "now",
  updatedAt: "now",
};

const emptyBoard: BoardDocument = {
  ...summary,
  schemaVersion: 1,
  nodes: [],
  edges: [],
  comments: [],
};

function node(id: string, over: Partial<BoardNode> = {}): BoardNode {
  return {
    id,
    kind: "sticky",
    x: 120,
    y: 100,
    width: 220,
    height: 160,
    text: `Note ${id}`,
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

function boardWith(...nodes: BoardNode[]): BoardDocument {
  return { ...emptyBoard, nodes };
}

function rpcFor(activeBoard: BoardDocument = emptyBoard) {
  return {
    boards_list: () => ({ boards: [summary] }),
    board_get: () => ({ board: activeBoard }),
    boards_create: () => ({ board: activeBoard }),
    board_apply_operations: () => ({ board: activeBoard }),
    board_import: () => ({ board: activeBoard }),
    board_delete: () => ({ deleted: true }),
    board_start_chat: () => ({ threadId: "thr_canvas_1" }),
  };
}

/** Every `board_apply_operations` call so far — i.e. everything the app actually did. */
function applies(calls: readonly RpcCall[]) {
  return calls.filter((call) => call.method === "board_apply_operations");
}

async function openBoard(activeBoard: BoardDocument) {
  const app = await loadPluginApp(() => import("../app"));
  const view = renderSlot(app.navPanels[0]!, { subPath: "board-1" }, { rpc: rpcFor(activeBoard) });
  await waitFor(() => expect(view.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy());
  return view;
}

function dockButton(view: Awaited<ReturnType<typeof openBoard>>, name: string) {
  return within(view.getByRole("toolbar", { name: "Canvas tools" })).getByRole("button", { name });
}

function nodeElement(view: Awaited<ReturnType<typeof openBoard>>, id: string): HTMLElement {
  const element = view.container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (element === null) throw new Error(`no node element for ${id}`);
  return element;
}

/** Right-clicks a node and returns its context menu. */
function openObjectMenu(view: Awaited<ReturnType<typeof openBoard>>, id: string) {
  fireEvent.contextMenu(nodeElement(view, id), { clientX: 300, clientY: 300 });
  return view.getByTestId("canvas-context-menu");
}

function menuItem(menu: HTMLElement, action: string): HTMLElement {
  const item = menu.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (item === null) throw new Error(`no menu item ${action}`);
  return item;
}

/** Lets the microtask queue drain so any pending `persist` would have landed. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("dead controls: the Comment tool", () => {
  it("FAILS: the Comment tool on an empty canvas produces no comment and no feedback", async () => {
    const view = await openBoard(emptyBoard);

    fireEvent.click(dockButton(view, "Comment"));
    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 320, clientY: 240 });
    await settle();

    // Expected (FigJam): clicking the canvas with the comment tool drops a comment pin,
    // or at minimum says "select an object to comment on". Today: absolutely nothing.
    expect(applies(view.rpcCalls).length).toBeGreaterThan(0);
  });

  it("PASSES (documents surprising behaviour): the canvas shows a crosshair for Comment and Connector, promising a click target that does not exist", async () => {
    const view = await openBoard(emptyBoard);
    const surface = view.getByTestId("canvas-surface");

    fireEvent.click(dockButton(view, "Comment"));
    // `.tool-comment` is styled `cursor: crosshair` in app.css — the strongest possible
    // "click here to place something" affordance...
    expect(surface.className).toContain("tool-comment");
    fireEvent.pointerDown(surface, { button: 0, clientX: 300, clientY: 300 });
    await settle();
    expect(applies(view.rpcCalls)).toHaveLength(0); // ...and the click places nothing.

    fireEvent.click(dockButton(view, "Connector"));
    expect(surface.className).toContain("tool-connector");
    fireEvent.pointerDown(surface, { button: 0, clientX: 400, clientY: 300 });
    await settle();
    expect(applies(view.rpcCalls)).toHaveLength(0);

    // Worse: both tools stay visibly armed, so the user repeats the gesture forever.
    expect(dockButton(view, "Connector").className).toContain("is-active");
  });

  it("FAILS: the Comment tool does nothing at all when the clicked object is already part of a multi-selection", async () => {
    const view = await openBoard(boardWith(node("a"), node("b", { x: 500 })));

    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerDown(nodeElement(view, "b"), { button: 0, clientX: 600, clientY: 200, shiftKey: true });
    expect(view.getByTestId("selection-bounds")).toBeTruthy(); // two objects selected

    fireEvent.click(dockButton(view, "Comment"));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });
    await settle();

    // `selectNode` sets `inspectorOpen` and reverts the tool to Select, but the Inspector
    // only renders for a selection of exactly one, so the click is swallowed whole.
    expect(view.queryByRole("complementary", { name: "Object inspector" })).not.toBeNull();
  });

  it("FAILS: the 'C' shortcut the context menu advertises for Add comment does not add a comment", async () => {
    const view = await openBoard(boardWith(node("a")));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });

    // The right-click menu literally prints `C` next to "Add comment".
    const menu = openObjectMenu(view, "a");
    expect(menuItem(menu, "add-comment").textContent).toContain("C");
    fireEvent.keyDown(menu, { key: "Escape" });

    fireEvent.keyDown(document.body, { key: "c" });
    await settle();

    // Pressing C only swaps the active tool to Comment; the comment UI never opens.
    expect(view.queryByRole("complementary", { name: "Object inspector" })).not.toBeNull();
  });
});

describe("dead controls: the Connector tool", () => {
  it("FAILS: clicking the same object twice with the Connector tool neither connects nor explains itself", async () => {
    const view = await openBoard(boardWith(node("a")));

    fireEvent.click(dockButton(view, "Connector"));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });
    expect(nodeElement(view, "a").className).toContain("is-connector-source");
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });
    await settle();

    // Expected: a self-loop, or a message that a connector needs a second object.
    // Today the second click is dropped on the floor and the node stays armed forever.
    expect(applies(view.rpcCalls).length).toBeGreaterThan(0);
  });

  it("PASSES (documents surprising behaviour): a half-drawn connector is silently disarmed by any canvas click while the tool stays selected", async () => {
    const view = await openBoard(boardWith(node("a"), node("b", { x: 500 })));

    fireEvent.click(dockButton(view, "Connector"));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });
    expect(nodeElement(view, "a").className).toContain("is-connector-source");

    // Click empty canvas — in FigJam this would drop the connector end there or keep drawing.
    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 700, clientY: 500 });
    await settle();
    expect(nodeElement(view, "a").className).not.toContain("is-connector-source");
    expect(applies(view.rpcCalls)).toHaveLength(0);

    // The dock still says Connector, so the user's next click looks like step one again.
    expect(dockButton(view, "Connector").className).toContain("is-active");
  });

  it("PASSES (documents surprising behaviour): only the two-object sequence works, and nothing on screen ever states that precondition", async () => {
    const view = await openBoard(boardWith(node("a"), node("b", { x: 500 })));

    fireEvent.click(dockButton(view, "Connector"));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerDown(nodeElement(view, "b"), { button: 0, clientX: 600, clientY: 200 });

    await waitFor(() => expect(applies(view.rpcCalls)).toHaveLength(1));
    const operations = (applies(view.rpcCalls)[0]!.input as { operations: unknown[] }).operations;
    expect(operations).toEqual([
      { type: "add_edge", edge: { source: "a", target: "b", color: "ink", routing: "elbow" } },
    ]);

    // The only hint the tool ever gives is the dashed outline that appears AFTER the
    // first successful click. Nothing tells a user on an empty board what to do.
    expect(view.container.textContent).not.toMatch(/select an object|pick two|choose a shape/i);
  });
});

describe("dead controls: the Shapes dock button", () => {
  it("FAILS: the Shapes button lights up as the active tool but the next canvas click places nothing", async () => {
    const view = await openBoard(emptyBoard);

    fireEvent.click(dockButton(view, "Shapes"));
    // The dock renders it active (`isShapeKind(tool) || shapeMenuOpen`)...
    expect(dockButton(view, "Shapes").className).toContain("is-active");

    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 320, clientY: 240 });
    await settle();

    // ...but `tool` is still "select", so the click marquee-selects instead of drawing.
    expect(applies(view.rpcCalls).length).toBeGreaterThan(0);
  });

  it("PASSES (documents surprising behaviour): the shape picker never closes when you click the canvas", async () => {
    const view = await openBoard(emptyBoard);
    fireEvent.click(dockButton(view, "Shapes"));
    expect(view.getByRole("toolbar", { name: "Shape choices" })).toBeTruthy();

    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 320, clientY: 240 });
    // `onSurfacePointerDown` clears every other transient popover but not this one.
    expect(view.queryByRole("toolbar", { name: "Shape choices" })).not.toBeNull();
  });
});

describe("enabled controls that cannot apply: locked objects", () => {
  it("FAILS: the selection toolbar's Delete is enabled on a locked object and silently does nothing", async () => {
    const view = await openBoard(boardWith(node("a", { locked: true })));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });

    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });
    const remove = within(toolbar).getByRole("button", { name: "Delete selected object" });
    expect(remove.hasAttribute("disabled")).toBe(false);
    fireEvent.click(remove);
    await settle();

    // Expected: either the button is disabled, or the app says "unlock it first".
    // Today `deleteSelected` filters the locked node out and persists an empty list.
    expect(applies(view.rpcCalls).length).toBeGreaterThan(0);
  });

  it("FAILS: the context menu offers Delete undimmed on a locked object and it no-ops", async () => {
    const view = await openBoard(boardWith(node("a", { locked: true })));
    const menu = openObjectMenu(view, "a");

    expect(menuItem(menu, "unlock")).toBeTruthy(); // proves the app knows it is locked
    expect(menuItem(menu, "delete").getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(menuItem(menu, "delete"));
    await settle();
    expect(applies(view.rpcCalls)).toHaveLength(0);
  });

  it("FAILS: Duplicate works on a locked object from the toolbar but its advertised Cmd/Ctrl+D shortcut does not", async () => {
    const view = await openBoard(boardWith(node("a", { locked: true })));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });

    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });
    const duplicate = within(toolbar).getByRole("button", { name: "Duplicate selected object" });
    expect(duplicate.getAttribute("title")).toContain("Cmd/Ctrl+D");
    fireEvent.click(duplicate);
    await waitFor(() => expect(applies(view.rpcCalls)).toHaveLength(1));

    fireEvent.keyDown(document.body, { key: "d", metaKey: true });
    await settle();
    // Same control, same object, two code paths: the button duplicates locked nodes,
    // the keyboard handler filters them out first.
    expect(applies(view.rpcCalls)).toHaveLength(2);
  });

  it("FAILS: 'Edit text' in the context menu bypasses the lock that double-click respects", async () => {
    const view = await openBoard(boardWith(node("a", { locked: true })));

    fireEvent.doubleClick(nodeElement(view, "a"));
    expect(nodeElement(view, "a").className).not.toContain("is-editing"); // lock honoured here

    fireEvent.click(menuItem(openObjectMenu(view, "a"), "edit-text"));
    // ...but the menu action calls `setEditingId` with no lock check, so the same
    // locked object becomes a live, writable textarea.
    expect(nodeElement(view, "a").className).not.toContain("is-editing");
    const textarea = nodeElement(view, "a").querySelector("textarea");
    expect(textarea?.hasAttribute("readonly")).toBe(true);
  });

  it("FAILS: Tidy up is enabled for an all-locked multi-selection and silently does nothing", async () => {
    const view = await openBoard(boardWith(node("a", { locked: true }), node("b", { x: 500, locked: true })));

    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerDown(nodeElement(view, "b"), { button: 0, clientX: 600, clientY: 200, shiftKey: true });

    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });
    const tidy = within(toolbar).getByRole("button", { name: "Tidy up selection" });
    expect(tidy.hasAttribute("disabled")).toBe(false);
    fireEvent.click(tidy);
    await settle();

    expect(applies(view.rpcCalls).length).toBeGreaterThan(0);
  });

  it("FAILS: the fill colour swatch repaints a locked object, so 'Lock' does not actually lock appearance", async () => {
    const view = await openBoard(boardWith(node("a", { locked: true })));
    fireEvent.pointerDown(nodeElement(view, "a"), { button: 0, clientX: 200, clientY: 200 });

    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Change fill color" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Set Blue fill" }));
    await settle();

    // Delete/tidy/nudge all refuse on a locked node; colour does not. Pick one rule.
    expect(applies(view.rpcCalls)).toHaveLength(0);
  });
});
