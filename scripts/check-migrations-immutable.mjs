#!/usr/bin/env node

/**
 * check-migrations-immutable.mjs
 *
 * Fails when a change modifies, renames or deletes a migration that already
 * exists on the base branch. A migration that has run cannot be edited:
 * databases that applied the old version would silently differ from new ones.
 * Add a new migration instead.
 *
 * Usage:
 *   node scripts/check-migrations-immutable.mjs [base-ref]
 *
 * base-ref defaults to origin/main. Needs that ref fetched (CI checks out
 * with fetch-depth: 0).
 */

import { execFileSync } from "child_process";

const base = process.argv[2] ?? "origin/main";
// Same glob the runner uses (backend/package.json migrate:up), so docs like
// AGENTS.md in the folder are not treated as migrations.
const MIGRATIONS_GLOB = "backend/migrations/*.cjs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

const mergeBase = git("merge-base", base, "HEAD");

// --name-status lists A (added), M (modified), D (deleted), R (renamed), ...
const changes = git("diff", "--name-status", "--find-renames", mergeBase, "HEAD", "--", MIGRATIONS_GLOB)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));

const violations = changes.filter(([status]) => !status.startsWith("A"));

if (violations.length > 0) {
  console.error("✖ Existing migrations must not be changed. Add a new migration instead:");
  for (const [status, ...paths] of violations) {
    console.error(`  ${status}\t${paths.join(" -> ")}`);
  }
  process.exit(1);
}

console.log(`✔ No existing migrations changed (${changes.length} new).`);
