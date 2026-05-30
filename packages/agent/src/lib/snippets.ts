import path from "node:path";
import { promises as fsp } from "node:fs";
import crypto from "node:crypto";
import { configDir } from "./config";

export interface Snippet {
  id: string;
  label: string;
  command: string;
  cwd?: string;             // relative to project root, default "."
  description?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  usageCount: number;
}

export interface SnippetsFile {
  version: 1;
  snippets: Snippet[];
}

const FILE = () => path.join(configDir(), "snippets.json");

export class SnippetError extends Error {
  constructor(message: string, public code: "not_found" | "duplicate_label" | "invalid_input") {
    super(message);
  }
}

async function readFile(): Promise<SnippetsFile> {
  try {
    const raw = await fsp.readFile(FILE(), "utf8");
    const parsed = JSON.parse(raw) as SnippetsFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.snippets)) {
      return { version: 1, snippets: [] };
    }
    return parsed;
  } catch {
    return { version: 1, snippets: [] };
  }
}

async function writeFile(data: SnippetsFile): Promise<void> {
  await fsp.writeFile(FILE(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function listSnippets(): Promise<Snippet[]> {
  const f = await readFile();
  // Sort by lastUsedAt desc, fall back to updatedAt desc.
  return [...f.snippets].sort((a, b) => {
    const aKey = a.lastUsedAt ?? a.updatedAt;
    const bKey = b.lastUsedAt ?? b.updatedAt;
    return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
  });
}

export async function createSnippet(input: {
  label: string;
  command: string;
  cwd?: string;
  description?: string;
  tags?: string[];
}): Promise<Snippet> {
  const label = (input.label || "").trim();
  const command = (input.command || "").trim();
  if (!label || !command) {
    throw new SnippetError("label and command are required", "invalid_input");
  }
  if (label.length > 80 || command.length > 4000) {
    throw new SnippetError("label or command too long", "invalid_input");
  }
  const f = await readFile();
  if (f.snippets.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
    throw new SnippetError(`a snippet with label "${label}" already exists`, "duplicate_label");
  }
  const now = new Date().toISOString();
  const snippet: Snippet = {
    id: crypto.randomUUID(),
    label,
    command,
    cwd: input.cwd?.trim() || ".",
    description: input.description?.trim() || undefined,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : undefined,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    usageCount: 0,
  };
  f.snippets.push(snippet);
  await writeFile(f);
  return snippet;
}

export async function updateSnippet(id: string, patch: Partial<Pick<Snippet, "label" | "command" | "cwd" | "description" | "tags">>): Promise<Snippet> {
  const f = await readFile();
  const idx = f.snippets.findIndex((s) => s.id === id);
  if (idx === -1) throw new SnippetError("snippet not found", "not_found");
  const current = f.snippets[idx]!;
  const next: Snippet = {
    ...current,
    label: patch.label?.trim() || current.label,
    command: patch.command?.trim() || current.command,
    cwd: patch.cwd?.trim() || current.cwd,
    description: patch.description?.trim() ?? current.description,
    tags: Array.isArray(patch.tags) ? patch.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : current.tags,
    updatedAt: new Date().toISOString(),
  };
  if ((patch.label?.trim() ?? next.label).length > 80) {
    throw new SnippetError("label too long", "invalid_input");
  }
  if ((patch.command?.trim() ?? next.command).length > 4000) {
    throw new SnippetError("command too long", "invalid_input");
  }
  // Check label uniqueness across other snippets.
  if (f.snippets.some((s) => s.id !== id && s.label.toLowerCase() === next.label.toLowerCase())) {
    throw new SnippetError(`a snippet with label "${next.label}" already exists`, "duplicate_label");
  }
  f.snippets[idx] = next;
  await writeFile(f);
  return next;
}

export async function deleteSnippet(id: string): Promise<void> {
  const f = await readFile();
  const before = f.snippets.length;
  f.snippets = f.snippets.filter((s) => s.id !== id);
  if (f.snippets.length === before) throw new SnippetError("snippet not found", "not_found");
  await writeFile(f);
}

export async function recordUsage(id: string): Promise<void> {
  const f = await readFile();
  const idx = f.snippets.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const cur = f.snippets[idx]!;
  f.snippets[idx] = {
    ...cur,
    lastUsedAt: new Date().toISOString(),
    usageCount: cur.usageCount + 1,
  };
  await writeFile(f);
}

export async function exportSnippets(): Promise<SnippetsFile> {
  return await readFile();
}

export async function importSnippets(data: unknown, mode: "merge" | "replace" = "merge"): Promise<{ imported: number; skipped: number }> {
  if (!data || typeof data !== "object" || (data as any).version !== 1 || !Array.isArray((data as any).snippets)) {
    throw new SnippetError("invalid snippets file", "invalid_input");
  }
  const incoming = (data as SnippetsFile).snippets;
  const f = mode === "replace" ? { version: 1 as const, snippets: [] as Snippet[] } : await readFile();
  let imported = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const raw of incoming) {
    if (!raw || typeof raw.label !== "string" || typeof raw.command !== "string") {
      skipped += 1;
      continue;
    }
    const label = raw.label.trim();
    const command = raw.command.trim();
    if (!label || !command) { skipped += 1; continue; }
    if (f.snippets.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      skipped += 1;
      continue;
    }
    f.snippets.push({
      id: crypto.randomUUID(),
      label,
      command,
      cwd: typeof raw.cwd === "string" ? raw.cwd : ".",
      description: typeof raw.description === "string" ? raw.description : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.map((t: unknown) => String(t)).slice(0, 8) : undefined,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
      updatedAt: now,
      lastUsedAt: null,
      usageCount: 0,
    });
    imported += 1;
  }
  await writeFile(f);
  return { imported, skipped };
}
