#!/usr/bin/env node

/**
 * check-i18n-keys.mjs
 *
 * Fails when frontend code calls a translation key that is missing from
 * frontend/messages/en.json (a missing key renders as MISSING_MESSAGE).
 *
 * Each `t("key")` is resolved against the namespace of the nearest preceding
 * `const t = useTranslations("Namespace")` (or getTranslations) in the file,
 * because one file often holds several components with their own `t`.
 * Dynamic keys (template strings, variables) are not checked.
 *
 * Usage:
 *   node scripts/check-i18n-keys.mjs
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "frontend/src");
const messages = JSON.parse(readFileSync(join(root, "frontend/messages/en.json"), "utf-8"));

const DECLARATION =
  /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?["']([\w.]+)["']/g;

function hasKey(path) {
  let node = messages;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) return false;
    node = node[part];
  }
  return true;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const missing = [];

for (const file of walk(srcDir)) {
  const source = readFileSync(file, "utf-8");
  const declarations = [...source.matchAll(DECLARATION)].map((m) => ({
    index: m.index,
    name: m[1],
    namespace: m[2],
  }));

  for (const name of new Set(declarations.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.raw|\\.markup)?\\(\\s*["']([\\w.]+)["']`, "g");
    for (const match of source.matchAll(call)) {
      const scope = declarations.filter((d) => d.name === name && d.index < match.index).at(-1);
      if (!scope) continue;
      const key = `${scope.namespace}.${match[1]}`;
      if (!hasKey(key)) missing.push(`${relative(root, file)}: ${key}`);
    }
  }
}

if (missing.length > 0) {
  console.error("✖ Translation keys used in code but missing from frontend/messages/en.json:");
  for (const line of [...new Set(missing)].sort()) console.error(`  ${line}`);
  process.exit(1);
}

console.log("✔ Every static translation key used in code exists in en.json.");
