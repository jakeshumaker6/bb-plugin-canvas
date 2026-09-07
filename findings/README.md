# Adversarial findings

These are **detection tests**, not part of the suite. Each one is written to FAIL while
the defect it describes is still present, so the file is a live ledger of open findings
rather than a regression suite. They are excluded from `npm test` and from CI for that
reason — a failing test here is the point, not a broken build.

Produced by a five-agent adversarial pass on 2026-09-07, each agent attacking one lens:
functional dead controls, data integrity, untrusted input, gesture/state races, and
accessibility + layout.

When a finding is fixed, its permanent regression test goes in `tests/` asserting the
corrected behaviour, and the detection test here is deleted. A finding that survives
here is a finding nobody has closed yet.

Run them deliberately:

    npx vitest run --config vitest.findings.config.ts
