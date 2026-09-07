// bb-plugin-canvas — the Canvas backend.
//
// One SQLite database owns every board: a `boards` row per board holding the
// summary columns the library view lists by, plus the whole document (nodes,
// edges, comments) as a versioned JSON snapshot. Three surfaces read and write
// through the same code path — the panel over RPC (app.tsx), the per-board AI
// chat through two agent tools, and imports — so a board can never diverge
// depending on who edited it.
//
// Validation lives entirely in src/domain.ts. Nothing here re-implements it:
// the RPC contract, the agent tools, and the persistence layer all funnel into
// `applyBoardOperations`, which is the single arbiter of what a board may
// become.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import {
  applyBoardOperations,
  boardDocumentSchema,
  boardOperationSchema,
  boardSummarySchema,
  createEmptyBoard,
  toBoardSummary,
  type BoardDocument,
  type BoardOperation,
} from "./src/domain";
import { parseBoardImport } from "./src/portable";

/** Realtime channel app.tsx listens on; the payload names the board that moved. */
export const BOARDS_CHANGED = "boards-changed";

/** `applyBoardOperations` refuses more than this, and so do we, up front. */
const MAX_OPERATIONS = 200;

const DEFAULT_BOARD_TITLE = "My first board";

const boardIdSchema = z.string().min(1).max(100);
const operationsSchema = z.array(boardOperationSchema).min(1).max(MAX_OPERATIONS);

// Both schemas run at the wire boundary; app.tsx imports only the type.
export const rpcContract = defineRpcContract({
  boards_list: {
    input: z.null(),
    output: z.object({ boards: z.array(boardSummarySchema) }),
  },
  boards_create: {
    input: z.object({ title: z.string().trim().min(1).max(200) }),
    output: z.object({ board: boardDocumentSchema }),
  },
  board_get: {
    input: z.object({ boardId: boardIdSchema }),
    output: z.object({ board: boardDocumentSchema }),
  },
  board_apply_operations: {
    input: z.object({ boardId: boardIdSchema, operations: operationsSchema }),
    output: z.object({ board: boardDocumentSchema }),
  },
  board_import: {
    input: z.object({
      boardId: boardIdSchema,
      fileName: z.string().trim().min(1).max(255),
      content: z.string().max(8_000_000),
    }),
    output: z.object({ board: boardDocumentSchema }),
  },
  board_delete: {
    input: z.object({ boardId: boardIdSchema }),
    output: z.object({ deleted: z.literal(true) }),
  },
  board_start_chat: {
    input: z.object({ boardId: boardIdSchema }),
    output: z.object({ threadId: z.string().min(1) }),
  },
});

/** Append-only. Never reorder or edit a shipped statement. */
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE INDEX IF NOT EXISTS boards_updated_idx ON boards(updated_at DESC)`,
];

interface BoardRow {
  id: string;
  document_json: string;
}

const APPLY_OPERATIONS_DESCRIPTION = [
  "Edit the Canvas board attached to this chat. The board is resolved from the",
  "thread you are running in — there is no board parameter and you cannot reach",
  "any other board.",
  "",
  "Operations (max 200 per call, applied in order, all-or-nothing):",
  "add_node, update_node, remove_nodes, add_edge, update_edge, remove_edges,",
  "reorder_nodes, add_comment, resolve_comment, delete_comment, rename_board.",
  "",
  "Nodes are sticky, rectangle, ellipse, diamond, text or image. Give x/y in",
  "board coordinates; width/height default sensibly per kind.",
  "",
  "Connectors (edges) carry a `label` and a `routing` of straight, elbow or",
  "curved — elbow reads best for flowcharts and org charts, curved for loose",
  "mind maps, straight for short direct links. `arrow` is none, end or both.",
  "",
  "Layer nodes with `reorder_nodes` (placement front, back, forward, backward):",
  "later nodes paint on top. Group nodes that move together by giving them a",
  "shared `groupId`, and pin a node in place by setting `locked: true`.",
].join("\n");

const GET_BOARD_DESCRIPTION = [
  "Read the Canvas board attached to this chat: its title, nodes, connectors",
  "and comments, as JSON. The board is resolved from the thread you are running",
  "in. Call this before editing so you place new shapes without overlapping the",
  "existing ones.",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const db: Database = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const now = () => new Date().toISOString();
  const makeId = () => randomUUID();

  // ---------------------------------------------------------------- storage

  const selectAll = db.prepare<[], BoardRow>(
    "SELECT id, document_json FROM boards ORDER BY created_at ASC, id ASC",
  );
  const selectOne = db.prepare<[string], BoardRow>(
    "SELECT id, document_json FROM boards WHERE id = ?",
  );
  // The board carries its own chat thread id inside the document, so a thread lookup
  // reads the snapshot rather than a denormalised column.
  const selectAllForThread = db.prepare<[], BoardRow>("SELECT id, document_json FROM boards");
  const insertBoard = db.prepare(
    `INSERT INTO boards (id, document_json, created_at, updated_at)
     VALUES (@id, @document_json, @createdAt, @updatedAt)`,
  );
  const updateBoard = db.prepare(
    `UPDATE boards SET document_json = @document_json, updated_at = @updatedAt WHERE id = @id`,
  );
  const deleteBoard = db.prepare<[string]>("DELETE FROM boards WHERE id = ?");

  /** The snapshot is re-parsed on read, so a schema change never leaks a stale shape. */
  function decode(row: BoardRow): BoardDocument {
    return boardDocumentSchema.parse(JSON.parse(row.document_json));
  }
  function encode(board: BoardDocument) {
    return {
      id: board.id,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      document_json: JSON.stringify(board),
    };
  }

  function readBoard(boardId: string): BoardDocument | null {
    const row = selectOne.get(boardId);
    return row === undefined ? null : decode(row);
  }
  function requireBoard(boardId: string): BoardDocument {
    const board = readBoard(boardId);
    if (board === null) throw new Error(`No board with id ${boardId}`);
    return board;
  }
  function listBoards(): BoardDocument[] {
    return selectAll.all().map(decode);
  }

  /**
   * The board a thread may edit. The only mapping there is: a thread reaches
   * exactly the board whose chat it was spawned for, and nothing else.
   */
  function boardForThread(threadId: string): BoardDocument | null {
    for (const row of selectAllForThread.all()) {
      const board = decode(row);
      if (board.chatThreadId === threadId) return board;
    }
    return null;
  }

  // ------------------------------------------------------------ write paths

  /**
   * Validate, apply and persist in ONE transaction; publish only after it
   * commits. A rejected operation rolls the whole batch back and leaves the
   * previous snapshot — and its version — exactly as it was.
   */
  function commit(boardId: string, mutate: (current: BoardDocument) => BoardDocument): BoardDocument {
    const write = db.transaction((): BoardDocument => {
      const current = requireBoard(boardId);
      const next = mutate(current);
      const changed = updateBoard.run(encode(next)).changes;
      if (changed !== 1) throw new Error(`No board with id ${boardId}`);
      return next;
    });
    const next = write();
    // After the commit, never inside it: a client that refetches on this signal
    // must be able to read the state the signal is announcing.
    bb.realtime.publish(BOARDS_CHANGED, { boardId });
    return next;
  }

  function applyOperations(boardId: string, operations: readonly BoardOperation[]): BoardDocument {
    const validated = operationsSchema.parse(operations);
    return commit(boardId, (current) =>
      applyBoardOperations(current, validated, { now: now(), makeId }),
    );
  }

  function createBoard(title: string, projectId: string | null): BoardDocument {
    const board = createEmptyBoard({ id: makeId(), title, now: now(), projectId });
    db.transaction(() => insertBoard.run(encode(board)))();
    bb.realtime.publish(BOARDS_CHANGED, { boardId: board.id });
    return board;
  }

  // ------------------------------------------------------------ chat thread

  async function resolveProjectId(preferred: string | null): Promise<string | null> {
    if (preferred !== null) return preferred;
    const projects = await bb.sdk.projects.list();
    return projects[0]?.id ?? null;
  }

  /**
   * Every board gets one durable hidden thread for its chat, created lazily.
   * Provisioning is best-effort by design: a board with no thread is still a
   * usable board, and `board_start_chat` retries later.
   */
  async function provisionChatThread(boardId: string): Promise<string | null> {
    const board = requireBoard(boardId);
    if (board.chatThreadId !== null) return board.chatThreadId;

    const projectId = await resolveProjectId(board.projectId);
    if (projectId === null) return null;

    const thread = await bb.sdk.threads.spawn({
      projectId,
      environment: { type: "project-default" },
      visibility: "hidden",
      title: `Canvas — ${board.title}`,
      input: [],
    });
    const threadId = thread.id;

    commit(boardId, (current) =>
      boardDocumentSchema.parse({ ...current, projectId, chatThreadId: threadId }),
    );
    return threadId;
  }

  async function tryProvisionChatThread(boardId: string): Promise<string | null> {
    try {
      return await provisionChatThread(boardId);
    } catch (cause) {
      bb.log.warn(`could not provision a chat thread for board ${boardId}: ${String(cause)}`);
      return null;
    }
  }

  // ------------------------------------------------------------------- rpc

  bb.rpc.register(rpcContract, {
    boards_list: () => ({ boards: listBoards().map(toBoardSummary) }),
    boards_create: async ({ title }) => {
      const board = createBoard(title, null);
      await tryProvisionChatThread(board.id);
      return { board: requireBoard(board.id) };
    },
    board_get: ({ boardId }) => ({ board: requireBoard(boardId) }),
    board_apply_operations: ({ boardId, operations }) => ({
      board: applyOperations(boardId, operations),
    }),
    board_import: ({ boardId, fileName, content }) => {
      const parsed = parseBoardImport({ fileName, content });
      // A picture is not a board: it lands as one image node beside whatever is
      // already there, through the same validated operation path as every other
      // edit. A native file replaces the board's contents wholesale.
      if (parsed.kind === "reference") {
        const board = requireBoard(boardId);
        const right = board.nodes.reduce((edge, node) => Math.max(edge, node.x + node.width), 0);
        return {
          board: applyOperations(boardId, [
            {
              type: "add_node",
              node: {
                kind: parsed.node.kind,
                x: board.nodes.length === 0 ? 0 : right + 80,
                y: 0,
                width: parsed.node.width,
                height: parsed.node.height,
                imageData: parsed.node.imageData,
                color: "gray",
              },
            },
          ]),
        };
      }
      const imported = parsed.board;
      return {
        board: commit(boardId, (current) =>
          boardDocumentSchema.parse({
            ...imported,
            // The target board keeps its own identity, project and chat.
            id: current.id,
            projectId: current.projectId,
            chatThreadId: current.chatThreadId,
            createdAt: current.createdAt,
            version: current.version + 1,
            updatedAt: now(),
          }),
        ),
      };
    },
    board_delete: ({ boardId }) => {
      requireBoard(boardId);
      db.transaction(() => deleteBoard.run(boardId))();
      bb.realtime.publish(BOARDS_CHANGED, { boardId });
      return { deleted: true as const };
    },
    board_start_chat: async ({ boardId }) => {
      const threadId = await provisionChatThread(boardId);
      if (threadId === null) throw new Error("No project is available to host this board's chat");
      return { threadId };
    },
  });

  // ------------------------------------------------------------ agent tools

  /**
   * The security boundary. A tool call carries no board id: the board is
   * resolved from the calling thread, so the chat agent can only ever touch
   * the board its thread was opened for. A thread with no board is refused.
   */
  function requireBoardForThread(threadId: string): BoardDocument {
    const board = boardForThread(threadId);
    if (board === null) {
      throw new Error(
        `This thread is not linked to a Canvas board, so no board can be read or edited from it.`,
      );
    }
    return board;
  }

  function toolError(cause: unknown) {
    return {
      content: [{ type: "text" as const, text: cause instanceof Error ? cause.message : String(cause) }],
      isError: true,
    };
  }

  bb.agents.registerTool({
    name: "canvas_get_board",
    description: GET_BOARD_DESCRIPTION,
    parameters: z.object({}).strict(),
    execute: (_params, ctx) => {
      try {
        const board = requireBoardForThread(ctx.threadId);
        return JSON.stringify(
          {
            ...board,
            // Base64 image payloads are useless to the model and huge.
            nodes: board.nodes.map(({ imageData, ...node }) =>
              imageData === undefined ? node : { ...node, imageData: "<image omitted>" },
            ),
          },
          null,
          2,
        );
      } catch (cause) {
        return toolError(cause);
      }
    },
  });

  bb.agents.registerTool({
    name: "canvas_apply_operations",
    description: APPLY_OPERATIONS_DESCRIPTION,
    parameters: z.object({ operations: operationsSchema }).strict(),
    execute: ({ operations }, ctx) => {
      try {
        const board = requireBoardForThread(ctx.threadId);
        const next = applyOperations(board.id, operations);
        return `Applied ${operations.length} operation(s) to "${next.title}". The board now has ${next.nodes.length} node(s) and ${next.edges.length} connector(s) at version ${next.version}.`;
      } catch (cause) {
        return toolError(cause);
      }
    },
  });

  // Contributed only to threads this plugin spawned — an ordinary thread, or
  // another plugin's, never sees the board tools at all.
  bb.agents.configure((context) => {
    if (context.origin.pluginId !== bb.pluginId) return { tools: [], skills: [] };
    return { tools: ["canvas_get_board", "canvas_apply_operations"], skills: [] };
  });

  // --------------------------------------------------------------- bootstrap

  // The panel is never empty: on first load there is always one board, with a
  // chat thread if one can be provisioned.
  const boards = listBoards();
  const defaultBoard = boards[0] ?? createBoard(DEFAULT_BOARD_TITLE, null);
  if (defaultBoard.chatThreadId === null) await tryProvisionChatThread(defaultBoard.id);

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
