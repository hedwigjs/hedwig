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
| 09 | `history-append` | emit on a topic with `retention: { last: N }` at N = 100 / 1,000 / 10,000 |
| 10 | `replay-cost` | `on({ replay: { limit: N } })` at 10 / 100 / 1,000 retained messages |
| 11 | `remote-roundtrip` | Remote client forward + loopback inject overhead (proxy for cross-tab) |
| 12 | `memory-footprint` | Heap Δ per subscription at 1k / 10k / 50k |
| 13 | `devtools-attach` | Overhead of the observer shape DevTools installs |
| 14 | `contention-jitter` | p99 jitter of 1,000-emit bursts (10 concurrent senders) |
| 15 | `cold-start` | `initBroker` + N × `createClient` startup budget |
| 16 | `remote-request` | `request()` to a remote and from a remote, against a local one |
| 17 | `envelope` | `buildFrame` / `parseFrame` — the per-frame wire tax, object and JSON text |
| 18 | `payloads` | Deep-freeze in place vs `payloads: 'clone'`, flat and nested |
| 19 | `maxbytes` | `maxBytes` on an inbound frame: measured by the runtime vs reported by the transport |
| 20 | `lazy-client` | SDK client created before `initBroker` — queue at 0 / 1 / 16 / 64 and flush |
| 21 | `state-retained` | `on()` on a `state` topic delivering the retained value synchronously |

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

In short (a longer rationale document is not written yet):
- **1–5** are the "must-have" set — anyone evaluating the broker should see
  these numbers on the tin.
- **6–10** cover operational cost of secondary features (backpressure,
  history, replay) so we can guard against regressions when their
  implementations evolve.
- **11–15** are diagnostic — memory leaks, GC jitter, cross-context, cold
  start. Run them when investigating a symptom, not on every PR.
- **16–21** price the decisions a host actually makes: whether to put a
  participant behind a transport, whether to turn on `maxBytes`, whether to
  pay for `payloads: 'clone'`, and what a module loading before the shell
  costs. Each one reads as a delta against a baseline case in the same
  file — the absolute numbers include setup that cancels out.

## Method notes

Two traps this suite has to sidestep, worth knowing before adding a case:

- **Never re-emit the same object** when the subject is payload handling.
  Deep-freeze bails out on an already-frozen object, so a reused payload
  makes `'freeze'` look free (see `18-payloads`).
- **Never put a `setTimeout` in the measured path.** A `setTimeout(…, 0)`
  costs ~1.3 ms and buries anything at µs scale; drain microtasks with
  `await Promise.resolve()` instead (see `20-lazy-client`).

`20-lazy-client` also imports the SDK from `packages/client/src` rather than
the package: a built `@hedwigjs/client` bakes `MIN_RUNTIME` from its release
and refuses the source runtime, which reports `0.0.0-dev`. It installs an
`EventTarget` on `globalThis` for the same reason — without it the SDK falls
back to a 50 ms polling timer that Node needs and a browser never sees.
