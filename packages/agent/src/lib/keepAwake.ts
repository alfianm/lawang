import { spawn, ChildProcess } from "node:child_process";
import { log } from "./logger";

export interface KeepAwakeHandle {
  provider: "caffeinate" | "systemd-inhibit" | "noop";
  reason: string;
  stop: () => void;
}

export function startKeepAwake(): KeepAwakeHandle {
  if (process.platform === "darwin") {
    return spawnInhibit("caffeinate", ["-i", "-s"]);
  }
  if (process.platform === "linux") {
    return spawnInhibit("systemd-inhibit", [
      "--what=idle:sleep",
      "--why=lawang agent active",
      "--mode=block",
      "tail", "-f", "/dev/null",
    ]);
  }
  return {
    provider: "noop",
    reason: `keep-awake not supported on ${process.platform}`,
    stop: () => undefined,
  };
}

function spawnInhibit(bin: string, args: string[]): KeepAwakeHandle {
  let child: ChildProcess | null = null;
  try {
    child = spawn(bin, args, { stdio: "ignore" });
  } catch (err) {
    log.warn(`keep-awake: failed to spawn ${bin} (${(err as Error).message}). Continuing without it.`);
    return { provider: "noop", reason: `spawn_failed:${bin}`, stop: () => undefined };
  }
  child.on("error", (err) => {
    log.warn(`keep-awake: ${bin} error: ${err.message}`);
  });
  return {
    provider: bin === "caffeinate" ? "caffeinate" : "systemd-inhibit",
    reason: `${bin} active`,
    stop: () => {
      try { child?.kill("SIGTERM"); } catch { /* ignore */ }
    },
  };
}
