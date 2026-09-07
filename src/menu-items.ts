/**
 * Pure item model for the canvas right-click menu.
 *
 * This module owns the *product* decision of which actions a given selection
 * exposes; the React component in `components/canvas-context-menu.tsx` is a
 * dumb renderer over whatever this returns. Keeping it free of React makes the
 * matrix cheap to test and cheap to reason about.
 */

export type MenuAction =
  | "cut" | "copy" | "paste" | "duplicate" | "delete"
  | "bring-front" | "bring-forward" | "send-backward" | "send-back"
  | "group" | "ungroup" | "lock" | "unlock"
  | "tidy-up" | "distribute-horizontal" | "distribute-vertical"
  | "align-left" | "align-horizontal-center" | "align-right" | "align-top" | "align-vertical-center" | "align-bottom"
  | "select-all" | "paste-here" | "edit-text" | "add-comment" | "zoom-to-fit";

export type MenuEntry = { id: MenuAction; label: string; hint?: string; disabled?: boolean };
export type MenuSeparator = { separator: true };
export type MenuItem = MenuEntry | MenuSeparator;

export type MenuContext = {
  target: "canvas" | "object";
  /** How many objects are selected. */
  selectionCount: number;
  /** True when *every* selected node is locked. */
  locked: boolean;
  /** True when *every* selected node shares one non-null groupId. */
  grouped: boolean;
  /** True when the clipboard holds something pasteable. */
  canPaste: boolean;
};

const SEPARATOR: MenuSeparator = { separator: true };

/** Distributing needs a first, a last, and something to space in between. */
const MIN_DISTRIBUTE = 3;

const LABELS: Record<MenuAction, string> = {
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  "paste-here": "Paste here",
  duplicate: "Duplicate",
  delete: "Delete",
  "bring-front": "Bring to front",
  "bring-forward": "Bring forward",
  "send-backward": "Send backward",
  "send-back": "Send to back",
  group: "Group selection",
  ungroup: "Ungroup",
  lock: "Lock",
  unlock: "Unlock",
  "tidy-up": "Tidy up",
  "distribute-horizontal": "Distribute horizontally",
  "distribute-vertical": "Distribute vertically",
  "align-left": "Align left",
  "align-horizontal-center": "Align horizontal centers",
  "align-right": "Align right",
  "align-top": "Align top",
  "align-vertical-center": "Align vertical centers",
  "align-bottom": "Align bottom",
  "select-all": "Select all",
  "edit-text": "Edit text",
  "add-comment": "Add comment",
  "zoom-to-fit": "Zoom to fit",
};

const HINTS: Partial<Record<MenuAction, string>> = {
  cut: "Cmd/Ctrl+X",
  copy: "Cmd/Ctrl+C",
  paste: "Cmd/Ctrl+V",
  "paste-here": "Cmd/Ctrl+V",
  duplicate: "Cmd/Ctrl+D",
  delete: "Delete",
  "select-all": "Cmd/Ctrl+A",
  "edit-text": "Enter",
  "zoom-to-fit": "Shift+1",
  group: "Cmd/Ctrl+G",
  ungroup: "Cmd/Ctrl+Shift+G",
  lock: "Cmd/Ctrl+Shift+L",
  unlock: "Cmd/Ctrl+Shift+L",
  "tidy-up": "Cmd/Ctrl+Shift+T",
  "bring-front": "Cmd/Ctrl+Shift+]",
  "bring-forward": "Cmd/Ctrl+]",
  "send-backward": "Cmd/Ctrl+[",
  "send-back": "Cmd/Ctrl+Shift+[",
};

export function isSeparator(item: MenuItem): item is MenuSeparator {
  return "separator" in item;
}

function entry(id: MenuAction, disabled = false): MenuEntry {
  const hint = HINTS[id];
  return {
    id,
    label: LABELS[id],
    ...(hint === undefined ? {} : { hint }),
    ...(disabled ? { disabled: true } : {}),
  };
}

const Z_ORDER: MenuAction[] = ["bring-front", "bring-forward", "send-backward", "send-back"];
const ALIGN: MenuAction[] = [
  "align-left", "align-horizontal-center", "align-right",
  "align-top", "align-vertical-center", "align-bottom",
];

/**
 * Joins non-empty sections with single separators. Building the menu as
 * sections — rather than pushing separators inline — is what makes "no leading,
 * trailing, or doubled separator" structurally true rather than a lint.
 */
function join(sections: MenuEntry[][]): MenuItem[] {
  const items: MenuItem[] = [];
  for (const section of sections) {
    if (section.length === 0) continue;
    if (items.length > 0) items.push(SEPARATOR);
    items.push(...section);
  }
  return items;
}

export function menuItemsFor(context: MenuContext): MenuItem[] {
  const count = Math.max(0, Math.trunc(context.selectionCount));
  if (context.target === "canvas" || count === 0) {
    return join([[entry("paste-here", !context.canPaste), entry("select-all"), entry("zoom-to-fit")]]);
  }

  const lockToggle = entry(context.locked ? "unlock" : "lock");
  const zOrder = Z_ORDER.map((id) => entry(id));

  if (count === 1) {
    return join([
      [entry("cut"), entry("copy"), entry("duplicate"), entry("edit-text"), entry("add-comment")],
      zOrder,
      [lockToggle],
      [entry("delete")],
    ]);
  }

  const cannotDistribute = count < MIN_DISTRIBUTE;
  return join([
    [entry("cut"), entry("copy"), entry("duplicate")],
    [
      ...ALIGN.map((id) => entry(id)),
      entry("tidy-up"),
      entry("distribute-horizontal", cannotDistribute),
      entry("distribute-vertical", cannotDistribute),
    ],
    [...zOrder, entry(context.grouped ? "ungroup" : "group"), lockToggle],
    [entry("delete")],
  ]);
}
