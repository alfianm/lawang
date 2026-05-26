import { promises as fs } from "node:fs";
import { auditLogPath } from "./config";
import { AuditEvent, AuditEventType } from "./audit";

export interface SessionRecord {
  sessionId: string;
  deviceName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: "ended" | "revoked" | "expired" | null;
  remoteAddr?: string;
  trusted?: boolean;
}

const END_TYPES: AuditEventType[] = ["session_ended", "session_revoked", "session_expired"];

export async function readEvents(limit = 5000): Promise<AuditEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(auditLogPath(), "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out: AuditEvent[] = [];
  // Iterate from the end so `limit` keeps the most recent events.
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      out.unshift(JSON.parse(lines[i]) as AuditEvent);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

export interface AuditQuery {
  limit?: number;
  types?: AuditEventType[];
  search?: string;
  since?: string;
}

export async function queryEvents(opts: AuditQuery = {}): Promise<AuditEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 5000);
  const events = await readEvents(5000);
  const types = opts.types && opts.types.length > 0 ? new Set<AuditEventType>(opts.types) : null;
  const search = opts.search?.trim().toLowerCase() || "";
  const sinceTs = opts.since ? Date.parse(opts.since) : NaN;

  const filtered: AuditEvent[] = [];
  // Walk newest-first by reversing in place (avoid duplicate sort cost).
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (types && !types.has(ev.type)) continue;
    if (Number.isFinite(sinceTs) && Date.parse(ev.timestamp) < sinceTs) continue;
    if (search) {
      const haystack = `${ev.type} ${ev.deviceName ?? ""} ${JSON.stringify(ev.metadata ?? {})}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }
    filtered.push(ev);
    if (filtered.length >= limit) break;
  }
  return filtered;
}

export async function eventTypeCounts(): Promise<Record<string, number>> {
  const events = await readEvents(5000);
  const counts: Record<string, number> = {};
  for (const ev of events) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
  return counts;
}

export async function readSessionHistory(limit = 50): Promise<SessionRecord[]> {
  // Walk events oldest -> newest, build a map keyed by sessionId, then sort
  // by startedAt desc and slice to `limit`.
  const events = await readEvents();
  const map = new Map<string, SessionRecord>();
  for (const ev of events) {
    const sid = (ev.metadata?.sessionId as string | undefined) ?? null;
    if (!sid) continue;
    if (ev.type === "session_started") {
      map.set(sid, {
        sessionId: sid,
        deviceName: ev.deviceName ?? "Unknown",
        startedAt: ev.timestamp,
        endedAt: null,
        endReason: null,
        remoteAddr: ev.metadata?.remoteAddr as string | undefined,
        trusted: Boolean(ev.metadata?.trusted),
      });
    } else if (END_TYPES.includes(ev.type)) {
      const rec = map.get(sid);
      if (rec && !rec.endedAt) {
        rec.endedAt = ev.timestamp;
        rec.endReason =
          ev.type === "session_revoked" ? "revoked" :
          ev.type === "session_expired" ? "expired" : "ended";
      }
    }
  }
  const list = [...map.values()].sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0
  );
  return list.slice(0, limit);
}

export function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "—";
  const d = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(d) || d < 0) return "—";
  const sec = Math.round(d / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hr}h${rem}m` : `${hr}h`;
}
