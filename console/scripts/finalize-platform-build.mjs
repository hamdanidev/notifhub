import fs from 'node:fs';
import path from 'node:path';

/**
 * Vite emits the platform entry as `platform.html` (its input file name). Static hosts expect
 * `index.html` for the root document, so rename it after the platform build.
 */
const platformDir = path.resolve('dist', 'platform');
const source = path.join(platformDir, 'platform.html');
const target = path.join(platformDir, 'index.html');

if (fs.existsSync(source)) {
  fs.renameSync(source, target);
  console.log('console: platform build finalized as dist/platform/index.html');
} else if (!fs.existsSync(target)) {
  throw new Error('platform build output not found (expected dist/platform/platform.html)');
}
