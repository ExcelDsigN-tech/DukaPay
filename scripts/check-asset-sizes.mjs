#!/usr/bin/env node

/**
 * check-asset-sizes.mjs
 *
 * Fails when any file in frontend/public is larger than MAX_KB. Large raw
 * images slow every page load; compress them or convert to WebP/AVIF.
 * Social preview images (og-image) must stay PNG/JPEG but still fit the limit.
 *
 * Usage:
 *   node scripts/check-asset-sizes.mjs
 */

import { readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const MAX_KB = 300;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const publicDir = join(root, "frontend/public");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const oversized = walk(publicDir)
  .map((path) => ({ path, kb: statSync(path).size / 1024 }))
  .filter(({ kb }) => kb > MAX_KB);

if (oversized.length > 0) {
  console.error(`✖ Files in frontend/public over ${MAX_KB} KB (compress or convert to WebP/AVIF):`);
  for (const { path, kb } of oversized) {
    console.error(`  ${relative(root, path)}  ${kb.toFixed(0)} KB`);
  }
  process.exit(1);
}

console.log(`✔ All frontend/public files are under ${MAX_KB} KB.`);
