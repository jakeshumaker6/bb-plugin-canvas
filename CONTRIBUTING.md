# Contributing

Thanks for looking. Canvas is a BB plugin; you need a working `bb` install to
run it, but not to run the tests or the type checker.

## Setup

```
git clone https://github.com/jakeshumaker6/bb-plugin-canvas
cd bb-plugin-canvas
npm install
bb plugin install . --yes
```

For day-to-day work, run the watch loop — it rebuilds and reloads the plugin on
every save:

```
bb plugin dev
```

Open **Canvas** in the BB sidebar to see your changes.

## Checks

Everything must pass before a pull request:

```
npm test -- --run      # vitest, once, no watch
npm run typecheck      # tsc, strict, no emit
npm run build          # bb plugin build
```

CI runs the first two. It does not run `npm run build`, because that shells out
to the `bb` CLI, which does not exist on a GitHub runner. Run the build
locally before you open a pull request that touches the manifest, the entry
points, or dependencies.

## Module layout

The layout is the design. Keep to it.

- **`src/`** — pure logic. No React, no DOM, no I/O, no imports from `app.tsx`
  or `components/`. `domain.ts` owns the schema and the operation model;
  `geometry.ts`, `arrange.ts`, `clipboard.ts`, `connectors.ts`,
  `menu-items.ts`, `navigation.ts`, `shapes.ts`, and `portable.ts` each own one
  pure concern.
  Functions here return operations or values — they never mutate state.
- **`components/`** — React rendering. Presentational, driven by props, no RPC
  calls and no business rules. `components/ui/` is vendored (the shadcn model):
  edit it freely, it never updates out from under you.
- **`app.tsx`** — the single integration point. It holds frontend state, wires
  the pointer and keyboard, and is the only place that calls RPC. When a new
  feature needs a rule, the rule goes in `src/` and `app.tsx` calls it.
- **`server.ts`** — the plugin backend: the RPC contract, persistence, and the
  chat agent's tools.
- **`tests/`** — vitest. Pure modules are tested directly; UI behaviour is
  tested through the plugin SDK's app testing helpers.

New behaviour that can be expressed as a pure function belongs in `src/`, not
in `app.tsx`. If you find yourself writing a rule inside a React handler, that
is the signal.

## The rule: the failing test comes first

A behaviour change needs a test, and the test is written **before** the
implementation, and it **fails first**.

1. Write the test that describes the behaviour you want.
2. Run it. Watch it fail, and read the failure — a test that passes before you
   have written anything is testing nothing.
3. Write the smallest implementation that makes it pass.
4. Run the full suite and the type checker.

This applies to bug fixes too: reproduce the bug as a failing test, then fix it.
The test is the record of what was wrong.

Pure refactors, comment and documentation changes, and dependency bumps do not
need a new test — but they do need the existing suite to stay green.

## Pull requests

- One concern per pull request.
- Say what changed and why. Link the issue if there is one.
- Note anything a reviewer should try by hand in the running plugin.
