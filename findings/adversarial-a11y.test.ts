// @vitest-environment jsdom
/**
 * ADVERSARIAL PASS — ACCESSIBILITY AND LAYOUT INTEGRITY.
 *
 * Detect-only. Nothing here fixes anything; every test that FAILS is a finding
 * against current behaviour. Findings that jsdom genuinely cannot express
 * (visual overlap, real contrast ratios, container queries) are proved instead
 * by arithmetic over the numbers that are literally in the CSS/TSX source, and
 * are labelled ARITHMETIC in their test name so nobody mistakes them for a
 * rendered-layout assertion.
 *
 * Tags used in test names:
 *   [A11Y-n]  accessible names / roles / semantics
 *   [KBD-n]   keyboard reachability
 *   [FOCUS-n] focus management
 *   [LAYOUT-n] layout integrity (arithmetic over source values)
 *   [TARGET-n] touch target size / colour
 *   [CONTROL] a test that is EXPECTED TO PASS, documenting a hypothesis that
 *             turned out NOT to be a real defect.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { BoardDocument, BoardNode, BoardSummary } from "../src/domain";
import { MINIMAP_FRAME } from "../src/navigation";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appCss = readFileSync(join(ROOT, "app.css"), "utf8");
const navCss = readFileSync(join(ROOT, "styles/navigation.css"), "utf8");
const appTsx = readFileSync(join(ROOT, "app.tsx"), "utf8");

/** Line number (1-based) of the first line matching `needle`, for reporting. */
function lineOf(source: string, needle: string): number {
  const lines = source.split("\n");
  const index = lines.findIndex((line) => line.includes(needle));
  return index + 1;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const summary: BoardSummary = {
  id: "board-1",
  title: "Customer workflow",
  projectId: "proj_personal",
  chatThreadId: "thr_canvas_1",
  version: 3,
  createdAt: "now",
  updatedAt: "now",
};

function node(partial: Partial<BoardNode> & { id: string }): BoardNode {
  return {
    kind: "sticky",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    text: "",
    color: "yellow",
    fontFamily: "inter",
    fontSize: 17,
    fontWeight: 500,
    textAlign: "left",
    locked: false,
    groupId: null,
    ...partial,
  };
}

const emptyBoard: BoardDocument = {
  ...summary,
  schemaVersion: 1,
  nodes: [],
  edges: [],
  comments: [],
};

const oneNode: BoardDocument = {
  ...emptyBoard,
  nodes: [node({ id: "sticky-1", x: 120, y: 100, text: "Customer request" })],
};

const twoNodes: BoardDocument = {
  ...emptyBoard,
  nodes: [
    node({ id: "sticky-1", x: 120, y: 100, text: "Customer request" }),
    node({ id: "sticky-2", x: 460, y: 100, text: "Refund issued" }),
  ],
};

const withEdge: BoardDocument = {
  ...twoNodes,
  edges: [
    {
      id: "edge-1",
      source: "sticky-1",
      target: "sticky-2",
      label: "then",
      color: "ink",
      routing: "elbow",
      arrow: "end",
    },
  ],
};

const withComments: BoardDocument = {
  ...oneNode,
  comments: [
    { id: "c-1", nodeId: "sticky-1", x: null, y: null, message: "Chase this", resolved: false, createdAt: "now" },
    { id: "c-2", nodeId: "sticky-1", x: null, y: null, message: "And this", resolved: false, createdAt: "now" },
  ],
};

function rpcFor(active: BoardDocument) {
  return {
    boards_list: () => ({ boards: [summary] }),
    board_get: () => ({ board: active }),
    boards_create: () => ({ board: active }),
    board_apply_operations: () => ({ board: active }),
    board_import: () => ({ board: active }),
    board_delete: () => ({ deleted: true }),
    board_start_chat: () => ({ threadId: "thr_canvas_1" }),
  };
}

async function openBoard(active: BoardDocument) {
  const app = await loadPluginApp(() => import("../app"));
  const view = renderSlot(app.navPanels[0]!, { subPath: "board-1" }, { rpc: rpcFor(active) });
  await waitFor(() => expect(view.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy());
  return view;
}

/** Pointer-select a node the way a mouse user would, so state matches reality. */
function selectNode(view: Awaited<ReturnType<typeof openBoard>>, id: string, shiftKey = false) {
  const element = view.container.querySelector(`[data-node-id="${id}"]`);
  expect(element).not.toBeNull();
  fireEvent.pointerDown(element!, { button: 0, clientX: 200, clientY: 200, shiftKey });
  return element as HTMLElement;
}

function accessibleNameOf(element: Element): string {
  const aria = element.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria.trim();
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Every element a screen-reader/keyboard user would treat as interactive. */
function interactiveElements(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

// ===========================================================================
// A. ACCESSIBLE NAMES
// ===========================================================================

describe("adversarial: accessible names", () => {
  it("[A11Y-1] 'Add comment' is ambiguous — the selection toolbar button and the Inspector submit share one name", async () => {
    const view = await openBoard(oneNode);
    selectNode(view, "sticky-1");
    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });

    // Opening the Inspector from the toolbar leaves BOTH controls on screen.
    fireEvent.click(within(toolbar).getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(view.getByRole("complementary", { name: "Object inspector" })).toBeTruthy());
    expect(view.getByRole("toolbar", { name: "Selection properties" })).toBeTruthy();

    const named = view.getAllByRole("button", { name: "Add comment" });
    // FINDING: two visible buttons, identical accessible name, different actions
    // (open the inspector vs. submit the comment form). WCAG 2.4.6 / 4.1.2.
    // app.tsx:585 (selection toolbar) and app.tsx:472 (inspector submit).
    expect(
      named.map((button) => `${button.className} :: ${accessibleNameOf(button)}`),
    ).toHaveLength(1);
  });

  it("[A11Y-2] every sticky gets the same textarea name, so N objects give N identical 'Text for sticky' controls", async () => {
    const view = await openBoard(twoNodes);
    const names = Array.from(view.container.querySelectorAll("textarea")).map((area) =>
      area.getAttribute("aria-label"),
    );
    expect(names.length).toBeGreaterThan(1);
    // FINDING: the label is derived from node.kind only (app.tsx:388), never from
    // the object's text or an index, so a screen reader hears the same name for
    // every object on the board. WCAG 4.1.2 / 2.4.6.
    expect(new Set(names).size).toBe(names.length);
  });

  it("[A11Y-3] Inspector comment actions are unlabelled duplicates ('Resolve'/'Delete' repeated per comment)", async () => {
    const view = await openBoard(withComments);
    selectNode(view, "sticky-1");
    fireEvent.click(
      within(view.getByRole("toolbar", { name: "Selection properties" })).getByRole("button", {
        name: "Add comment",
      }),
    );
    const inspector = await waitFor(() => view.getByRole("complementary", { name: "Object inspector" }));
    const deletes = within(inspector).getAllByRole("button", { name: "Delete" });
    // FINDING: nothing distinguishes "Delete" on comment 1 from "Delete" on
    // comment 2 — no aria-label naming the comment. app.tsx:479-480.
    expect(deletes).toHaveLength(1);
  });

  it("[A11Y-4] no interactive element anywhere is missing an accessible name (sweep of every open state)", async () => {
    const view = await openBoard(twoNodes);
    // several objects selected + inspector + colour menu + shape picker + export menu
    selectNode(view, "sticky-1");
    selectNode(view, "sticky-2", true);
    fireEvent.click(view.getByRole("button", { name: "Shapes" }));
    fireEvent.click(view.getByRole("button", { name: "Download or export board" }));
    fireEvent.click(
      within(view.getByRole("toolbar", { name: "Selection properties" })).getByRole("button", {
        name: "Change fill color",
      }),
    );

    const nameless = interactiveElements(view.container)
      .filter((element) => accessibleNameOf(element) === "")
      .map((element) => `<${element.tagName.toLowerCase()} class="${element.className}">`);
    // FINDING (if non-empty): icon-only controls with no name.
    expect(nameless).toEqual([]);
  });

  it("[A11Y-5] board library rows have no aria-label, so the ≤760px icon-only layout strips their name", async () => {
    const view = await openBoard(oneNode);
    const row = view.container.querySelector<HTMLElement>(".canvas-library-row");
    expect(row).not.toBeNull();
    // At `@media (max-width: 760px)` app.css:133 hides `.canvas-library-row .min-w-0`,
    // which is the ONLY source of this button's accessible name. jsdom does not
    // evaluate the media query, so the proof is: there is no aria-label fallback.
    expect(navCss.length).toBeGreaterThan(0);
    expect(appCss).toContain(".canvas-library-row .min-w-0, .canvas-library-foot { display: none; }");
    expect(row!.getAttribute("aria-label")).not.toBeNull();
  });
});

// ===========================================================================
// B. KEYBOARD REACHABILITY
// ===========================================================================

describe("adversarial: keyboard reachability", () => {
  it("[KBD-1] HEADLINE: there is no keyboard path to create an object at all", async () => {
    const view = await openBoard(emptyBoard);

    // A keyboard user CAN pick the sticky tool (dock buttons are real buttons,
    // and the 's' shortcut is a window-level listener).
    const sticky = view.getByRole("button", { name: "Sticky note" });
    sticky.focus();
    fireEvent.click(sticky);
    fireEvent.keyDown(window, { key: "s" });

    // ...and then has nowhere to put it. The canvas only creates on pointerdown
    // (app.tsx onSurfacePointerDown), and the surface is not focusable.
    const surface = view.getByTestId("canvas-surface");
    for (const target of [document.body, surface]) {
      for (const key of ["Enter", " ", "n"]) {
        fireEvent.keyDown(target, { key });
        fireEvent.keyUp(target, { key });
      }
    }
    fireEvent.click(surface);

    const created = view.rpcCalls.filter(
      (call) =>
        call.method === "board_apply_operations" &&
        JSON.stringify((call.input as { operations: unknown }).operations).includes('"add_node"'),
    );
    // FINDING: zero. WCAG 2.1.1 Keyboard (Level A) — the primary function of the
    // application is unavailable without a pointer. app.tsx:938-949 / :915-925.
    expect(created.length).toBeGreaterThan(0);
  });

  it("[KBD-2] the canvas surface is neither focusable nor named — a keyboard user cannot reach or perceive it", async () => {
    const view = await openBoard(twoNodes);
    const surface = view.getByTestId("canvas-surface");
    // FINDING: no tabindex, no role, no aria-label. It is a bare <div> carrying
    // pointer handlers only. WCAG 2.1.1 / 4.1.2. app.tsx:846-856.
    expect({
      tabindex: surface.getAttribute("tabindex"),
      role: surface.getAttribute("role"),
      label: surface.getAttribute("aria-label") ?? surface.getAttribute("aria-labelledby"),
    }).not.toEqual({ tabindex: null, role: null, label: null });
  });

  it("[KBD-3] objects expose no role or selection state — a diagram of unlabelled divs", async () => {
    const view = await openBoard(twoNodes);
    const element = selectNode(view, "sticky-1");
    expect(element.className).toContain("is-selected");
    // FINDING: selection is communicated purely by a CSS class. No role, no
    // aria-selected/aria-pressed, no tabindex. WCAG 4.1.2 / 1.3.1.
    expect({
      role: element.getAttribute("role"),
      selected: element.getAttribute("aria-selected"),
      tabindex: element.getAttribute("tabindex"),
    }).not.toEqual({ role: null, selected: null, tabindex: null });
  });

  it("[KBD-4] connectors cannot be selected, relabelled or deleted by keyboard", async () => {
    const view = await openBoard(withEdge);
    const paths = view.container.querySelectorAll(".canvas-edge, .canvas-edge-hit");
    expect(paths.length).toBeGreaterThan(0);
    const focusable = Array.from(paths).filter((path) => path.getAttribute("tabindex") !== null);

    // Nothing in the app reacts to a keyboard event by selecting an edge, so the
    // ConnectorToolbar (label input, routing, arrows, delete) is pointer-only.
    fireEvent.keyDown(window, { key: "Tab" });
    fireEvent.keyDown(window, { key: "Enter" });
    const toolbar = view.queryByRole("toolbar", { name: "Connector properties" });

    // FINDING: edges are <path> elements with onPointerDown only. WCAG 2.1.1.
    // app.tsx:1240-1257.
    expect({ focusableEdges: focusable.length, connectorToolbarReachable: toolbar !== null }).toEqual({
      focusableEdges: paths.length,
      connectorToolbarReachable: true,
    });
  });

  it("[KBD-5] the minimap is a <button> that ignores keyboard activation", async () => {
    const view = await openBoard(twoNodes);
    const frame = view.getByTestId("minimap-frame");
    const before = frame.querySelector('[data-testid="minimap-viewport"]')!.getAttribute("style");
    frame.focus();
    expect(document.activeElement).toBe(frame);

    // Enter/Space on a <button> produce a click. The minimap only listens for
    // pointerdown/pointermove, so nothing happens.
    fireEvent.keyDown(frame, { key: "Enter" });
    fireEvent.click(frame);
    fireEvent.keyDown(frame, { key: " " });
    fireEvent.click(frame);

    const after = frame.querySelector('[data-testid="minimap-viewport"]')!.getAttribute("style");
    // FINDING: focusable, announced as a button, does nothing on Enter/Space.
    // WCAG 2.1.1. components/canvas-minimap.tsx:65-88.
    expect(after).not.toBe(before);
  });

  it("[KBD-6] tabbing into the board lands in read-only textareas that swallow every global shortcut", async () => {
    const view = await openBoard(twoNodes);
    const area = view.container.querySelector<HTMLTextAreaElement>('[data-node-id="sticky-1"] textarea')!;
    // readOnly (not disabled) textareas are in the tab order.
    expect(area.readOnly).toBe(true);
    expect(area.getAttribute("tabindex")).toBeNull();
    area.focus();
    expect(document.activeElement).toBe(area);

    // Every window-level shortcut bails when the event target is a textarea
    // (app.tsx:695-696), so from this tab stop Escape, Cmd+A, Cmd+F, Backspace,
    // and the arrow-nudges are all dead.
    fireEvent.keyDown(area, { key: "f", metaKey: true });
    expect(view.queryByRole("dialog", { name: "Find objects" })).not.toBeNull();
  });

  it("[KBD-7] the find palette — the only keyboard route to selecting one object — has no visible trigger", async () => {
    const view = await openBoard(twoNodes);
    const triggers = interactiveElements(view.container).filter((element) =>
      /find|search/i.test(accessibleNameOf(element)),
    );
    // FINDING: Cmd/Ctrl+F is the sole entry point (app.tsx:733-737); it appears
    // in no toolbar, menu, or context menu. WCAG 2.4.6 / 3.2.4 discoverability.
    expect(triggers.map(accessibleNameOf)).not.toEqual([]);
  });
});

// ===========================================================================
// C. FOCUS MANAGEMENT
// ===========================================================================

describe("adversarial: focus management", () => {
  it("[FOCUS-1] closing the find palette drops focus on document.body", async () => {
    const view = await openBoard(twoNodes);
    const undo = view.getByRole("button", { name: "Undo" });
    undo.focus();

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const dialog = await waitFor(() => view.getByRole("dialog", { name: "Find objects" }));
    // Opening does move focus into the palette (this part is correct).
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close find" }));
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Find objects" })).toBeNull());
    // FINDING: focus is not restored to the invoking control. WCAG 2.4.3.
    expect(document.activeElement).not.toBe(document.body);
  });

  it("[FOCUS-2] the find palette claims role=dialog but is not modal and traps nothing", async () => {
    const view = await openBoard(twoNodes);
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const dialog = await waitFor(() => view.getByRole("dialog", { name: "Find objects" }));
    // FINDING: role="dialog" with no aria-modal and no focus containment — Tab
    // walks straight out into the canvas behind it. WCAG 4.1.2 / 2.4.3.
    // components/canvas-find.tsx:61.
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("[FOCUS-3] closing the context menu drops focus on document.body", async () => {
    const view = await openBoard(oneNode);
    const element = selectNode(view, "sticky-1");
    fireEvent.contextMenu(element, { clientX: 150, clientY: 150 });
    const menu = await waitFor(() => view.getByTestId("canvas-context-menu"));
    expect(menu.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(view.queryByTestId("canvas-context-menu")).toBeNull());
    // FINDING: no focus restoration on close. WCAG 2.4.3.
    // components/canvas-context-menu.tsx:131-135, 197-201.
    expect(document.activeElement).not.toBe(document.body);
  });

  it("[FOCUS-4] Tab inside the context menu closes it and abandons focus", async () => {
    const view = await openBoard(oneNode);
    const element = selectNode(view, "sticky-1");
    fireEvent.contextMenu(element, { clientX: 150, clientY: 150 });
    const menu = await waitFor(() => view.getByTestId("canvas-context-menu"));
    fireEvent.keyDown(menu, { key: "Tab" });
    await waitFor(() => expect(view.queryByTestId("canvas-context-menu")).toBeNull());
    // FINDING: Tab is swallowed to dismiss (canvas-context-menu.tsx:213-216) and
    // focus is left nowhere, so the next Tab restarts from the top of the page.
    expect(document.activeElement).not.toBe(document.body);
  });

  it("[FOCUS-5] the export menu is a role-less div: no focus move, no Escape, no outside dismiss", async () => {
    const view = await openBoard(oneNode);
    const trigger = view.getByRole("button", { name: "Download or export board" });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = view.container.querySelector(".canvas-download-menu");
    expect(menu).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.pointerDown(view.getByTestId("canvas-surface"), { button: 0, clientX: 10, clientY: 10 });

    // FINDING: still open after Escape and after an outside click; the trigger
    // carries no aria-haspopup/aria-expanded and the popup carries no role.
    // WCAG 4.1.2, and 2.1.2-adjacent (no keyboard dismissal). app.tsx:1443-1451.
    expect({
      stillOpen: view.container.querySelector(".canvas-download-menu") !== null,
      role: menu!.getAttribute("role"),
      haspopup: trigger.getAttribute("aria-haspopup"),
      expanded: trigger.getAttribute("aria-expanded"),
      focusMoved: menu!.contains(document.activeElement),
    }).toEqual({
      stillOpen: false,
      role: "menu",
      haspopup: "menu",
      expanded: "true",
      focusMoved: true,
    });
  });

  it("[FOCUS-6] opening the Inspector never moves focus into it", async () => {
    const view = await openBoard(oneNode);
    selectNode(view, "sticky-1");
    const button = within(view.getByRole("toolbar", { name: "Selection properties" })).getByRole(
      "button",
      { name: "Add comment" },
    );
    button.focus();
    fireEvent.click(button);
    const inspector = await waitFor(() => view.getByRole("complementary", { name: "Object inspector" }));
    // FINDING: a whole new panel appears and focus stays behind it. At ≤700px it
    // is an overlay (app.css:130), so a keyboard user gets no signal at all.
    // WCAG 2.4.3.
    expect(inspector.contains(document.activeElement)).toBe(true);
  });
});

// ===========================================================================
// D. ROLES AND SEMANTICS
// ===========================================================================

describe("adversarial: roles and semantics", () => {
  it("[A11Y-6] the selection fill-colour popup labels a role-less <div>, so the label is dropped", async () => {
    const view = await openBoard(oneNode);
    selectNode(view, "sticky-1");
    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Change fill color" }));
    const menu = view.container.querySelector(".selection-color-menu");
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute("aria-label")).toBe("Fill colors");
    // FINDING: aria-label on a generic (role-less) div is ignored by AT. The
    // popup is also not associated with its trigger. app.tsx:530.
    expect(menu!.getAttribute("role")).not.toBeNull();
  });

  it("[A11Y-7] toggle controls report state only through CSS classes, never aria-pressed", async () => {
    const view = await openBoard(oneNode);
    const dock = view.getByRole("toolbar", { name: "Canvas tools" });
    const select = within(dock).getByRole("button", { name: "Select" });
    expect(select.className).toContain("is-active");

    selectNode(view, "sticky-1");
    const bold = within(view.getByRole("toolbar", { name: "Selection properties" })).getByRole(
      "button",
      { name: "Bold" },
    );

    // FINDING: the active tool and the Bold toggle are visually distinct and
    // programmatically identical. WCAG 4.1.2. app.tsx:283-292 (ToolButton),
    // app.tsx:551 (Bold).
    expect({
      activeTool: select.getAttribute("aria-pressed"),
      bold: bold.getAttribute("aria-pressed"),
    }).toEqual({ activeTool: "true", bold: "false" });
  });

  it("[A11Y-8] disabled is expressed two different ways — `disabled` in the toolbar, `aria-disabled` in the menu", async () => {
    const view = await openBoard(twoNodes);
    selectNode(view, "sticky-1");
    selectNode(view, "sticky-2", true);
    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });
    const distribute = within(toolbar).getByRole("button", { name: "Distribute horizontally" });

    fireEvent.contextMenu(view.getByTestId("canvas-surface"), { clientX: 40, clientY: 40 });
    const menu = await waitFor(() => view.getByTestId("canvas-context-menu"));
    const disabledItem = menu.querySelector('[aria-disabled="true"]');

    // FINDING: two conventions in one UI. The `disabled` attribute removes the
    // control from the a11y tree entirely (a user never learns why it is gone);
    // `aria-disabled` keeps it but relies on `pointer-events: none`
    // (styles/context-menu.css:44-48) rather than real inertness.
    expect({
      toolbarUsesDisabledAttribute: distribute.hasAttribute("disabled"),
      toolbarUsesAriaDisabled: distribute.getAttribute("aria-disabled"),
      menuUsesAriaDisabled: disabledItem !== null,
      menuUsesDisabledAttribute: disabledItem?.hasAttribute("disabled") ?? null,
    }).toEqual({
      toolbarUsesDisabledAttribute: false,
      toolbarUsesAriaDisabled: "true",
      menuUsesAriaDisabled: true,
      menuUsesDisabledAttribute: false,
    });
  });

  it("[A11Y-9] the connector layer is an <svg> with a bare aria-label and no image role", async () => {
    const view = await openBoard(withEdge);
    const edges = view.container.querySelector(".canvas-edges")!;
    expect(edges.getAttribute("aria-label")).toBe("Connectors");
    // FINDING: an <svg> needs role="img"/"graphics-document" for the label to be
    // exposed reliably, and the individual edges carry no description of what
    // connects to what. app.tsx:1225.
    expect(edges.getAttribute("role")).not.toBeNull();
  });
});

// ===========================================================================
// E. LAYOUT INTEGRITY (arithmetic over source values — jsdom does no layout)
// ===========================================================================

/**
 * jsdom has no layout engine and evaluates neither container queries nor
 * `translateX(-50%)`. Each test below therefore recomputes the box from the
 * exact numbers in app.css / styles/navigation.css / app.tsx and asserts they do
 * not collide. A failure is a real geometric collision at the stated width.
 */
describe("adversarial: layout integrity (ARITHMETIC)", () => {
  const TOOLBAR_BOTTOM = 16; // app.css:32 .canvas-toolbar bottom
  const TOOLBAR_HEIGHT = 40 + 2 * 5 + 2; // .canvas-tool 40px + 5px padding + 1px border
  const TOOLBAR_NATURAL_WIDTH = 7 * 40 + 6 * 3 + 2 * 5 + 2; // 7 tools, 3px gaps
  const MINIMAP_CHROME = 2 * 4 + 2; // .canvas-minimap padding 4px + 1px border
  const MINIMAP_W = MINIMAP_FRAME.width + MINIMAP_CHROME;
  const MINIMAP_H = MINIMAP_FRAME.height + MINIMAP_CHROME;
  const MINIMAP_RIGHT = 14; // navigation.css:8
  const MINIMAP_BOTTOM_WIDE = 58; // navigation.css:9
  const MINIMAP_BOTTOM_NARROW = 70; // navigation.css:158 (@container max-width: 560px)

  it("[LAYOUT-1] ARITHMETIC: the minimap and the tool dock overlap for container widths 561–717px", () => {
    // Sanity-check the constants really are in the CSS.
    expect(navCss).toContain("bottom: 58px");
    expect(navCss).toContain(".canvas-minimap { bottom: 70px; }");
    expect(appCss).toContain("bottom: 16px; left: 50%; transform: translateX(-50%)");

    const collisions: number[] = [];
    for (let width = 320; width <= 900; width += 1) {
      const minimapBottom = width <= 560 ? MINIMAP_BOTTOM_NARROW : MINIMAP_BOTTOM_WIDE;
      const minimap = {
        left: width - MINIMAP_RIGHT - MINIMAP_W,
        right: width - MINIMAP_RIGHT,
        bottom: minimapBottom,
        top: minimapBottom + MINIMAP_H,
      };
      const dockWidth = Math.min(TOOLBAR_NATURAL_WIDTH, width - 16); // max-width: calc(100% - 16px)
      const dock = {
        left: width / 2 - dockWidth / 2,
        right: width / 2 + dockWidth / 2,
        bottom: TOOLBAR_BOTTOM,
        top: TOOLBAR_BOTTOM + TOOLBAR_HEIGHT,
      };
      const overlaps =
        dock.right > minimap.left &&
        dock.left < minimap.right &&
        dock.top > minimap.bottom &&
        dock.bottom < minimap.top;
      if (overlaps) collisions.push(width);
    }
    // FINDING: the tool dock (z-index 24) paints over the bottom of the minimap
    // (z-index 20) in this band — the 560px container query moves the minimap up
    // but the 700px one does not, leaving a gap the CSS never covers.
    // app.css:32 + styles/navigation.css:5-15,155-160.
    expect({ collisionWidths: collisions.length, from: collisions[0], to: collisions.at(-1) }).toEqual({
      collisionWidths: 0,
      from: undefined,
      to: undefined,
    });
  });

  it("[LAYOUT-2] ARITHMETIC: at ≤700px the Inspector overlay covers the minimap, and at ≤560px it covers Undo/Redo", () => {
    expect(appCss).toContain("@container (max-width: 700px) { .canvas-inspector { position: absolute; right: 8px; top: 8px; bottom: 78px;");
    expect(appCss).toContain(".canvas-zoom-controls, .canvas-history-controls { top: 10px; bottom: auto; }");

    const width = 640; // inside the ≤700 band, outside the ≤560 one
    const inspector = {
      left: width - 8 - Math.min(280, width - 16),
      right: width - 8,
      bottomOffset: 78,
      topOffset: 8, // measured from the top; spans nearly the full height
    };
    const minimapTopFromBottom = MINIMAP_BOTTOM_WIDE + MINIMAP_H;
    const minimapLeft = width - MINIMAP_RIGHT - MINIMAP_W;
    const horizontallyOverlaps = inspector.left < width - MINIMAP_RIGHT && inspector.right > minimapLeft;
    const verticallyOverlaps = minimapTopFromBottom > inspector.bottomOffset;

    // At ≤560 the history cluster moves to top:10 (height 32) — right inside the
    // inspector overlay, which starts at top:8 and has the higher z-index (21>20).
    const narrow = 480;
    const historyCoveredWhenNarrow =
      narrow - 8 - Math.min(280, narrow - 16) < narrow - 14 && 10 + 32 > inspector.topOffset;

    // FINDING: the inspector (z-index 21) occludes the minimap (z-index 20) and,
    // on a narrow panel, the Undo/Redo buttons. app.css:97-101,130-131.
    expect({ horizontallyOverlaps, verticallyOverlaps, historyCoveredWhenNarrow }).toEqual({
      horizontallyOverlaps: false,
      verticallyOverlaps: false,
      historyCoveredWhenNarrow: false,
    });
  });

  it("[LAYOUT-3] ARITHMETIC: the find palette sits on top of the selection toolbar and hides it", async () => {
    // Both are absolutely positioned in .canvas-surface / .canvas-stage.
    expect(navCss).toContain("z-index: 29");
    expect(navCss).toContain("top: 14px");
    expect(appCss).toContain(".selection-toolbar { position: absolute; z-index: 28;");
    expect(appCss).toContain("height: 44px");

    // Selection toolbar top is clamped to a minimum of 12px (app.tsx:1153), so
    // for any object at or above the top of the viewport it occupies 12..56.
    const toolbar = { top: 12, bottom: 12 + 44, z: 28 };
    const findHeadHeight = 6 + 20; // label row + margin
    const find = { top: 14, bottom: 14 + findHeadHeight + 34, z: 29 }; // + input
    const overlapping = find.top < toolbar.bottom && find.bottom > toolbar.top;

    // FINDING: the find palette is centred horizontally exactly where the
    // clamped selection toolbar sits, one z-index higher, so opening Find while
    // something is selected hides the selection controls entirely.
    // styles/navigation.css:49-62 vs app.css:46, app.tsx:1149-1155.
    expect({ overlapping, findOnTop: find.z > toolbar.z }).toEqual({
      overlapping: false,
      findOnTop: false,
    });
  });

  it("[LAYOUT-4] ARITHMETIC: the selection toolbar is clipped off the LEFT edge for a wide selection near x=0", () => {
    // app.tsx:1149-1155 — clamp constant and the <500 special case.
    expect(appTsx).toContain("Math.max(185, Math.min(");
    expect(appCss).toContain(".canvas-stage { position: relative; min-width: 0; min-height: 0; flex: 1; display: flex; overflow: hidden;");

    /** Reproduces the `left` computed in app.tsx for the selection toolbar. */
    const leftFor = (surfaceWidth: number, centreX: number) =>
      surfaceWidth < 500 ? surfaceWidth / 2 : Math.max(185, Math.min(surfaceWidth - 185, centreX));

    // A multi-selection toolbar carries ~18 controls at ~36px each plus dividers.
    const naturalToolbarWidth = 18 * 36 + 3 * 7;
    const offscreen: number[] = [];
    for (const surfaceWidth of [500, 560, 640, 720, 800, 900]) {
      const toolbarWidth = Math.min(naturalToolbarWidth, surfaceWidth - 12); // max-width: calc(100% - 12px)
      const left = leftFor(surfaceWidth, 0); // object hard against the left edge
      const leftEdge = left - toolbarWidth / 2; // transform: translateX(-50%)
      if (leftEdge < 0) offscreen.push(surfaceWidth);
    }
    // FINDING: `.canvas-stage` is `overflow: hidden`, so the clipped portion of
    // the toolbar is unreachable by pointer AND invisible — the 185px clamp
    // assumes a 370px-wide toolbar that a multi-selection far exceeds.
    expect(offscreen).toEqual([]);
  });

  it("[LAYOUT-5 CONTROL] the selection toolbar does NOT overlap the board header — hypothesis disproved", () => {
    // `.canvas-board-header` is a flex sibling ABOVE `.canvas-stage`
    // (app.css:13-14, 21), and the toolbar's `top` is clamped to >= 12px
    // *inside the stage*, i.e. already below the 48px header. The header also
    // carries z-index 30 against the toolbar's 28, so even a negative top would
    // paint behind it. This test documents that the reported issue is NOT real.
    expect(appCss).toContain(".canvas-main { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column;");
    expect(appCss).toContain(".canvas-board-header { position: relative; z-index: 30; height: 48px;");
    expect(appCss).toContain(".canvas-stage { position: relative;");
    expect(appTsx).toContain("top: Math.max(12, viewport.y + selectionBox.minY * viewport.zoom - 60)");
    const headerZ = 30;
    const toolbarZ = 28;
    expect(headerZ).toBeGreaterThan(toolbarZ);
  });
});

// ===========================================================================
// F. TOUCH TARGETS AND COLOUR
// ===========================================================================

describe("adversarial: touch targets and colour", () => {
  it("[TARGET-1] ARITHMETIC: several controls fall below the 24×24 CSS-px minimum", () => {
    // WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA.
    const undersized: Array<{ control: string; height: number; where: string }> = [];

    // .canvas-find-close — padding 2px 6px around a 10px font, no min-height.
    expect(navCss).toContain(".canvas-find-close {");
    expect(navCss).toContain("padding: 2px 6px;");
    expect(navCss).toContain("font-size: 10px;");
    undersized.push({
      control: "Close find",
      height: 10 * 1.2 + 2 * 2 + 2, // line box + padding + border
      where: `styles/navigation.css:${lineOf(navCss, ".canvas-find-close {")}`,
    });

    // Inspector comment Resolve/Delete — bare buttons, 11px font, no sizing.
    expect(appCss).toContain(".comment-list article div { display: flex; gap: 10px; margin-top: 7px; color: var(--primary); font-size: 11px; }");
    undersized.push({
      control: "Resolve / Delete comment",
      height: 11 * 1.2,
      where: `app.css:${lineOf(appCss, ".comment-list article div {")}`,
    });

    // The zoom-percentage button doubles as "Fit to content" but has no height.
    expect(appCss).toContain(".canvas-zoom-controls > button:nth-child(2) { width: 56px; color: var(--muted-foreground); font-size: 11px; }");
    undersized.push({
      control: "Fit to content (zoom %)",
      height: 11 * 1.2,
      where: `app.css:${lineOf(appCss, ".canvas-zoom-controls > button:nth-child(2)")}`,
    });

    // .selection-color-menu swatches sit exactly on the 24px boundary.
    expect(appCss).toContain(".selection-color-menu > button, .selection-color-menu > label { width: 24px; height: 24px;");

    expect(undersized.filter((entry) => entry.height < 24)).toEqual([]);
  });

  it("[TARGET-2] hard-coded colours in the selection toolbar and guides ignore the theme custom properties", () => {
    const hardCoded = [
      { rule: ".selection-toolbar", colour: "#202124", where: `app.css:${lineOf(appCss, ".selection-toolbar { position: absolute")}` },
      { rule: ".selection-toolbar select", colour: "#202124 / #38393b", where: `app.css:${lineOf(appCss, ".selection-toolbar select {")}` },
      { rule: ".selection-action:hover", colour: "#414244", where: `app.css:${lineOf(appCss, ".selection-action:hover")}` },
      { rule: ".selection-action.danger:hover", colour: "#b42318", where: `app.css:${lineOf(appCss, ".selection-action.danger:hover")}` },
      { rule: ".canvas-guides line", colour: "#f2338d", where: `app.css:${lineOf(appCss, ".canvas-guides line")}` },
      { rule: ".canvas-edges marker path", colour: "#334155", where: `app.css:${lineOf(appCss, ".canvas-edges marker path")}` },
      { rule: ".canvas-edges text", colour: "#475569 on white stroke", where: `app.css:${lineOf(appCss, ".canvas-edges text")}` },
      { rule: ".diagram-node", colour: "#64748b border", where: `app.css:${lineOf(appCss, ".diagram-node { position: absolute")}` },
      { rule: ".diagram-node textarea", colour: "#172033 ink", where: `app.css:${lineOf(appCss, ".diagram-node textarea")}` },
      { rule: ".canvas-tool-tooltip", colour: "#202124 / white", where: `app.css:${lineOf(appCss, ".canvas-tool-tooltip {")}` },
    ].filter((entry) => appCss.includes(entry.colour.split(" ")[0]!));

    // FINDING: none of these respond to the light/dark theme tokens. The two that
    // actually fail contrast are the connector arrowheads (#334155 on the dark
    // theme's canvas fill) and the connector label halo (`stroke: white`, which
    // paints a white outline on a dark board) — WCAG 1.4.11 / 1.4.3. jsdom
    // cannot resolve `color-mix()` or the host theme, so the ratios themselves
    // are REASONED; the hard-coding is asserted here.
    expect(hardCoded.map((entry) => `${entry.rule} (${entry.colour}) ${entry.where}`)).toEqual([]);
  });

  it("[TARGET-3] a user-chosen fill can render node text invisible — the ink colour is a constant", async () => {
    const view = await openBoard(oneNode);
    selectNode(view, "sticky-1");
    const toolbar = view.getByRole("toolbar", { name: "Selection properties" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Change fill color" }));
    const picker = view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom selection fill color"]',
    )!;
    fireEvent.change(picker, { target: { value: "#000000" } });

    // Fill is arbitrary; the text colour is not.
    expect(appCss).toContain("color: #172033");
    const applied = view.rpcCalls
      .filter((call) => call.method === "board_apply_operations")
      .flatMap((call) => (call.input as { operations: Array<{ patch?: { color?: string } }> }).operations)
      .map((operation) => operation.patch?.color)
      .filter((value): value is string => value !== undefined);

    // FINDING: #172033 text on a #000000 fill is ~1.1:1. Nothing clamps or
    // adapts the ink. WCAG 1.4.3 Contrast (Minimum). app.css:74, app.tsx:539.
    expect(applied).not.toContain("#000000");
  });
});
