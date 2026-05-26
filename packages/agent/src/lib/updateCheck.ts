import https from "node:https";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { configDir } from "./config";

const CACHE_FILE = path.join(configDir(), ".update-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY = "https://registry.npmjs.org";
const REQUEST_TIMEOUT_MS = 4000;

export interface UpdateInfo {
  current: string;
  latest: string | null;
  outdated: boolean;
  checkedAt: string;
}

interface CacheEntry {
  latest: string;
  checkedAt: number;
}

export async function checkForUpdate(opts: {
  pkgName: string;
  currentVersion: string;
  signal?: AbortSignal;
}): Promise<UpdateInfo> {
  const { pkgName, currentVersion } = opts;

  if (process.env.NO_UPDATE_NOTIFIER === "1" || process.env.NO_UPDATE_NOTIFIER === "true") {
    return { current: currentVersion, latest: null, outdated: false, checkedAt: new Date().toISOString() };
  }

  const cached = await readCache();
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return makeInfo(currentVersion, cached.latest);
  }

  let latest: string | null = null;
  try {
    latest = await fetchLatest(pkgName);
    await writeCache({ latest: latest ?? "", checkedAt: Date.now() });
  } catch {
    // network down / registry slow: fall back to cached even if stale
    if (cached?.latest) latest = cached.latest;
  }

  return makeInfo(currentVersion, latest);
}

function makeInfo(current: string, latest: string | null): UpdateInfo {
  const outdated = !!latest && compareSemver(current, latest) < 0;
  return { current, latest, outdated, checkedAt: new Date().toISOString() };
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const raw = await fsp.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

async function writeCache(entry: CacheEntry): Promise<void> {
  try {
    await fsp.writeFile(CACHE_FILE, JSON.stringify(entry), { mode: 0o600 });
  } catch {
    // best-effort
  }
}

function fetchLatest(pkgName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `${REGISTRY}/${encodeURIComponent(pkgName)}/latest`,
      { headers: { Accept: "application/json" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`registry_${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { version?: string };
            if (typeof parsed.version === "string") resolve(parsed.version);
            else reject(new Error("no_version_field"));
          } catch (err) {
            reject(err as Error);
          }
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("registry_timeout"));
    });
    req.on("error", reject);
  });
}

// Minimal semver comparator (major.minor.patch with optional prerelease).
// Returns negative if a < b, 0 if equal, positive if a > b.
export function compareSemver(a: string, b: string): number {
  const pa = parsePart(a);
  const pb = parsePart(b);
  for (let i = 0; i < 3; i++) {
    if (pa.numeric[i]! !== pb.numeric[i]!) return pa.numeric[i]! - pb.numeric[i]!;
  }
  // Equal core. Treat prerelease as lower than release.
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) return pa.pre.localeCompare(pb.pre);
  return 0;
}

function parsePart(v: string): { numeric: number[]; pre: string | null } {
  const [core, pre] = v.split("-", 2);
  const parts = (core || "0.0.0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return { numeric: parts.slice(0, 3), pre: pre ?? null };
}
