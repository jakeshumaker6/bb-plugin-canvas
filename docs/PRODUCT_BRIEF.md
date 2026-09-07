# Product brief

## The problem

Engineering work is full of moments where a picture is the shortest path: the
shape of a request as it crosses four services, the order of a migration, the
branches of a checkout flow, the boxes a new feature has to fit between.

The tools for drawing those pictures live somewhere else. Opening FigJam or a
whiteboard app means leaving the editor, losing the code you were reading,
waiting on a document to load, and ending up with a diagram that lives in a
different system from the work it describes. The cost is small enough each time
that people mostly skip it — and then reason about the system in prose, badly.

Canvas removes the trip. The canvas is a tab in the IDE, one keystroke from the
code, and the board is a local file-scale thing rather than a cloud document.

The second problem is that drawing is slow. Describing a flow takes fifteen
seconds; drawing it takes ten minutes of box-placement. Canvas puts an AI
diagram partner in a tab beside the board, scoped to that board, editing it
through the same validated operations the UI uses — so you can describe the
system and then fix the result by hand, rather than choosing between the two.

## Who it is for

- **Engineers** mapping a system, a workflow, or a migration while reading the
  code that implements it.
- **Technical leads** thinking through an architecture before writing it down,
  and exporting the result into a design doc or a pull request.
- **Anyone using BB** who wants a scratch surface for structured thinking that
  does not require a browser tab, an account, or a shared document.

The unit of use is one person thinking. That assumption is load-bearing: it is
why there is no presence, no sharing, and no conflict resolution.

## In scope

- A direct-manipulation canvas: sticky notes, shapes, text, images, and
  connectors, with the arrangement tools that make a rough sketch readable —
  snapping, alignment, distribution, tidy up, grouping, locking, and layering.
- A keyboard-complete editing model, so the tool keeps up with someone who is
  already fast in an IDE.
- A board-scoped AI chat that builds and edits the diagram through the same
  operations the UI uses, and cannot reach any other board.
- Local-first persistence: boards in the plugin's own SQLite database, on the
  user's machine, with no account and no network dependency.
- A documented interchange boundary: export as Canvas JSON, SVG, or PNG; import
  Canvas JSON, SVG, or raster images.

## Explicitly out of scope

- **Multiplayer.** No shared cursors, no presence, no comments addressed to
  other people, no permissions model, no operational transform or CRDT. The
  comments feature is private notes to yourself.
- **A cloud service.** No hosted boards, no sync between machines, no accounts.
  Moving a board is exporting and importing it.
- **Figma or FigJam integration.** No live link, no plugin bridge, no read or
  write of `.fig` or `.jam` files. Interchange is via the open formats those
  tools already export (SVG from Figma Design, PNG or PDF from FigJam).
- **Being a design tool.** No components, no auto-layout, no constraints, no
  vector editing, no prototyping, no design tokens. Canvas is for diagrams, not
  interfaces.
- **Being a document.** No pages, no long-form text, no tables, no embeds.
- **Rendering someone else's diagram language.** Canvas has one document model.
  It is not a Mermaid, Graphviz, or PlantUML renderer.
