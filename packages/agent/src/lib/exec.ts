import { spawn } from "node:child_process";
import path from "node:path";
import { resolveInside, SandboxError } from "./sandbox";

export interface ExecResult {
  cwd: string;          // relative to root
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
}

const MAX_OUTPUT = 256 * 1024; // 256 KB combined
const DEFAULT_TIMEOUT = 15_000;
const HARD_TIMEOUT = 60_000;

export class ExecError extends Error {
  constructor(message: string, public code: "command_required" | "outside_root") {
    super(message);
  }
}

export async function runOneShot(
  rootPath: string,
  cwdRelative: string,
  command: string,
  timeoutMs?: number,
): Promise<ExecResult> {
  if (!command || !command.trim()) {
    throw new ExecError("empty command", "command_required");
  }

  let cwdAbs: string;
  try {
    cwdAbs = resolveInside(rootPath, cwdRelative || ".");
  } catch (err) {
    if (err instanceof SandboxError) {
      throw new ExecError("cwd outside root", "outside_root");
    }
    throw err;
  }

  const isWindows = process.platform === "win32";
  const shell = isWindows
    ? (process.env.COMSPEC || "cmd.exe")
    : (process.env.SHELL || "/bin/bash");
  const args = isWindows ? ["/d", "/s", "/c", command] : ["-lc", command];

  const env = {
    ...process.env,
    TERM: "dumb",
    NO_COLOR: "1",
    CLICOLOR: "0",
    PAGER: "cat",
    GIT_PAGER: "cat",
    LESS: "-FRX",
  };

  const limit = Math.min(Math.max(timeoutMs ?? DEFAULT_TIMEOUT, 1_000), HARD_TIMEOUT);
  const started = Date.now();

  return await new Promise<ExecResult>((resolve) => {
    const child = spawn(shell, args, { cwd: cwdAbs, env });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let truncated = false;
    let timedOut = false;

    const collect = (which: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = MAX_OUTPUT - stdoutLen - stderrLen;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      if (chunk.length > remaining) truncated = true;
      if (which === "stdout") {
        stdoutChunks.push(slice);
        stdoutLen += slice.length;
      } else {
        stderrChunks.push(slice);
        stderrLen += slice.length;
      }
    };

    child.stdout?.on("data", (b: Buffer) => collect("stdout", b));
    child.stderr?.on("data", (b: Buffer) => collect("stderr", b));

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 2000).unref();
    }, limit);
    timer.unref();

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const rootAbs = path.resolve(rootPath);
      const rel = path.relative(rootAbs, cwdAbs).split(path.sep).join("/") || ".";
      resolve({
        cwd: rel,
        command,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code,
        signal,
        durationMs: Date.now() - started,
        truncated,
        timedOut,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        cwd: cwdRelative || ".",
        command,
        stdout: "",
        stderr: `spawn_failed: ${err.message}`,
        exitCode: -1,
        signal: null,
        durationMs: Date.now() - started,
        truncated: false,
        timedOut: false,
      });
    });
  });
}
