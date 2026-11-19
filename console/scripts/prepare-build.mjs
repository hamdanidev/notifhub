import fs from 'node:fs';
import path from 'node:path';

/** Removes the whole console/dist so stale artifacts from the previous layout never leak. */
const dist = path.resolve('dist');
fs.rmSync(dist, { recursive: true, force: true });
console.log('console: cleaned dist/');
