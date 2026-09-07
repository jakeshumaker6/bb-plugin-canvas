// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RpcCall } from "@get-bb/plugin-sdk/testing/app";
import { applyBoardOperations } from "../src/domain";
import type { BoardDocument, BoardEdge, BoardNode, BoardOperation, BoardSummary } from "../src/domain";

const summary: BoardSummary = {
  id: "board-1",
  title: "Customer workflow",
  projectId: "proj_personal",
  chatThreadId: "thr_canvas_1",
  version: 0,
  createdAt: "now",
  updatedAt: "now",
};

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

function edge(id: string, source: string, target: string): BoardEdge {
  return { id, source, target, label: "", color: "ink", routing: "straight", arrow: "end" };
}

const twoNodes: BoardDocument = {
  ...summary,
  schemaVersion: 1,
  nodes: [sticky("sticky-1", 120, 100, "Customer request"), sticky("sticky-2", 460, 100, "Refund issued")],
  edges: [],
  comments: [],
};

const withEdge: BoardDocument = { ...twoNodes, edges: [edge("edge-1", "sticky-1", "sticky-2")] };
const withTwoEdges: BoardDocument = {
  ...twoNodes,
  nodes: [...twoNodes.nodes, sticky("sticky-3", 120, 420, "Refund denied")],
  edges: [edge("edge-1", "sticky-1", "sticky-2"), edge("edge-2", "sticky-1", "sticky-3")],
};

/** Static: every call returns the same document, so the view never moves under the test. */
function staticRpc(activeBoard: BoardDocument) {
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

/** Live: operations really are applied, so the board reflects what the keyboard did. */
function liveRpc(initial: BoardDocument) {
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

async function openBoard(rpc: ReturnType<typeof staticRpc> | ReturnType<typeof liveRpc>) {
  const app = await loadPluginApp(() => import("../app"));
  const view = renderSlot(app.navPanels[0]!, { subPath: "board-1" }, { rpc });
  await waitFor(() => expect(view.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy());
  const surface = view.getByTestId("canvas-surface");
  surface.focus();
  return { view, surface };
}

function nodeElement(view: { container: HTMLElement }, id: string): HTMLElement {
  const found = view.container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (found === null) throw new Error(`no node ${id}`);
  return found;
}

function edgeStroke(view: { container: HTMLElement }, id: string): SVGPathElement {
  const group = view.container.querySelector<SVGGElement>(`#canvas-object-${id}`);
  if (group === null) throw new Error(`no connector ${id}`);
  const stroke = group.querySelector<SVGPathElement>("path.canvas-edge");
  if (stroke === null) throw new Error(`connector ${id} has no stroke`);
  return stroke;
}

describe("drawing and editing connectors with the keyboard", () => {
  it("HEADLINE: a connector can be drawn with the keyboard alone", async () => {
    const { view, surface } = await openBoard(liveRpc(twoNodes));

    fireEvent.keyDown(surface, { key: "Tab" });
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-sticky-1");
    fireEvent.keyDown(surface, { key: "l" });
    fireEvent.keyDown(surface, { key: "Enter" });
    fireEvent.keyDown(surface, { key: "Tab" });
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-sticky-2");
    fireEvent.keyDown(surface, { key: "Enter" });

    await waitFor(() => expect(applies(view.rpcCalls)).toHaveLength(1));
    expect(lastApply(view.rpcCalls)).toEqual([
      { type: "add_edge", edge: { source: "sticky-1", target: "sticky-2", color: "ink", routing: "elbow" } },
    ]);
    const dock = view.getByRole("toolbar", { name: "Canvas tools" });
    await waitFor(() => expect(within(dock).getByRole("button", { name: "Select" }).className).toContain("is-active"));
  });

  it("Enter with the connector tool never starts text editing", async () => {
    const { view, surface } = await openBoard(liveRpc(twoNodes));

    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "l" });
    fireEvent.keyDown(surface, { key: "Enter" });

    await waitFor(() => expect(nodeElement(view, "sticky-1").className).toContain("is-connector-source"));
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    expect(view.container.querySelectorAll(".diagram-node.is-editing")).toHaveLength(0);
    expect(applies(view.rpcCalls)).toHaveLength(0);
    expect(view.getByRole("status").textContent).toContain("Connector started from Customer request");
  });

  it("Escape cancels a half-drawn connector", async () => {
    const { view, surface } = await openBoard(liveRpc(twoNodes));

    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "l" });
    fireEvent.keyDown(surface, { key: "Enter" });
    await waitFor(() => expect(nodeElement(view, "sticky-1").className).toContain("is-connector-source"));

    fireEvent.keyDown(surface, { key: "Escape" });

    await waitFor(() => expect(nodeElement(view, "sticky-1").className).not.toContain("is-connector-source"));
    expect(applies(view.rpcCalls)).toHaveLength(0);
    expect(view.getByRole("status").textContent).toContain("Connector cancelled");
  });

  it("Enter on a focused connector moves focus into the connector toolbar", async () => {
    const { view, surface } = await openBoard(staticRpc(withEdge));

    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-edge-1");

    const toolbar = view.getByRole("toolbar", { name: "Connector properties" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(document.activeElement).toBe(within(toolbar).getByLabelText("Connector label"));
  });

  it("the whole connector toolbar is operable from there", async () => {
    const { view, surface } = await openBoard(staticRpc(withEdge));

    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Enter" });
    const toolbar = view.getByRole("toolbar", { name: "Connector properties" });

    const label = within(toolbar).getByLabelText("Connector label");
    expect(document.activeElement).toBe(label);
    fireEvent.change(label, { target: { value: "then" } });
    fireEvent.blur(label);
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_edge", id: "edge-1", patch: { label: "then" } }]));

    fireEvent.change(within(toolbar).getByLabelText("Connector routing"), { target: { value: "curved" } });
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_edge", id: "edge-1", patch: { routing: "curved" } }]));

    fireEvent.change(within(toolbar).getByLabelText("Connector arrows"), { target: { value: "both" } });
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_edge", id: "edge-1", patch: { arrow: "both" } }]));

    fireEvent.click(within(toolbar).getByRole("button", { name: "Delete connector" }));
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "remove_edges", ids: ["edge-1"] }]));
  });

  it("Escape in the connector toolbar returns focus to the canvas and keeps the connector selected", async () => {
    const { view, surface } = await openBoard(staticRpc(withEdge));

    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Enter" });
    const label = within(view.getByRole("toolbar", { name: "Connector properties" })).getByLabelText("Connector label");
    expect(document.activeElement).toBe(label);

    fireEvent.keyDown(label, { key: "Escape" });

    expect(document.activeElement).toBe(surface);
    expect(view.getByRole("toolbar", { name: "Connector properties" })).toBeTruthy();
  });

  it("the context menu opens from the keyboard", async () => {
    const { view, surface } = await openBoard(staticRpc(withEdge));

    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "F10", shiftKey: true });
    const objectItems = view.getAllByRole("menuitem").map((item) => item.textContent);
    expect(objectItems.length).toBeGreaterThan(0);
    expect(objectItems.some((text) => text?.startsWith("Edit text"))).toBe(true);
    expect(objectItems.some((text) => text?.startsWith("Delete"))).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(view.queryByTestId("canvas-context-menu")).toBeNull());
    expect(document.activeElement).toBe(surface);

    // Nothing focused: the menu targets the canvas and offers the canvas-only set.
    fireEvent.keyDown(surface, { key: "Escape" });
    fireEvent.keyDown(surface, { key: "F10", shiftKey: true });
    const canvasItems = view.getAllByRole("menuitem").map((item) => item.textContent);
    expect(canvasItems.some((text) => text?.startsWith("Paste here"))).toBe(true);
    expect(canvasItems.some((text) => text?.startsWith("Select all"))).toBe(true);
    expect(canvasItems.some((text) => text?.startsWith("Zoom to fit"))).toBe(true);
    expect(canvasItems.some((text) => text?.startsWith("Edit text"))).toBe(false);
  });

  it("toolbar toggles report state, not just a CSS class", async () => {
    const single = await openBoard(liveRpc(twoNodes));
    fireEvent.pointerDown(nodeElement(single.view, "sticky-1"), { button: 0, clientX: 200, clientY: 200 });
    const toolbar = single.view.getByRole("toolbar", { name: "Selection properties" });

    const bold = within(toolbar).getByRole("button", { name: "Bold" });
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(bold);
    await waitFor(() => expect(within(toolbar).getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true"));

    const lock = within(toolbar).getByRole("button", { name: "Lock selection" });
    expect(lock.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lock);
    await waitFor(() => expect(within(toolbar).getByRole("button", { name: "Unlock selection" }).getAttribute("aria-pressed")).toBe("true"));
    single.view.lifecycle.unmount();

    const many = await openBoard(liveRpc(twoNodes));
    fireEvent.keyDown(many.surface, { key: "a", metaKey: true });
    const groupToolbar = await waitFor(() => many.view.getByRole("toolbar", { name: "Selection properties" }));
    const group = within(groupToolbar).getByRole("button", { name: "Group selection" });
    expect(group.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(group);
    await waitFor(() => expect(within(groupToolbar).getByRole("button", { name: "Ungroup selection" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("the focused connector is visibly distinct from a merely selected one", async () => {
    const { view, surface } = await openBoard(staticRpc(withTwoEdges));

    // sticky-1, sticky-2, sticky-3, then the connectors in endpoint reading order.
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    fireEvent.keyDown(surface, { key: "Tab" });
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-edge-1");

    expect(edgeStroke(view, "edge-1").getAttribute("class")).toContain("is-selected");
    expect(edgeStroke(view, "edge-1").getAttribute("class")).toContain("is-focused");
    // The other connector is neither, so the two rings are computed independently.
    expect(edgeStroke(view, "edge-2").getAttribute("class")).not.toContain("is-selected");
    expect(edgeStroke(view, "edge-2").getAttribute("class")).not.toContain("is-focused");

    fireEvent.keyDown(surface, { key: "Tab" });
    expect(edgeStroke(view, "edge-1").getAttribute("class")).not.toContain("is-focused");
    expect(edgeStroke(view, "edge-2").getAttribute("class")).toContain("is-focused");
  });
});
