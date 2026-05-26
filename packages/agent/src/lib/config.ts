import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface AgentConfig {
  machineId: string;
  machineName: string;
  trustedDevices: TrustedDevice[];
  settings: {
    rootPath: string;
    tokenExpiryMinutes: number;
    idleTimeoutMinutes: number;
    port: number;
  };
}

export interface TrustedDevice {
  deviceId: string;
  name: string;
  fingerprintHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  preset?: "full" | "files" | "terminal";
}

const CONFIG_DIR = path.join(os.homedir(), ".lawang");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Legacy directory from the project's previous name. Auto-migrate on first run
// so existing users keep trusted devices, audit log, and machine identity.
const LEGACY_DIR = path.join(os.homedir(), ".remote-app");

export function configDir() {
  return CONFIG_DIR;
}

export function auditLogPath() {
  return path.join(CONFIG_DIR, "audit.log");
}

async function ensureConfigDir() {
  if (!fsSync.existsSync(CONFIG_DIR) && fsSync.existsSync(LEGACY_DIR)) {
    try {
      await fs.rename(LEGACY_DIR, CONFIG_DIR);
    } catch {
      try {
        await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
        for (const name of await fs.readdir(LEGACY_DIR)) {
          await fs.copyFile(path.join(LEGACY_DIR, name), path.join(CONFIG_DIR, name));
        }
      } catch {
        // best-effort
      }
    }
  }
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export async function loadConfig(rootPath: string, port: number): Promise<AgentConfig> {
  await ensureConfigDir();
  let raw: string;
  try {
    raw = await fs.readFile(CONFIG_FILE, "utf8");
  } catch {
    const fresh: AgentConfig = {
      machineId: crypto.randomUUID(),
      machineName: os.hostname() || "Unknown machine",
      trustedDevices: [],
      settings: {
        rootPath,
        tokenExpiryMinutes: 15,
        idleTimeoutMinutes: 30,
        port,
      },
    };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(fresh, null, 2), { mode: 0o600 });
    return fresh;
  }

  const parsed = JSON.parse(raw) as AgentConfig;
  parsed.settings.rootPath = rootPath;
  parsed.settings.port = port;
  return parsed;
}

export async function saveConfig(cfg: AgentConfig) {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
