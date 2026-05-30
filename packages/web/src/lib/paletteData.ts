import { listSnippets } from "./api";
import type { Snippet } from "./api";

// Cache to avoid hammering /api/snippets when palette opened repeatedly.
let cache: { at: number; data: Snippet[] } | null = null;
const TTL_MS = 30_000;

export async function fetchSnippets(token: string): Promise<Snippet[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const r = await listSnippets(token);
    cache = { at: Date.now(), data: r.snippets };
    return r.snippets;
  } catch {
    return cache?.data ?? [];
  }
}

export function invalidatePaletteCache() {
  cache = null;
}
