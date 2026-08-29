#!/usr/bin/env node
/**
 * Single-bench runner. Match by prefix — `04` / `04-fanout` / full name.
 */

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// tsx lives in the monorepo root's node_modules, not the broker's own.
const TSX = join(HERE, '..', '..', '..', 'node_modules', '.bin', 'tsx');

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('usage: run-one.mjs <name-prefix>');
    process.exit(2);
  }

  const files = await readdir(HERE);
  const matches = files
    .filter((f) => f.endsWith('.bench.ts'))
    .filter((f) => f.startsWith(query) || f.includes(query));

  if (matches.length === 0) {
    console.error(`No bench file matched "${query}".`);
    process.exit(2);
  }
  if (matches.length > 1) {
    console.error(`Ambiguous match for "${query}":\n  ${matches.join('\n  ')}`);
    process.exit(2);
  }

  const [file] = matches;
  await new Promise((resolve, reject) => {
    const child = spawn(TSX, ['--expose-gc', join(HERE, file)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(code)));
  });
}

main().catch((code) => process.exit(typeof code === 'number' ? code : 1));
