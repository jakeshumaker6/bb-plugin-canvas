import { beforeEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import type { BoardDocument, BoardOperation, BoardSummary } from "../src/domain";
import plugin, { BOARDS_CHANGED, rpcContract } from "../server";

const PLUGIN_ID = "canvas";

interface Loaded {
  host: FakePluginHost;
  /** `db.inTransaction` observed at each realtime publish, in order. */
  inTransactionAtPublish: boolean[];
  spawnArgs: unknown[][];
}

/**
 * Load the real server factory against the fake host, wrapping
 * `realtime.publish` so every test can prove invalidation happens outside the
 * SQLite write transaction rather than inside it.
 */
async function load(options?: { projects?: readonly { id: string }[] }): Promise<Loaded> {
  let threadCounter = 0;
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      projects: {
        list: async () => options?.projects ?? [{ id: "project-1", name: "Project" }],
      },
      threads: {
        spawn: async () => {
          threadCounter += 1;
          return { id: `thread-${threadCounter}` };
        },
      },
    },
  });

  const db = host.bb.storage.database();
  const inTransactionAtPublish: boolean[] = [];
  const realtime = host.bb.realtime as { publish: (channel: string, payload: unknown) => void };
  const publish = realtime.publish.bind(host.bb.realtime);
  realtime.publish = (channel, payload) => {
    inTransactionAtPublish.push(db.inTransaction);
    publish(channel, payload);
  };

  await plugin(host.bb);
  return {
    host,
    inTransactionAtPublish,
    spawnArgs: host.harness.sdk.callsTo("threads.spawn"),
  };
}

function call<Method extends keyof typeof rpcContract>(
  loaded: Loaded,
  method: Method,
  input?: unknown,
): Promise<unknown> {
  return loaded.host.harness.callRpc(method as string, input ?? null);
}

async function listBoards(loaded: Loaded): Promise<BoardSummary[]> {
  const result = (await call(loaded, "boards_list")) as { boards: BoardSummary[] };
  return result.boards;
}

async function getBoard(loaded: Loaded, boardId: string): Promise<BoardDocument> {
  const result = (await call(loaded, "board_get", { boardId })) as { board: BoardDocument };
  return result.board;
}

async function createBoard(loaded: Loaded, title: string): Promise<BoardDocument> {
  const result = (await call(loaded, "boards_create", { title })) as { board: BoardDocument };
  return result.board;
}

/** A small, fully-deterministic diagram: two nodes joined by an elbow connector. */
const DIAGRAM: BoardOperation[] = [
  { type: "add_node", node: { id: "n1", kind: "rectangle", x: 0, y: 0, color: "blue", text: "Start" } },
  { type: "add_node", node: { id: "n2", kind: "rectangle", x: 400, y: 0, color: "blue", text: "Finish" } },
  {
    type: "add_edge",
    edge: { id: "e1", source: "n1", target: "n2", color: "slate", label: "then", routing: "elbow" },
  },
];

function shape(board: BoardDocument) {
  return {
    nodes: board.nodes,
    edges: board.edges,
    comments: board.comments,
    version: board.version,
  };
}

function toolText(result: Awaited<ReturnType<FakePluginHost["harness"]["callAgentTool"]>>): string {
  if (typeof result === "string") return result;
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function isError(result: Awaited<ReturnType<FakePluginHost["harness"]["callAgentTool"]>>): boolean {
  return typeof result !== "string" && result.isError === true;
}

describe("canvas server", () => {
  let loaded: Loaded;

  beforeEach(async () => {
    loaded = await load();
  });

  it("creates a default durable board and provisions its hidden chat thread", async () => {
    const boards = await listBoards(loaded);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.chatThreadId).toBe("thread-1");

    const [args] = loaded.host.harness.sdk.callsTo("threads.spawn");
    expect(args?.[0]).toMatchObject({ projectId: "project-1", visibility: "hidden" });

    // Durable: a reload against the same storage reuses the board and does not
    // spawn a second thread.
    const reloaded = await loaded.host.harness.reload(plugin);
    const after = (await reloaded.harness.callRpc("boards_list", null)) as { boards: BoardSummary[] };
    expect(after.boards).toHaveLength(1);
    expect(after.boards[0]?.id).toBe(boards[0]?.id);
    expect(loaded.host.harness.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });

  it("keeps the board usable when chat provisioning fails, and board_start_chat retries", async () => {
    const failing = await load({ projects: [] });
    const boards = await listBoards(failing);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.chatThreadId).toBeNull();

    failing.host.harness.sdk.stub("projects.list", async () => [{ id: "project-9" }]);
    const started = (await failing.host.harness.callRpc("board_start_chat", {
      boardId: boards[0]?.id,
    })) as { threadId: string };
    expect(started.threadId).toBe("thread-1");
    expect((await getBoard(failing, boards[0]!.id)).chatThreadId).toBe("thread-1");
  });

  it("applies the same validated operations over RPC and via the agent tool, reaching identical state", async () => {
    const viaRpc = await createBoard(loaded, "Via RPC");
    const viaTool = await createBoard(loaded, "Via tool");
    expect(viaTool.chatThreadId).not.toBeNull();

    const rpcResult = (await call(loaded, "board_apply_operations", {
      boardId: viaRpc.id,
      operations: DIAGRAM,
    })) as { board: BoardDocument };

    const toolResult = await loaded.host.harness.callAgentTool(
      "canvas_apply_operations",
      { operations: DIAGRAM },
      { threadId: viaTool.chatThreadId!, projectId: "project-1" },
    );
    expect(isError(toolResult)).toBe(false);

    const stored = await getBoard(loaded, viaTool.id);
    expect(shape(stored)).toEqual(shape(rpcResult.board));
    expect(stored.version).toBe(1);
    expect(stored.edges[0]).toMatchObject({ label: "then", routing: "elbow" });
  });

  it("resolves the board from the calling thread, never from a tool parameter", async () => {
    const tools = loaded.host.harness.registrations.agentTools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "canvas_apply_operations",
      "canvas_get_board",
    ]);
    for (const tool of tools) {
      const schema = tool.inputSchema as { properties?: Record<string, unknown> };
      expect(Object.keys(schema.properties ?? {})).not.toContain("boardId");
    }
    // The description tells the agent about connectors, layering, grouping and locking.
    const apply = tools.find((tool) => tool.name === "canvas_apply_operations");
    expect(apply?.description).toMatch(/elbow/i);
    expect(apply?.description).toMatch(/reorder_nodes/);
    expect(apply?.description).toMatch(/groupId/);
    expect(apply?.description).toMatch(/locked/);
  });

  it("contributes board tools only to Canvas-origin threads", async () => {
    const board = await createBoard(loaded, "Origin");
    const threadId = board.chatThreadId!;

    const mine = await loaded.host.harness.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        thread: { id: threadId },
        origin: { kind: "fork", pluginId: PLUGIN_ID },
      }),
    );
    expect(mine.tools.map((tool) => tool.name).sort()).toEqual([
      "canvas_apply_operations",
      "canvas_get_board",
    ]);

    const foreign = await loaded.host.harness.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        thread: { id: threadId },
        origin: { kind: "fork", pluginId: "side-chat" },
      }),
    );
    expect(foreign.tools).toEqual([]);

    const ordinary = await loaded.host.harness.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        thread: { id: "thread-somewhere-else" },
        origin: { kind: null, pluginId: null },
      }),
    );
    expect(ordinary.tools).toEqual([]);
  });

  it("refuses a tool call from a thread that is not mapped to a board", async () => {
    const board = await createBoard(loaded, "Guarded");
    await call(loaded, "board_apply_operations", { boardId: board.id, operations: DIAGRAM });

    for (const name of ["canvas_get_board", "canvas_apply_operations"]) {
      const result = await loaded.host.harness.callAgentTool(
        name,
        name === "canvas_get_board" ? {} : { operations: DIAGRAM },
        { threadId: "thread-not-a-board", projectId: "project-1" },
      );
      expect(isError(result)).toBe(true);
      expect(toolText(result)).toMatch(/not (linked|mapped)|no canvas board/i);
    }

    // The refused calls changed nothing.
    expect((await getBoard(loaded, board.id)).version).toBe(1);
  });

  it("a rejected operation leaves the stored board unchanged and the version un-bumped", async () => {
    const board = await createBoard(loaded, "Atomic");
    await call(loaded, "board_apply_operations", { boardId: board.id, operations: DIAGRAM });
    const before = await getBoard(loaded, board.id);
    const signalsBefore = loaded.host.harness.realtimeSignals.length;

    await expect(
      call(loaded, "board_apply_operations", {
        boardId: board.id,
        operations: [
          { type: "add_node", node: { id: "n3", kind: "sticky", x: 10, y: 10, color: "yellow" } },
          { type: "update_node", id: "missing-node", patch: { text: "nope" } },
        ] satisfies BoardOperation[],
      }),
    ).rejects.toThrow();

    const after = await getBoard(loaded, board.id);
    expect(after).toEqual(before);
    expect(after.version).toBe(1);
    expect(after.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(loaded.host.harness.realtimeSignals).toHaveLength(signalsBefore);
  });

  it("refuses more than 200 operations in one agent call", async () => {
    const board = await createBoard(loaded, "Too big");
    const operations = Array.from({ length: 201 }, (_, index): BoardOperation => ({
      type: "add_node",
      node: { id: `bulk-${index}`, kind: "sticky", x: index, y: 0, color: "yellow" },
    }));
    await expect(
      loaded.host.harness.callAgentTool(
        "canvas_apply_operations",
        { operations },
        { threadId: board.chatThreadId!, projectId: "project-1" },
      ),
    ).rejects.toThrow();
    expect((await getBoard(loaded, board.id)).version).toBe(0);
  });

  it("publishes realtime invalidation after the write transaction commits", async () => {
    const board = await createBoard(loaded, "Realtime");
    const before = loaded.host.harness.realtimeSignals.length;

    await call(loaded, "board_apply_operations", { boardId: board.id, operations: DIAGRAM });

    const published = loaded.host.harness.realtimeSignals.slice(before);
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({ channel: BOARDS_CHANGED, payload: { boardId: board.id } });
    // The bug a previous review caught: publishing from inside the transaction.
    expect(loaded.inTransactionAtPublish.every((inside) => inside === false)).toBe(true);
    // Committed before the signal: a client refetching on it sees the new version.
    expect((await getBoard(loaded, board.id)).version).toBe(1);
  });

  it("deletes a board and reports unknown boards clearly", async () => {
    const board = await createBoard(loaded, "Doomed");
    const deleted = (await call(loaded, "board_delete", { boardId: board.id })) as {
      deleted: boolean;
    };
    expect(deleted.deleted).toBe(true);
    expect((await listBoards(loaded)).map((entry) => entry.id)).not.toContain(board.id);
    await expect(call(loaded, "board_get", { boardId: board.id })).rejects.toThrow(/board/i);
  });
});
