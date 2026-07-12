import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface AgentPreflightResult {
  ok: boolean;
  warnings: string[];
  hints: string[];
  /** Absolute path to the resolved launcher on PATH, when found. */
  resolvedPath: string | null;
}

/**
 * Best-effort macOS prep before launching coding-agent CLIs.
 * Codex/Claude native binaries are often false-positive quarantined by Gatekeeper,
 * which then deletes or blocks them and surfaces as spawn ENOENT.
 */
export function prepareAgentLaunch(command: string): AgentPreflightResult {
  const warnings: string[] = [];
  const hints: string[] = [];
  const binName = firstToken(command);
  const resolvedPath = binName ? whichAbsolute(binName) : null;

  if (!binName) {
    return { ok: false, warnings: ["empty command"], hints: [], resolvedPath: null };
  }

  if (!resolvedPath) {
    return {
      ok: false,
      warnings: [`\`${binName}\` not found on PATH`],
      hints: [
        `Install the CLI, then retry. Example: npm install -g @openai/codex`,
        `Or use a Custom command with the full path to the binary.`,
      ],
      resolvedPath: null,
    };
  }

  if (process.platform === "darwin") {
    const cleared = clearQuarantineAround(resolvedPath);
    if (cleared.length) {
      warnings.push(`Cleared macOS quarantine on ${cleared.length} path(s) near ${binName}.`);
    }

    const missing = findMissingCodexNativeBinary(resolvedPath);
    if (missing) {
      return {
        ok: false,
        warnings: [
          `Codex native binary missing: ${missing}`,
          `macOS often removes this after a false-positive malware warning.`,
        ],
        hints: [
          `Reinstall: npm install -g @openai/codex@latest`,
          `Then clear quarantine: xattr -cr "$(npm root -g)/@openai/codex"`,
          `If macOS still blocks it: System Settings → Privacy & Security → Allow anyway`,
        ],
        resolvedPath,
      };
    }
  }

  return { ok: true, warnings, hints, resolvedPath };
}

export function formatPreflightMessage(result: AgentPreflightResult): string {
  const lines: string[] = [];
  if (result.warnings.length) {
    lines.push("⚠ Agent preflight:");
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  if (result.hints.length) {
    lines.push("Fix:");
    for (const h of result.hints) lines.push(`  • ${h}`);
  }
  return lines.length ? lines.join("\n") + "\n\n" : "";
}

/** Detect Codex ENOENT / Gatekeeper failures in live agent output. */
export function detectAgentLaunchFailure(text: string): string | null {
  if (!text) return null;
  const sample = text.length > 4000 ? text.slice(text.length - 4000) : text;
  const isEnoent = /ENOENT/i.test(sample) && /spawn/i.test(sample);
  const looksCodex = /codex/i.test(sample);
  const looksMalware = /malware|quarantine|cannot be opened|not trusted|killed/i.test(sample);

  if (!isEnoent && !looksMalware) return null;
  if (!looksCodex && !looksMalware) return null;

  return [
    "",
    "─── Lawang hint ─────────────────────────────────────────",
    "This usually means macOS Gatekeeper blocked/removed the Codex native binary",
    "(false-positive malware warning), so the file is missing (ENOENT).",
    "",
    "Try on the host:",
    "  npm install -g @openai/codex@latest",
    "  xattr -cr \"$(npm root -g)/@openai/codex\"",
    "Then reopen Codex from Agents → Start.",
    "If macOS shows a block again: System Settings → Privacy & Security → Allow.",
    "────────────────────────────────────────────────────────",
    "",
  ].join("\n");
}

function firstToken(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  // Skip simple env assignments: FOO=bar codex
  const parts = trimmed.split(/\s+/);
  let i = 0;
  while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i]!)) i += 1;
  return parts[i] || null;
}

function whichAbsolute(bin: string): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where.exe", [bin], { encoding: "utf8" }).trim();
      return out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null;
    }
    const out = execFileSync("/usr/bin/env", ["sh", "-c", `command -v ${shellQuote(bin)}`], {
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function clearQuarantineAround(resolvedPath: string): string[] {
  const cleared: string[] = [];
  const targets = collectQuarantineTargets(resolvedPath);
  for (const target of targets) {
    try {
      execFileSync("xattr", ["-cr", target], { stdio: "ignore" });
      cleared.push(target);
    } catch {
      /* ignore — may lack permission or xattr unavailable */
    }
  }
  return cleared;
}

function collectQuarantineTargets(resolvedPath: string): string[] {
  const targets = new Set<string>([resolvedPath]);
  // Follow symlinks (npm global bins are usually links into lib/node_modules).
  try {
    const real = fs.realpathSync(resolvedPath);
    targets.add(real);
    // Package root: .../node_modules/@openai/codex or .../node_modules/claude
    const pkgRoot = findPackageRoot(real);
    if (pkgRoot) {
      targets.add(pkgRoot);
      // Platform package often lives under node_modules/@openai/codex-darwin-arm64
      const nm = path.join(pkgRoot, "node_modules");
      if (fs.existsSync(nm)) {
        for (const name of fs.readdirSync(nm)) {
          if (/codex|claude|openai|anthropic/i.test(name)) {
            targets.add(path.join(nm, name));
          }
          const scoped = path.join(nm, name);
          if (name.startsWith("@") && fs.existsSync(scoped)) {
            for (const child of fs.readdirSync(scoped)) {
              if (/codex|claude|darwin|linux|win32/i.test(child)) {
                targets.add(path.join(scoped, child));
              }
            }
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return [...targets];
}

function findPackageRoot(filePath: string): string | null {
  let cur = path.dirname(filePath);
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(cur, "package.json");
    if (fs.existsSync(pkg)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function findMissingCodexNativeBinary(resolvedPath: string): string | null {
  try {
    const real = fs.realpathSync(resolvedPath);
    const pkgRoot = findPackageRoot(real);
    if (!pkgRoot) return null;
    const pkgJson = path.join(pkgRoot, "package.json");
    const name = JSON.parse(fs.readFileSync(pkgJson, "utf8")).name as string | undefined;
    if (!name || !/codex/i.test(name)) return null;

    const platformPkg =
      process.arch === "arm64"
        ? path.join(pkgRoot, "node_modules", "@openai", "codex-darwin-arm64")
        : path.join(pkgRoot, "node_modules", "@openai", "codex-darwin-x64");
    if (!fs.existsSync(platformPkg)) return null;

    const triple = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    const candidates = [
      path.join(platformPkg, "vendor", triple, "bin", "codex"),
      path.join(platformPkg, "vendor", triple, "codex", "codex"),
    ];
    if (candidates.some((c) => fs.existsSync(c))) return null;
    return candidates[0]!;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
