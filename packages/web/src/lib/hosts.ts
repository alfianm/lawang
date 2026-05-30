// Multi-host directory — purely client-side bookmarks (Opsi A).
// We store metadata about Lawang agents the user has paired with from this
// browser. Session tokens stay in localStorage on each origin (browsers scope
// localStorage per origin, so this list is also per-origin).
//
// We don't probe other hosts (CORS prevents that without explicit setup).
// Switching hosts = navigating to that origin via window.location.

export interface KnownHost {
  id: string;
  name: string;
  origin: string;
  addedAt: string;
  lastSeenAt: string;
  isCurrent?: boolean;
}

const KEY = "lawang:known-hosts";

function read(): KnownHost[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as KnownHost[];
    if (!Array.isArray(arr)) return [];
    return arr.map((h) => ({ ...h }));
  } catch {
    return [];
  }
}

function write(list: KnownHost[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded — best effort */
  }
}

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOrigin(input: string): string {
  try {
    const u = new URL(input);
    // Drop trailing slashes, query, hash.
    return `${u.protocol}//${u.host}`;
  } catch {
    return input.trim().replace(/\/+$/, "");
  }
}

export function listHosts(): KnownHost[] {
  const list = read();
  const here = window.location.origin;
  return list
    .map((h) => ({ ...h, isCurrent: h.origin === here }))
    .sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return a.lastSeenAt < b.lastSeenAt ? 1 : -1;
    });
}

export function rememberCurrentHost(opts: { machineName: string }): KnownHost {
  const here = window.location.origin;
  const now = new Date().toISOString();
  const list = read();
  const existing = list.find((h) => h.origin === here);
  if (existing) {
    if (opts.machineName) existing.name = opts.machineName;
    existing.lastSeenAt = now;
    write(list);
    return existing;
  }
  const fresh: KnownHost = {
    id: uuid(),
    name: opts.machineName || "Unknown",
    origin: here,
    addedAt: now,
    lastSeenAt: now,
  };
  list.push(fresh);
  write(list);
  return fresh;
}

export function addHost(opts: { name: string; origin: string }): KnownHost | { error: string } {
  const origin = normalizeOrigin(opts.origin);
  if (!/^https?:\/\//.test(origin)) {
    return { error: "Origin must start with http:// or https://" };
  }
  const list = read();
  if (list.some((h) => h.origin === origin)) {
    return { error: "Host with this URL is already saved" };
  }
  const now = new Date().toISOString();
  const fresh: KnownHost = {
    id: uuid(),
    name: opts.name?.trim() || origin.replace(/^https?:\/\//, ""),
    origin,
    addedAt: now,
    lastSeenAt: now,
  };
  list.push(fresh);
  write(list);
  return fresh;
}

export function renameHost(id: string, name: string): void {
  const list = read();
  const h = list.find((x) => x.id === id);
  if (!h) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  h.name = trimmed;
  write(list);
}

export function forgetHost(id: string): void {
  write(read().filter((h) => h.id !== id));
}

export function navigateTo(origin: string): void {
  window.location.href = origin;
}
