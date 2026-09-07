# 1. Single-player, local-first diagram workspace

- **Status:** Accepted
- **Date:** 2026
- **Deciders:** Jake Shumaker

## Context

Canvas is a diagramming surface inside the BB IDE. The obvious reference points
— FigJam, Miro, Excalidraw+ — are all collaborative cloud documents, and it is
tempting to treat collaboration as table stakes.

Three facts pushed the other way.

**The use is solo.** The moment Canvas exists to serve is one engineer, alone,
mapping something they are currently reading. That is not a session that
benefits from presence, and it is not a session that should have to wait on a
network round trip.

**Multiplayer is not a feature, it is an architecture.** Shared editing means
conflict resolution — a CRDT or an OT layer — presence, permissions, identity,
a hosted service, and a durability story for other people's work. Every one of
those choices constrains the document model. Adopting them speculatively would
cost most of the build and buy nothing for the actual user.

**A local plugin has a real advantage.** Boards in the plugin's own SQLite
database on the user's machine mean no account, no network dependency, no data
leaving the machine, and no operation that can fail because a service is down.
That is a better product for the solo case than a cloud document is, not a
compromised version of one.

Against that: people do have existing work in Figma and FigJam, and the
question "can I open my .fig file" will be asked. `.fig` and `.jam` are
proprietary, undocumented container formats with no published reader. Building
a speculative importer for them would be reverse-engineering a moving target,
and it would fail silently and confusingly when it broke.

## Decision

Build Canvas as a **single-player, local-first diagram workspace**, and give it
a **documented interchange boundary** with Figma and FigJam instead of an
integration.

Concretely:

1. Boards are persisted in the plugin's own SQLite database on the user's
   machine. There is no hosted service and no account.
2. There is no shared editing, presence, or permissions model. Realtime signals
   keep one installation's open tabs consistent; they are not multiplayer.
   Comments are private notes to oneself.
3. The document model is a versioned schema (`BOARD_SCHEMA_VERSION`) mutated
   only by small validated operations, applied in a transaction. Concurrency
   within one installation is handled by last-write-wins on a serialised
   operation batch, not by a merge algorithm.
4. Interchange is via open formats only. Canvas exports editable Canvas JSON,
   SVG, and PNG, and imports Canvas JSON, SVG, and raster images.
5. Canvas will not read or write `.fig` or `.jam`. The documented path is:
   export SVG from Figma Design, or PNG/PDF from FigJam, and import that. This
   limitation is stated in the README rather than hidden behind a failing file
   picker.

## Consequences

**Good**

- The whole build is spent on the editing experience — snapping, alignment,
  connectors, keyboard coverage, the AI partner — instead of on infrastructure
  no one in the target use would exercise.
- No account, no network, no telemetry, no data leaving the machine. Canvas
  works offline and on a locked-down machine, and there is nothing to breach.
- The document model stays simple and readable. Operations are plain data,
  validated by one schema, applied by one pure function that both halves of the
  plugin share. Undo can be a snapshot stack because there is no remote peer to
  reconcile with.
- The AI chat is safe by construction: its tools resolve the board from the
  calling thread, and there is no other user's board it could reach.
- Interchange formats are ones we can support forever, because they are
  standards rather than someone else's build artefact.

**Bad, and accepted**

- Two people cannot work on a board at once. There is no plan for this.
- A board does not follow you between machines. Moving one means exporting and
  importing it.
- There is no server-side backup. A board's durability is the durability of the
  machine it lives on, and the mitigation is the JSON export.
- Users with existing FigJam boards must re-draw them; an imported PNG can be
  traced or annotated but is not editable structure.
- If multiplayer is ever wanted, it is a rewrite of the persistence and
  concurrency layers, not an addition. That is the deliberate trade.

**Kept open**

- The operation-based model means a future sync layer would have a sensible
  unit to ship, if the decision is ever revisited.
- `BOARD_SCHEMA_VERSION` and the preprocessing defaults on the node and edge
  schemas mean older exports can be migrated forward rather than rejected.
