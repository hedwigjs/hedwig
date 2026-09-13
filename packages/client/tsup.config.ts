import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
// The runtime this SDK is released with. Before 1.0 the two move in
// lockstep, so the oldest runtime the SDK accepts is the one from the same
// release — baked here, nothing to remember at release time.
const runtimePkg = JSON.parse(readFileSync(new URL('../broker/package.json', import.meta.url), 'utf8')) as {
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
  // Baked into `src/version.ts`: the SDK reports its own version in
  // `ClientMeta` without importing package.json from outside `rootDir`.
  define: {
    __HEDWIG_SDK_VERSION__: JSON.stringify(pkg.version),
    __HEDWIG_MIN_RUNTIME__: JSON.stringify(runtimePkg.version),
  },
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
