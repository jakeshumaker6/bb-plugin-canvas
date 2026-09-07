// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RpcCall } from "@get-bb/plugin-sdk/testing/app";
import { applyBoardOperations } from "../src/domain";
import type { BoardDocument, BoardNode, BoardOperation, BoardSummary } from "../src/domain";
import { viewportCenterPoint } from "../src/placement";
import { SHAPE_LABELS } from "../src/shapes";

const summary: BoardSummary = {
  id: "board-1",
  title: "Customer workflow",
  projectId: "proj_personal",
  chatThreadId: "thr_canvas_1",
  version: 0,
  createdAt: "now",
  updatedAt: "now",
};

const empty: BoardDocument = { ...summary, schemaVersion: 1, nodes: [], edges: [], comments: [] };

function sticky(id: string, x: number, y: number, text: string): BoardNode {
  return {
    id,
    kind: "sticky",
    x,
    y,
    width: 220,
    height: 160,
    text,
    color: "yellow",
    fontFamily: "inter",
    fontSize: 17,
    fontWeight: 500,
    textAlign: "left",
    locked: false,
    groupId: null,
  };
}

const withSticky: BoardDocument = { ...empty, nodes: [sticky("sticky-1", 120, 100, "Customer request")] };

/** A live mock: operations really are applied, so the board reflects what the keyboard did. */
function rpcFor(initial: BoardDocument) {
  let current = initial;
  return {
    boards_list: () => ({ boards: [summary] }),
    board_get: () => ({ board: current }),
    boards_create: () => ({ board: current }),
    board_apply_operations: (input: unknown) => {
      const { operations } = input as { operations: BoardOperation[] };
      current = applyBoardOperations(current, operations, { now: "now", makeId: () => globalThis.crypto.randomUUID() });
      return { board: current };
    },
    board_import: () => ({ board: current }),
    board_delete: () => ({ deleted: true }),
    board_start_chat: () => ({ threadId: "thr_canvas_1" }),
  };
}

function applies(calls: readonly RpcCall[]): BoardOperation[][] {
  return calls
    .filter((call) => call.method === "board_apply_operations")
    .map((call) => (call.input as { operations: BoardOperation[] }).operations);
}

function lastApply(calls: readonly RpcCall[]): BoardOperation[] {
  const latest = applies(calls).at(-1);
  if (latest === undefined) throw new Error("no board_apply_operations call was made");
  return latest;
}

async function openBoard(initial: BoardDocument = empty) {
  const app = await loadPluginApp(() => import("../app"));
  const view = renderSlot(app.navPanels[0]!, { subPath: "board-1" }, { rpc: rpcFor(initial) });
  await waitFor(() => expect(view.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy());
  const surface = view.getByTestId("canvas-surface");
  return { view, surface };
}

/** The board point the caret defaults to, computed from the same inputs the app uses. */
function centre(surface: HTMLElement): { x: number; y: number } {
  return viewportCenterPoint({ x: 80, y: 64, zoom: 1 }, { width: surface.clientWidth, height: surface.clientHeight });
}

describe("creating objects with the keyboard", () => {
  it("HEADLINE: a sticky can be created with the keyboard alone", async () => {
    const { view, surface } = await openBoard(empty);
    surface.focus();
    fireEvent.keyDown(surface, { key: "s" });
    fireEvent.keyDown(surface, { key: "Enter", metaKey: true });

    const at = centre(surface);
    await waitFor(() => expect(applies(view.rpcCalls)).toHaveLength(1));
    expect(lastApply(view.rpcCalls)).toEqual([
      { type: "add_node", node: { id: expect.any(String), kind: "sticky", x: at.x, y: at.y, color: "yellow" } },
    ]);

    const created = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>("[data-node-id]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(created.getAttribute("aria-selected")).toBe("true");
    expect(created.querySelector("textarea")!.readOnly).toBe(false);
  });

  it("keyboard activation of a dock tool places immediately, a mouse click only arms it", async () => {
    const keyboard = await openBoard(empty);
    fireEvent.click(keyboard.view.getByRole("button", { name: "Sticky note" }));
    await waitFor(() => expect(applies(keyboard.view.rpcCalls)).toHaveLength(1));
    expect(lastApply(keyboard.view.rpcCalls)[0]).toMatchObject({ type: "add_node", node: { kind: "sticky" } });
    keyboard.view.lifecycle.unmount();

    const mouse = await openBoard(empty);
    fireEvent.click(mouse.view.getByRole("button", { name: "Sticky note" }), { detail: 1 });
    expect(applies(mouse.view.rpcCalls)).toHaveLength(0);
    fireEvent.pointerDown(mouse.surface, { button: 0, clientX: 300, clientY: 200 });
    await waitFor(() => expect(applies(mouse.view.rpcCalls)).toHaveLength(1));
    expect(lastApply(mouse.view.rpcCalls)).toEqual([
      { type: "add_node", node: { id: expect.any(String), kind: "sticky", x: 110, y: 56, color: "yellow" } },
    ]);
  });

  it("a new object lands beside the focused object, not on top of it", async () => {
    const { view, surface } = await openBoard(withSticky);
    surface.focus();
    fireEvent.keyDown(surface, { key: "Tab" });
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-sticky-1");
    fireEvent.keyDown(surface, { key: "r" });
    fireEvent.keyDown(surface, { key: "Enter", metaKey: true });

    await waitFor(() => expect(applies(view.rpcCalls)).toHaveLength(1));
    expect(lastApply(view.rpcCalls)).toEqual([
      { type: "add_node", node: { id: expect.any(String), kind: "rectangle", x: 380, y: 100, color: "blue" } },
    ]);
  });

  it("the insertion point is visible while the canvas has keyboard focus", async () => {
    const { view, surface } = await openBoard(empty);
    expect(view.queryByTestId("placement-caret")).toBeNull();

    surface.focus();
    fireEvent.keyDown(surface, { key: "s" });
    const at = centre(surface);
    const caret = await waitFor(() => {
      const found = view.getByTestId("placement-caret");
      expect(found.style.left).toBe(`${at.x}px`);
      return found;
    });
    expect(caret.getAttribute("aria-hidden")).toBe("true");
    expect(caret.style.top).toBe(`${at.y}px`);

    fireEvent.keyDown(surface, { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(view.getByTestId("placement-caret").style.left).toBe(`${at.x + 20}px`));
    fireEvent.keyDown(surface, { key: "ArrowRight", altKey: true, shiftKey: true });
    await waitFor(() => expect(view.getByTestId("placement-caret").style.left).toBe(`${at.x + 120}px`));

    // Escape disarms the tool as well as clearing the caret, so re-arm to see it again.
    fireEvent.keyDown(surface, { key: "Escape" });
    fireEvent.keyDown(surface, { key: "s" });
    await waitFor(() => expect(view.getByTestId("placement-caret").style.left).toBe(`${at.x}px`));
    expect(view.getByTestId("placement-caret").style.top).toBe(`${at.y}px`);
  });

  it("placement is announced", async () => {
    const { view, surface } = await openBoard(empty);
    surface.focus();
    fireEvent.keyDown(surface, { key: "s" });
    fireEvent.keyDown(surface, { key: "Enter", metaKey: true });
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Sticky note added at"));
  });

  it("every shape kind is reachable from the keyboard", async () => {
    const { view } = await openBoard(empty);
    fireEvent.click(view.getByRole("button", { name: "Shapes" }));
    const picker = await waitFor(() => view.getByRole("toolbar", { name: "Shape choices" }));
    expect(applies(view.rpcCalls)).toHaveLength(0);

    fireEvent.click(within(picker).getByRole("button", { name: SHAPE_LABELS.cylinder }));
    await waitFor(() => expect(applies(view.rpcCalls)).toHaveLength(1));
    expect(lastApply(view.rpcCalls)[0]).toMatchObject({ type: "add_node", node: { kind: "cylinder" } });
  });

  it("a comment pin can be dropped from the keyboard", async () => {
    const { view, surface } = await openBoard(empty);
    surface.focus();
    fireEvent.keyDown(surface, { key: "c" });
    fireEvent.keyDown(surface, { key: "Enter", metaKey: true });

    const at = centre(surface);
    await waitFor(() => expect(applies(view.rpcCalls)).toHaveLength(1));
    const operation = lastApply(view.rpcCalls)[0]!;
    expect(operation).toMatchObject({ type: "add_comment", comment: { x: at.x, y: at.y } });
    expect((operation as { comment: { nodeId?: string } }).comment.nodeId).toBeUndefined();
  });

  it("Find has a visible trigger that returns focus when dismissed", async () => {
    const { view, surface } = await openBoard(withSticky);
    const trigger = view.getByRole("button", { name: "Find on board" });
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Meta+F Control+F");

    fireEvent.click(trigger);
    await waitFor(() => expect(view.getByRole("dialog", { name: "Find objects" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Close find" }));
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Find objects" })).toBeNull());
    expect(document.activeElement).toBe(trigger);

    surface.focus();
    fireEvent.keyDown(surface, { key: "f", metaKey: true });
    await waitFor(() => expect(view.getByRole("dialog", { name: "Find objects" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Close find" }));
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Find objects" })).toBeNull());
    expect(document.activeElement).toBe(surface);
  });

  it("Cmd+Enter with no creation tool armed does nothing but say so", async () => {
    const { view, surface } = await openBoard(withSticky);
    surface.focus();
    fireEvent.keyDown(surface, { key: "Enter", metaKey: true });
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Pick a tool first"));
    expect(applies(view.rpcCalls)).toHaveLength(0);
  });

});
