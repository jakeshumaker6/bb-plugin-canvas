import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from "react";
import { isSeparator, type MenuAction, type MenuItem } from "../src/menu-items";
import { Icon } from "./ui/icon";
import type { IconName } from "./ui/icon";

/** Keeps the menu off the very edge of the viewport when it flips. */
const EDGE_MARGIN = 8;
/** Used only when the browser cannot measure yet (first paint, jsdom). */
const FALLBACK_WIDTH = 240;
const FALLBACK_ITEM_HEIGHT = 32;
const FALLBACK_PADDING = 10;

/** Actions drawn with a shared bb `Icon`; everything else gets a local glyph. */
const ICONS: Partial<Record<MenuAction, IconName>> = {
  copy: "Copy",
  duplicate: "Copy",
  delete: "Trash2",
  "edit-text": "Edit",
  "add-comment": "MessageSquarePlus",
};

/**
 * Line-art glyphs in the same idiom as `ToolGlyph`/`AlignGlyph` in app.tsx, so
 * the menu reads as part of the same toolset rather than a bolted-on widget.
 */
function MenuGlyph({ id }: { id: MenuAction }): JSX.Element {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const align = ALIGN_GEOMETRY[id];
  if (align !== undefined) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {align.vertical ? (
          <>
            <path {...common} d={`M${align.rail} 3v18`} strokeDasharray="2 2" />
            <rect {...common} x={align.a} y="5" width="12" height="5" rx="1" />
            <rect {...common} x={align.b} y="14" width="8" height="5" rx="1" />
          </>
        ) : (
          <>
            <path {...common} d={`M3 ${align.rail}h18`} strokeDasharray="2 2" />
            <rect {...common} x="5" y={align.a} width="5" height="12" rx="1" />
            <rect {...common} x="14" y={align.b} width="5" height="8" rx="1" />
          </>
        )}
      </svg>
    );
  }
  if (id === "cut") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="6" cy="18" r="3" /><circle {...common} cx="18" cy="18" r="3" /><path {...common} d="M8.1 15.9 19 4M15.9 15.9 5 4" /></svg>;
  }
  if (id === "paste" || id === "paste-here") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M9 4H6.5A1.5 1.5 0 0 0 5 5.5v14A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-14A1.5 1.5 0 0 0 17.5 4H15" /><rect {...common} x="9" y="2.5" width="6" height="3.5" rx="1" /></svg>;
  }
  if (id === "bring-front" || id === "bring-forward") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="3.5" y="3.5" width="11" height="11" rx="2" /><path {...common} d={id === "bring-front" ? "M9.5 20.5h11v-11" : "M14.5 20.5h6v-6"} /></svg>;
  }
  if (id === "send-backward" || id === "send-back") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="9.5" y="9.5" width="11" height="11" rx="2" /><path {...common} d={id === "send-back" ? "M14.5 3.5h-11v11" : "M9.5 3.5h-6v6"} /></svg>;
  }
  if (id === "group" || id === "ungroup") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" strokeDasharray={id === "ungroup" ? "3 2" : undefined} /><rect {...common} x="8" y="8" width="8" height="8" rx="1.5" /></svg>;
  }
  if (id === "lock") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="4.5" y="10" width="15" height="10" rx="2" /><path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  }
  if (id === "unlock") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="4.5" y="10" width="15" height="10" rx="2" /><path {...common} d="M8 10V7a4 4 0 0 1 7.7-1.5" /></svg>;
  }
  if (id === "tidy-up") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="3.5" y="4" width="7" height="7" rx="1" /><rect {...common} x="13.5" y="4" width="7" height="7" rx="1" /><rect {...common} x="3.5" y="13" width="7" height="7" rx="1" /><rect {...common} x="13.5" y="13" width="7" height="7" rx="1" /></svg>;
  }
  if (id === "distribute-horizontal") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M3 4v16M21 4v16" strokeDasharray="2 2" /><rect {...common} x="10" y="7" width="4" height="10" rx="1" /></svg>;
  }
  if (id === "distribute-vertical") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 3h16M4 21h16" strokeDasharray="2 2" /><rect {...common} x="7" y="10" width="10" height="4" rx="1" /></svg>;
  }
  if (id === "select-all") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="3.5" y="3.5" width="17" height="17" rx="2.5" strokeDasharray="3 2.5" /><path {...common} d="m8 12 3 3 5-6" /></svg>;
  }
  if (id === "zoom-to-fit") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="12" cy="12" r="2" /></svg>;
}

const ALIGN_GEOMETRY: Partial<Record<MenuAction, { vertical: boolean; rail: number; a: number; b: number }>> = {
  "align-left": { vertical: true, rail: 4, a: 4, b: 4 },
  "align-horizontal-center": { vertical: true, rail: 12, a: 6, b: 8 },
  "align-right": { vertical: true, rail: 20, a: 8, b: 12 },
  "align-top": { vertical: false, rail: 4, a: 4, b: 4 },
  "align-vertical-center": { vertical: false, rail: 12, a: 6, b: 8 },
  "align-bottom": { vertical: false, rail: 20, a: 8, b: 12 },
};

function isEnabled(item: MenuItem): boolean {
  return !isSeparator(item) && item.disabled !== true;
}

function enabledIndexes(items: MenuItem[]): number[] {
  return items.reduce<number[]>((found, item, index) => (isEnabled(item) ? [...found, index] : found), []);
}

export function CanvasContextMenu({
  items,
  position,
  onSelect,
  onClose,
}: {
  items: MenuItem[];
  /** Client coordinates of the right-click, before any edge flipping. */
  position: { x: number; y: number };
  onSelect: (action: MenuAction) => void;
  onClose: () => void;
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closedRef = useRef(false);
  const [placement, setPlacement] = useState(position);
  const [activeIndex, setActiveIndex] = useState(() => enabledIndexes(items)[0] ?? -1);

  // `onClose` must fire exactly once even if several dismissals race (an
  // outside pointerdown that also scrolls, say).
  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }, [onClose]);

  const activate = useCallback((item: MenuItem) => {
    if (!isEnabled(item) || isSeparator(item)) return;
    onSelect(item.id);
    close();
  }, [close, onSelect]);

  // Flip rather than clip: a menu opened near the right/bottom edge opens
  // toward the centre so every item stays reachable.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : FALLBACK_WIDTH;
    const height = rect.height > 0 ? rect.height : FALLBACK_PADDING + items.length * FALLBACK_ITEM_HEIGHT;
    const maxX = window.innerWidth - EDGE_MARGIN;
    const maxY = window.innerHeight - EDGE_MARGIN;
    setPlacement({
      x: position.x + width > maxX ? Math.max(EDGE_MARGIN, position.x - width) : position.x,
      y: position.y + height > maxY ? Math.max(EDGE_MARGIN, position.y - height) : position.y,
    });
  }, [items, position.x, position.y]);

  // Also runs on mount, which is what puts focus on the first enabled item.
  useEffect(() => {
    if (activeIndex < 0) {
      menuRef.current?.focus();
      return;
    }
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target) === true) return;
      close();
    };
    const onDismiss = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [close]);

  const step = (delta: number) => {
    const enabled = enabledIndexes(items);
    if (enabled.length === 0) return;
    const current = enabled.indexOf(activeIndex);
    const next = current === -1
      ? (delta > 0 ? 0 : enabled.length - 1)
      : (current + delta + enabled.length) % enabled.length;
    setActiveIndex(enabled[next]!);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const enabled = enabledIndexes(items);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown") { event.preventDefault(); step(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); step(-1); return; }
    if (event.key === "Home") { event.preventDefault(); if (enabled[0] !== undefined) setActiveIndex(enabled[0]); return; }
    if (event.key === "End") { event.preventDefault(); const last = enabled.at(-1); if (last !== undefined) setActiveIndex(last); return; }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = items[activeIndex];
      if (item !== undefined) activate(item);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      close();
    }
  };

  itemRefs.current.length = items.length;
  return (
    <div
      ref={menuRef}
      className="canvas-context-menu"
      role="menu"
      aria-label="Canvas actions"
      aria-orientation="vertical"
      tabIndex={-1}
      data-testid="canvas-context-menu"
      style={{ left: placement.x, top: placement.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (isSeparator(item)) return <div key={`separator-${index}`} className="canvas-context-separator" role="separator" />;
        const disabled = item.disabled === true;
        const icon = ICONS[item.id];
        return (
          <button
            key={item.id}
            ref={(element) => { itemRefs.current[index] = element; }}
            type="button"
            role="menuitem"
            className="canvas-context-item"
            aria-disabled={disabled}
            data-action={item.id}
            tabIndex={index === activeIndex ? 0 : -1}
            onPointerEnter={() => { if (!disabled) setActiveIndex(index); }}
            onClick={() => activate(item)}
          >
            <span className="canvas-context-icon" aria-hidden="true">
              {icon === undefined ? <MenuGlyph id={item.id} /> : <Icon name={icon} className="size-4" />}
            </span>
            <span className="canvas-context-label">{item.label}</span>
            {item.hint === undefined ? null : <kbd className="canvas-context-hint">{item.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
