import { defineConfig } from 'tsup';

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
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
