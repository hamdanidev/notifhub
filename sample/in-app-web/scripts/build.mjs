#!/usr/bin/env node
/**
 * Production build wrapper.
 *
 * Sets NODE_ENV before Vite starts so @vitejs/plugin-react emits the production JSX runtime.
 * Running `vite build` with NODE_ENV unset makes the plugin choose jsxDEV, which is larger and
 * embeds absolute source paths in the bundle.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env, NODE_ENV: 'production' };

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), ['--noEmit']);
run(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ['build']);
