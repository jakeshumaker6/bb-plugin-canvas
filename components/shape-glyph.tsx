import type { JSX } from "react";
import { shapePath, type ShapeKind } from "../src/shapes";

const GLYPH_BOX = 20;
const GLYPH_ORIGIN = 2;

export function ShapeGlyph({ kind }: { kind: ShapeKind }): JSX.Element {
  return (
    <svg
      className="shape-glyph"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g transform={`translate(${GLYPH_ORIGIN} ${GLYPH_ORIGIN})`}>
        <path d={shapePath(kind, GLYPH_BOX, GLYPH_BOX)} />
      </g>
    </svg>
  );
}
