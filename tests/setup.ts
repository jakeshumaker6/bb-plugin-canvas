import { afterEach } from "vitest";

// React Testing Library only auto-cleans when vitest exposes globals. Without this,
// two renders in one file leave both trees in the document and queries find duplicates.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

