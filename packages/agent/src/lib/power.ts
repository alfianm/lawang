import { spawn } from "node:child_process";

export type PowerAction = "sleep" | "shutdown" | "reboot" | "lock";
export type PowerCapability = { supported: boolean; provider: string; needsAuth?: boolean; reason?: string };

export class PowerError extends Error {
  constructor(message: string, public code: "unsupported" | "spawn_failed" | "exit_failed" | "permission_denied") {
    super(message);
  }
}

export function powerCapabilities(): Record<PowerAction, PowerCapability> {
  if (process.platform === "darwin") {
    return {
      sleep:    { supported: true, provider: "pmset" },
      shutdown: { supported: true, provider: "osascript", needsAuth: false },
      reboot:   { supported: true, provider: "osascript" },
      lock:     { supported: true, provider: "pmset displaysleepnow" },
    };
  }
  if (process.platform === "linux") {
    return {
      sleep:    { supported: true, provider: "systemctl suspend" },
      shutdown: { supported: true, provider: "systemctl poweroff" },
      reboot:   { supported: true, provider: "systemctl reboot" },
      lock:     { supported: true, provider: "loginctl lock-session" },
    };
  }
  return {
    sleep:    { supported: false, provider: "n/a", reason: `power_actions_unsupported_on_${process.platform}` },
    shutdown: { supported: false, provider: "n/a", reason: `power_actions_unsupported_on_${process.platform}` },
    reboot:   { supported: false, provider: "n/a", reason: `power_actions_unsupported_on_${process.platform}` },
    lock:     { supported: false, provider: "n/a", reason: `power_actions_unsupported_on_${process.platform}` },
  };
}

interface ActionPlan {
  bin: string;
  args: string[];
  provider: string;
}

function plan(action: PowerAction): ActionPlan {
  if (process.platform === "darwin") {
    if (action === "sleep")    return { bin: "pmset",     args: ["sleepnow"],          provider: "pmset" };
    if (action === "shutdown") return { bin: "osascript", args: ["-e", 'tell application "System Events" to shut down'], provider: "osascript" };
    if (action === "reboot")   return { bin: "osascript", args: ["-e", 'tell application "System Events" to restart'],   provider: "osascript" };
    if (action === "lock")     return { bin: "pmset",     args: ["displaysleepnow"],   provider: "pmset-displaysleepnow" };
  }
  if (process.platform === "linux") {
    if (action === "sleep")    return { bin: "systemctl", args: ["suspend"],   provider: "systemctl-suspend" };
    if (action === "shutdown") return { bin: "systemctl", args: ["poweroff"],  provider: "systemctl-poweroff" };
    if (action === "reboot")   return { bin: "systemctl", args: ["reboot"],    provider: "systemctl-reboot" };
    if (action === "lock")     return { bin: "loginctl",  args: ["lock-session"], provider: "loginctl-lock-session" };
  }
  throw new PowerError("unsupported", "unsupported");
}

export async function performPowerAction(
  action: PowerAction,
  opts: { delaySeconds?: number } = {},
): Promise<{ provider: string; willHappenAt: string }> {
  const caps = powerCapabilities();
  const cap = caps[action];
  if (!cap.supported) {
    throw new PowerError(`unsupported on ${process.platform}`, "unsupported");
  }
  // Lock screen does not need a delay; everything else gets one.
  const defaultDelay = action === "lock" ? 0 : 5;
  const delay = Math.min(Math.max(opts.delaySeconds ?? defaultDelay, 0), 120);
  const eta = new Date(Date.now() + delay * 1000).toISOString();
  const p = plan(action);
  await delayMs(delay * 1000);
  await runOnce(p.bin, p.args);
  return { provider: p.provider, willHappenAt: eta };
}

function delayMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function runOnce(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: "ignore", detached: true });
    } catch (err) {
      reject(new PowerError(`spawn ${bin} failed: ${(err as Error).message}`, "spawn_failed"));
      return;
    }
    child.on("error", (err) => {
      reject(new PowerError(`${bin} error: ${err.message}`, "spawn_failed"));
    });
    child.on("close", (code, signal) => {
      // Sleep/poweroff often kill our process before close fires; treat code 0 or null as success.
      if (code === 0 || code === null) resolve();
      else if (code === 1 || code === 126 || code === 127) {
        reject(new PowerError(`${bin} exited ${code} ${signal ?? ""}`.trim(), code === 1 ? "permission_denied" : "exit_failed"));
      } else {
        reject(new PowerError(`${bin} exited ${code} ${signal ?? ""}`.trim(), "exit_failed"));
      }
    });
    child.unref();
  });
}
