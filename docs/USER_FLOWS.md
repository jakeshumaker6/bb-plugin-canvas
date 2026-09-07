# User flows

Each flow is written from the role that performs it, with an explicit pass
condition. A flow passes only if the condition holds exactly as stated.

---

## 1. Build a workflow manually

**Role:** an engineer sketching the steps of a process while reading the code
that implements it.

1. Open **Canvas** in the sidebar and click **+** in the board library to
   create a board. Rename it from the header.
2. Press `S` and click the canvas to drop a sticky note. It opens straight into
   text editing — type the first step.
3. Press `Escape`, then `S` again for the next step. Repeat for each step.
4. Drag a note. Its edges and centre snap to the notes already placed, and a
   guide line appears showing which edge it snapped to.
5. Select a note and use the toolbar above it to change fill colour, font, size,
   weight, or alignment.
6. Nudge with the arrow keys for fine placement, `Shift`+arrow for coarse.

**Pass condition:** the board shows every step as a distinct object, dragging
one produces snap guides against its neighbours, and reopening the board from
the library shows the same objects in the same places with the same styling.

---

## 2. Arrange several objects at once

**Role:** anyone who has produced a rough sketch and wants it to read cleanly.

1. Drag a marquee across the objects, or shift-click them one at a time. A
   dashed bounding box appears around the selection and the toolbar shows the
   count.
2. Use an alignment button — left, horizontal centre, right, top, vertical
   centre, bottom — to line the selection up against its own bounding box.
3. With three or more objects selected, use **Distribute horizontally** or
   **Distribute vertically** to give every gap the same size. With fewer than
   three, both buttons are disabled.
4. Use **Tidy up** (`Cmd/Ctrl`+`Shift`+`T`) to snap the selection into a uniform
   grid anchored at its current top-left.
5. Press `Cmd/Ctrl`+`G` to group the result, then `Cmd/Ctrl`+`Shift`+`L` to
   lock it so later marquees do not disturb it.
6. Press `Cmd/Ctrl`+`Z` once.

**Pass condition:** the arrangement is applied to every unlocked object in the
selection, nothing jumps off screen, clicking one member of the group selects
the whole group, locked objects are not moved by any of these actions, and the
single undo restores the entire arrangement in one step.

---

## 3. Build a flowchart with connectors

**Role:** an engineer documenting how a request moves through a system.

1. Place the boxes: `R` for rectangles, `D` for diamonds at the decision points.
2. Press `L` for the connector tool. Click the source box, then the target box.
   The connector attaches to the nearest sensible side of each.
3. Click the connector. Its toolbar appears: type a label, choose the routing
   (straight, elbow, curved) and the arrows (one way, two way, none).
4. Drag one of the connected boxes.
5. Select a box in the middle of the chain and press `Delete`.

**Pass condition:** the connector renders between the two boxes and re-routes
live as either box moves; the label and routing survive a reload; deleting a box
also deletes every connector attached to it, leaving no dangling line.

---

## 4. Reuse work across boards

**Role:** someone who has built a pattern once and wants it on a second board.

1. Select the objects to reuse — including the connectors between them, which
   come along automatically when both endpoints are in the selection.
2. `Cmd/Ctrl`+`C`.
3. Open or create the destination board from the library.
4. `Cmd/Ctrl`+`V` to paste at an offset, or right-click and choose **Paste
   here** to paste at the pointer.
5. Paste a second time.

**Pass condition:** the pasted objects keep their size, colour, text, and
typography; connectors that were entirely inside the selection are recreated
between the pasted copies; a copied single object brings no connector; the paste
is unlocked and immediately editable; and the second paste does not collide
with or overwrite the first.

---

## 5. Build a diagram with the AI chat

**Role:** someone who can describe a system faster than they can draw it.

1. Open a board, then open the **Chat** tab beside it.
2. Describe what you want: "map the checkout flow — cart, payment, fulfilment,
   with a retry branch off payment".
3. Watch the board. The agent's edits land as ordinary board changes.
4. Correct it in words: "make the retry branch a diamond and connect it back to
   payment".
5. Adjust something by hand, then ask for another change.

**Pass condition:** the objects the agent creates are indistinguishable from
hand-made ones — selectable, draggable, styleable, deletable, and undoable — the
agent only ever edits the board its thread is bound to, and your manual edits
are visible to the next thing the agent does rather than being overwritten by
it.

---

## 6. Share or move a board

**Role:** someone taking the diagram somewhere else — a pull request, a
document, another machine.

1. Open the board and click **Export**.
2. Choose the format:
   - **Editable Canvas JSON** — the full board, for reopening in Canvas.
   - **SVG** — scalable, for docs and pull requests.
   - **PNG** — a flat image, for anywhere that will not render SVG.
3. The file downloads named after the board title.

**Pass condition:** the JSON export re-imports into Canvas as the same board;
the SVG and PNG show every object, connector, and label as they appear on
screen; and no export requires a network connection or an account.

---

## 7. Bring in an existing diagram

**Role:** someone continuing work that started somewhere else.

1. Open the destination board and click **Import**.
2. Choose the file:
   - A **Canvas JSON** export — restores the board's objects.
   - An **SVG** — brings the diagram in as board content.
   - A **PNG or JPEG** — placed on the board as an image object to trace,
     annotate, or reference.
3. To bring work out of Figma: export from **Figma Design as SVG**, or from
   **FigJam as PNG or PDF**, and import that. Canvas cannot open `.fig` or
   `.jam` files — they are proprietary formats with no published reader.
4. You can also paste an image from the clipboard, or drag an image file
   straight onto the canvas, to place it at that point.

**Pass condition:** a Canvas JSON export round-trips without loss; an imported
image lands where it was dropped and can be selected, moved, resized, and
deleted like any other object; an unsupported file is refused with a message
and leaves the board unchanged.
