// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RpcCall } from "@get-bb/plugin-sdk/testing/app";
import type { BoardDocument, BoardNode, BoardOperation, BoardSummary } from "../src/domain";

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

const twoNodes: BoardDocument = {
  ...summary,
  schemaVersion: 1,
  nodes: [sticky("sticky-1", 120, 100, "Customer request"), sticky("sticky-2", 460, 100, "Refund issued")],
  edges: [],
  comments: [],
};

const twoEmpty: BoardDocument = {
  ...twoNodes,
  nodes: [sticky("sticky-1", 120, 100, ""), sticky("sticky-2", 460, 100, "")],
};

const withEdge: BoardDocument = {
  ...twoNodes,
  edges: [{ id: "edge-1", source: "sticky-1", target: "sticky-2", label: "", color: "ink", routing: "straight", arrow: "end" }],
};

function rpcFor(activeBoard: BoardDocument) {
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

function lastApply(calls: readonly RpcCall[]): BoardOperation[] {
  const latest = calls.filter((call) => call.method === "board_apply_operations").at(-1);
  if (latest === undefined) throw new Error("no board_apply_operations call was made");
  return (latest.input as { operations: BoardOperation[] }).operations;
}

async function openBoard(activeBoard: BoardDocument) {
  const app = await loadPluginApp(() => import("../app"));
  const view = renderSlot(app.navPanels[0]!, { subPath: "board-1" }, { rpc: rpcFor(activeBoard) });
  await waitFor(() => expect(view.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy());
  const surface = view.getByTestId("canvas-surface");
  surface.focus();
  return { view, surface };
}

/** Tab on the surface; true when the browser is left free to move focus onwards. */
function tab(surface: HTMLElement, shiftKey = false): boolean {
  return fireEvent.keyDown(surface, { key: "Tab", shiftKey });
}

describe("keyboard access to the canvas", () => {
  it("the canvas surface is the single tab stop and names itself", async () => {
    const { view, surface } = await openBoard(twoNodes);
    expect(surface.getAttribute("tabindex")).toBe("0");
    expect(surface.getAttribute("role")).toBe("application");
    expect(surface.getAttribute("aria-roledescription")).toBe("canvas");
    expect(surface.getAttribute("aria-label")).toContain("Customer workflow");

    const describedBy = surface.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const help = view.container.ownerDocument.getElementById(describedBy!);
    expect(help?.textContent?.trim().length).toBeGreaterThan(0);

    const textareas = Array.from(view.container.querySelectorAll<HTMLTextAreaElement>("[data-node-id] textarea"));
    expect(textareas).toHaveLength(2);
    for (const area of textareas) {
      expect(area.tabIndex).toBe(-1);
      expect(area.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("Tab walks objects in reading order and releases past the last one", async () => {
    const { surface } = await openBoard(twoNodes);
    expect(tab(surface)).toBe(false);
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-sticky-1");
    expect(tab(surface)).toBe(false);
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-sticky-2");
    // Past the last object the canvas lets the event through so the user tabs out.
    expect(tab(surface)).toBe(true);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);

    expect(tab(surface)).toBe(false);
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-sticky-1");
    expect(tab(surface, true)).toBe(true);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("keyboard focus selects the object, so the selection toolbar appears", async () => {
    const { view, surface } = await openBoard(twoNodes);
    tab(surface);
    await waitFor(() => expect(view.getByRole("toolbar", { name: "Selection properties" })).toBeTruthy());
    const first = view.container.querySelector('[data-node-id="sticky-1"]')!;
    const second = view.container.querySelector('[data-node-id="sticky-2"]')!;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.classList.contains("is-focused")).toBe(true);
    expect(second.getAttribute("aria-selected")).toBe("false");
    expect(second.classList.contains("is-focused")).toBe(false);
  });

  it("every object exposes an option role and a name that distinguishes it", async () => {
    const { view } = await openBoard(twoEmpty);
    const first = view.container.querySelector('[data-node-id="sticky-1"]')!;
    const second = view.container.querySelector('[data-node-id="sticky-2"]')!;
    expect(first.getAttribute("role")).toBe("option");
    expect(second.getAttribute("role")).toBe("option");
    expect(first.getAttribute("aria-label")).toBe("Untitled sticky note at 120, 100");
    expect(second.getAttribute("aria-label")).toBe("Untitled sticky note at 460, 100");
    expect(first.getAttribute("aria-label")).not.toBe(second.getAttribute("aria-label"));
  });

  it("the global shortcuts still fire from the focused surface", async () => {
    const first = await openBoard(twoNodes);
    tab(first.surface);
    fireEvent.keyDown(first.surface, { key: "Backspace" });
    await waitFor(() => expect(lastApply(first.view.rpcCalls)).toEqual([{ type: "remove_nodes", ids: ["sticky-1"] }]));
    first.view.lifecycle.unmount();

    const second = await openBoard(twoNodes);
    tab(second.surface);
    fireEvent.keyDown(second.surface, { key: "ArrowRight" });
    await waitFor(() => expect(lastApply(second.view.rpcCalls))
      .toEqual([{ type: "update_node", id: "sticky-1", patch: { x: 121, y: 100 } }]));
  });

  it("Escape releases the canvas cursor without moving DOM focus", async () => {
    const { view, surface } = await openBoard(twoNodes);
    tab(surface);
    await waitFor(() => expect(view.getByRole("toolbar", { name: "Selection properties" })).toBeTruthy());

    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(surface.hasAttribute("aria-activedescendant")).toBe(false));
    expect(view.queryByRole("toolbar", { name: "Selection properties" })).toBeNull();
    expect(document.activeElement).toBe(surface);
    // The cursor is genuinely cleared, so the next Tab re-enters at the first object
    // exactly as it would on a freshly focused surface.
    expect(tab(surface)).toBe(false);
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-sticky-1");
  });

  it("Enter edits the focused object and Escape returns focus to the surface", async () => {
    const { view, surface } = await openBoard(twoNodes);
    tab(surface);
    fireEvent.keyDown(surface, { key: "Enter" });

    const area = await waitFor(() => {
      const found = view.container.querySelector<HTMLTextAreaElement>('[data-node-id="sticky-1"] textarea')!;
      expect(found.tabIndex).toBe(0);
      return found;
    });
    expect(area.getAttribute("aria-hidden")).not.toBe("true");
    expect(document.activeElement).toBe(area);

    fireEvent.keyDown(area, { key: "Escape" });
    await waitFor(() => expect(view.container.querySelector('[data-node-id="sticky-1"] textarea')!.getAttribute("aria-hidden")).toBe("true"));
    expect(document.activeElement).toBe(surface);
  });

  it("double-click still opens the text editor", async () => {
    const { view } = await openBoard(twoNodes);
    const node = view.container.querySelector('[data-node-id="sticky-1"]')!;
    fireEvent.pointerDown(node, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.doubleClick(node);
    await waitFor(() => {
      const area = view.container.querySelector<HTMLTextAreaElement>('[data-node-id="sticky-1"] textarea')!;
      expect(area.readOnly).toBe(false);
      expect(area.tabIndex).toBe(0);
      expect(document.activeElement).toBe(area);
    });
  });

  it("connectors are cursor stops that select themselves and open the connector toolbar", async () => {
    const { view, surface } = await openBoard(withEdge);
    tab(surface);
    tab(surface);
    tab(surface);
    expect(surface.getAttribute("aria-activedescendant")).toBe("canvas-object-edge-1");

    const group = view.container.ownerDocument.getElementById("canvas-object-edge-1")!;
    expect(group.getAttribute("role")).toBe("option");
    expect(group.getAttribute("aria-selected")).toBe("true");
    expect(group.getAttribute("aria-roledescription")).toBe("connector");
    expect(group.getAttribute("aria-label")).toContain("from Customer request to Refund issued");

    await waitFor(() => expect(view.getByRole("toolbar", { name: "Connector properties" })).toBeTruthy());
    expect(view.queryByRole("toolbar", { name: "Selection properties" })).toBeNull();

    fireEvent.keyDown(surface, { key: "Backspace" });
    await waitFor(() => expect(lastApply(view.rpcCalls)).toEqual([{ type: "remove_edges", ids: ["edge-1"] }]));
  });
});
