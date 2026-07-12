import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clipboard, ExternalLink, Loader2,
  Play, RefreshCw, ServerCog, Share2, Shield, Square, Wrench, XCircle, Bot,
} from "lucide-react";
import {
  addProxyTarget,
  AuthError,
  createShareSession,
  fetchAttention,
  fetchOpsDoctor,
  fetchOpsPorts,
  fetchOpsService,
  listProcessJobs,
  listShareSessions,
  listTrustedDevices,
  AgentCard,
  OpsDoctor,
  OpsPort,
  OpsService,
  OpsShareRecord,
  ProcessJob,
  revokeShareSession,
  revokeTrustedDevice,
  startProcessJob,
  stopProcessJob,
  TrustedDeviceRecord,
  performOpsService,
} from "../lib/api";

interface Props {
  sessionToken: string;
  permissions?: string[] | null;
  onAuthFailed: () => void;
}

type Toast = { id: number; tone: "ok" | "error"; text: string };

export function OpsPanel({ sessionToken, permissions, onAuthFailed }: Props) {
  const canTerminal = hasPerm(permissions, "terminal");
  const canRead = hasPerm(permissions, "file:read");
  const canWrite = hasPerm(permissions, "file:write");

  const [doctor, setDoctor] = useState<OpsDoctor | null>(null);
  const [jobs, setJobs] = useState<ProcessJob[]>([]);
  const [ports, setPorts] = useState<OpsPort[]>([]);
  const [service, setService] = useState<OpsService | null>(null);
  const [shares, setShares] = useState<OpsShareRecord[]>([]);
  const [devices, setDevices] = useState<TrustedDeviceRecord[]>([]);
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [command, setCommand] = useState("npm run build");
  const [cwd, setCwd] = useState(".");
  const [label, setLabel] = useState("");
  const [shareScope, setShareScope] = useState<"full" | "files" | "terminal">("terminal");
  const [shareLabel, setShareLabel] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [streamState, setStreamState] = useState<"connecting" | "live" | "polling" | "off">("off");
  const logRefs = useRef<Map<string, HTMLPreElement>>(new Map());

  function toast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { ...t, id }]);
    window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 3200);
  }

  async function guarded<T>(fn: () => Promise<T>, fallback?: string): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AuthError) {
        onAuthFailed();
        return null;
      }
      setErr((e as Error).message || fallback || "Request failed");
      return null;
    }
  }

  async function refreshAll() {
    setErr(null);
    setBusy("refresh");
    const tasks: Promise<void>[] = [];
    if (canRead) {
      tasks.push(guarded(() => fetchOpsDoctor(sessionToken)).then((d) => { if (d) setDoctor(d); }));
      tasks.push(guarded(() => fetchOpsPorts(sessionToken)).then((p) => { if (p) setPorts(p.ports); }));
    }
    if (canTerminal) {
      tasks.push(guarded(() => fetchOpsService(sessionToken)).then((s) => { if (s) setService(s); }));
      tasks.push(guarded(() => listShareSessions(sessionToken)).then((s) => { if (s) setShares(s.shares); }));
      tasks.push(guarded(() => listTrustedDevices(sessionToken)).then((d) => { if (d) setDevices(d.devices); }));
      tasks.push(guarded(() => fetchAttention(sessionToken)).then((a) => { if (a) setAgents(a.agents); }));
      if (streamState !== "live") {
        tasks.push(guarded(() => listProcessJobs(sessionToken)).then((j) => { if (j) setJobs(j.jobs); }));
      }
    }
    await Promise.all(tasks);
    setBusy(null);
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, canRead, canTerminal]);

  // Real-time process log stream with HTTP polling fallback.
  useEffect(() => {
    if (!canTerminal) {
      setStreamState("off");
      return;
    }

    let closed = false;
    let ws: WebSocket | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    function startPolling() {
      if (closed) return;
      setStreamState("polling");
      const tick = async () => {
        const r = await guarded(() => listProcessJobs(sessionToken));
        if (r) setJobs(r.jobs);
      };
      void tick();
      pollTimer = window.setInterval(() => { void tick(); }, 2000);
    }

    function stopPolling() {
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function connect() {
      if (closed) return;
      setStreamState("connecting");
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws/processes?token=${encodeURIComponent(sessionToken)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        if (closed) return;
        attempt = 0;
        stopPolling();
        setStreamState("live");
      };

      ws.onmessage = (ev) => {
        let msg: { event?: string; payload?: any };
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (!msg?.event) return;

        if (msg.event === "processes:snapshot" && Array.isArray(msg.payload?.jobs)) {
          setJobs(msg.payload.jobs);
          return;
        }
        if (msg.event === "processes:started" && msg.payload?.job) {
          const job = msg.payload.job as ProcessJob;
          setJobs((cur) => [job, ...cur.filter((j) => j.id !== job.id)]);
          return;
        }
        if (msg.event === "processes:updated" && msg.payload?.job) {
          const job = msg.payload.job as ProcessJob;
          setJobs((cur) => cur.map((j) => (j.id === job.id ? { ...job, log: j.log || job.log } : j)));
          return;
        }
        if (msg.event === "processes:log" && msg.payload?.jobId) {
          const { jobId, chunk, truncated } = msg.payload as { jobId: string; chunk: string; truncated?: boolean };
          setJobs((cur) => cur.map((j) => {
            if (j.id !== jobId) return j;
            return {
              ...j,
              log: (j.log || "") + chunk,
              truncated: Boolean(truncated) || j.truncated,
            };
          }));
          requestAnimationFrame(() => {
            const el = logRefs.current.get(jobId);
            if (el) el.scrollTop = el.scrollHeight;
          });
          return;
        }
        if (msg.event === "error") {
          setErr(msg.payload?.message || "Process stream error");
        }
      };

      ws.onclose = () => {
        if (closed) return;
        ws = null;
        stopPolling();
        startPolling();
        const delay = Math.min(10_000, 1000 * (2 ** attempt));
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try { ws?.close(); } catch { /* ignore */ }
      };
    }

    connect();

    return () => {
      closed = true;
      stopPolling();
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* ignore */ }
      setStreamState("off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, canTerminal]);

  async function runJob() {
    if (!canTerminal) return;
    setBusy("job");
    const r = await guarded(() => startProcessJob(sessionToken, {
      command,
      cwd,
      label: label.trim() || undefined,
    }));
    if (r) {
      setJobs((cur) => [r.job, ...cur.filter((j) => j.id !== r.job.id)]);
      toast({ tone: "ok", text: "Process started." });
    }
    setBusy(null);
  }

  async function stopJob(id: string) {
    setBusy(`stop:${id}`);
    const r = await guarded(() => stopProcessJob(sessionToken, id));
    if (r) {
      setJobs((cur) => cur.map((j) => (j.id === id ? { ...r.job, log: j.log || r.job.log } : j)));
      toast({ tone: "ok", text: "Stop signal sent." });
    }
    setBusy(null);
  }

  async function share() {
    if (!canTerminal) return;
    setBusy("share");
    const r = await guarded(() => createShareSession(sessionToken, {
      scope: shareScope,
      label: shareLabel.trim() || undefined,
    }));
    if (r) {
      setShareUrl(r.url);
      toast({ tone: "ok", text: "Share session created." });
      try { await navigator.clipboard.writeText(r.url); } catch { /* ignore */ }
      const next = await guarded(() => listShareSessions(sessionToken));
      if (next) setShares(next.shares);
    }
    setBusy(null);
  }

  async function revokeShare(sessionId: string) {
    setBusy(`share-revoke:${sessionId}`);
    const r = await guarded(() => revokeShareSession(sessionToken, sessionId));
    if (r) {
      if (r.current) {
        onAuthFailed();
        return;
      }
      setShares((cur) => cur.filter((s) => s.sessionId !== sessionId));
      toast({ tone: "ok", text: "Share link revoked." });
    }
    setBusy(null);
  }

  async function revokeDevice(deviceId: string) {
    setBusy(`device-revoke:${deviceId}`);
    const r = await guarded(() => revokeTrustedDevice(sessionToken, deviceId));
    if (r) {
      setDevices((cur) => cur.map((d) => (d.deviceId === deviceId ? { ...d, active: false, revokedAt: r.device?.revokedAt || new Date().toISOString() } : d)));
      toast({ tone: "ok", text: "Trusted device revoked." });
    }
    setBusy(null);
  }

  async function exposePort(port: number) {
    if (!canWrite) return;
    setBusy(`port:${port}`);
    const r = await guarded(() => addProxyTarget(sessionToken, { port }));
    if (r) {
      toast({ tone: "ok", text: `Port ${port} exposed.` });
      const next = await guarded(() => fetchOpsPorts(sessionToken));
      if (next) setPorts(next.ports);
    }
    setBusy(null);
  }

  async function serviceAction(action: "install" | "uninstall", register: boolean) {
    if (!canTerminal) return;
    setBusy(`service:${action}`);
    const r = await guarded(() => performOpsService(sessionToken, { action, register }));
    if (r) {
      toast({ tone: "ok", text: action === "install" ? "Service unit written." : "Service removed." });
      const next = await guarded(() => fetchOpsService(sessionToken));
      if (next) setService(next);
    }
    setBusy(null);
  }

  const running = useMemo(() => jobs.filter((j) => j.status === "running").length, [jobs]);
  const activeDevices = useMemo(() => devices.filter((d) => d.active), [devices]);

  if (!canTerminal && !canRead) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted p-6">
        This session scope cannot access Ops tools.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto bg-bg">
      <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 space-y-4">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted">
              <Wrench className="w-4 h-4 text-accent" /> Ops
            </div>
            <h1 className="mt-1 text-xl font-semibold text-ink">Setup, process, share, ports, service</h1>
          </div>
          <button
            onClick={refreshAll}
            disabled={busy === "refresh"}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-line rounded text-xs text-muted hover:text-ink disabled:opacity-50"
          >
            {busy === "refresh" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </header>

        {err && (
          <div className="border border-danger/40 bg-danger/5 text-danger rounded-md px-3 py-2 text-sm">
            {err}
          </div>
        )}

        {canTerminal && agents.length > 0 && (
          <Panel title={`AI Agents · ${agents.length} running`} icon={<Bot className="w-4 h-4" />}>
            <div className="mb-2 text-xs text-muted">
              Manage chat &amp; approvals in the{" "}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => { window.location.hash = "/agents"; }}
              >
                Agents
              </button>{" "}
              tab.
            </div>
            <div className="space-y-2">
              {agents.map((a) => (
                <div key={a.jobId} className="flex items-start gap-3 border border-line rounded-md px-3 py-2">
                  <Bot className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-ink truncate">{a.agent}</span>
                      {a.attention && a.attention.kind !== "prompt" && (
                        <span className="text-[10px] uppercase tracking-wider text-warn border border-warn/40 rounded px-1">needs you</span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-muted truncate">{a.command}</div>
                    <div className="text-[11px] font-mono text-muted">{a.cwd} · {formatDuration(a.durationMs)}</div>
                    {a.attention && a.attention.kind !== "prompt" && (
                      <div className="mt-1 text-xs text-warn truncate">{a.attention.snippet}</div>
                    )}
                  </div>
                  {jobs.some((j) => j.id === a.jobId && j.status === "running") && (
                    <button onClick={() => stopJob(a.jobId)} className="shrink-0 text-xs border border-danger/40 text-danger rounded px-2 py-1">
                      Stop
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}

        <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
          {canRead ? (
            <Panel title="Setup Doctor" icon={<Wrench className="w-4 h-4" />}>
              {!doctor ? (
                <LoadingLine text="Checking host setup..." />
              ) : (
                <div className="space-y-2">
                  {doctor.checks.map((check) => (
                    <div key={check.id} className="flex items-start gap-3 border border-line rounded-md px-3 py-2">
                      <StatusIcon status={check.status} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink">{check.label}</div>
                        <div className="text-xs text-muted truncate">{check.detail}</div>
                        {check.fix && <div className="mt-1 text-xs text-warn">{check.fix}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          ) : (
            <Panel title="Setup Doctor" icon={<Wrench className="w-4 h-4" />}>
              <Empty text="Requires file:read permission." />
            </Panel>
          )}

          {canTerminal ? (
            <Panel title="Secure Share Session" icon={<Share2 className="w-4 h-4" />}>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1 rounded border border-line p-1">
                  {(["terminal", "files", "full"] as const).map((scope) => (
                    <button
                      key={scope}
                      onClick={() => setShareScope(scope)}
                      className={`px-2 py-1.5 rounded text-xs ${shareScope === scope ? "bg-accent text-bg" : "text-muted hover:text-ink"}`}
                    >
                      {scope}
                    </button>
                  ))}
                </div>
                <input
                  value={shareLabel}
                  onChange={(e) => setShareLabel(e.target.value)}
                  placeholder="Recipient label"
                  className="w-full bg-bg border border-line rounded px-2 py-2 text-sm"
                />
                <button
                  onClick={share}
                  disabled={busy === "share"}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-accent text-bg rounded text-sm font-medium disabled:opacity-50"
                >
                  {busy === "share" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  Create limited link
                </button>
                {shareUrl && (
                  <div className="border border-line rounded p-2">
                    <div className="font-mono text-[11px] text-muted break-all">{shareUrl}</div>
                    <button
                      onClick={() => { void navigator.clipboard.writeText(shareUrl); toast({ tone: "ok", text: "Copied." }); }}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-accent"
                    >
                      <Clipboard className="w-3 h-3" /> Copy link
                    </button>
                  </div>
                )}
                <div className="border-t border-line pt-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted font-mono">
                    Active shares · {shares.length}
                  </div>
                  {shares.length === 0 && <Empty text="No active share links." />}
                  {shares.map((s) => (
                    <div key={s.sessionId} className="flex items-start gap-2 border border-line rounded-md px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink truncate">{s.label}</div>
                        <div className="text-[11px] font-mono text-muted">
                          {s.scope} · {s.sessionId.slice(0, 8)} · {fmtTime(s.createdAt)}
                          {s.expiresAt ? ` · expires ${fmtTime(s.expiresAt)}` : ""}
                        </div>
                      </div>
                      <button
                        onClick={() => void revokeShare(s.sessionId)}
                        disabled={busy === `share-revoke:${s.sessionId}`}
                        className="shrink-0 text-xs border border-danger/40 text-danger rounded px-2 py-1 disabled:opacity-50"
                      >
                        {busy === `share-revoke:${s.sessionId}` ? <Loader2 className="w-3 h-3 animate-spin" /> : "Revoke"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Secure Share Session" icon={<Share2 className="w-4 h-4" />}>
              <Empty text="Requires terminal permission." />
            </Panel>
          )}
        </section>

        {canTerminal && (
          <section className="grid gap-3 xl:grid-cols-[1fr_1fr]">
            <Panel
              title={`Process Monitor${running ? ` · ${running} running` : ""}`}
              icon={<Activity className="w-4 h-4" />}
              badge={streamBadge(streamState)}
            >
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
                  <input value={command} onChange={(e) => setCommand(e.target.value)} className="bg-bg border border-line rounded px-2 py-2 text-sm font-mono" />
                  <input value={cwd} onChange={(e) => setCwd(e.target.value)} className="bg-bg border border-line rounded px-2 py-2 text-sm font-mono" />
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label" className="bg-bg border border-line rounded px-2 py-2 text-sm" />
                  <button onClick={runJob} disabled={busy === "job"} className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded bg-accent text-bg text-sm disabled:opacity-50">
                    {busy === "job" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Run
                  </button>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-auto">
                  {jobs.length === 0 && <Empty text="No monitored processes yet." />}
                  {jobs.map((job) => (
                    <div key={job.id} className="border border-line rounded-md overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                        <StatusDot status={job.status} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-mono text-ink truncate">{job.label || job.command}</div>
                          <div className="text-[11px] text-muted font-mono truncate">
                            {job.cwd} · {job.status}
                            {job.exitCode != null ? ` · exit ${job.exitCode}` : ""}
                            {job.signal ? ` · ${job.signal}` : ""}
                            {" · "}{formatDuration(job.durationMs)}
                            {job.truncated ? " · log truncated" : ""}
                          </div>
                        </div>
                        {job.status === "running" && (
                          <button onClick={() => stopJob(job.id)} className="inline-flex items-center gap-1 text-xs border border-line rounded px-2 py-1 text-danger">
                            <Square className="w-3 h-3" /> Stop
                          </button>
                        )}
                      </div>
                      {job.truncated && (
                        <div className="px-3 py-1 text-[10px] font-mono text-warn bg-warn/5 border-b border-line">
                          Log capped at ~192KB — older output was dropped.
                        </div>
                      )}
                      <pre
                        ref={(el) => {
                          if (el) logRefs.current.set(job.id, el);
                          else logRefs.current.delete(job.id);
                        }}
                        className="max-h-40 overflow-auto p-3 text-[11px] leading-relaxed bg-bg text-muted whitespace-pre-wrap"
                      >
                        {job.log || "Waiting for output..."}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <div className="space-y-3">
              {canRead && (
                <Panel title="Port Explorer" icon={<ExternalLink className="w-4 h-4" />}>
                  <div className="space-y-2">
                    {ports.length === 0 && <Empty text="No common dev ports are listening." />}
                    {ports.map((p) => (
                      <div key={p.port} className="flex items-center gap-3 border border-line rounded-md px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono text-ink">:{p.port} <span className="text-muted font-sans">{p.label}</span></div>
                          <div className="text-[11px] text-muted">{p.proxied ? "proxied" : p.allowed ? "ready to expose" : "not allowed"}</div>
                        </div>
                        {p.proxied ? (
                          <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent">
                            Open <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <button
                            onClick={() => exposePort(p.port)}
                            disabled={!canWrite || !p.allowed || busy === `port:${p.port}`}
                            title={!canWrite ? "Requires file:write" : undefined}
                            className="text-xs border border-line rounded px-2 py-1 text-muted hover:text-ink disabled:opacity-40"
                          >
                            Expose
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <Panel title="Service Installer" icon={<ServerCog className="w-4 h-4" />}>
                {!service ? <LoadingLine text="Loading service status..." /> : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Metric label="Installed" value={service.status.installed ? "yes" : "no"} good={service.status.installed} />
                      <Metric label="Active" value={service.status.active ? "yes" : "no"} good={service.status.active} />
                    </div>
                    <div className="text-[11px] text-muted font-mono break-all">{service.unitPath || service.platform}</div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => serviceAction("install", false)} className="text-xs border border-line rounded px-2 py-1 text-muted hover:text-ink">Write unit</button>
                      <button onClick={() => serviceAction("install", true)} className="text-xs border border-accent/50 rounded px-2 py-1 text-accent">Install + start</button>
                      <button onClick={() => serviceAction("uninstall", true)} className="text-xs border border-danger/40 rounded px-2 py-1 text-danger">Uninstall</button>
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title={`Trusted Devices · ${activeDevices.length} active`} icon={<Shield className="w-4 h-4" />}>
                <div className="space-y-2">
                  {devices.length === 0 && <Empty text="No trusted devices yet." />}
                  {devices.map((d) => (
                    <div key={d.deviceId} className="flex items-start gap-2 border border-line rounded-md px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-ink truncate">{d.name}</span>
                          <span className={`text-[10px] uppercase tracking-wider rounded px-1 border ${d.active ? "border-ok/40 text-ok" : "border-line text-muted"}`}>
                            {d.active ? "active" : "revoked"}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-muted">
                          {d.deviceId.slice(0, 8)}
                          {d.preset ? ` · ${d.preset}` : ""}
                          {" · "}last {fmtTime(d.lastUsedAt)}
                        </div>
                      </div>
                      {d.active && (
                        <button
                          onClick={() => void revokeDevice(d.deviceId)}
                          disabled={busy === `device-revoke:${d.deviceId}`}
                          className="shrink-0 text-xs border border-danger/40 text-danger rounded px-2 py-1 disabled:opacity-50"
                        >
                          {busy === `device-revoke:${d.deviceId}` ? <Loader2 className="w-3 h-3 animate-spin" /> : "Revoke"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </section>
        )}
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}

function hasPerm(permissions: string[] | null | undefined, perm: string): boolean {
  if (!permissions) return true;
  return permissions.includes(perm);
}

function streamBadge(state: "connecting" | "live" | "polling" | "off") {
  if (state === "live") return <span className="text-[10px] uppercase tracking-wider text-ok border border-ok/40 rounded px-1.5 py-0.5">live</span>;
  if (state === "polling") return <span className="text-[10px] uppercase tracking-wider text-warn border border-warn/40 rounded px-1.5 py-0.5">poll</span>;
  if (state === "connecting") return <span className="text-[10px] uppercase tracking-wider text-muted border border-line rounded px-1.5 py-0.5">connecting</span>;
  return null;
}

function Panel({ title, icon, children, badge }: { title: string; icon: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="border border-line bg-panel/50 rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted">
        <span className="text-accent">{icon}</span>
        <span className="flex-1">{title}</span>
        {badge}
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function StatusIcon({ status }: { status: "ok" | "warn" | "bad" }) {
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />;
  if (status === "bad") return <XCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />;
  return <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />;
}

function StatusDot({ status }: { status: ProcessJob["status"] }) {
  const cls = status === "running" ? "bg-ok" : status === "failed" ? "bg-danger" : status === "stopped" ? "bg-warn" : "bg-muted";
  return <span className={`w-2 h-2 rounded-full ${cls}`} />;
}

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="border border-line rounded px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-sm font-mono ${good ? "text-ok" : "text-warn"}`}>{value}</div>
    </div>
  );
}

function LoadingLine({ text }: { text: string }) {
  return <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin" /> {text}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted text-center py-6">{text}</div>;
}

function formatDuration(ms: number) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto text-xs rounded border px-3 py-2 max-w-xs shadow-lg ${
            t.tone === "ok" ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
