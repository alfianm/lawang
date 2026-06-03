import { useEffect, useState } from "react";
import { Cpu, Box, GitBranch, History, X, Loader2, RefreshCw, ShieldX, Users } from "lucide-react";
import {
  fetchActiveSessions, fetchEnvironment, fetchSessionHistory, revokeActiveSession,
  ActiveSessionRecord, EnvironmentResponse, SessionHistoryRecord, AuthError,
} from "../lib/api";

interface Props {
  sessionToken: string;
  currentSessionId?: string;
  onAuthFailed: () => void;
}

export function SessionMeta({ sessionToken, currentSessionId, onAuthFailed }: Props) {
  const [env, setEnv] = useState<EnvironmentResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ActiveSessionRecord[] | null>(null);
  const [history, setHistory] = useState<SessionHistoryRecord[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchEnvironment(sessionToken)
      .then((e) => { if (!cancelled) setEnv(e); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
      });
    return () => { cancelled = true; };
  }, [sessionToken]);

  async function loadSessions() {
    setOpen(true);
    setLoading(true);
    try {
      const [activeRes, historyRes] = await Promise.all([
        fetchActiveSessions(sessionToken),
        fetchSessionHistory(sessionToken, 50),
      ]);
      setActive(activeRes.sessions);
      setHistory(historyRes.records);
    } catch (err) {
      if (err instanceof AuthError) onAuthFailed();
      setActive([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-muted">
        {env && (
          <>
            <Badge icon={<Cpu className="w-3 h-3" />} label={`node ${env.runtime.node}`} />
            {env.project.packageManager && (
              <Badge icon={<Box className="w-3 h-3" />} label={env.project.packageManager} />
            )}
            {env.project.isGitRepo && (
              <Badge icon={<GitBranch className="w-3 h-3" />} label="git" />
            )}
          </>
        )}
        <button
          onClick={loadSessions}
          title="Sessions"
          className="inline-flex items-center gap-1 px-2 py-1 border border-line rounded text-muted hover:text-ink hover:border-accent/50"
        >
          <Users className="w-3.5 h-3.5" /> sessions
        </button>
      </div>

      {open && (
        <SessionsModal
          loading={loading}
          active={active}
          records={history}
          currentSessionId={currentSessionId}
          onRefresh={loadSessions}
          onRevoke={async (sessionId) => {
            try {
              const r = await revokeActiveSession(sessionToken, sessionId);
              if (r.current) {
                onAuthFailed();
                return;
              }
              await loadSessions();
            } catch (err) {
              if (err instanceof AuthError) onAuthFailed();
            }
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 border border-line rounded text-muted">
      {icon}<span>{label}</span>
    </span>
  );
}

function SessionsModal({
  loading, active, records, currentSessionId, onRefresh, onRevoke, onClose,
}: {
  loading: boolean;
  active: ActiveSessionRecord[] | null;
  records: SessionHistoryRecord[] | null;
  currentSessionId?: string;
  onRefresh: () => void;
  onRevoke: (sessionId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(sessionId: string) {
    setRevoking(sessionId);
    try {
      await onRevoke(sessionId);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line w-full max-w-2xl max-h-[80vh] flex flex-col rounded"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 text-sm">
            <Users className="w-4 h-4 text-accent" />
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Sessions</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onRefresh}
              className="text-muted hover:text-ink p-1"
              aria-label="Refresh sessions"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="text-muted hover:text-ink p-1"
              aria-label="Close sessions"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-6 flex items-center gap-2 text-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading sessions…
            </div>
          )}
          {!loading && active && (
            <section className="border-b border-line">
              <div className="px-4 py-2 text-[11px] uppercase tracking-wider text-muted font-mono bg-bg/40">
                Active sessions
              </div>
              {active.length === 0 ? (
                <div className="p-4 text-muted text-sm">No active sessions.</div>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {active.map((s) => (
                    <li key={s.sessionId} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <code className="font-mono text-xs text-accent">{s.sessionId.slice(0, 8)}</code>
                            <span className="truncate">{s.deviceName}</span>
                            {(s.current || s.sessionId === currentSessionId) && (
                              <span className="text-[10px] uppercase tracking-wider text-ok border border-ok/40 rounded px-1">current</span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted font-mono flex flex-wrap gap-x-3 gap-y-1">
                            <span>{s.deviceType}</span>
                            <span>last {fmt(s.lastActiveAt)}</span>
                            <span>{s.remoteAddr}</span>
                            <span>{scopeLabel(s.permissions)}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => void revoke(s.sessionId)}
                          disabled={revoking === s.sessionId}
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-60"
                          title={s.current ? "Revoke this browser session" : "Revoke session"}
                        >
                          {revoking === s.sessionId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldX className="w-3.5 h-3.5" />}
                          revoke
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {!loading && records && records.length === 0 && (
            <div className="p-6 text-muted text-sm">No past sessions yet.</div>
          )}
          {!loading && records && records.length > 0 && (
            <>
            <div className="px-4 py-2 text-[11px] uppercase tracking-wider text-muted font-mono bg-bg/40">
              History
            </div>
            <ul className="divide-y divide-line text-sm">
              {records.map((r) => (
                <li key={r.sessionId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <code className="font-mono text-xs text-accent">{r.sessionId.slice(0, 8)}</code>
                      <span className="truncate">{r.deviceName}</span>
                      {r.trusted && (
                        <span className="text-[10px] uppercase tracking-wider text-ok border border-ok/40 rounded px-1">trusted</span>
                      )}
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider rounded px-2 py-0.5 border ${tone(r)}`}>
                      {r.endedAt ? r.endReason ?? "ended" : "active"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted font-mono flex flex-wrap gap-x-3 gap-y-1">
                    <span>started {fmt(r.startedAt)}</span>
                    <span>ended {fmt(r.endedAt)}</span>
                    <span>· {duration(r)}</span>
                    {r.remoteAddr && <span>· {r.remoteAddr}</span>}
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function tone(r: SessionHistoryRecord): string {
  if (!r.endedAt) return "border-accent/40 text-accent";
  if (r.endReason === "revoked") return "border-warn/40 text-warn";
  if (r.endReason === "expired") return "border-warn/40 text-warn";
  return "border-line text-muted";
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function duration(r: SessionHistoryRecord): string {
  if (!r.endedAt) return "still open";
  const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hr}h${rem}m` : `${hr}h`;
}

function scopeLabel(perms: string[]): string {
  const set = new Set(perms);
  if (set.has("file:write") && set.has("git:write") && set.has("screen:control")) return "full";
  if (set.has("file:read") && !set.has("file:write")) return "read-only";
  if (set.has("terminal") && !set.has("file:read")) return "terminal";
  return "custom";
}
