import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { BoardNode } from "../src/domain";
import { matchNodes } from "../src/navigation";

const MAX_RESULTS = 30;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function label(node: BoardNode): string {
  const text = node.text.replace(/\s+/g, " ").trim();
  return text === "" ? `Untitled ${node.kind}` : text;
}

/**
 * Find-object palette. Sits centred near the top of `.canvas-surface`, under the
 * board header and clear of the bottom toolbar/zoom/history clusters.
 */
export function CanvasFind({
  nodes,
  onFocus,
  onClose,
}: {
  nodes: readonly BoardNode[];
  onFocus: (node: BoardNode) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => {
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      // Only reclaim focus if the palette still owns it — focusing a result
      // hands focus to the board, and that must win.
      const active = document.activeElement;
      const ours = active === null || active === document.body || rootRef.current?.contains(active) === true;
      if (ours && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, []);

  const results = useMemo(() => matchNodes(nodes, query).slice(0, MAX_RESULTS), [nodes, query]);
  const active = results.length === 0 ? -1 : Math.min(highlight, results.length - 1);
  const activeId = active < 0 ? undefined : `${baseId}-option-${active}`;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((active + step + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = active < 0 ? undefined : results[active];
      if (chosen !== undefined) onFocus(chosen);
      return;
    }
    if (event.key === "Tab") {
      const root = rootRef.current;
      if (root === null) return;
      const targets = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (targets.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? -1 : 1;
      const current = targets.findIndex((element) => element === document.activeElement);
      const next = current === -1
        ? (step > 0 ? 0 : targets.length - 1)
        : (current + step + targets.length) % targets.length;
      targets[next]?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className="canvas-find"
      role="dialog"
      aria-modal="true"
      aria-label="Find objects"
      onKeyDown={onKeyDown}
    >
      <div className="canvas-find-head">
        <label className="canvas-find-label" htmlFor={`${baseId}-input`}>Find on board</label>
        <button type="button" className="canvas-find-close" onClick={onClose} aria-label="Close find">Esc</button>
      </div>
      <input
        ref={inputRef}
        id={`${baseId}-input`}
        className="canvas-find-input"
        type="text"
        autoComplete="off"
        placeholder="Search objects by text or kind"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={`${baseId}-listbox`}
        aria-activedescendant={activeId}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
      />
      <p className="canvas-find-count" role="status" aria-live="polite">
        {query.trim() === ""
          ? `${nodes.length} objects on this board`
          : `${results.length} ${results.length === 1 ? "match" : "matches"}`}
      </p>
      {results.length === 0 ? (
        query.trim() === "" ? null : <p className="canvas-find-empty">No matches for “{query.trim()}”.</p>
      ) : (
        <ul className="canvas-find-results" id={`${baseId}-listbox`} role="listbox" aria-label="Matching objects">
          {results.map((node, index) => (
            <li
              key={node.id}
              id={`${baseId}-option-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : ""}
              onPointerDown={(event) => {
                event.preventDefault();
                setHighlight(index);
                onFocus(node);
              }}
              onPointerMove={() => setHighlight(index)}
            >
              <span className="canvas-find-text">{label(node)}</span>
              <span className="canvas-find-kind">{node.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
