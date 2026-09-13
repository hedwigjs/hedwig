import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: { tsconfig: './tsconfig.build.json' },
  splitting: false,
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: 'es2022',
  external: ['react', '@hedwigjs/client'],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
