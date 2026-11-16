#!/usr/bin/env node
/**
 * Exports the public consumer subset of the NotifHub OpenAPI document.
 *
 * The backend's /api/docs-json also documents admin, webhook, in-app and health endpoints.
 * The Go SDK only covers the endpoints a consumer service needs, so this script keeps the
 * public paths, resolves their transitive $refs and writes a standalone spec.
 *
 * Usage:
 *   node scripts/export-openapi.mjs [baseUrl]
 *   NOTIFHUB_API_URL=http://localhost:3000 node scripts/export-openapi.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_PATHS = [
  '/api/v1/notify',
  '/api/v1/subscribers/{externalId}',
  '/api/v1/topics/{key}/members',
];

const baseUrl = (process.argv[2] ?? process.env.NOTIFHUB_API_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, '..', 'openapi', 'notifhub.json');

async function fetchDocs() {
  let response;

  try {
    response = await fetch(`${baseUrl}/api/docs-json`);
  } catch (error) {
    throw new Error(
      `cannot reach ${baseUrl}/api/docs-json (${error instanceof Error ? error.message : 'unknown error'}); start the backend first`,
    );
  }

  if (!response.ok) {
    throw new Error(`GET ${baseUrl}/api/docs-json returned ${response.status}`);
  }

  return response.json();
}

function collectRefs(node, refs) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return;
  }

  if (node === null || typeof node !== 'object') return;

  if (typeof node.$ref === 'string') refs.add(node.$ref);

  for (const value of Object.values(node)) collectRefs(value, refs);
}

function componentKey(ref) {
  const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref);
  return match === null ? null : { type: match[1], name: match[2] };
}

const docs = await fetchDocs();

if (docs.openapi === undefined || docs.paths === undefined) {
  throw new Error('unexpected OpenAPI document: missing openapi/paths');
}

const missing = PUBLIC_PATHS.filter((path) => docs.paths[path] === undefined);

if (missing.length > 0) {
  throw new Error(`public paths missing from the OpenAPI document: ${missing.join(', ')}`);
}

const paths = {};
const securitySchemes = new Set();
const components = { schemas: {}, parameters: {}, responses: {}, requestBodies: {} };

for (const path of PUBLIC_PATHS) {
  paths[path] = structuredClone(docs.paths[path]);

  for (const operation of Object.values(paths[path])) {
    if (operation?.security === undefined) continue;

    for (const requirement of operation.security) {
      for (const scheme of Object.keys(requirement)) securitySchemes.add(scheme);
    }
  }
}

const initialRefs = new Set();
for (const path of Object.values(paths)) collectRefs(path, initialRefs);
const pending = [...initialRefs];

const seen = new Set();

while (pending.length > 0) {
  const ref = pending.pop();

  if (seen.has(ref)) continue;
  seen.add(ref);

  const key = componentKey(ref);

  if (key === null) continue;

  const source = docs.components?.[key.type]?.[key.name];

  if (source === undefined) {
    throw new Error(`unresolvable OpenAPI reference: ${ref}`);
  }

  const bucket = components[key.type] ?? (components[key.type] = {});
  bucket[key.name] = structuredClone(source);

  const refs = new Set();
  collectRefs(source, refs);
  for (const nested of refs) pending.push(nested);
}

const result = {
  openapi: docs.openapi,
  info: {
    title: 'NotifHub Public API',
    description:
      'Consumer API for NotifHub: ingest notifications, sync subscribers and manage topic membership.',
    version: '0.8.0',
  },
  paths,
  components: {
    schemas: components.schemas,
    securitySchemes: Object.fromEntries(
      [...securitySchemes].map((name) => [name, structuredClone(docs.components.securitySchemes[name])]),
    ),
    ...(Object.keys(components.parameters).length > 0
      ? { parameters: components.parameters }
      : {}),
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

console.log(
  `wrote ${outputPath} (${Object.keys(paths).length} paths, ${Object.keys(components.schemas).length} schemas)`,
);
