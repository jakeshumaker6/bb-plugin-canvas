# Canvas

Canvas is a visual diagramming workspace that lives as a tab inside the BB IDE.
It is the FigJam-shaped tool you reach for when a workflow, a service map, or a
migration plan is easier to draw than to describe — without leaving the editor
you are already in.

Alongside the board is a **Chat** tab: a board-scoped AI diagram partner. It
edits the diagram through the same validated domain operations the UI uses, so
anything the agent draws is something you could have drawn by hand, and
anything it cannot express as an operation it cannot do.

Boards are stored locally by the plugin. There is no account, no external
service, and nothing leaves the machine.

## Install

```
bb plugin install git:https://github.com/jakeshumaker6/bb-plugin-canvas
```

Requires BB `>=0.42` (`engines.bb`) and plugin SDK `>=0.4.47`.

Open **Canvas** in the left sidebar. The board list is on the left, the board
fills the middle, and the **Chat** tab sits beside it.

## Features

**Objects.** Sticky notes, free text, images, and nine shapes: rectangle,
ellipse, diamond, cylinder (a datastore), cloud (an external service),
parallelogram (input or output), hexagon (a process), triangle (a decision), and
actor (a person or role). Text stays inside the outline at any size — a label in
a cylinder clears the rim, a label in a triangle sits below the slope. Every
object carries its own fill colour (seven presets plus a custom colour picker),
font family (Inter, serif, mono), font size, weight, and text alignment. Objects
can be locked in place and grouped.

**Selection.** Click to select, shift-click to extend, drag on empty canvas for
a marquee. Touching one member of a group selects the whole group. Locked
objects are skipped by marquee, select-all, and every destructive action.

**Snapping and alignment.** Dragging snaps edges and centres to nearby objects
within a zoom-aware tolerance, and draws the guide that justifies the snap. Six
alignment edges (left / horizontal centre / right, top / vertical centre /
bottom), distribute horizontally or vertically (needs three or more objects),
and a FigJam-style **Tidy up** that lays the selection out in a uniform grid
anchored at its existing top-left.

**Layering.** Board order is z-order. Bring to front, bring forward, send
backward, send to back — for one object or a whole selection.

**Connectors.** Pick the connector tool, click a source object, click a target.
Connectors anchor to the nearest sensible side of each box and re-route as the
boxes move. Three routings (straight, elbow, curved), three arrow modes (one
way, two way, none), and an optional label.

**Comments.** Private per-object notes with resolve / reopen / delete, shown as
a badge on the object.

**Navigation.** Pan by scroll or with the hand tool, zoom from 20% to 250%,
zoom-to-fit, a live minimap you can click to jump, and a find box that ranks
matches over object text and kind.

**Clipboard.** Cut, copy, paste, and duplicate. Copied objects carry the
connectors that are entirely inside the selection; pasting rebuilds everything
with fresh ids, so a paste never collides with its source and works across
boards. Pasting or dropping an image file places it as an image object.

**Undo/redo.** A local history of up to 40 steps. A multi-object gesture is one
undo step.

**Boards.** Create, rename, delete, and switch boards from the library rail.

**Import/export.** Export a board as editable Canvas JSON, as SVG, or as PNG.
Canvas embeds its own document inside the SVG it exports, so a Canvas SVG
re-imports as a fully editable board — as does a Canvas JSON export. Any other
SVG, PNG, or JPEG is imported as a reference image on the board.

## Keyboard

Every binding below is read from the keydown handler in `app.tsx`. Shortcuts are
ignored while the focus is in a text field, a textarea, or an editable object.

| Keys | Action |
| --- | --- |
| `V` | Select tool |
| `H` | Hand tool (pan) |
| `S` | Sticky note tool |
| `R` | Shape tool (the picker offers all nine shapes) |
| `O` | Ellipse tool |
| `D` | Diamond tool |
| `T` | Text tool |
| `L` | Connector tool |
| `C` | Comment tool |
| `Enter` | Edit the text of the one selected object |
| `Escape` | Clear selection and editing, close menus, return to the select tool |
| `Backspace` / `Delete` | Delete the selected objects, or the selected connector |
| `Arrow keys` | Nudge the selection by 1 px |
| `Shift`+`Arrow keys` | Nudge the selection by 10 px |
| `Shift`+`1` | Zoom to fit |
| `Cmd/Ctrl`+`A` | Select every unlocked object |
| `Cmd/Ctrl`+`F` | Open find |
| `Cmd/Ctrl`+`D` | Duplicate the selection |
| `Cmd/Ctrl`+`G` | Group the selection |
| `Cmd/Ctrl`+`Shift`+`G` | Ungroup the selection |
| `Cmd/Ctrl`+`Shift`+`L` | Lock the selection, or unlock it if all of it is locked |
| `Cmd/Ctrl`+`Shift`+`T` | Tidy up the selection |
| `Cmd/Ctrl`+`]` | Bring forward |
| `Cmd/Ctrl`+`Shift`+`]` | Bring to front |
| `Cmd/Ctrl`+`[` | Send backward |
| `Cmd/Ctrl`+`Shift`+`[` | Send to back |
| `Cmd/Ctrl`+`Z` | Undo |
| `Cmd/Ctrl`+`Shift`+`Z` | Redo |
| `Cmd/Ctrl`+`X` / `C` / `V` | Cut / copy / paste (handled as native clipboard events) |

Holding `Shift` while dragging an object constrains the drag to one axis.

## Pointer model

- **Click** an object to select it and begin a drag. **Shift**-click adds to or
  removes from the selection.
- **Drag on empty canvas** with the select tool draws a marquee; anything the
  marquee touches is selected.
- **Double-click** an object — or press `Enter` with a single object selected —
  to edit its text. `Escape` or clicking away commits the edit.
- **Drag the handle** on a single selected object to resize it.
- **Right-click** anywhere for a context menu whose items depend on what is
  selected, whether it is locked or grouped, and whether the clipboard holds
  something Canvas can paste.
- **Scroll** pans the board. **Cmd/Ctrl**+**scroll** zooms toward the pointer,
  clamped to 20%–250%.
- **Drop an image file** onto the canvas to place it where you dropped it.

## Limitations

These are design boundaries, not a roadmap.

- **Single-player.** One person, one machine. There are no cursors, no
  presence, no sharing link, and no conflict resolution. Realtime updates keep
  the open tabs of a single install in step; they are not multiplayer.
- **Local storage.** Boards live in the plugin's own SQLite database on your
  machine. Moving a board to another machine means exporting it and importing
  it there.
- **No Figma sync.** Canvas does not connect to a Figma account and there is no
  live link between a Canvas board and a Figma or FigJam file.
- **No .fig or .jam import.** Those are Figma's proprietary formats and Canvas
  cannot open them; picking one tells you so and points you at the alternative.
  To bring work across, export from Figma Design as SVG, or from FigJam as PNG
  or PDF, and import that. A foreign SVG or image comes in as a reference
  image, not as editable objects.

## Development

```
git clone https://github.com/jakeshumaker6/bb-plugin-canvas
cd bb-plugin-canvas
npm install
bb plugin install . --yes
bb plugin dev          # rebuild and reload on save
```

Checks:

```
npm test -- --run      # vitest
npm run typecheck      # tsc
npm run build          # bb plugin build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the module layout and the
test-first rule, and [docs/](docs/) for the architecture, user flows, and
product brief.

## License

MIT — see [LICENSE](LICENSE).
