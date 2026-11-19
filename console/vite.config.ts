import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Two console targets from one codebase:
 * - default (mode `production`/`development`) → tenant console, `index.html`, `dist/tenant`
 * - `--mode platform` → platform console, `platform.html`, `dist/platform`
 *
 * Keeping separate outputs guarantees that the tenant artifact never contains platform pages,
 * which is what allows deploying the platform console to its own origin.
 */
export default defineConfig(({ mode }) => {
  const target = mode === 'platform' ? 'platform' : 'tenant';

  return {
    plugins: [react()],
    server: {
      port: target === 'platform' ? 5174 : 5173,
      strictPort: true,
    },
    preview: {
      port: target === 'platform' ? 4174 : 4173,
      strictPort: true,
    },
    build: {
      outDir: `dist/${target}`,
      emptyOutDir: true,
      rollupOptions: {
        input: target === 'platform' ? 'platform.html' : 'index.html',
      },
    },
  };
});
