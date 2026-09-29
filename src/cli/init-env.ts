#!/usr/bin/env node
/**
 * Copy .env.example → .env so MigraLens can be configured locally.
 * Usage: npm run init-env [-- --force]
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const examplePath = resolve(root, ".env.example");
const envPath = resolve(root, ".env");
const force = process.argv.includes("--force");
const existed = existsSync(envPath);

if (!existsSync(examplePath)) {
  console.error("Missing .env.example — cannot create .env.");
  process.exit(1);
}

if (existed && !force) {
  console.log(".env already exists. Re-run with --force to overwrite from .env.example.");
  process.exit(0);
}

copyFileSync(examplePath, envPath);
console.log(`${existed ? "Recreated" : "Created"} .env from .env.example.`);
console.log("Edit .env and set TARGET_URL (and stage credentials if using content compare).");
