import path from "node:path";
import os from "node:os";
import { promises as fsp } from "node:fs";
import { spawnSync } from "node:child_process";

export type Platform = "linux-systemd" | "macos-launchd" | "unsupported";

export interface ServiceContext {
  platform: Platform;
  unitPath: string;       // file path of the generated unit
  serviceName: string;
  rootPath: string;
  binaryPath: string;
  extraArgs: string[];
}

export interface ServiceStatus {
  installed: boolean;
  active: boolean;
  source: string;
}

const SERVICE_NAME = "lawang";

export function detectPlatform(): Platform {
  if (process.platform === "linux") return "linux-systemd";
  if (process.platform === "darwin") return "macos-launchd";
  return "unsupported";
}

export function buildContext(opts: {
  rootPath: string;
  binaryPath: string;
  extraArgs?: string[];
}): ServiceContext {
  const platform = detectPlatform();
  if (platform === "linux-systemd") {
    return {
      platform,
      unitPath: path.join(os.homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`),
      serviceName: SERVICE_NAME,
      rootPath: opts.rootPath,
      binaryPath: opts.binaryPath,
      extraArgs: opts.extraArgs ?? [],
    };
  }
  if (platform === "macos-launchd") {
    return {
      platform,
      unitPath: path.join(os.homedir(), "Library", "LaunchAgents", `dev.lawang.${SERVICE_NAME}.plist`),
      serviceName: `dev.lawang.${SERVICE_NAME}`,
      rootPath: opts.rootPath,
      binaryPath: opts.binaryPath,
      extraArgs: opts.extraArgs ?? [],
    };
  }
  return {
    platform: "unsupported",
    unitPath: "",
    serviceName: "",
    rootPath: opts.rootPath,
    binaryPath: opts.binaryPath,
    extraArgs: opts.extraArgs ?? [],
  };
}

export function renderUnit(ctx: ServiceContext): string {
  if (ctx.platform === "linux-systemd") {
    const exec = [ctx.binaryPath, "start", ...ctx.extraArgs].map(escSh).join(" ");
    return `[Unit]
Description=Lawang local-first remote terminal agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ctx.rootPath}
ExecStart=${exec}
Restart=on-failure
RestartSec=5
# Hardening (best-effort for a user service):
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=default.target
`;
  }
  if (ctx.platform === "macos-launchd") {
    const programArgs = [ctx.binaryPath, "start", ...ctx.extraArgs];
    const argEntries = programArgs
      .map((a) => `        <string>${escapeXml(a)}</string>`)
      .join("\n");
    const logPath = path.join(os.homedir(), "Library", "Logs", `${SERVICE_NAME}.log`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${ctx.serviceName}</string>
    <key>ProgramArguments</key>
    <array>
${argEntries}
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(ctx.rootPath)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
`;
  }
  return "";
}

function escSh(s: string): string {
  if (/^[A-Za-z0-9._/=:@%+-]+$/.test(s)) return s;
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function writeUnit(ctx: ServiceContext): Promise<void> {
  const dir = path.dirname(ctx.unitPath);
  await fsp.mkdir(dir, { recursive: true });
  const content = renderUnit(ctx);
  if (!content) throw new Error("unsupported_platform");
  await fsp.writeFile(ctx.unitPath, content, { mode: 0o644 });
}

export async function removeUnit(ctx: ServiceContext): Promise<boolean> {
  try {
    await fsp.unlink(ctx.unitPath);
    return true;
  } catch (err: any) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
}

export interface RegisterStep {
  cmd: string[];
  description: string;
}

// Steps the CLI will run on behalf of the user when they pass --register.
export function registrationSteps(ctx: ServiceContext): RegisterStep[] {
  if (ctx.platform === "linux-systemd") {
    return [
      { cmd: ["systemctl", "--user", "daemon-reload"], description: "Reload systemd user units" },
      { cmd: ["systemctl", "--user", "enable", "--now", `${SERVICE_NAME}.service`], description: "Enable + start service" },
    ];
  }
  if (ctx.platform === "macos-launchd") {
    return [
      { cmd: ["launchctl", "unload", ctx.unitPath], description: "Unload prior version (ok if not loaded)" },
      { cmd: ["launchctl", "load", "-w", ctx.unitPath], description: "Load + enable launchd job" },
    ];
  }
  return [];
}

export function unregistrationSteps(ctx: ServiceContext): RegisterStep[] {
  if (ctx.platform === "linux-systemd") {
    return [
      { cmd: ["systemctl", "--user", "disable", "--now", `${SERVICE_NAME}.service`], description: "Stop + disable service" },
      { cmd: ["systemctl", "--user", "daemon-reload"], description: "Reload systemd user units" },
    ];
  }
  if (ctx.platform === "macos-launchd") {
    return [
      { cmd: ["launchctl", "unload", ctx.unitPath], description: "Unload launchd job" },
    ];
  }
  return [];
}

export interface RunResult {
  cmd: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runStep(step: RegisterStep): RunResult {
  const r = spawnSync(step.cmd[0]!, step.cmd.slice(1), { encoding: "utf8" });
  return {
    cmd: step.cmd.join(" "),
    ok: r.status === 0,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

export function probeStatus(ctx: ServiceContext): ServiceStatus {
  if (ctx.platform === "linux-systemd") {
    const r = spawnSync("systemctl", ["--user", "is-active", `${SERVICE_NAME}.service`], { encoding: "utf8" });
    return {
      installed: existsSync(ctx.unitPath),
      active: (r.stdout || "").trim() === "active",
      source: "systemctl --user",
    };
  }
  if (ctx.platform === "macos-launchd") {
    const r = spawnSync("launchctl", ["list", ctx.serviceName], { encoding: "utf8" });
    return {
      installed: existsSync(ctx.unitPath),
      active: r.status === 0,
      source: "launchctl list",
    };
  }
  return { installed: false, active: false, source: "n/a" };
}

function existsSync(p: string): boolean {
  try { require("node:fs").accessSync(p); return true; } catch { return false; }
}
