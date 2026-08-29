/**
 * Shared benchmark harness for @hedwigjs/broker.
 *
 * Wraps tinybench so every bench file gets:
 *  - Consistent bench-suite construction (warmup, iterations, tolerance)
 *  - A `runSuite` helper that runs, waits, and prints a table
 *  - `pretty` for one-off ad-hoc measurements (memory, latency percentiles)
 *
 * Files under `benchmarks/*.bench.ts` are meant to be run through `tsx`
 * (see `npm run bench` in package.json).
 */

import { Bench, type BenchOptions } from 'tinybench';

/** Bench defaults chosen for stability at sub-microsecond ops. */
export const BENCH_DEFAULTS: BenchOptions = {
  warmup: true,
  warmupTime: 200,
  time: 800, // 800ms per case — enough for ns-scale ops to converge
};

export function newBench(opts?: BenchOptions): Bench {
  return new Bench({ ...BENCH_DEFAULTS, ...opts });
}

/**
 * Run a bench and print a compact ops/sec + mean-latency table.
 * Optionally receives a per-task "meta" formatter (e.g. subscribers count).
 */
export async function runSuite(
  title: string,
  bench: Bench,
  meta?: (taskName: string) => string,
): Promise<void> {
  printBanner(title);
  await bench.run();

  const rows = bench.tasks
    .filter((t) => t.result)
    .map((t) => {
      // Tinybench 6 puts `mean/p50/p99/samplesCount/rme` on `latency` and
      // `throughput` alike; both are `Statistics`. We don't rely on
      // `.samples` (undefined unless `retainSamples: true`).
      const r = t.result as unknown as {
        latency: { mean: number; p50: number; p99: number };
        throughput: { mean: number; rme: number; samplesCount: number };
      };
      return {
        name: t.name,
        opsPerSec: fmtOps(r.throughput.mean),
        meanNs: fmtNs(r.latency.mean * 1e6),
        p50Ns: fmtNs(r.latency.p50 * 1e6),
        p99Ns: fmtNs(r.latency.p99 * 1e6),
        rme: `±${r.throughput.rme.toFixed(2)}%`,
        samples: r.throughput.samplesCount.toString(),
        meta: meta ? meta(t.name) : '',
      };
    });

  const cols: Array<[string, keyof (typeof rows)[number]]> = [
    ['case', 'name'],
    ['ops/sec', 'opsPerSec'],
    ['mean', 'meanNs'],
    ['p50', 'p50Ns'],
    ['p99', 'p99Ns'],
    ['rme', 'rme'],
    ['runs', 'samples'],
    ['note', 'meta'],
  ];

  const widths = cols.map(([label, key]) =>
    Math.max(label.length, ...rows.map((r) => String(r[key]).length)),
  );

  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');

  console.log(line(cols.map(([label]) => label)));
  console.log(line(widths.map((w) => '─'.repeat(w))));
  rows.forEach((r) => console.log(line(cols.map(([, key]) => String(r[key])))));
  console.log('');
}

function printBanner(title: string) {
  const bar = '═'.repeat(72);
  console.log(`\n${bar}\n  ${title}\n${bar}\n`);
}

// ────────────────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────────────────

/** ops/sec → "12,345,678" or "1.23M" for wider readability. */
export function fmtOps(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}

/** ns → readable unit (ns / µs / ms). */
export function fmtNs(ns: number): string {
  if (!Number.isFinite(ns)) return '—';
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)}ms`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)}µs`;
  return `${ns.toFixed(0)}ns`;
}

/** bytes → human-readable string. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MiB`;
  if (abs >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n.toFixed(0)} B`;
}

// ────────────────────────────────────────────────────────────────────
// Latency sampling helper (for percentiles on custom flows)
// ────────────────────────────────────────────────────────────────────

/**
 * Run `fn` `iterations` times, sample latency of each call in ns.
 * Returns sorted samples — feed into `percentile()`.
 */
export async function sampleLatencies(
  fn: () => void | Promise<void>,
  iterations: number,
): Promise<number[]> {
  // Warmup
  for (let i = 0; i < Math.min(1000, iterations / 10); i++) {
    await fn();
  }
  const samples = new Array<number>(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples[i] = (performance.now() - start) * 1e6; // ms → ns
  }
  samples.sort((a, b) => a - b);
  return samples;
}

export function percentile(sortedSamples: number[], p: number): number {
  if (sortedSamples.length === 0) return NaN;
  const idx = Math.min(
    sortedSamples.length - 1,
    Math.floor((p / 100) * sortedSamples.length),
  );
  return sortedSamples[idx]!;
}

// ────────────────────────────────────────────────────────────────────
// Broker/isolation helpers — safe fresh instances for every bench
// ────────────────────────────────────────────────────────────────────

import { destroyBroker, initBroker } from '../src/facade';
import type { BrokerConfig } from '../src/core/types';
import type { BrokerLogger } from '../src/core/logger/BrokerLogger.types';

/**
 * Silent logger — suppress benign warnings that would otherwise flood stdout
 * for benches that intentionally re-create clients or exercise other paths
 * that produce `logger.warn` in normal operation.
 *
 * NEVER swallow errors silently in real code — only OK for bench harness
 * where we know the "warning" is expected iteration noise.
 */
export const SILENT_LOGGER: BrokerLogger = {
  warn: () => {},
  error: () => {},
};

/**
 * Create a fresh broker instance for a test, returning a `dispose` fn to be
 * called in the outer bench cleanup. Broker is a module-singleton in the
 * facade, so destroy-before-init keeps back-to-back benches isolated.
 */
export function withFreshBroker<T extends string, P extends Record<T, any>>(
  config?: BrokerConfig,
) {
  destroyBroker();
  return initBroker<T, P>(config);
}

export function disposeBroker() {
  destroyBroker();
}
