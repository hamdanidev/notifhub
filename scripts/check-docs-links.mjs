#!/usr/bin/env node
/**
 * Checks that Markdown links inside the repository resolve.
 *
 * - Relative links must point to an existing file or directory.
 * - Links with an anchor (`file.md#section`) must match a heading in the target file,
 *   using the same slug rules as GitHub (lowercase, punctuation stripped, spaces to `-`,
 *   duplicates suffixed with `-1`, `-2`, ...).
 * - External links (http/https/mailto) and links inside fenced code blocks are ignored.
 *
 * Run with `npm run docs:check`. Exits with code 1 when at least one link is broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'var',
  '.next',
  'test-results',
]);

function collectMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      collectMarkdown(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Mirrors GitHub's heading anchor generation for the text we actually use. */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
    .replace(/ /g, '-');
}

function buildAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  let fenceMarker = null;

  for (const line of text.split(/\r?\n/)) {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;

    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!heading) continue;

    const base = slugify(heading[1]);
    if (seen.has(base)) {
      const next = seen.get(base);
      seen.set(base, next + 1);
      anchors.add(`${base}-${next}`);
    } else {
      seen.set(base, 1);
      anchors.add(base);
    }
  }

  return anchors;
}

function stripFences(text) {
  let inFence = false;
  let fenceMarker = null;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const fence = /^\s*(```+|~~~+)/.exec(line);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fence[1][0];
        } else if (fence[1][0] === fenceMarker) {
          inFence = false;
          fenceMarker = null;
        }
        return '';
      }
      // Inline code is not Markdown link syntax: `foo[a](b)` must not look like a link.
      return inFence ? '' : line.replace(/`[^`]*`/g, '');
    })
    .join('\n');
}

const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
const isExternal = (target) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);

const files = collectMarkdown(root);
const anchorCache = new Map();

function anchorsFor(file) {
  if (!anchorCache.has(file)) {
    anchorCache.set(file, buildAnchors(fs.readFileSync(file, 'utf8')));
  }
  return anchorCache.get(file);
}

const errors = [];
let checkedLinks = 0;

for (const file of files) {
  const relativeFile = path.relative(root, file).split(path.sep).join('/');
  const lines = stripFences(fs.readFileSync(file, 'utf8')).split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const match of line.matchAll(linkPattern)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, '');
      if (!rawTarget || isExternal(rawTarget)) continue;

      const hashIndex = rawTarget.indexOf('#');
      const pathPart = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex);
      const anchor = hashIndex === -1 ? '' : rawTarget.slice(hashIndex + 1);
      checkedLinks += 1;

      const targetPath = pathPart
        ? path.resolve(path.dirname(file), decodeURIComponent(pathPart))
        : file;

      if (pathPart) {
        if (!fs.existsSync(targetPath)) {
          errors.push(`${relativeFile}:${index + 1}: missing target "${rawTarget}"`);
          continue;
        }
        if (!fs.statSync(targetPath).isFile()) continue;
      }

      if (!anchor || !targetPath.toLowerCase().endsWith('.md')) continue;

      const anchors = anchorsFor(targetPath);
      if (!anchors.has(anchor)) {
        errors.push(`${relativeFile}:${index + 1}: missing anchor "#${anchor}" in ${path
          .relative(root, targetPath)
          .split(path.sep)
          .join('/')}`);
      }
    }
  });
}

if (errors.length > 0) {
  console.error(`docs:check failed — ${errors.length} broken link(s):\n`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `docs:check ok — ${checkedLinks} links and anchors checked across ${files.length} Markdown files`,
);
