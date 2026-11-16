import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@notifhub/js'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
