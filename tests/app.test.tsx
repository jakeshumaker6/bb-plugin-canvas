// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { BoardDocument, BoardSummary } from "../src/domain";

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

describe("Canvas bb surface", () => {
  it("registers a distinct left-sidebar panel and native Chat fixed tab", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.navPanels).toHaveLength(1);
