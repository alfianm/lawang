import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { resolveInside, SandboxError } from "./sandbox";

export type ProcessJobStatus = "running" | "exited" | "failed" | "stopped";

export interface ProcessJobRecord {
  id: string;
  command: string;
  cwd: string;
  label: string | null;
  status: ProcessJobStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  log: string;
  truncated: boolean;
}

export type ProcessJobEvent =
  | { type: "started"; job: ProcessJobRecord }
  | { type: "log"; jobId: string; chunk: string; truncated: boolean }
  | { type: "updated"; job: ProcessJobRecord };

interface ProcessJobInternal {
  id: string;
  command: string;
  cwdRelative: string;
  label: string | null;
  status: ProcessJobStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  child: ChildProcessWithoutNullStreams | null;
  chunks: string[];
  logBytes: number;
  truncated: boolean;
}

const MAX_JOBS = 20;
const MAX_LOG_BYTES = 192 * 1024;

export class ProcessJobError extends Error {
  constructor(message: string, public code: "command_required" | "outside_root" | "not_found" | "not_running") {
    super(message);
  }
}

export class ProcessJobStore {
  private jobs = new Map<string, ProcessJobInternal>();
  private listeners = new Set<(event: ProcessJobEvent) => void>();

  subscribe(listener: (event: ProcessJobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ProcessJobEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore listener errors */ }
    }
  }

  start(rootPath: string, opts: { command: string; cwd?: string; label?: string | null }): ProcessJobRecord {
    const command = opts.command.trim();
    if (!command) throw new ProcessJobError("empty command", "command_required");

    let cwdAbs: string;
    try {
      cwdAbs = resolveInside(rootPath, opts.cwd || ".");
    } catch (err) {
      if (err instanceof SandboxError) throw new ProcessJobError("cwd outside root", "outside_root");
      throw err;
    }

    this.prune();

    const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const isWindows = process.platform === "win32";
    const shell = isWindows ? (process.env.COMSPEC || "cmd.exe") : (process.env.SHELL || "/bin/bash");
    const args = isWindows ? ["/d", "/s", "/c", command] : ["-lc", command];
    const rootAbs = path.resolve(rootPath);
    const cwdRelative = path.relative(rootAbs, cwdAbs).split(path.sep).join("/") || ".";
    const child = spawn(shell, args, {
      cwd: cwdAbs,
      env: {
        ...process.env,
        TERM: process.env.TERM || "xterm-256color",
        PAGER: "cat",
        GIT_PAGER: "cat",
      },
    });

    const job: ProcessJobInternal = {
      id,
      command,
      cwdRelative,
      label: opts.label?.trim() || null,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      child,
      chunks: [],
      logBytes: 0,
      truncated: false,
    };

    const collect = (prefix: string, chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const line = prefix ? `${prefix}${text}` : text;
      const bytes = Buffer.byteLength(line);
      let emitted = line;
      if (job.logBytes + bytes > MAX_LOG_BYTES) {
        job.truncated = true;
        const remaining = Math.max(0, MAX_LOG_BYTES - job.logBytes);
        if (remaining > 0) {
          const slice = Buffer.from(line).subarray(0, remaining).toString("utf8");
          job.chunks.push(slice);
          job.logBytes += Buffer.byteLength(slice);
          emitted = slice;
        } else {
          emitted = "";
        }
      } else {
        job.chunks.push(line);
        job.logBytes += bytes;
      }
      if (emitted) {
        this.emit({ type: "log", jobId: job.id, chunk: emitted, truncated: job.truncated });
      }
    };

    child.stdout.on("data", (chunk: Buffer) => collect("", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("[stderr] ", chunk));
    child.on("error", (err) => {
      job.status = "failed";
      job.endedAt = Date.now();
      job.child = null;
      collect("", Buffer.from(`spawn_failed: ${err.message}\n`));
      this.emit({ type: "updated", job: this.toRecord(job) });
    });
    child.on("close", (code, signal) => {
      if (job.status === "running") job.status = "exited";
      job.exitCode = code;
      job.signal = signal;
      job.endedAt = Date.now();
      job.child = null;
      this.emit({ type: "updated", job: this.toRecord(job) });
    });

    this.jobs.set(id, job);
    const record = this.toRecord(job);
    this.emit({ type: "started", job: record });
    return record;
  }

  list(): ProcessJobRecord[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((job) => this.toRecord(job));
  }

  get(id: string): ProcessJobRecord | null {
    const job = this.jobs.get(id);
    return job ? this.toRecord(job) : null;
  }

  stop(id: string): ProcessJobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new ProcessJobError("job not found", "not_found");
    if (!job.child || job.status !== "running") throw new ProcessJobError("job is not running", "not_running");
    job.status = "stopped";
    try { job.child.kill("SIGTERM"); } catch { /* ignore */ }
    setTimeout(() => {
      if (job.child && job.status === "stopped") {
        try { job.child.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }, 2000).unref();
    const record = this.toRecord(job);
    this.emit({ type: "updated", job: record });
    return record;
  }

  private prune() {
    const all = [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
    for (const job of all.slice(MAX_JOBS)) {
      if (job.status === "running") continue;
      this.jobs.delete(job.id);
    }
  }

  private toRecord(job: ProcessJobInternal): ProcessJobRecord {
    return {
      id: job.id,
      command: job.command,
      cwd: job.cwdRelative,
      label: job.label,
      status: job.status,
      startedAt: new Date(job.startedAt).toISOString(),
      endedAt: job.endedAt ? new Date(job.endedAt).toISOString() : null,
      exitCode: job.exitCode,
      signal: job.signal,
      durationMs: (job.endedAt || Date.now()) - job.startedAt,
      log: job.chunks.join(""),
      truncated: job.truncated,
    };
  }
}
