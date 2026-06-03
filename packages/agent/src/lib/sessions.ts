import crypto from "node:crypto";
import { recordEvent } from "./audit";
import { newSessionToken, hash, safeEqual, SessionInfo, Permission } from "./tokens";

export class SessionStore {
  private sessions = new Map<string, SessionInfo>();
  private idleTimeoutMs: number;
  private maxLifetimeMs: number;
  private timer: NodeJS.Timeout;
  private endListeners = new Set<(sessionId: string, reason: "ended" | "revoked" | "expired") => void>();

  constructor(idleTimeoutMinutes: number, maxLifetimeMinutes = 0) {
    this.idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
    this.maxLifetimeMs = Math.max(0, maxLifetimeMinutes) * 60 * 1000;
    this.timer = setInterval(() => this.sweep(), 60_000).unref();
  }

  create(opts: {
    deviceName: string;
    deviceType: string;
    remoteAddr: string;
    trusted?: boolean;
    permissions?: Permission[];
  }) {
    const { token, hash: tokenHash } = newSessionToken();
    const permissions: Permission[] = opts.permissions && opts.permissions.length > 0
      ? [...new Set(opts.permissions)]
      : ["terminal", "file:read", "file:write", "git:read", "git:write", "screen:view", "screen:control"];
    const session: SessionInfo = {
      sessionId: crypto.randomUUID(),
      sessionTokenHash: tokenHash,
      deviceName: opts.deviceName,
      deviceType: opts.deviceType,
      remoteAddr: opts.remoteAddr,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: this.maxLifetimeMs > 0 ? Date.now() + this.maxLifetimeMs : null,
      status: "active",
      permissions,
    };
    this.sessions.set(session.sessionId, session);
    recordEvent("session_started", {
      deviceName: session.deviceName,
      metadata: {
        sessionId: session.sessionId,
        remoteAddr: session.remoteAddr,
        trusted: Boolean(opts.trusted),
        permissions,
      },
    });
    return { session, token };
  }

  byTokenHash(h: string): SessionInfo | undefined {
    for (const s of this.sessions.values()) {
      if (s.status === "active" && safeEqual(s.sessionTokenHash, h)) {
        if (s.expiresAt && Date.now() > s.expiresAt) {
          this.end(s.sessionId, "expired");
          return undefined;
        }
        return s;
      }
    }
    return undefined;
  }

  byTokenRaw(raw: string): SessionInfo | undefined {
    return this.byTokenHash(hash(raw));
  }

  touch(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s) s.lastActiveAt = Date.now();
  }

  end(sessionId: string, reason: "ended" | "revoked" | "expired" = "ended") {
    const s = this.sessions.get(sessionId);
    if (!s || s.status !== "active") return;
    s.status = reason;
    const eventType = reason === "revoked" ? "session_revoked" : reason === "expired" ? "session_expired" : "session_ended";
    recordEvent(eventType, {
      deviceName: s.deviceName,
      metadata: { sessionId: s.sessionId },
    });
    for (const fn of this.endListeners) {
      try { fn(s.sessionId, reason); } catch { /* ignore listener errors */ }
    }
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].filter((s) => s.status === "active");
  }

  revokeAll(reason: "revoked" | "expired" = "revoked") {
    for (const s of this.list()) this.end(s.sessionId, reason);
  }

  onEnd(fn: (sessionId: string, reason: "ended" | "revoked" | "expired") => void): () => void {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  private sweep() {
    const cutoff = Date.now() - this.idleTimeoutMs;
    const now = Date.now();
    for (const s of this.list()) {
      if (s.lastActiveAt < cutoff) this.end(s.sessionId, "expired");
      else if (s.expiresAt && now > s.expiresAt) this.end(s.sessionId, "expired");
    }
  }

  dispose() {
    clearInterval(this.timer);
  }
}
