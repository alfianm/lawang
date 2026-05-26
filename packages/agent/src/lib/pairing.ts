import crypto from "node:crypto";
import { recordEvent } from "./audit";
import { hash, newPairingToken, PairingToken, PairingRequest, safeEqual } from "./tokens";

interface PendingResolver {
  resolve: (s: "approved" | "rejected") => void;
}

export class PairingManager {
  private currentToken: PairingToken | null = null;
  private requests = new Map<string, PairingRequest & PendingResolver>();
  private listeners = new Set<(req: PairingRequest) => void>();
  private expiryMs: number;
  private sweepTimer: NodeJS.Timeout;

  constructor(tokenExpiryMinutes: number) {
    this.expiryMs = tokenExpiryMinutes * 60 * 1000;
    this.sweepTimer = setInterval(() => this.sweep(), 30_000).unref();
  }

  rotate(): PairingToken {
    this.currentToken = newPairingToken(this.expiryMs);
    return this.currentToken;
  }

  current(): PairingToken | null {
    if (!this.currentToken) return null;
    if (this.currentToken.status !== "active") return null;
    if (Date.now() > this.currentToken.expiresAt) {
      this.currentToken.status = "expired";
      return null;
    }
    return this.currentToken;
  }

  validateRawToken(raw: string): PairingToken | null {
    const cur = this.current();
    if (!cur) return null;
    if (!safeEqual(cur.tokenHash, hash(raw))) return null;
    return cur;
  }

  consumeToken() {
    if (this.currentToken && this.currentToken.status === "active") {
      this.currentToken.usedAt = Date.now();
      this.currentToken.status = "consumed";
    }
  }

  enqueue(opts: {
    deviceName: string;
    deviceType: string;
    remoteAddr: string;
    userAgent: string;
    fingerprint?: string | null;
  }): { request: PairingRequest; promise: Promise<"approved" | "rejected"> } {
    const tokenId = this.currentToken?.tokenId ?? "expired";
    let resolveFn: (s: "approved" | "rejected") => void = () => undefined;
    const promise = new Promise<"approved" | "rejected">((res) => {
      resolveFn = res;
    });
    const request: PairingRequest & PendingResolver = {
      requestId: crypto.randomUUID(),
      tokenId,
      deviceName: opts.deviceName,
      deviceType: opts.deviceType,
      remoteAddr: opts.remoteAddr,
      userAgent: opts.userAgent,
      fingerprint: opts.fingerprint?.trim() || null,
      createdAt: Date.now(),
      status: "pending",
      resolve: resolveFn,
    };
    this.requests.set(request.requestId, request);
    recordEvent("pairing_requested", {
      deviceName: request.deviceName,
      metadata: {
        requestId: request.requestId,
        remoteAddr: request.remoteAddr,
        fingerprint: request.fingerprint ? "present" : "absent",
      },
    });
    for (const l of this.listeners) l(request);
    return { request, promise };
  }

  decide(requestId: string, decision: "approved" | "rejected") {
    const req = this.requests.get(requestId);
    if (!req || req.status !== "pending") return false;
    req.status = decision;
    if (decision === "approved") {
      this.consumeToken();
      recordEvent("pairing_approved", {
        deviceName: req.deviceName,
        metadata: { requestId: req.requestId },
      });
    } else {
      recordEvent("pairing_rejected", {
        deviceName: req.deviceName,
        metadata: { requestId: req.requestId },
      });
    }
    req.resolve(decision);
    return true;
  }

  pending(): PairingRequest[] {
    return [...this.requests.values()].filter((r) => r.status === "pending");
  }

  attachSessionToken(requestId: string, sessionToken: string) {
    const req = this.requests.get(requestId);
    if (req) req.sessionToken = sessionToken;
  }

  onPending(fn: (req: PairingRequest) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private sweep() {
    const now = Date.now();
    if (this.currentToken && this.currentToken.status === "active" && now > this.currentToken.expiresAt) {
      this.currentToken.status = "expired";
      recordEvent("pairing_expired", { metadata: { tokenId: this.currentToken.tokenId } });
    }
    for (const req of this.requests.values()) {
      if (req.status === "pending" && now - req.createdAt > this.expiryMs) {
        req.status = "expired";
        req.resolve("rejected");
      }
    }
  }

  dispose() {
    clearInterval(this.sweepTimer);
  }
}
