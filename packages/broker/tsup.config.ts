import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    tsconfig: './tsconfig.build.json',
  },
  splitting: false,
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: 'es2022',
  // Baked into `src/core/version.ts` so the runtime knows its own version
  // without importing package.json from outside `rootDir`.
  define: {
    __HEDWIG_VERSION__: JSON.stringify(pkg.version),
  },
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
