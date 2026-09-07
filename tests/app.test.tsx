// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RpcCall } from "@get-bb/plugin-sdk/testing/app";
import type { BoardDocument, BoardOperation, BoardSummary } from "../src/domain";
import { SHAPE_KINDS, SHAPE_LABELS } from "../src/shapes";

const summary: BoardSummary = {
  id: "board-1",
  title: "Customer workflow",
  projectId: "proj_personal",
  chatThreadId: "thr_canvas_1",
  version: 0,
  createdAt: "now",
  updatedAt: "now",
};

const board: BoardDocument = {
  ...summary,
  schemaVersion: 1,
  nodes: [],
  edges: [],
  comments: [],
};

const boardWithSticky: BoardDocument = {
  ...board,
  nodes: [
    {
      id: "sticky-1",
      kind: "sticky",
      x: 120,
      y: 100,
      width: 220,
      height: 160,
      text: "Customer request",
      color: "yellow",
      fontFamily: "inter",
      fontSize: 17,
      fontWeight: 500,
      textAlign: "left",
      locked: false,
      groupId: null,
    },
  ],
};

function rpcFor(activeBoard: BoardDocument = board) {
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

/** The operations of the most recent `board_apply_operations` call. */
function lastApply(calls: readonly RpcCall[]): BoardOperation[] {
  const applies = calls.filter((call) => call.method === "board_apply_operations");
  const latest = applies.at(-1);
  if (latest === undefined) throw new Error("no board_apply_operations call was made");
  return (latest.input as { operations: BoardOperation[] }).operations;
}

async function openBoard(rpc: ReturnType<typeof rpcFor>) {
  const app = await loadPluginApp(() => import("../app"));
  const view = renderSlot(app.navPanels[0]!, { subPath: "board-1" }, { rpc });
  await waitFor(() => expect(view.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy());
  return view;
}

describe("Canvas bb surface", () => {
  it("registers a distinct left-sidebar panel and native Chat fixed tab", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.navPanels).toHaveLength(1);
    const panel = app.navPanels[0]!;
    expect(panel.id).toBe("canvas");
    expect(panel.title).toBe("Canvas");
    expect(panel.icon).toBe("Workflow");
    expect(panel.path).toBe("board");
    // Canvas owns a page of its own rather than borrowing another surface.
    expect(app.homepageSections).toEqual([]);
    expect(app.settingsSections).toEqual([]);
    expect(app.threadPanelActions).toEqual([]);
    expect(app.appOverlays).toEqual([]);

    const tabs = panel.fixedTabs ?? [];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.panelId).toBe("canvas");
    expect(tabs[0]!.id).toBe("chat");
    expect(tabs[0]!.title).toBe("Chat");
    expect(tabs[0]!.icon).toBe("SideChat");
    expect(tabs[0]!.layout).toBe("flush");
    expect(typeof tabs[0]!.component).toBe("function");
  });

  it("creates a sticky note from the persistent toolbar", async () => {
    const view = await openBoard({ ...rpcFor(board), board_apply_operations: () => ({ board: boardWithSticky }) });
    expect(view.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(view.getByRole("button", { name: "Sticky note" }));
    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 300, clientY: 200 });

    await waitFor(() => expect(lastApply(view.rpcCalls)).toHaveLength(1));
    // The viewport starts at (80, 64) and a sticky is centred on the pointer.
    expect(lastApply(view.rpcCalls)).toEqual([
      { type: "add_node", node: { id: expect.any(String), kind: "sticky", x: 110, y: 56, color: "yellow" } },
    ]);
    await waitFor(() => expect(view.getByLabelText("Text for sticky")).toBeTruthy());

    const undo = view.getByRole("button", { name: "Undo" });
    expect(undo.hasAttribute("disabled")).toBe(false);
    fireEvent.click(undo);
    await waitFor(() => expect(view.rpcCalls.some((call) => call.method === "board_import")).toBe(true));
    const restore = view.rpcCalls.filter((call) => call.method === "board_import").at(-1)!;
    expect(restore.input).toMatchObject({ boardId: "board-1", fileName: "history.canvas.json" });
    expect(typeof (restore.input as { content: unknown }).content).toBe("string");
  });

  it("uses a FigJam-like bottom tool dock with recognizable SVG tools", async () => {
    const view = await openBoard(rpcFor(board));
    const dock = view.getByRole("toolbar", { name: "Canvas tools" });
    expect(dock.getAttribute("data-placement")).toBe("bottom");

    const tools = ["Select", "Hand tool", "Sticky note", "Shapes", "Text", "Connector", "Comment"];
    expect(within(dock).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(tools);
    for (const label of tools) {
      const button = within(dock).getByRole("button", { name: label });
      expect(button.querySelector("svg")).not.toBeNull();
    }

    // Shapes opens a secondary picker rather than selecting a shape directly.
    fireEvent.click(within(dock).getByRole("button", { name: "Shapes" }));
    const picker = view.getByRole("toolbar", { name: "Shape choices" });
    expect(within(picker).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(SHAPE_KINDS.map((kind) => SHAPE_LABELS[kind]));
    // The picker is the only place shapes are offered, so it must stay in step with the library.
    expect(within(picker).getAllByRole("button")).toHaveLength(9);
  });

  it("puts color, typography, comments, duplicate, and delete beside a selected object", async () => {
    const view = await openBoard(rpcFor(boardWithSticky));
    const node = view.container.querySelector('[data-node-id="sticky-1"]');
    expect(node).not.toBeNull();
    fireEvent.pointerDown(node!, { button: 0, clientX: 200, clientY: 200 });

    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });

    fireEvent.click(within(toolbar).getByRole("button", { name: "Change fill color" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Set Blue fill" }));
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_node", id: "sticky-1", patch: { color: "blue" } }]));

    fireEvent.change(within(toolbar).getByLabelText("Font family"), { target: { value: "serif" } });
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_node", id: "sticky-1", patch: { fontFamily: "serif" } }]));

    fireEvent.change(within(toolbar).getByLabelText("Font size"), { target: { value: "24" } });
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_node", id: "sticky-1", patch: { fontSize: 24 } }]));

    fireEvent.click(within(toolbar).getByRole("button", { name: "Bold" }));
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_node", id: "sticky-1", patch: { fontWeight: 700 } }]));

    // The sticky is left-aligned, so the single alignment control steps to centre.
    fireEvent.click(within(toolbar).getByRole("button", { name: "Change text alignment" }));
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "update_node", id: "sticky-1", patch: { textAlign: "center" } }]));

    fireEvent.click(within(toolbar).getByRole("button", { name: "Add comment" }));
    const inspector = view.getByRole("complementary", { name: "Object inspector" });
    fireEvent.change(within(inspector).getByLabelText("New comment"), { target: { value: "  Chase this  " } });
    fireEvent.submit(inspector.querySelector("form")!);
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "add_comment", comment: { nodeId: "sticky-1", message: "Chase this" } }]));

    fireEvent.click(within(toolbar).getByRole("button", { name: "Duplicate selected object" }));
    await waitFor(() => expect(lastApply(view.rpcCalls)).toEqual([
      {
        type: "add_node",
        node: {
          kind: "sticky",
          x: 152,
          y: 132,
          width: 220,
          height: 160,
          text: "Customer request",
          color: "yellow",
          fontFamily: "inter",
          fontSize: 17,
          fontWeight: 500,
          textAlign: "left",
        },
      },
    ]));

    fireEvent.click(within(toolbar).getByRole("button", { name: "Delete selected object" }));
    await waitFor(() => expect(lastApply(view.rpcCalls))
      .toEqual([{ type: "remove_nodes", ids: ["sticky-1"] }]));
    await waitFor(() => expect(view.queryByRole("toolbar", { name: "Selection properties" })).toBeNull());
  });

  it("makes board renaming an explicit edit and save flow", async () => {
    const renamed: BoardDocument = { ...board, title: "Refund flow" };
    const view = await openBoard({ ...rpcFor(board), board_apply_operations: () => ({ board: renamed }) });

    const header = view.container.querySelector("header")!;
    expect(within(header).getByText("Customer workflow")).toBeTruthy();
    expect(view.queryByLabelText("Board title")).toBeNull();
    expect(view.queryByRole("button", { name: "Save board title" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Rename board" }));
    const input = view.getByLabelText("Board title");
    expect((input as HTMLInputElement).value).toBe("Customer workflow");

    fireEvent.change(input, { target: { value: "  Refund flow  " } });
    // Typing alone must not persist anything.
    expect(view.rpcCalls.some((call) => call.method === "board_apply_operations")).toBe(false);

    fireEvent.click(view.getByRole("button", { name: "Save board title" }));
    await waitFor(() => expect(lastApply(view.rpcCalls)).toEqual([{ type: "rename_board", title: "Refund flow" }]));
    await waitFor(() => expect(view.queryByLabelText("Board title")).toBeNull());
    expect(within(view.container.querySelector("header")!).getByText("Refund flow")).toBeTruthy();
  });

  it("exposes portable import and download actions", async () => {
    const objectUrls: string[] = [];
    const created: Blob[] = [];
    const downloads: Array<{ name: string; href: string }> = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((source: Blob | MediaSource) => {
      created.push(source as Blob);
      const url = `blob:canvas-${created.length}`;
      objectUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, href: this.href });
    });
    const pickFile = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);

    try {
      const view = await openBoard(rpcFor(boardWithSticky));

      const importInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(importInput).not.toBeNull();
      const accept = importInput!.getAttribute("accept") ?? "";
      for (const extension of [".png", ".jpg", ".jpeg", ".svg", ".canvas.json"]) {
        expect(accept).toContain(extension);
      }
      fireEvent.click(view.getByRole("button", { name: "Import board" }));
      expect(pickFile).toHaveBeenCalledTimes(1);

      expect(view.queryByRole("button", { name: /Editable Canvas JSON/ })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Download or export board" }));
      expect(view.getByRole("button", { name: /Editable Canvas JSON/ })).toBeTruthy();
      expect(view.getByRole("button", { name: /^SVG/ })).toBeTruthy();
      expect(view.getByRole("button", { name: /^PNG/ })).toBeTruthy();

      fireEvent.click(view.getByRole("button", { name: /Editable Canvas JSON/ }));
      expect(created).toHaveLength(1);
      expect(created[0]!.type).toBe("application/json");
      expect(downloads).toEqual([{ name: "customer-workflow.canvas.json", href: "blob:canvas-1" }]);
      // Choosing an export closes the menu again.
      expect(view.queryByRole("button", { name: /Editable Canvas JSON/ })).toBeNull();

      fireEvent.click(view.getByRole("button", { name: "Download or export board" }));
      fireEvent.click(view.getByRole("button", { name: /^SVG/ }));
      expect(created).toHaveLength(2);
      expect(created[1]!.type).toBe("image/svg+xml");
      expect(downloads[1]).toEqual({ name: "customer-workflow.svg", href: "blob:canvas-2" });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("places every library shape on the board and draws its real geometry", async () => {
    const view = await openBoard(rpcFor());
    const dock = view.getByRole("toolbar", { name: "Canvas tools" });
    fireEvent.click(within(dock).getByRole("button", { name: "Shapes" }));
    const picker = view.getByRole("toolbar", { name: "Shape choices" });
    fireEvent.click(within(picker).getByRole("button", { name: SHAPE_LABELS.cylinder }));
    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { clientX: 320, clientY: 240, button: 0 });
    await waitFor(() => {
      const call = view.inspection.rpcCalls.find((item) => item.method === "board_apply_operations");
      const operations = (call?.input as { operations: Array<{ node?: { kind: string } }> }).operations;
      expect(operations[0]?.node?.kind).toBe("cylinder");
    });
    view.lifecycle.unmount();
  });

  it("clips the shapes CSS can express and outlines the ones it cannot", async () => {
    const drawn: BoardDocument = {
      ...board,
      nodes: [
        { ...boardWithSticky.nodes[0]!, id: "hex", kind: "hexagon", x: 0, y: 0 },
        { ...boardWithSticky.nodes[0]!, id: "cyl", kind: "cylinder", x: 400, y: 0 },
      ],
    };
    const view = await openBoard(rpcFor(drawn));
    const hexagon = view.container.querySelector('[data-node-id="hex"]') as HTMLElement;
    const cylinder = view.container.querySelector('[data-node-id="cyl"]') as HTMLElement;
    // A hexagon is a polygon, so CSS clips the existing element and keeps the textarea inside it.
    expect(hexagon.getAttribute("data-shape")).toBe("hexagon");
    expect(hexagon.getAttribute("data-shape-outline")).toBeNull();
    expect(hexagon.style.getPropertyValue("--shape-clip")).toContain("polygon");
    expect(hexagon.querySelector(".diagram-shape-outline")).toBeNull();
    // A cylinder has curved edges CSS cannot clip, so it paints a real path instead.
    expect(cylinder.getAttribute("data-shape-outline")).toBe("true");
    const path = cylinder.querySelector(".diagram-shape-outline path");
    expect(path?.getAttribute("d")).toContain("M");
    expect(path?.getAttribute("d")).not.toContain("NaN");
    // Text is inset so it clears the cylinder's rim rather than overlapping it.
    expect(Number.parseFloat(cylinder.style.getPropertyValue("--shape-pad-top"))).toBeGreaterThan(
      Number.parseFloat(hexagon.style.getPropertyValue("--shape-pad-top")),
    );
    view.lifecycle.unmount();
  });

  it("renders the board-scoped chat tab", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const tab = (app.navPanels[0]!.fixedTabs ?? [])[0]!;

    const blank = renderSlot(tab, { subPath: "" }, { rpc: rpcFor() });
    expect(blank.getByText("Open a board to start diagramming with AI.")).toBeTruthy();
    expect(blank.rpcCalls).toEqual([]);
    blank.unmount();

    const view = renderSlot(tab, { subPath: "board-1" }, { rpc: rpcFor() });
    await waitFor(() => expect(view.getByTestId("bb-thread-chat")).toBeTruthy());
    expect(view.rpcCalls).toEqual([{ method: "board_get", input: { boardId: "board-1" } }]);
    const chat = view.getByTestId("bb-thread-chat");
    expect(chat.getAttribute("data-thread-id")).toBe("thr_canvas_1");
    expect(chat.getAttribute("data-variant")).toBe("compact");
    expect(chat.getAttribute("data-layout")).toBe("contained");
    expect(view.getByTestId("bb-thread-chat-leading-content").textContent).toContain("Customer workflow");
    view.unmount();

    // A board whose thread could not be provisioned offers to start one.
    const threadless: BoardDocument = { ...board, chatThreadId: null };
    const recovery = renderSlot(tab, { subPath: "board-1" }, { rpc: rpcFor(threadless) });
    await waitFor(() => expect(recovery.getByRole("button", { name: "Start chat" })).toBeTruthy());
    fireEvent.click(recovery.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(recovery.getByTestId("bb-thread-chat")).toBeTruthy());
    expect(recovery.rpcCalls.map((call) => call.method)).toEqual(["board_get", "board_start_chat"]);
    expect(recovery.getByTestId("bb-thread-chat").getAttribute("data-thread-id")).toBe("thr_canvas_1");
  });
});
