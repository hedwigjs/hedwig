# benchmarks/

Performance harness for `@hedwigjs/broker`. Uses [`tinybench`](https://github.com/tinylibs/tinybench)
for op/sec + latency percentiles, and lightweight custom loops for scenarios
that need per-call wall-clock samples (memory footprint, burst jitter, cold
start).

## Run

```bash
npm run bench             # every bench file, sequentially
npm run bench:one <name>  # single file, e.g. `npm run bench:one 04-fanout`
```

`bench:one` matches by prefix — `04`, `04-fanout`, or the full name all work.

Every bench file is invoked as an isolated `tsx` process with `--expose-gc`
so the memory bench can trigger `global.gc()` for reliable deltas.

## What each file measures

| # | File | Focus |
|---|---|---|
| 01 | `emit-throughput` | `emit()` ops/sec at 1 / 10 / 100 subscribers |
| 02 | `emit-latency` | p50 / p95 / p99 / p99.9 of a single `emit` cycle |
| 03 | `request-roundtrip` | `request()` sync/async handler vs one-way `emit` |
| 04 | `fanout-scaling` | Dispatch cost 1 → 10,000 subscribers on one topic |
| 05 | `hook-overhead` | Marginal cost per `beforeSend` hook (0 / 1 / 5 / 10) |
| 06 | `subscribe-cost` | `on` + `off` cycle, backpressure wrapper cost, HMR churn |
| 07 | `backpressure-overhead` | throttle / debounce / rateLimit vs plain handler |
| 08 | `multi-topic-isolation` | Dispatch stays O(1) across 10 → 10,000 unrelated topics |
| 09 | `history-append` | `emit({ history: true })` at buffer sizes 100 / 1,000 / 10,000 |
| 10 | `replay-cost` | `on({ replay: { limit: N } })` at 10 / 100 / 1,000 historical messages |
| 11 | `bridge-roundtrip` | Bridge send + loopback inject overhead (proxy for cross-tab) |
| 12 | `memory-footprint` | Heap Δ per subscription at 1k / 10k / 50k |
| 13 | `devtools-attach` | Overhead of the observer shape DevTools installs |
| 14 | `contention-jitter` | p99 jitter of 1,000-emit bursts (10 concurrent senders) |
| 15 | `cold-start` | `initBroker` + N × `createClient` startup budget |

## Interpretation

The suite reports **op/sec** and **ns/op** with tinybench's built-in
relative-margin-of-error (`±rme%`). Anything > 5% RME is noisy — either
increase `time` in `harness.ts BENCH_DEFAULTS` or lower background load.

`ns/op` scales inversely with throughput, so:
- Fan-out 10 at 10M ops/sec ≈ 100 ns/emit ≈ 10 ns/subscriber
- Fan-out 100 at 1M ops/sec ≈ 1 µs/emit ≈ 10 ns/subscriber

**A dispatch that stays constant in ns/subscriber as fan-out grows is what
we want.** Superlinear = bad.

## Baseline & regression detection

Not implemented yet. Planned:

- `bench --save <label>` writes results to `baselines/<label>.json`
- `bench --compare <label>` fails if any case regresses beyond a threshold

Wire that into CI once the numbers stabilize and platform (macOS vs Linux
runners) is normalized.

## Why these tests

See `docs/content/architecture/benchmark-rationale.md` (TBD) for the full
rationale. Short version:
- **1–5** are the "must-have" set — anyone evaluating the broker should see
  these numbers on the tin.
- **6–10** cover operational cost of secondary features (backpressure,
  history, replay) so we can guard against regressions when their
  implementations evolve.
- **11–15** are diagnostic — memory leaks, GC jitter, cross-context, cold
  start. Run them when investigating a symptom, not on every PR.

## Legacy

`benchmarks-legacy/` still contains the pre-tsup-refactor bench scripts
from the hse era. They target `dist/core/BrokerCore` and `InMemoryClient`
paths that no longer exist. Kept for reference; the current suite here
supersedes them.
