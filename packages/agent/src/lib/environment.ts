import path from "node:path";
import { promises as fsp } from "node:fs";
import os from "node:os";

export interface EnvironmentInfo {
  machine: {
    hostname: string;
    platform: NodeJS.Platform;
    arch: string;
    cpus: number;
    release: string;
  };
  runtime: {
    node: string;
    npm_user_agent: string | null;
  };
  shell: {
    path: string;
    name: string;
  };
  project: {
    rootPath: string;
    name: string | null;
    version: string | null;
    packageManager: "npm" | "pnpm" | "yarn" | "bun" | null;
    packageManagerLockfile: string | null;
    isGitRepo: boolean;
    monorepo: boolean;
    workspaces: string[] | null;
  };
}

async function exists(p: string): Promise<boolean> {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readJsonSafe<T = unknown>(p: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function detectPackageManager(rootPath: string): Promise<{ pm: EnvironmentInfo["project"]["packageManager"]; lockfile: string | null }> {
  const candidates: Array<[NonNullable<EnvironmentInfo["project"]["packageManager"]>, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun",  "bun.lockb"],
    ["npm",  "package-lock.json"],
  ];
  for (const [pm, file] of candidates) {
    if (await exists(path.join(rootPath, file))) {
      return { pm, lockfile: file };
    }
  }
  return { pm: null, lockfile: null };
}

export async function detectEnvironment(rootPath: string): Promise<EnvironmentInfo> {
  const pkgPath = path.join(rootPath, "package.json");
  const pkg = (await readJsonSafe<{
    name?: string;
    version?: string;
    workspaces?: string[] | { packages?: string[] };
  }>(pkgPath)) ?? null;

  const { pm, lockfile } = await detectPackageManager(rootPath);

  const workspacesRaw = pkg?.workspaces;
  const workspaces = Array.isArray(workspacesRaw)
    ? workspacesRaw
    : Array.isArray((workspacesRaw as any)?.packages)
      ? (workspacesRaw as any).packages as string[]
      : null;

  const isGitRepo = await exists(path.join(rootPath, ".git"));

  const shellPath = process.env.SHELL || (process.platform === "win32" ? (process.env.COMSPEC || "powershell.exe") : "/bin/bash");
  const shellName = path.basename(shellPath).replace(/\.exe$/i, "");

  return {
    machine: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      release: os.release(),
    },
    runtime: {
      node: process.versions.node,
      npm_user_agent: process.env.npm_config_user_agent ?? null,
    },
    shell: {
      path: shellPath,
      name: shellName,
    },
    project: {
      rootPath,
      name: pkg?.name ?? null,
      version: pkg?.version ?? null,
      packageManager: pm,
      packageManagerLockfile: lockfile,
      isGitRepo,
      monorepo: Array.isArray(workspaces) && workspaces.length > 0,
      workspaces,
    },
  };
}
