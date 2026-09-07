// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CanvasContextMenu } from "../components/canvas-context-menu";
import { isSeparator, menuItemsFor, type MenuContext, type MenuItem } from "../src/menu-items";

afterEach(cleanup);

const base: MenuContext = {
  target: "object",
  selectionCount: 1,
  locked: false,
  grouped: false,
  canPaste: false,
};

function ids(items: MenuItem[]): string[] {
  return items.map((item) => (isSeparator(item) ? "---" : item.id));
}

function find(items: MenuItem[], id: string): MenuItem | undefined {
  return items.find((item) => !isSeparator(item) && item.id === id);
}

function labels(items: MenuItem[]): string[] {
  return items.flatMap((item) => (isSeparator(item) ? [] : [item.label]));
}

describe("menuItemsFor", () => {
  it("offers paste-here, select-all, and zoom-to-fit on empty canvas", () => {
    const empty = menuItemsFor({ ...base, target: "canvas", selectionCount: 0 });
    expect(ids(empty)).toEqual(["paste-here", "select-all", "zoom-to-fit"]);
    expect(find(empty, "paste-here")).toMatchObject({ disabled: true, hint: "Cmd/Ctrl+V" });

    const withClipboard = menuItemsFor({ ...base, target: "canvas", selectionCount: 0, canPaste: true });
    expect(find(withClipboard, "paste-here")).toMatchObject({ label: "Paste here" });
    expect((find(withClipboard, "paste-here") as { disabled?: boolean }).disabled).toBeUndefined();
  });

  it("gives one object edit, z-order, lock, and delete — but no align or group", () => {
    const items = menuItemsFor(base);
    expect(ids(items)).toEqual([
      "cut", "copy", "duplicate", "edit-text", "add-comment",
      "---", "bring-front", "bring-forward", "send-backward", "send-back",
      "---", "lock",
      "---", "delete",
    ]);
    expect(find(items, "align-left")).toBeUndefined();
    expect(find(items, "group")).toBeUndefined();
    expect(find(items, "tidy-up")).toBeUndefined();
  });

  it("swaps lock for unlock when the whole selection is locked, never both", () => {
    for (const selectionCount of [1, 4]) {
      const unlocked = menuItemsFor({ ...base, selectionCount });
      expect(find(unlocked, "lock")).toBeDefined();
      expect(find(unlocked, "unlock")).toBeUndefined();

      const locked = menuItemsFor({ ...base, selectionCount, locked: true });
      expect(find(locked, "unlock")).toBeDefined();
      expect(find(locked, "lock")).toBeUndefined();
    }
  });

  it("adds align, tidy-up, distribute, and group for a multi-selection", () => {
    const items = menuItemsFor({ ...base, selectionCount: 2 });
    expect(ids(items)).toEqual([
      "cut", "copy", "duplicate",
      "---",
      "align-left", "align-horizontal-center", "align-right",
      "align-top", "align-vertical-center", "align-bottom",
      "tidy-up", "distribute-horizontal", "distribute-vertical",
      "---", "bring-front", "bring-forward", "send-backward", "send-back", "group", "lock",
      "---", "delete",
    ]);
    expect(find(items, "edit-text")).toBeUndefined();
  });

  it("disables distribute below three objects and enables it at three", () => {
    const pair = menuItemsFor({ ...base, selectionCount: 2 });
    expect(find(pair, "distribute-horizontal")).toMatchObject({ disabled: true });
    expect(find(pair, "distribute-vertical")).toMatchObject({ disabled: true });

    const trio = menuItemsFor({ ...base, selectionCount: 3 });
    expect((find(trio, "distribute-horizontal") as { disabled?: boolean }).disabled).toBeUndefined();
    expect((find(trio, "distribute-vertical") as { disabled?: boolean }).disabled).toBeUndefined();
    expect(find(trio, "tidy-up")).toBeDefined();
  });

  it("swaps group for ungroup when the selection already shares a group", () => {
    const grouped = menuItemsFor({ ...base, selectionCount: 3, grouped: true });
    expect(find(grouped, "ungroup")).toMatchObject({ hint: "Cmd/Ctrl+Shift+G" });
    expect(find(grouped, "group")).toBeUndefined();

    const loose = menuItemsFor({ ...base, selectionCount: 3 });
    expect(find(loose, "group")).toMatchObject({ hint: "Cmd/Ctrl+G" });
    expect(find(loose, "ungroup")).toBeUndefined();
  });

  it("never emits a leading, trailing, or doubled separator in any context", () => {
    const targets: Array<MenuContext["target"]> = ["canvas", "object"];
    for (const target of targets) {
      for (const selectionCount of [0, 1, 2, 3, 12]) {
        for (const locked of [false, true]) {
          for (const grouped of [false, true]) {
            for (const canPaste of [false, true]) {
              const items = menuItemsFor({ target, selectionCount, locked, grouped, canPaste });
              expect(items.length).toBeGreaterThan(0);
              expect(isSeparator(items[0]!)).toBe(false);
              expect(isSeparator(items.at(-1)!)).toBe(false);
              expect(items.some((item, index) => isSeparator(item) && isSeparator(items[index - 1] ?? item))).toBe(false);
            }
          }
        }
      }
    }
  });

  it("labels shortcuts on the actions that have them", () => {
    const items = menuItemsFor({ ...base, selectionCount: 2 });
    expect(find(items, "cut")).toMatchObject({ hint: "Cmd/Ctrl+X" });
    expect(find(items, "copy")).toMatchObject({ hint: "Cmd/Ctrl+C" });
    expect(find(items, "duplicate")).toMatchObject({ hint: "Cmd/Ctrl+D" });
    expect(find(items, "delete")).toMatchObject({ hint: "Delete" });
    expect(find(items, "align-left")).not.toHaveProperty("hint");
  });
});

const menuItems = menuItemsFor({ ...base, target: "canvas", selectionCount: 0 });

function renderMenu(overrides: Partial<Parameters<typeof CanvasContextMenu>[0]> = {}) {
  cleanup();
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <CanvasContextMenu
      items={overrides.items ?? menuItems}
      position={overrides.position ?? { x: 40, y: 40 }}
      onSelect={overrides.onSelect ?? onSelect}
      onClose={overrides.onClose ?? onClose}
    />,
  );
  return { ...view, onSelect, onClose, menu: view.getByRole("menu", { name: "Canvas actions" }) };
}

describe("CanvasContextMenu", () => {
  it("renders menu roles, separators, and aria-disabled state", () => {
    const view = renderMenu({ items: menuItemsFor({ ...base }) });
    expect(view.menu.getAttribute("aria-orientation")).toBe("vertical");
    expect(view.getAllByRole("menuitem")).toHaveLength(labels(menuItemsFor({ ...base })).length);
    expect(view.getAllByRole("separator")).toHaveLength(3);

    const disabled = renderMenu().getByRole("menuitem", { name: /Paste here/ });
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
  });

  it("focuses the first enabled item on open, skipping a leading disabled item", () => {
    const view = renderMenu();
    expect(document.activeElement?.getAttribute("data-action")).toBe("select-all");
    expect(view.getByRole("menuitem", { name: /Select all/ }).tabIndex).toBe(0);
  });

  it("moves focus with arrows, skipping disabled items and separators", () => {
    const view = renderMenu({ items: menuItemsFor({ ...base, selectionCount: 2 }) });
    expect(document.activeElement?.getAttribute("data-action")).toBe("cut");
    // cut -> copy -> duplicate -> (separator) -> align-left
    for (const expected of ["copy", "duplicate", "align-left"]) {
      fireEvent.keyDown(view.menu, { key: "ArrowDown" });
      expect(document.activeElement?.getAttribute("data-action")).toBe(expected);
    }
    // ...through the aligns and tidy-up, then the disabled distribute pair is skipped.
    for (let index = 0; index < 6; index += 1) fireEvent.keyDown(view.menu, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-action")).toBe("tidy-up");
    fireEvent.keyDown(view.menu, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-action")).toBe("bring-front");
    fireEvent.keyDown(view.menu, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("data-action")).toBe("tidy-up");
  });

  it("jumps to the ends with Home and End", () => {
    const view = renderMenu({ items: menuItemsFor({ ...base }) });
    fireEvent.keyDown(view.menu, { key: "End" });
    expect(document.activeElement?.getAttribute("data-action")).toBe("delete");
    fireEvent.keyDown(view.menu, { key: "Home" });
    expect(document.activeElement?.getAttribute("data-action")).toBe("cut");
  });

  it("activates the focused item with Enter and closes once", () => {
    const view = renderMenu();
    fireEvent.keyDown(view.menu, { key: "ArrowDown" });
    fireEvent.keyDown(view.menu, { key: "Enter" });
    expect(view.onSelect).toHaveBeenCalledTimes(1);
    expect(view.onSelect).toHaveBeenCalledWith("zoom-to-fit");
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it("activates with Space and by click, and never fires a disabled action", () => {
    const view = renderMenu();
    fireEvent.keyDown(view.menu, { key: " " });
    expect(view.onSelect).toHaveBeenCalledWith("select-all");

    const other = renderMenu();
    fireEvent.click(other.getByRole("menuitem", { name: /Paste here/ }));
    expect(other.onSelect).not.toHaveBeenCalled();
    expect(other.onClose).not.toHaveBeenCalled();
  });

  it("closes exactly once on Escape, outside pointerdown, and scroll", () => {
    const escape = renderMenu();
    fireEvent.keyDown(escape.menu, { key: "Escape" });
    fireEvent.keyDown(escape.menu, { key: "Escape" });
    expect(escape.onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const outside = renderMenu();
    fireEvent.pointerDown(outside.menu);
    expect(outside.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    fireEvent.pointerDown(document.body);
    expect(outside.onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const scrolled = renderMenu();
    fireEvent.scroll(window);
    fireEvent.resize(window);
    expect(scrolled.onClose).toHaveBeenCalledTimes(1);
  });

  it("flips away from the right and bottom viewport edges", () => {
    const view = renderMenu({ position: { x: 40, y: 40 } });
    expect(view.menu.style.left).toBe("40px");
    expect(view.menu.style.top).toBe("40px");
    cleanup();

    // jsdom reports a zero-size rect, so the component falls back to its
    // measured-size estimate: 240px wide, 10 + 3 * 32 = 106px tall.
    const corner = renderMenu({ position: { x: window.innerWidth - 10, y: window.innerHeight - 10 } });
    expect(corner.menu.style.left).toBe(`${window.innerWidth - 10 - 240}px`);
    expect(corner.menu.style.top).toBe(`${window.innerHeight - 10 - 106}px`);
  });

  it("removes every document and window listener on unmount", () => {
    const view = renderMenu();
    view.unmount();
    fireEvent.pointerDown(document.body);
    fireEvent.scroll(window);
    fireEvent.resize(window);
    expect(view.onClose).not.toHaveBeenCalled();
  });
});

const menuCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/context-menu.css"), "utf8");

describe("CanvasContextMenu focus management", () => {
  afterEach(() => {
    for (const stray of Array.from(document.querySelectorAll("body > button, body > textarea"))) stray.remove();
  });

  function opener(): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = "Board";
    document.body.append(button);
    button.focus();
    return button;
  }

  it("restores focus to the control that opened it when Escape closes it", () => {
    const trigger = opener();
    const view = renderMenu();
    expect(view.menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(view.menu, { key: "Escape" });
    expect(view.onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Tab and hands focus back rather than dropping it on the body", () => {
    const trigger = opener();
    const view = renderMenu();
    fireEvent.keyDown(view.menu, { key: "Tab" });
    expect(view.onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does not pull focus back when the chosen action already moved it", () => {
    opener();
    const elsewhere = document.createElement("textarea");
    document.body.append(elsewhere);
    const view = renderMenu();
    elsewhere.focus();
    view.unmount();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("makes disabled items genuinely inert, not just aria-disabled", () => {
    const view = renderMenu();
    const paste = view.getByRole("menuitem", { name: /Paste here/ });
    expect(paste.hasAttribute("disabled")).toBe(true);
    expect(paste.getAttribute("aria-disabled")).toBe("true");
    expect(paste.tabIndex).toBe(-1);
    // jsdom will focus a disabled button, so prove inertness the way a browser
    // decides it: the element is out of the sequential focus order entirely.
    expect(paste.matches('button:not([disabled])')).toBe(false);
    expect(paste.matches(":disabled")).toBe(true);
    fireEvent.click(paste);
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
  });

  it("styles disabled items through :disabled instead of pointer-events: none", () => {
    expect(menuCss).toMatch(/\.canvas-context-item:disabled/);
    expect(menuCss).not.toContain("pointer-events: none");
  });
});
