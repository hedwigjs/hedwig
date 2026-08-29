#!/usr/bin/env node
/**
 * Sequential runner for all `benchmarks/*.bench.ts` files.
 *
 * Each bench file is a self-contained tsx process — fresh V8 heap, no
 * cross-run state, and any single failure doesn't drop the rest. The runner
 * just streams stdout/stderr through and reports a summary.
 */

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// tsx lives in the monorepo root's node_modules, not the broker's own.
const TSX = join(HERE, '..', '..', '..', 'node_modules', '.bin', 'tsx');

async function main() {
  const files = (await readdir(HERE))
    .filter((f) => f.endsWith('.bench.ts'))
    .sort();

  console.log(`\nHedwig · broker · benchmarks (${files.length} files)\n`);

  const results = [];
  for (const file of files) {
    const start = Date.now();
    const code = await runFile(file);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ file, code, elapsed });
  }

  console.log('\n──────────────── SUMMARY ────────────────');
  for (const { file, code, elapsed } of results) {
    const status = code === 0 ? 'OK ' : 'FAIL';
    console.log(`  [${status}]  ${file.padEnd(38)}  ${elapsed}s`);
  }
  console.log('');

  const failed = results.filter((r) => r.code !== 0).length;
  process.exit(failed === 0 ? 0 : 1);
}

function runFile(file) {
  return new Promise((resolve) => {
    const child = spawn(TSX, ['--expose-gc', join(HERE, file)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
