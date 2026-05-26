#!/usr/bin/env node
// Lawang — placeholder CLI.
// Versi penuh sedang disiapkan. Untuk sementara hanya menampilkan info.

const pkg = require("../package.json");

const lines = [
  "",
  "  Lawang \u00b7 placeholder",
  "  ---------------------------------------------",
  "  Local-first remote terminal with QR pairing.",
  "  Versi penuh sedang dipersiapkan.",
  "",
  "  Status   : reserved (" + pkg.version + ")",
  "  Engine   : node " + pkg.engines.node,
  "  License  : " + pkg.license,
  "",
  "  Coming soon:",
  "    - lawang start            # nyalakan agent + QR",
  "    - lawang rotate           # token baru tanpa restart",
  "    - lawang devices          # kelola trusted device",
  "    - lawang history          # baca audit log",
  "    - lawang verify           # smoke test keamanan",
  "",
  "  Update with: npm i -g lawang@latest",
  "",
];

process.stdout.write(lines.join("\n") + "\n");
process.exit(0);
