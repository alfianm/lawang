import path from "node:path";
import { spawn as ptySpawn, IPty } from "node-pty";
import { resolveInside, SandboxError } from "./sandbox";
import { agentLabelFromCommand, detectAttention, AttentionHit } from "./attention";
import { findAgentPreset, resolvePresetCommand } from "./agentPresets";
import {
  detectAgentLaunchFailure,
  formatPreflightMessage,
  prepareAgentLaunch,
} from "./agentPreflight";

export type AgentSessionStatus = "running" | "exited" | "failed" | "stopped";

export interface AgentReplyRecord {
  id: string;
  at: string;
  text: string;
  kind: "reply" | "approve" | "reject" | "enter";
}

export interface AgentSessionRecord {
  id: string;
  presetId: string | null;
  agent: string;
  label: string;
  command: string;
  cwd: string;
  status: AgentSessionStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  durationMs: number;
  log: string;
  truncated: boolean;
  attention: AttentionHit | null;
  replies: AgentReplyRecord[];
}

export type AgentSessionEvent =
  | { type: "started"; session: AgentSessionRecord }
  | { type: "log"; sessionId: string; chunk: string; truncated: boolean }
  | { type: "updated"; session: AgentSessionRecord }
  | { type: "reply"; sessionId: string; reply: AgentReplyRecord };

interface AgentSessionInternal {
  id: string;
  presetId: string | null;
  agent: string;
  label: string;
  command: string;
  cwdRelative: string;
  status: AgentSessionStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  pty: IPty | null;
  chunks: string[];
  logBytes: number;
  truncated: boolean;
  replies: AgentReplyRecord[];
}

export class AgentSessionError extends Error {
  constructor(
    message: string,
    public code: "command_required" | "outside_root" | "not_found" | "not_running" | "empty_reply" | "preflight_failed",
  ) {
    super(message);
  }
}

const MAX_SESSIONS = 12;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_REPLIES = 80;

export class AgentSessionStore {
  private sessions = new Map<string, AgentSessionInternal>();
  private listeners = new Set<(event: AgentSessionEvent) => void>();

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentSessionEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  start(rootPath: string, opts: {
    command?: string;
    presetId?: string | null;
    cwd?: string;
    label?: string | null;
  }): AgentSessionRecord {
    const preset = opts.presetId ? findAgentPreset(opts.presetId) : null;
    const resolved = opts.presetId ? resolvePresetCommand(opts.presetId) : null;
    const command = (opts.command?.trim() || resolved || preset?.command || "").trim();
    if (!command) throw new AgentSessionError("empty command", "command_required");

    let cwdAbs: string;
    try {
      cwdAbs = resolveInside(rootPath, opts.cwd || ".");
    } catch (err) {
      if (err instanceof SandboxError) throw new AgentSessionError("cwd outside root", "outside_root");
      throw err;
    }

    this.prune();

    const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const isWindows = process.platform === "win32";
    const shell = isWindows
      ? (process.env.COMSPEC || "powershell.exe")
      : (process.env.SHELL || "/bin/bash");
    const args = isWindows ? ["/d", "/s", "/c", command] : ["-lc", command];
    const rootAbs = path.resolve(rootPath);
    const cwdRelative = path.relative(rootAbs, cwdAbs).split(path.sep).join("/") || ".";
    const agent = agentLabelFromCommand(command) || preset?.id || "agent";
    const label = opts.label?.trim() || preset?.label || agent;

    const preflight = prepareAgentLaunch(command);
    if (!preflight.ok) {
      const detail = formatPreflightMessage(preflight).trim() || preflight.warnings.join("; ");
      throw new AgentSessionError(detail || "agent preflight failed", "preflight_failed");
    }

    let pty: IPty;
    try {
      pty = ptySpawn(shell, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 36,
        cwd: cwdAbs,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          LANG: process.env.LANG || "en_US.UTF-8",
          PAGER: "cat",
          GIT_PAGER: "cat",
        } as { [key: string]: string },
      });
    } catch (err) {
      throw new AgentSessionError((err as Error).message || "failed to spawn agent", "command_required");
    }

    const session: AgentSessionInternal = {
      id,
      presetId: preset?.id || opts.presetId || null,
      agent,
      label,
      command,
      cwdRelative,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      pty,
      chunks: [],
      logBytes: 0,
      truncated: false,
      replies: [],
    };

    let launchHintInjected = false;
    const append = (chunk: string) => {
      const bytes = Buffer.byteLength(chunk);
      let emitted = chunk;
      if (session.logBytes + bytes > MAX_LOG_BYTES) {
        session.truncated = true;
        const remaining = Math.max(0, MAX_LOG_BYTES - session.logBytes);
        if (remaining > 0) {
          const slice = Buffer.from(chunk).subarray(0, remaining).toString("utf8");
          session.chunks.push(slice);
          session.logBytes += Buffer.byteLength(slice);
          emitted = slice;
        } else {
          emitted = "";
        }
      } else {
        session.chunks.push(chunk);
        session.logBytes += bytes;
      }
      if (emitted) {
        this.emit({ type: "log", sessionId: session.id, chunk: emitted, truncated: session.truncated });
      }
      if (!launchHintInjected) {
        const hint = detectAgentLaunchFailure(session.chunks.join(""));
        if (hint) {
          launchHintInjected = true;
          // Append remediation once so the Agents UI shows actionable next steps.
          const tipBytes = Buffer.byteLength(hint);
          session.chunks.push(hint);
          session.logBytes += tipBytes;
          this.emit({ type: "log", sessionId: session.id, chunk: hint, truncated: session.truncated });
        }
      }
    };

    if (preflight.warnings.length || preflight.hints.length) {
      append(formatPreflightMessage(preflight));
    }

    pty.onData((data) => append(data));
    pty.onExit(({ exitCode }) => {
      if (session.status === "running") session.status = "exited";
      session.exitCode = exitCode;
      session.endedAt = Date.now();
      session.pty = null;
      this.emit({ type: "updated", session: this.toRecord(session) });
    });

    this.sessions.set(id, session);
    const record = this.toRecord(session);
    this.emit({ type: "started", session: record });
    return record;
  }

  list(): AgentSessionRecord[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((s) => this.toRecord(s));
  }

  get(id: string): AgentSessionRecord | null {
    const session = this.sessions.get(id);
    return session ? this.toRecord(session) : null;
  }

  reply(id: string, opts: { text: string; kind?: AgentReplyRecord["kind"] }): AgentSessionRecord {
    const session = this.sessions.get(id);
    if (!session) throw new AgentSessionError("agent not found", "not_found");
    if (!session.pty || session.status !== "running") {
      throw new AgentSessionError("agent is not running", "not_running");
    }
    const text = opts.text;
    if (!text.length) throw new AgentSessionError("empty reply", "empty_reply");

    const kind = opts.kind || "reply";
    const payload = text.endsWith("\n") || text.endsWith("\r") ? text : `${text}\n`;
    session.pty.write(payload);

    const reply: AgentReplyRecord = {
      id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      text: text.replace(/\r?\n$/, ""),
      kind,
    };
    session.replies.push(reply);
    if (session.replies.length > MAX_REPLIES) {
      session.replies = session.replies.slice(-MAX_REPLIES);
    }
    this.emit({ type: "reply", sessionId: session.id, reply });
    this.emit({ type: "updated", session: this.toRecord(session) });
    return this.toRecord(session);
  }

  action(id: string, action: "approve" | "reject" | "enter"): AgentSessionRecord {
    if (action === "enter") return this.sendEnter(id);
    if (action === "reject") return this.reply(id, { text: "n", kind: "reject" });

    // Approve: pick a sensible default from the latest attention heuristic.
    const session = this.sessions.get(id);
    if (!session) throw new AgentSessionError("agent not found", "not_found");
    const hit = detectAttention(session.chunks.join(""));
    const text =
      hit?.kind === "agent" ? "y" :
      hit?.kind === "confirm" ? "y" :
      "y";
    return this.reply(id, { text, kind: "approve" });
  }

  /** Send bare Enter (empty line). */
  sendEnter(id: string): AgentSessionRecord {
    const session = this.sessions.get(id);
    if (!session) throw new AgentSessionError("agent not found", "not_found");
    if (!session.pty || session.status !== "running") {
      throw new AgentSessionError("agent is not running", "not_running");
    }
    session.pty.write("\r");
    const reply: AgentReplyRecord = {
      id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      text: "⏎",
      kind: "enter",
    };
    session.replies.push(reply);
    this.emit({ type: "reply", sessionId: session.id, reply });
    this.emit({ type: "updated", session: this.toRecord(session) });
    return this.toRecord(session);
  }

  stop(id: string): AgentSessionRecord {
    const session = this.sessions.get(id);
    if (!session) throw new AgentSessionError("agent not found", "not_found");
    if (!session.pty || session.status !== "running") {
      throw new AgentSessionError("agent is not running", "not_running");
    }
    session.status = "stopped";
    try { session.pty.kill(); } catch { /* ignore */ }
    setTimeout(() => {
      if (session.pty && session.status === "stopped") {
        try { session.pty.write("\x03"); } catch { /* ignore */ }
        try { session.pty.kill(); } catch { /* ignore */ }
      }
    }, 1500).unref();
    const record = this.toRecord(session);
    this.emit({ type: "updated", session: record });
    return record;
  }

  endAll() {
    for (const session of this.sessions.values()) {
      if (session.pty) {
        try { session.pty.kill(); } catch { /* ignore */ }
      }
    }
    this.sessions.clear();
  }

  private prune() {
    const all = [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
    for (const session of all.slice(MAX_SESSIONS)) {
      if (session.status === "running") continue;
      this.sessions.delete(session.id);
    }
  }

  private toRecord(session: AgentSessionInternal): AgentSessionRecord {
    const log = session.chunks.join("");
    return {
      id: session.id,
      presetId: session.presetId,
      agent: session.agent,
      label: session.label,
      command: session.command,
      cwd: session.cwdRelative,
      status: session.status,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      exitCode: session.exitCode,
      durationMs: (session.endedAt || Date.now()) - session.startedAt,
      log,
      truncated: session.truncated,
      attention: detectAttention(log),
      replies: [...session.replies],
    };
  }
}
