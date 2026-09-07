// Adversarial pass — DATA INTEGRITY AND PERSISTENCE.
//
// Every test below is written to describe the behaviour a user is entitled to.
// Tests that currently FAIL are marked ADVERSARIAL and name the defect; tests
// marked CONTROL confirm an invariant that already holds and exist so a future
// "fix" cannot quietly trade one of them away.
//
// Nothing here is hand-written board state: boards are built with
// `createEmptyBoard` + `applyBoardOperations` (or through the real server over
// the SDK fake host) so the tests exercise the same arbiter the product does.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  applyBoardOperations,
  boardDocumentSchema,
  createEmptyBoard,
  type BoardDocument,
  type BoardOperation,
} from "../src/domain";
import { parseBoardImport, serializeBoardJson, serializeBoardSvg } from "../src/portable";
import plugin, { rpcContract } from "../server";

const PLUGIN_ID = "canvas";

interface Loaded {
  host: FakePluginHost;
}

async function load(): Promise<Loaded> {
  let threadCounter = 0;
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      projects: { list: async () => [{ id: "project-1", name: "Project" }] },
      threads: {
        spawn: async () => {
          threadCounter += 1;
          return { id: `thread-${threadCounter}` };
        },
      },
    },
  });
  await plugin(host.bb);
  return { host };
}

function call<Method extends keyof typeof rpcContract>(
  loaded: Loaded,
  method: Method,
  input?: unknown,
): Promise<unknown> {
  return loaded.host.harness.callRpc(method as string, input ?? null);
}

async function createBoard(loaded: Loaded, title: string): Promise<BoardDocument> {
  const result = (await call(loaded, "boards_create", { title })) as { board: BoardDocument };
  return result.board;
}

async function getBoard(loaded: Loaded, boardId: string): Promise<BoardDocument> {
  const result = (await call(loaded, "board_get", { boardId })) as { board: BoardDocument };
  return result.board;
}

async function apply(
  loaded: Loaded,
  boardId: string,
  operations: BoardOperation[],
): Promise<BoardDocument> {
  const result = (await call(loaded, "board_apply_operations", { boardId, operations })) as {
    board: BoardDocument;
  };
  return result.board;
}

/**
 * Exactly what app.tsx `restore` does for undo/redo: round-trip a whole
 * snapshot document back through `board_import` under a synthetic filename.
 * See app.tsx:687-701.
 */
async function restoreSnapshot(
  loaded: Loaded,
  boardId: string,
  snapshot: BoardDocument,
): Promise<BoardDocument> {
  const result = (await call(loaded, "board_import", {
    boardId,
    fileName: "history.canvas.json",
    content: serializeBoardJson(snapshot),
  })) as { board: BoardDocument };
  return result.board;
}

let ids = 0;
const makeId = () => `id-${(ids += 1)}`;
const NOW = "2026-01-01T00:00:00.000Z";

function board(operations: BoardOperation[]): BoardDocument {
  return applyBoardOperations(
    createEmptyBoard({ id: "board-x", title: "Board", now: NOW }),
    operations,
    { now: NOW, makeId },
  );
}

const STICKY = (id: string, x = 0, y = 0): BoardOperation => ({
  type: "add_node",
  node: { id, kind: "sticky", x, y, color: "yellow", text: id },
});

/** A board that exercises every persisted field at once. */
const RICH: BoardOperation[] = [
  {
    type: "add_node",
    node: {
      id: "n1",
      kind: "rectangle",
      x: -40,
      y: 12,
      width: 260,
      height: 140,
      text: "Start\nhere",
      color: "blue",
      fontFamily: "mono",
      fontSize: 22,
      fontWeight: 700,
      textAlign: "right",
      locked: true,
      groupId: "group-a",
    },
  },
  {
    type: "add_node",
    node: {
      id: "n2",
      kind: "image",
      x: 400,
      y: 0,
      width: 480,
      height: 320,
      color: "white",
      imageData: "data:image/png;base64,aGVsbG8=",
      groupId: "group-a",
    },
  },
  {
    type: "add_edge",
    edge: {
      id: "e1",
      source: "n1",
      target: "n2",
      color: "coral",
      label: "then",
      routing: "curved",
      arrow: "both",
    },
  },
  { type: "add_comment", comment: { id: "c1", nodeId: "n1", message: "check this" } },
  { type: "resolve_comment", id: "c1", resolved: true },
];

describe("adversarial: undo / redo", () => {
  let loaded: Loaded;
  beforeEach(async () => {
    loaded = await load();
  });

  it("ADVERSARIAL: undo of the user's own edit destroys an agent edit made in between", async () => {
    const target = await createBoard(loaded, "Shared");

    // The user is about to add a note; app.tsx snapshots the board first.
    const snapshotBeforeUserEdit = await getBoard(loaded, target.id);
    await apply(loaded, target.id, [STICKY("user-note", 0, 0)]);

    // The chat agent, working on the same board, adds its own note.
    await apply(loaded, target.id, [STICKY("agent-note", 600, 0)]);

    // The user presses Cmd-Z once to take back their own note.
    const after = await restoreSnapshot(loaded, target.id, snapshotBeforeUserEdit);

    const remaining = after.nodes.map((node) => node.id);
    // Expected: undo reverts only the user's own operation. The agent's node,
    // which the user never asked to remove and cannot see disappear, survives.
    expect(remaining).toContain("agent-note");
    expect(remaining).not.toContain("user-note");
  });

  it("ADVERSARIAL: undo of a group drag reverts every node the agent touched too", async () => {
    const target = await createBoard(loaded, "Group drag");
    await apply(loaded, target.id, [STICKY("a", 0, 0), STICKY("b", 300, 0), STICKY("c", 600, 0)]);

    const beforeDrag = await getBoard(loaded, target.id);
    // Group drag of a + b (app.tsx beginNodeDrag persists absolute coordinates).
    await apply(loaded, target.id, [
      { type: "update_node", id: "a", patch: { x: 100, y: 100 } },
      { type: "update_node", id: "b", patch: { x: 400, y: 100 } },
    ]);
    // The agent, meanwhile, retitles a node the drag never touched.
    await apply(loaded, target.id, [{ type: "update_node", id: "c", patch: { text: "agent text" } }]);

    const after = await restoreSnapshot(loaded, target.id, beforeDrag);

    expect(after.nodes.find((node) => node.id === "a")?.x).toBe(0);
    // Expected: undoing a drag of a and b leaves c exactly as the agent left it.
    expect(after.nodes.find((node) => node.id === "c")?.text).toBe("agent text");
  });

  it("ADVERSARIAL: a snapshot restore is accepted even though the board moved on underneath it", async () => {
    const target = await createBoard(loaded, "Stale undo");
    await apply(loaded, target.id, [STICKY("a")]);
    const snapshot = await getBoard(loaded, target.id);

    // Another writer advances the board past the snapshot's version.
    await apply(loaded, target.id, [STICKY("b", 300, 0)]);
    await apply(loaded, target.id, [STICKY("c", 600, 0)]);

    // Expected: restoring a document whose `version` is older than the stored
    // board is a conflict and must be refused (or merged), not applied blind.
    await expect(restoreSnapshot(loaded, target.id, snapshot)).rejects.toThrow(
      /version|stale|conflict|changed/i,
    );
  });

  it("CONTROL: a restore keeps the board id, project and chat thread, and bumps the version", async () => {
    const target = await createBoard(loaded, "Identity");
    const snapshot = await getBoard(loaded, target.id);
    await apply(loaded, target.id, [STICKY("a")]);

    const after = await restoreSnapshot(loaded, target.id, snapshot);
    expect(after.id).toBe(target.id);
    expect(after.chatThreadId).toBe(target.chatThreadId);
    expect(after.chatThreadId).not.toBeNull();
    expect(after.projectId).toBe(target.projectId);
    expect(after.createdAt).toBe(target.createdAt);
    expect(after.version).toBe(2);
  });

  it("CONTROL: a restore cannot resurrect a deleted board", async () => {
    const target = await createBoard(loaded, "Doomed");
    const snapshot = await getBoard(loaded, target.id);
    await call(loaded, "board_delete", { boardId: target.id });

    await expect(restoreSnapshot(loaded, target.id, snapshot)).rejects.toThrow(/board/i);
    const remaining = (await call(loaded, "boards_list")) as { boards: { id: string }[] };
    expect(remaining.boards.map((entry) => entry.id)).not.toContain(target.id);
  });

  it("ADVERSARIAL: an undo snapshot of a board with a legal large image cannot be restored", async () => {
    const target = await createBoard(loaded, "Big picture");
    // imageData is capped at 7,000,000 characters by the node schema, and
    // src/clipboard.ts happily creates one this size ("under 5 MB").
    const imageData = `data:image/png;base64,${"A".repeat(5_600_000)}`;
    await apply(loaded, target.id, [
      {
        type: "add_node",
        node: { kind: "image", x: 0, y: 0, color: "white", imageData },
      },
    ]);

    const snapshot = await getBoard(loaded, target.id);
    // Expected: any board the product let the user build can be undone and
    // exported. src/portable.ts MAX_IMPORT_CHARS (5,000,000) is below what the
    // node schema permits, so this legal board is un-restorable and
    // un-importable, and app.tsx has already popped the history entry.
    await expect(restoreSnapshot(loaded, target.id, snapshot)).resolves.toBeDefined();
  });
});

describe("adversarial: concurrent editors", () => {
  let loaded: Loaded;
  beforeEach(async () => {
    loaded = await load();
  });

  it("ADVERSARIAL: a stale UI drag silently overwrites a newer agent move", async () => {
    const target = await createBoard(loaded, "Race");
    await apply(loaded, target.id, [STICKY("n1", 0, 0)]);

    // The UI reads the board and the user picks the node up at x = 0.
    const asSeenByTheUi = await getBoard(loaded, target.id);
    expect(asSeenByTheUi.nodes[0]?.x).toBe(0);

    // Mid-drag, the agent relocates the same node.
    await apply(loaded, target.id, [{ type: "update_node", id: "n1", patch: { x: 900 } }]);

    // Pointer-up. app.tsx:1038 persists ABSOLUTE coordinates computed from the
    // origin captured at drag start, with no expected version on the wire.
    const stale = asSeenByTheUi.nodes[0]!;
    // Expected: the write is rejected as stale so the agent's edit is not lost.
    await expect(
      call(loaded, "board_apply_operations", {
        boardId: target.id,
        expectedVersion: asSeenByTheUi.version,
        operations: [
          { type: "update_node", id: "n1", patch: { x: stale.x + 10, y: stale.y } },
        ] satisfies BoardOperation[],
      }),
    ).rejects.toThrow(/version|stale|conflict/i);
  });

  it("ADVERSARIAL: a gesture larger than the 200-operation cap applies only partially", async () => {
    const target = await createBoard(loaded, "Tidy up 201");
    const creates: BoardOperation[] = Array.from({ length: 200 }, (_, index) =>
      STICKY(`n${index}`, index * 300, 0),
    );
    await apply(loaded, target.id, creates);
    const before = await getBoard(loaded, target.id);

    // One user gesture (tidy up / select-all nudge) producing 201 operations.
    // app.tsx:677 splits it into 200 + 1 separate RPC calls, each its own
    // transaction. The last operation names a node the agent has just deleted.
    const gesture: BoardOperation[] = [
      ...Array.from({ length: 200 }, (_, index): BoardOperation => ({
        type: "update_node",
        id: `n${index}`,
        patch: { y: 500 },
      })),
      { type: "update_node", id: "deleted-by-someone-else", patch: { y: 500 } },
    ];

    const chunks: BoardOperation[][] = [gesture.slice(0, 200), gesture.slice(200)];
    let failed = false;
    for (const chunk of chunks) {
      try {
        await apply(loaded, target.id, chunk);
      } catch {
        failed = true;
      }
    }
    expect(failed).toBe(true);

    const after = await getBoard(loaded, target.id);
    // Expected: one gesture is one atomic change. Either every node moved or
    // none did — the user must never be left with half a tidy-up.
    expect(after.nodes.map((node) => node.y)).toEqual(before.nodes.map((node) => node.y));
  });

  it("CONTROL: a rejected operation mid-batch leaves the board and its version untouched", async () => {
    const target = await createBoard(loaded, "Atomic");
    await apply(loaded, target.id, [STICKY("a")]);
    const before = await getBoard(loaded, target.id);
    const signals = loaded.host.harness.realtimeSignals.length;

    await expect(
      apply(loaded, target.id, [
        STICKY("b", 300, 0),
        { type: "update_node", id: "ghost", patch: { x: 1 } },
        STICKY("c", 600, 0),
      ]),
    ).rejects.toThrow();

    expect(await getBoard(loaded, target.id)).toEqual(before);
    // Realtime must not announce a change that did not happen.
    expect(loaded.host.harness.realtimeSignals).toHaveLength(signals);
  });
});

describe("adversarial: round-trip fidelity", () => {
  it("CONTROL: board -> JSON -> import preserves every persisted field", () => {
    const source = board(RICH);
    const parsed = parseBoardImport({
      fileName: "board.canvas.json",
      content: serializeBoardJson(source),
    });
    expect(parsed.kind).toBe("native");
    if (parsed.kind !== "native") throw new Error("unreachable");
    expect(parsed.board).toEqual(source);
  });

  it("CONTROL: board -> SVG -> import preserves every persisted field", () => {
    const source = board(RICH);
    const parsed = parseBoardImport({ fileName: "board.svg", content: serializeBoardSvg(source) });
    expect(parsed.kind).toBe("native");
    if (parsed.kind !== "native") throw new Error("unreachable");
    expect(parsed.board).toEqual(source);
  });

  it("ADVERSARIAL: SVG export of a distant-but-finite node writes non-numeric coordinates", () => {
    const source = board([
      { type: "add_node", node: { id: "far", kind: "sticky", x: 1e308, y: 0, color: "yellow" } },
    ]);
    const svg = serializeBoardSvg(source);
    // Expected: every coordinate the exporter emits is a finite number, so the
    // file opens in any SVG viewer. src/portable.ts:71 `num` multiplies by 100
    // before rounding, which overflows to Infinity for large finite inputs.
    expect(svg).not.toMatch(/"[-]?Infinity/);
    expect(svg).not.toMatch(/NaN/);
  });

  it("ADVERSARIAL: SVG export copies control characters straight into the XML", () => {
    const source = board([
      {
        type: "add_node",
        node: { id: "n1", kind: "sticky", x: 0, y: 0, color: "yellow", text: "before\u0000after\u000Bend" },
      },
    ]);
    const svg = serializeBoardSvg(source);
    // Expected: escapeXml also neutralises characters XML forbids, so the
    // exported picture is well-formed. Today the raw byte lands in a <tspan>
    // and every parser rejects the file.
    expect(svg).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });
});

describe("adversarial: schema evolution", () => {
  const envelope = (extra: Record<string, unknown>) =>
    JSON.stringify({
      schemaVersion: 1,
      id: "board-legacy",
      title: "Legacy",
      projectId: null,
      chatThreadId: null,
      version: 3,
      createdAt: NOW,
      updatedAt: NOW,
      nodes: [],
      edges: [],
      comments: [],
      ...extra,
    });

  it("CONTROL: nodes and edges written before locked/groupId/routing/arrow still load", () => {
    const content = envelope({
      nodes: [
        { id: "n1", kind: "sticky", x: 0, y: 0, width: 220, height: 160, text: "old", color: "yellow" },
        { id: "n2", kind: "text", x: 400, y: 0, width: 240, height: 72, text: "old", color: "white" },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2", color: "gray" }],
    });
    const parsed = parseBoardImport({ fileName: "legacy.canvas.json", content });
    if (parsed.kind !== "native") throw new Error("expected a native board");
    expect(parsed.board.nodes[0]).toMatchObject({
      locked: false,
      groupId: null,
      fontFamily: "inter",
      fontSize: 17,
      textAlign: "left",
    });
    expect(parsed.board.nodes[1]).toMatchObject({ fontSize: 21, fontWeight: 650, textAlign: "center" });
    expect(parsed.board.edges[0]).toMatchObject({ routing: "straight", arrow: "end", label: "" });
  });

  it("CONTROL: a board written by a newer schema version is refused, not half-read", () => {
    const content = envelope({ schemaVersion: 2 });
    expect(() => parseBoardImport({ fileName: "future.canvas.json", content })).toThrow(
      /schema version/i,
    );
  });

  it("ADVERSARIAL: the document envelope gets no defaults, so an older file is refused wholesale", () => {
    const raw = JSON.parse(envelope({})) as Record<string, unknown>;
    delete raw.chatThreadId;
    delete raw.projectId;
    // Expected: the same forgiving preprocess that gives nodes and edges their
    // defaults applies to the envelope, so a board file predating projectId and
    // chatThreadId loads with them null. Today the whole board is unreadable.
    const parsed = parseBoardImport({
      fileName: "older.canvas.json",
      content: JSON.stringify(raw),
    });
    if (parsed.kind !== "native") throw new Error("expected a native board");
    expect(parsed.board.chatThreadId).toBeNull();
    expect(parsed.board.projectId).toBeNull();
  });

  it("ADVERSARIAL: import accepts a board whose connectors point at nodes that do not exist", () => {
    const content = envelope({
      nodes: [
        { id: "n1", kind: "sticky", x: 0, y: 0, width: 220, height: 160, text: "", color: "yellow" },
      ],
      edges: [{ id: "e1", source: "n1", target: "gone", color: "gray" }],
    });
    // Expected: `add_edge` refuses a dangling connector (src/domain.ts:283-288),
    // so import must hold the same invariant rather than storing a board the
    // operation model says is impossible.
    expect(() => parseBoardImport({ fileName: "dangling.canvas.json", content })).toThrow(
      /gone|missing|connector|edge/i,
    );
  });

  it("ADVERSARIAL: import accepts a board with duplicate node ids, and edits then diverge", async () => {
    const node = (text: string) => ({
      id: "dup",
      kind: "sticky" as const,
      x: 0,
      y: 0,
      width: 220,
      height: 160,
      text,
      color: "yellow",
    });
    const content = envelope({ nodes: [node("first"), node("second")] });

    // Reproduction first, so the failure below is proof and not a prediction:
    // the file imports cleanly and the operation model can no longer address
    // the two nodes separately — one update_node rewrites both.
    const parsed = parseBoardImport({ fileName: "dupes.canvas.json", content });
    expect(parsed.kind).toBe("native");

    const loaded = await load();
    const target = await createBoard(loaded, "Dupes");
    await call(loaded, "board_import", { boardId: target.id, fileName: "dupes.canvas.json", content });
    const patched = await apply(loaded, target.id, [
      { type: "update_node", id: "dup", patch: { text: "renamed" } },
    ]);
    expect(patched.nodes.map((entry) => entry.text)).toEqual(["renamed", "second"]);

    // Expected: ids are the board's primary key; a file with two nodes sharing
    // one is corrupt and must be refused at the door.
    expect(() => parseBoardImport({ fileName: "dupes.canvas.json", content })).toThrow(/dup/i);
  });

  it("ADVERSARIAL: import accepts comments anchored to nodes that are not in the file", () => {
    const content = envelope({
      nodes: [],
      comments: [
        { id: "c1", nodeId: "gone", message: "orphan", resolved: false, createdAt: NOW },
      ],
    });
    // Expected: `add_comment` refuses an orphan (src/domain.ts:332), and
    // `remove_nodes` sweeps comments with their node, so a stored board can
    // never contain one. Import must not be the back door.
    expect(() => parseBoardImport({ fileName: "orphan.canvas.json", content })).toThrow(
      /gone|missing|comment/i,
    );
  });
});

describe("adversarial: numeric and volume edges", () => {
  it("CONTROL: zero-size and inverted geometry are refused", () => {
    expect(() =>
      board([{ type: "add_node", node: { id: "z", kind: "sticky", x: 0, y: 0, width: 0, height: 0, color: "yellow" } }]),
    ).toThrow();
    expect(() =>
      board([
        { type: "add_node", node: { id: "z", kind: "sticky", x: 0, y: 0, width: -220, height: -160, color: "yellow" } },
      ]),
    ).toThrow();
  });

  it("CONTROL: NaN and Infinity cannot enter a board through an operation", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        board([{ type: "add_node", node: { id: "n", kind: "sticky", x: value, y: 0, color: "yellow" } }]),
      ).toThrow();
      const base = board([STICKY("n")]);
      expect(() =>
        applyBoardOperations(base, [{ type: "update_node", id: "n", patch: { x: value } }], {
          now: NOW,
          makeId,
        }),
      ).toThrow();
    }
  });

  it("CONTROL: exactly 200 operations are accepted and 201 are refused, atomically", () => {
    const base = createEmptyBoard({ id: "b", title: "Cap", now: NOW });
    const at200 = Array.from({ length: 200 }, (_, index) => STICKY(`n${index}`, index * 10, 0));
    const applied = applyBoardOperations(base, at200, { now: NOW, makeId });
    expect(applied.nodes).toHaveLength(200);
    expect(applied.version).toBe(1);

    const at201 = [...at200, STICKY("n200", 2010, 0)];
    expect(() => applyBoardOperations(base, at201, { now: NOW, makeId })).toThrow(/200/);
    expect(base.nodes).toHaveLength(0);
    expect(base.version).toBe(0);
  });

  it("CONTROL: a 2000-node board persists and re-reads, and the 2001st node is refused", async () => {
    let current = createEmptyBoard({ id: "b", title: "Dense", now: NOW });
    for (let batch = 0; batch < 10; batch += 1) {
      current = applyBoardOperations(
        current,
        Array.from({ length: 200 }, (_, index) => STICKY(`n${batch * 200 + index}`, index * 10, batch * 200)),
        { now: NOW, makeId },
      );
    }
    expect(current.nodes).toHaveLength(2000);
    // Survives a full encode/decode the way server.ts stores it.
    expect(boardDocumentSchema.parse(JSON.parse(JSON.stringify(current)))).toEqual(current);

    expect(() => applyBoardOperations(current, [STICKY("one-too-many", 0, 0)], { now: NOW, makeId })).toThrow();
    expect(current.nodes).toHaveLength(2000);
  });
});
