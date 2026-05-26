import crypto from "node:crypto";

export type Permission = "terminal" | "file:read" | "file:write" | "git:read" | "git:write";

export interface PairingToken {
  tokenId: string;
  rawToken: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  status: "active" | "consumed" | "expired";
}

export interface PairingRequest {
  requestId: string;
  tokenId: string;
  deviceName: string;
  deviceType: string;
  remoteAddr: string;
  userAgent: string;
  fingerprint: string | null;
  createdAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
  sessionToken?: string;
  resolve: (status: "approved" | "rejected") => void;
}

export interface SessionInfo {
  sessionId: string;
  sessionTokenHash: string;
  deviceName: string;
  deviceType: string;
  remoteAddr: string;
  createdAt: number;
  lastActiveAt: number;
  status: "active" | "ended" | "revoked" | "expired";
  permissions: Permission[];
}

export function newPairingToken(expiryMs: number): PairingToken {
  const raw = crypto.randomBytes(24).toString("base64url");
  return {
    tokenId: crypto.randomUUID(),
    rawToken: raw,
    tokenHash: hash(raw),
    createdAt: Date.now(),
    expiresAt: Date.now() + expiryMs,
    usedAt: null,
    status: "active",
  };
}

export function newSessionToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hash(token) };
}

export function hash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
