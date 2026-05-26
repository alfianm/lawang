#!/usr/bin/env node
// Copies the built web assets into the agent's public folder so
// `lawang start` can serve them statically.
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const src = path.join(repoRoot, "packages/web/dist");
const dest = path.join(repoRoot, "packages/agent/public");

if (!fs.existsSync(src)) {
  console.error(`[copy-web] web build not found at ${src}. Run 'npm run build:web' first.`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

function copyDir(s, d) {
  for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, entry.name);
    const dp = path.join(d, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dp, { recursive: true });
      copyDir(sp, dp);
    } else {
      fs.copyFileSync(sp, dp);
    }
  }
}
copyDir(src, dest);
console.log(`[copy-web] copied ${src} -> ${dest}`);
