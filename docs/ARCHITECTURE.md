# Architecture

Canvas is a BB plugin with two halves: a React frontend registered as a nav
panel (`app.tsx`) and a Node backend registered as the plugin server
(`server.ts`). They talk over the plugin SDK's typed RPC contract. Everything
that decides *what a board is* lives in `src/domain.ts` and is shared by both.

## System boundaries

```
+---------------------------------------------------------------+
|  BB IDE                                                        |
|                                                                |
|  +--------------------------+   +--------------------------+   |
|  |  Canvas panel (app.tsx)  |   |  Chat tab (ThreadChat)    |  |
|  |                          |   |  board.chatThreadId       |  |
|  |  tool dock / selection   |   +------------+-------------+   |
|  |  marquee / snapping      |                |                 |
|  |  align / group / lock    |                | agent tool call |
|  |  connectors / minimap    |                v                 |
|  |  find / clipboard        |   +--------------------------+   |
|  |  import / export         |   |  Chat agent tools         |  |
|  +------------+-------------+   |  (registered by server)   |  |
|               |                 +------------+-------------+   |
|               | rpc.call(...)                |                 |
+---------------|------------------------------|-----------------+
                |                              |
                v                              v
        +-------------------------------------------------+
        |  Plugin server (server.ts)                       |
        |                                                  |
        |  validate  ->  applyBoardOperations  ->  persist  |
        |  (zod, src/domain.ts)        (SQLite transaction) |
        |                        |                          |
        |                        +--> realtime publish      |
        |                             "boards-changed"      |
        +----------------------+--------------------------+
                               |
                               v
                    +----------------------+
                    |  Plugin-owned SQLite |
                    |  boards + documents  |
                    +----------------------+
```

Nothing crosses the machine boundary. There is no network client, no account,
and no third-party service.

### Module layout

- `src/domain.ts` — the schemas, the operation union, and
  `applyBoardOperations`. Pure, isomorphic, no I/O. This is the contract.
- `src/geometry.ts` — bounding boxes, marquee intersection, alignment targets,
  and Figma-style edge/centre snapping.
- `src/arrange.ts` — group/ungroup, lock, z-order, distribute, tidy up, and
  group expansion. Every function returns *operations*, never mutated state.
- `src/clipboard.ts` — serialise a selection, parse untrusted clipboard text,
  and rebuild a payload as add operations with fresh ids.
- `src/connectors.ts` — anchor choice and SVG path/label geometry for straight,
  elbow, and curved connectors.
- `src/menu-items.ts` — the pure item model for the right-click menu. Owns the
  product decision of which actions a selection exposes.
- `src/navigation.ts` — viewport maths, minimap transform, and find ranking.
- `src/shapes.ts` — SVG path, CSS clip-path, and text inset for each shape.
- `components/` — React rendering only (minimap, find, context menu, glyphs,
  and the vendored `components/ui` set).
- `app.tsx` — the single integration point. It is the only place that holds
  frontend state and the only place that calls RPC.

## Data flow

A user gesture never writes a document. It produces a list of small operations,
each one a member of `boardOperationSchema`:

1. **Gesture.** `app.tsx` turns the gesture into `BoardOperation[]` — usually by
   calling a pure function in `src/arrange.ts` or `src/clipboard.ts`, which
   already filter out locked objects and no-op moves.
2. **Optimism.** For a drag, `app.tsx` moves the objects locally while the
   pointer is down so the board feels immediate. Nothing is sent until the
   pointer is released.
3. **Batch.** `applyBoardOperations` refuses more than 200 operations in one
   call, so `app.tsx` slices the list into 200-operation batches and issues them
   in order. A select-all delete is several `remove_nodes` operations, not one
   giant one.
4. **RPC.** `board_apply_operations` carries `{ boardId, operations }`.
5. **Validate.** The server re-parses the operations with the same zod schemas.
   The frontend's validation is a convenience; the server's is the boundary.
6. **Apply and commit.** The server loads the board, runs
   `applyBoardOperations`, bumps `version` and `updatedAt`, and writes the
   result inside one SQLite transaction. Either every operation in the call
   lands or none of them do.
7. **Invalidate.** *After* the transaction commits, the server publishes the
   `boards-changed` realtime signal with the board id. Subscribers refetch;
   the signal carries no document. Publishing after the commit is what makes a
   refetch triggered by the signal guaranteed to read the committed state.
8. **Adopt.** The caller adopts the returned document as the new board state.

### Chat

The Chat tab is BB's `ThreadChat` bound to the board's `chatThreadId`, which
the server provisions per board. The agent's tools are registered by the
server and go through exactly the same validate/apply/commit/publish path as
the UI. The agent has no privileged write channel.

## Invariants

These are the properties the design exists to protect. Breaking one is a bug,
not a preference.

**Operations, not overwrites.** A user action becomes a small, named, validated
domain operation. Nothing on the write path serialises a whole document and
posts it as the new truth. This is what makes concurrent tabs, the chat agent,
and the undo history all compose: they are all producing the same alphabet.

*The one deliberate exception:* undo and redo restore a snapshot of the whole
document, because inverting an arbitrary operation batch is a different and
larger problem. They go through the import path, which validates the snapshot
against the same schema before it is committed. Everything else is operations.

**One gesture, one undo step.** Before a batch is sent, `app.tsx` pushes a
single snapshot of the pre-gesture board onto the undo stack. Aligning nine
objects is nine `update_node` operations and exactly one press of undo. The
stack is capped at 40 entries.

**The 200-operation ceiling is enforced at the domain, honoured at the caller.**
`applyBoardOperations` throws above 200. `app.tsx` never relies on that throw:
it slices to `OPERATION_BATCH` and issues the batches in order.

**Selection is frontend-only.** Which objects are selected, which is being
edited, where the viewport sits, whether the inspector is open — none of it is
persisted, sent over RPC, or present in the schema. Two tabs on the same board
have independent selections. Locking, which *is* persisted, is a property of
the object, not of the selection.

**The chat agent's tools resolve the board from the calling thread.** A tool
does not take a board id parameter. The thread the agent is running in is bound
to exactly one board, and the server derives the board from that binding. There
is no argument an agent can pass to reach a board other than the one the user
is looking at.

**Clipboard input is untrusted.** `parseClipboard` caps the input length,
requires the Canvas MIME marker, and returns `null` — never throws — for
foreign text, malformed JSON, a wrong version, or an oversized payload. Pasting
rebuilds every id, so a paste can never collide with the source board.

**Referential integrity is the domain's job.** Removing nodes also removes the
connectors that touched them and the comments attached to them. Adding a
connector to a missing endpoint throws. The frontend does not have to remember
to clean up.

## Failure paths

| Failure | Where it is caught | What the user sees |
| --- | --- | --- |
| Invalid operation (bad enum, out-of-range size, empty patch) | zod, in `applyBoardOperations`, on both sides | The batch is rejected whole; a toast with the message; the board is unchanged |
| Operation references a missing node, edge, or comment | `applyBoardOperations` throws by name | Same — the transaction never opens |
| More than 200 operations in one call | `applyBoardOperations` throws; `app.tsx` avoids it by slicing | Nothing; the caller batches |
| Transaction fails mid-write | SQLite rolls back | The RPC rejects; a toast; no realtime signal is published, so no tab adopts a half-write |
| Board id does not exist | Server rejects the RPC | A toast; the panel keeps the board it had |
| Realtime signal lost | Nothing | The open tab keeps its last known board until the next fetch. The signal is an invalidation hint, not the source of truth |
| Clipboard is foreign or malformed | `parseClipboard` returns `null` | "Nothing on the clipboard for Canvas" |
| Browser denies clipboard read/write | `navigator.clipboard` rejects | A toast naming the failure; the keyboard cut/copy/paste path still works, because it uses native clipboard events |
| Image over the size cap | `imageNodeOperation` throws before any RPC | A toast asking for a smaller image |
| Image file unreadable | `FileReader.onerror` | "Could not read `<name>`" |
| PNG export cannot get a 2D context or encode | `downloadPng` throws | A toast; the SVG and JSON exports are unaffected |
| Import file is not a format Canvas understands | Server rejects the import | A toast; the board is unchanged |

The shape of every one of these is the same: reject at the boundary, leave the
persisted board untouched, tell the user in words, and never publish a realtime
signal for a write that did not commit.
