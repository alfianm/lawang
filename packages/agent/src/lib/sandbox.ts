import path from "node:path";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { Readable } from "node:stream";

export class SandboxError extends Error {
  constructor(message: string, public code: "outside_root" | "not_found" | "not_a_file" | "not_a_dir" | "too_large" | "binary" | "target_exists") {
    super(message);
  }
}

// Resolve a user-supplied relative path against the sandbox root.
// Throws SandboxError("outside_root") on traversal attempts.
export function resolveInside(root: string, relative: string): string {
  const rootAbs = path.resolve(root);
  const candidate = path.resolve(rootAbs, relative.replace(/^\/+/, ""));
  const rel = path.relative(rootAbs, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new SandboxError(`Path '${relative}' is outside the sandbox root`, "outside_root");
  }
  return candidate;
}

export interface DirEntry {
  name: string;
  path: string;        // path relative to root
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  modifiedAt: string;  // ISO
}

export async function listDir(root: string, relative: string): Promise<{ path: string; entries: DirEntry[] }> {
  const abs = resolveInside(root, relative || ".");
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw new SandboxError("Path not found", "not_found");
  }
  if (!stat.isDirectory()) throw new SandboxError("Not a directory", "not_a_dir");

  const dirents = await fsp.readdir(abs, { withFileTypes: true });
  const rootAbs = path.resolve(root);
  const entries: DirEntry[] = [];
  for (const d of dirents) {
    const child = path.join(abs, d.name);
    let kind: DirEntry["type"] = "other";
    if (d.isDirectory()) kind = "dir";
    else if (d.isFile()) kind = "file";
    else if (d.isSymbolicLink()) kind = "symlink";

    let size = 0;
    let modifiedAt = new Date(0).toISOString();
    try {
      const s = await fsp.stat(child);
      // For symlinks, fall back if target is missing
      size = s.size;
      modifiedAt = s.mtime.toISOString();
      if (kind === "symlink") {
        if (s.isDirectory()) kind = "dir";
        else if (s.isFile()) kind = "file";
      }
    } catch {
      // dangling symlink etc; keep defaults
    }
    entries.push({
      name: d.name,
      path: path.relative(rootAbs, child).split(path.sep).join("/"),
      type: kind,
      size,
      modifiedAt,
    });
  }
  // Sort: dirs first, then alphabetic
  entries.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (a.type === "dir") return -1;
    if (b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });
  const relOut = path.relative(rootAbs, abs).split(path.sep).join("/") || ".";
  return { path: relOut, entries };
}

export interface FileRead {
  path: string;
  size: number;
  modifiedAt: string;
  encoding: "utf8" | "base64";
  content: string;
  truncated: boolean;
  isBinary: boolean;
  mime: string;
}

const TEXT_LIMIT = 1_000_000; // 1 MB cap for inline preview

export async function readFile(root: string, relative: string): Promise<FileRead> {
  const abs = resolveInside(root, relative);
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw new SandboxError("File not found", "not_found");
  }
  if (!stat.isFile()) throw new SandboxError("Not a file", "not_a_file");
  if (stat.size > TEXT_LIMIT) throw new SandboxError("File too large to preview", "too_large");

  const buf = await fsp.readFile(abs);
  const isBinary = looksBinary(buf);
  const rootAbs = path.resolve(root);
  const relOut = path.relative(rootAbs, abs).split(path.sep).join("/");
  return {
    path: relOut,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    encoding: isBinary ? "base64" : "utf8",
    content: isBinary ? buf.toString("base64") : buf.toString("utf8"),
    truncated: false,
    isBinary,
    mime: guessMime(abs, isBinary),
  };
}

export function statForDownload(root: string, relative: string): { absolute: string; name: string; size: number } {
  const abs = resolveInside(root, relative);
  const s = fs.statSync(abs);
  if (!s.isFile()) throw new SandboxError("Not a file", "not_a_file");
  return { absolute: abs, name: path.basename(abs), size: s.size };
}

function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  let suspicious = 0;
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) suspicious++;
  }
  return suspicious / Math.max(len, 1) > 0.3;
}

function guessMime(p: string, binary: boolean): string {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain", ".md": "text/markdown",
    ".json": "application/json", ".yaml": "text/yaml", ".yml": "text/yaml",
    ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript",
    ".ts": "text/typescript", ".tsx": "text/typescript",
    ".jsx": "text/javascript",
    ".html": "text/html", ".css": "text/css",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  return map[ext] || (binary ? "application/octet-stream" : "text/plain");
}

// ---- Write operations (V0.2) ----


export async function writeFile(root: string, relative: string, content: string, encoding: "utf8" | "base64" = "utf8"): Promise<{ path: string; size: number; modifiedAt: string }> {
  const abs = resolveInside(root, relative);
  // Ensure parent directory exists and is inside the root.
  const parent = path.dirname(abs);
  await fsp.mkdir(parent, { recursive: true });
  const buf = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
  await fsp.writeFile(abs, buf);
  const stat = await fsp.stat(abs);
  const rootAbs = path.resolve(root);
  return {
    path: path.relative(rootAbs, abs).split(path.sep).join("/"),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function streamWriteFile(root: string, relative: string, source: Readable): Promise<{ path: string; size: number; modifiedAt: string }> {
  const abs = resolveInside(root, relative);
  const parent = path.dirname(abs);
  await fsp.mkdir(parent, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(abs);
    source.on("error", reject);
    out.on("error", reject);
    out.on("close", () => resolve());
    source.pipe(out);
  });
  const stat = await fsp.stat(abs);
  const rootAbs = path.resolve(root);
  return {
    path: path.relative(rootAbs, abs).split(path.sep).join("/"),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function removeEntry(root: string, relative: string): Promise<void> {
  const abs = resolveInside(root, relative);
  const rootAbs = path.resolve(root);
  if (abs === rootAbs) {
    throw new SandboxError("Cannot delete the project root", "outside_root");

  }
  let stat;
  try {
    stat = await fsp.lstat(abs);
  } catch {
    throw new SandboxError("Path not found", "not_found");
  }
  if (stat.isDirectory()) {
    await fsp.rm(abs, { recursive: true, force: true });
  } else {
    await fsp.unlink(abs);
  }
}

export async function renameEntry(root: string, fromRel: string, toRel: string): Promise<{ from: string; to: string }> {
  const fromAbs = resolveInside(root, fromRel);
  const toAbs = resolveInside(root, toRel);
  try {
    await fsp.access(fromAbs);
  } catch {
    throw new SandboxError("Source not found", "not_found");
  }
  // Don't allow overwriting an existing target silently.
  let exists = false;
  try { await fsp.access(toAbs); exists = true; } catch {}
  if (exists) {
    throw new SandboxError("Target already exists", "target_exists");
  }
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  await fsp.rename(fromAbs, toAbs);
  const rootAbs = path.resolve(root);
  return {
    from: path.relative(rootAbs, fromAbs).split(path.sep).join("/"),
    to: path.relative(rootAbs, toAbs).split(path.sep).join("/"),
  };
}

export async function makeDir(root: string, relative: string): Promise<{ path: string }> {
  const abs = resolveInside(root, relative);
  await fsp.mkdir(abs, { recursive: true });
  const rootAbs = path.resolve(root);
  return { path: path.relative(rootAbs, abs).split(path.sep).join("/") };
}
