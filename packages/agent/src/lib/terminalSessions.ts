import { spawnTerminal, defaultUserCwd, TerminalProcess } from "./terminal";
import { recordEvent } from "./audit";
import { log } from "./logger";

const RING_BYTES = 256 * 1024; // 256 KB per session — survives a refresh, plus some scrollback
const ABANDONED_GRACE_MS = 5 * 60 * 1000; // detach -> kill if not reattached in 5 min

export interface AttachedListener {
  onData(data: string): void;
  onExit(opts: { exitCode: number; signal?: number }): void;
}

interface TerminalSession {
  sessionId: string;
  term: TerminalProcess;
  buffer: Buffer;
  bufferBytes: number;
  listener: AttachedListener | null;
  abandonedTimer: NodeJS.Timeout | null;
  exited: boolean;
}

function appendToRing(session: TerminalSession, chunk: string) {
  const incoming = Buffer.from(chunk, "utf8");
  if (incoming.length >= RING_BYTES) {
    session.buffer = incoming.subarray(incoming.length - RING_BYTES);
    session.bufferBytes = session.buffer.length;
    return;
  }
  const combined = Buffer.concat([session.buffer, incoming]);
  if (combined.length > RING_BYTES) {
    session.buffer = combined.subarray(combined.length - RING_BYTES);
  } else {
    session.buffer = combined;
  }
  session.bufferBytes = session.buffer.length;
}

export class TerminalSessionStore {
  private sessions = new Map<string, TerminalSession>();

  attachOrCreate(opts: {
    sessionId: string;
    rootPath: string;
    cols?: number;
    rows?: number;
    listener: AttachedListener;
  }): { session: TerminalSession; reused: boolean; replay: string } {
    let session = this.sessions.get(opts.sessionId);
    let reused = false;
    if (!session || session.exited) {
      const term = spawnTerminal({ cwd: defaultUserCwd(opts.rootPath), cols: opts.cols, rows: opts.rows });
      const fresh: TerminalSession = {
        sessionId: opts.sessionId,
        term,
        buffer: Buffer.alloc(0),
        bufferBytes: 0,
        listener: null,
        abandonedTimer: null,
        exited: false,
      };
      term.pty.onData((data) => {
        appendToRing(fresh, data);
        if (fresh.listener) fresh.listener.onData(data);
      });
      term.pty.onExit(({ exitCode, signal }) => {
        fresh.exited = true;
        if (fresh.listener) fresh.listener.onExit({ exitCode, signal });
        if (fresh.abandonedTimer) {
          clearTimeout(fresh.abandonedTimer);
          fresh.abandonedTimer = null;
        }
        this.sessions.delete(fresh.sessionId);
      });
      this.sessions.set(opts.sessionId, fresh);
      session = fresh;
    } else {
      reused = true;
      if (session.abandonedTimer) {
        clearTimeout(session.abandonedTimer);
        session.abandonedTimer = null;
      }
    }
    session.listener = opts.listener;

    if (opts.cols && opts.rows && Number.isInteger(opts.cols) && Number.isInteger(opts.rows)) {
      try { session.term.pty.resize(opts.cols, opts.rows); } catch { /* ignore */ }
    }

    const replay = session.buffer.toString("utf8");
    if (reused && replay.length > 0) {
      recordEvent("terminal_resumed", {
        metadata: { sessionId: session.sessionId, replayBytes: session.bufferBytes },
      });
    }
    return { session, reused, replay };
  }

  detach(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.listener = null;
    if (session.exited) {
      this.sessions.delete(sessionId);
      return;
    }
    if (session.abandonedTimer) clearTimeout(session.abandonedTimer);
    session.abandonedTimer = setTimeout(() => {
      log.warn(`Terminal session ${sessionId.slice(0, 8)} abandoned, killing PTY.`);
      try { session.term.pty.kill(); } catch { /* ignore */ }
      this.sessions.delete(sessionId);
    }, ABANDONED_GRACE_MS);
    session.abandonedTimer.unref?.();
  }

  end(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.abandonedTimer) {
      clearTimeout(session.abandonedTimer);
      session.abandonedTimer = null;
    }
    try { session.term.pty.kill(); } catch { /* ignore */ }
    this.sessions.delete(sessionId);
  }

  endAll() {
    for (const id of [...this.sessions.keys()]) this.end(id);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.exited) return false;
    session.term.pty.write(data);
    return true;
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.exited) return false;
    try { session.term.pty.resize(cols, rows); return true; } catch { return false; }
  }

  /** Snapshot of live terminal sessions for attention / agent cards. */
  listLive(): Array<{
    sessionId: string;
    attached: boolean;
    exited: boolean;
    bufferTail: string;
  }> {
    return [...this.sessions.values()]
      .filter((s) => !s.exited)
      .map((s) => {
        const text = s.buffer.toString("utf8");
        const bufferTail = text.length > 4000 ? text.slice(text.length - 4000) : text;
        return {
          sessionId: s.sessionId,
          attached: Boolean(s.listener),
          exited: s.exited,
          bufferTail,
        };
      });
  }
}
