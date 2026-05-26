import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { auditLogPath } from "./config";

export type AuditEventType =
  | "agent_started"
  | "agent_stopped"
  | "pairing_requested"
  | "pairing_approved"
  | "pairing_rejected"
  | "pairing_expired"
  | "pairing_auto_approved"
  | "trusted_device_added"
  | "trusted_device_revoked"
  | "session_started"
  | "session_ended"
  | "session_revoked"
  | "session_expired"
  | "ws_rejected"
  | "auth_failed"
  | "file_written"
  | "file_uploaded"
  | "file_deleted"
  | "file_renamed"
  | "dir_created"
  | "git_commit"
  | "git_pull"
  | "git_push"
  | "git_stage"
  | "git_unstage"
  | "chat_exec"
  | "power_action"
  | "proxy_added"
  | "proxy_removed"
  | "proxy_forwarded"
  | "terminal_resumed";

export interface AuditEvent {
  eventId: string;
  type: AuditEventType;
  timestamp: string;
  deviceName?: string;
  metadata?: Record<string, unknown>;
}

let inflight: Promise<void> = Promise.resolve();

export function recordEvent(type: AuditEventType, payload: Omit<AuditEvent, "eventId" | "type" | "timestamp"> = {}) {
  const event: AuditEvent = {
    eventId: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  inflight = inflight
    .catch(() => undefined)
    .then(() => fs.appendFile(auditLogPath(), JSON.stringify(event) + "\n", { mode: 0o600 }));
  return event;
}

export async function flushAudit() {
  await inflight.catch(() => undefined);
}
