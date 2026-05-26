import { useEffect, useMemo, useState } from "react";
import {
  ScrollText, Filter, Loader2, RefreshCw, AlertTriangle, Search, X,
} from "lucide-react";
import {
  AuditEvent, AuthError,
  fetchAuditLog, fetchAuditSummary,
} from "../lib/api";

const QUICK_FILTERS: { label: string; types: string[] }[] = [
  { label: "Pairing", types: ["pairing_requested", "pairing_approved", "pairing_rejected", "pairing_expired", "pairing_auto_approved", "trusted_device_added", "trusted_device_revoked"] },
  { label: "Sessions", types: ["session_started", "session_ended", "session_revoked", "session_expired", "terminal_resumed"] },
  { label: "Files", types: ["file_written", "file_uploaded", "file_deleted", "file_renamed", "dir_created"] },
  { label: "Git", types: ["git_commit", "git_pull", "git_push", "git_stage", "git_unstage"] },
  { label: "Proxy", types: ["proxy_added", "proxy_removed", "proxy_forwarded"] },
  { label: "Power", types: ["power_action"] },
  { label: "Security", types: ["auth_failed", "ws_rejected"] },
];

export function AuditPanel(props: { sessionToken: string; onAuthFailed: () => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const filterTypes = useMemo(() => {
    if (!activeFilter) return undefined;
    return QUICK_FILTERS.find((f) => f.label === activeFilter)?.types;
  }, [activeFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAuditLog(props.sessionToken, { limit: 500, types: filterTypes, search: search.trim() || undefined })
      .then((r) => { if (!cancelled) setEvents(r.events); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { props.onAuthFailed(); return; }
        setError((e as Error).message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.sessionToken, filterTypes, search, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    fetchAuditSummary(props.sessionToken)
      .then((r) => { if (!cancelled) setCounts(r.counts); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [props.sessionToken, refreshTick]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="max-w-sm rounded-md border border-line bg-panel p-4 text-sm">
          <div className="flex items-center gap-2 text-warn"><AlertTriangle className="w-4 h-4" /> Audit log unavailable</div>
          <div className="text-muted mt-2">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/60">
        <ScrollText className="w-4 h-4 text-accent" />
        <div className="text-sm font-mono">Audit log</div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search…"
            className="bg-bg border border-line rounded pl-7 pr-2 py-1 text-xs w-44"
          />
        </div>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          title="Refresh"
          className="inline-flex items-center justify-center w-8 h-8 text-muted hover:text-ink"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-line bg-panel/40 text-[11px]">
        <FilterChip label="All" active={activeFilter === null} onClick={() => setActiveFilter(null)} />
        {QUICK_FILTERS.map((f) => (
          <FilterChip
            key={f.label}
            label={f.label}
            active={activeFilter === f.label}
            count={counts ? sumCounts(counts, f.types) : undefined}
            onClick={() => setActiveFilter(activeFilter === f.label ? null : f.label)}
          />
        ))}
        {(activeFilter || search) && (
          <button
            onClick={() => { setActiveFilter(null); setSearch(""); }}
            className="ml-auto inline-flex items-center gap-1 text-muted hover:text-ink"
          >
            <X className="w-3 h-3" /> reset
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {events.length === 0 && !loading && (
          <div className="p-6 text-center text-xs text-muted">
            Tidak ada event yang cocok. Coba ubah filter atau kosongkan pencarian.
          </div>
        )}
        <ul className="divide-y divide-line text-xs font-mono">
          {events.map((ev) => (
            <li key={ev.eventId} className="px-3 py-2 hover:bg-panel/50">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${eventDot(ev.type)}`} />
                <span className="text-ink">{ev.type}</span>
                {ev.deviceName && (
                  <span className="text-muted">• {ev.deviceName}</span>
                )}
                <span className="ml-auto text-muted text-[11px]">
                  {new Date(ev.timestamp).toLocaleString()}
                </span>
              </div>
              {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                <pre className="mt-1 text-[11px] text-muted whitespace-pre-wrap break-words">
                  {JSON.stringify(ev.metadata)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FilterChip(props: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 border ${
        props.active ? "bg-accent text-bg border-accent" : "border-line text-muted hover:text-ink hover:border-accent/40"
      }`}
    >
      <Filter className="w-3 h-3" />
      <span>{props.label}</span>
      {props.count !== undefined && props.count > 0 && (
        <span className="text-[10px] opacity-80">{props.count}</span>
      )}
    </button>
  );
}

function sumCounts(counts: Record<string, number>, types: string[]): number {
  let total = 0;
  for (const t of types) total += counts[t] ?? 0;
  return total;
}

function eventDot(type: string): string {
  if (type.startsWith("auth_failed") || type.startsWith("ws_rejected")) return "bg-danger";
  if (type.startsWith("pairing_rejected") || type.startsWith("trusted_device_revoked")) return "bg-warn";
  if (type.startsWith("pairing_") || type.startsWith("trusted_device_")) return "bg-accent";
  if (type.startsWith("session_")) return "bg-ok";
  if (type.startsWith("git_")) return "bg-blue-400";
  if (type.startsWith("file_") || type.startsWith("dir_")) return "bg-yellow-400";
  if (type.startsWith("proxy_")) return "bg-purple-400";
  return "bg-muted";
}
