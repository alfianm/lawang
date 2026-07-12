import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Check, Loader2, Play, Plus, Send, Square, X, CornerDownLeft,
  AlertTriangle, RefreshCw,
} from "lucide-react";
import {
  AgentPreset,
  AgentSession,
  AuthError,
  agentAction,
  listAgents,
  replyToAgent,
  startAgent,
  stopAgent,
} from "../lib/api";
import { takeFocusAgentId } from "../lib/agentFocus";

interface Props {
  sessionToken: string;
  onAuthFailed: () => void;
  /** True while the Agents tab is visible — used to consume focus handoffs. */
  active?: boolean;
}

type StreamState = "connecting" | "live" | "polling" | "off";

const QUICK_REPLIES = ["y", "n", "yes", "no", "allow", "continue", "1", "2", "3"];

function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\r/g, "");
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function needsAttention(a: AgentSession): boolean {
  return Boolean(a.status === "running" && a.attention && a.attention.kind !== "prompt");
}

export function AgentsPanel({ sessionToken, onAuthFailed, active = true }: Props) {
  const [agents, setAgents] = useState<AgentSession[]>([]);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [customCommand, setCustomCommand] = useState("");
  const [cwd, setCwd] = useState(".");
  const [streamState, setStreamState] = useState<StreamState>("off");
  const logRef = useRef<HTMLPreElement>(null);
  const stickBottom = useRef(true);
  const userPicked = useRef(false);
  const lastAutoAttention = useRef<string | null>(null);

  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) || null,
    [agents, selectedId],
  );

  const attentionCount = useMemo(
    () => agents.filter(needsAttention).length,
    [agents],
  );

  async function guarded<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AuthError) {
        onAuthFailed();
        return null;
      }
      setErr((e as Error).message || "Request failed");
      return null;
    }
  }

  async function refresh() {
    const data = await guarded(() => listAgents(sessionToken));
    if (!data) return;
    setAgents(data.agents);
    setPresets(data.presets);
    setErr(null);
  }

  function selectAgent(id: string, opts?: { manual?: boolean }) {
    setSelectedId(id);
    if (opts?.manual) userPicked.current = true;
  }

  useEffect(() => {
    void refresh();
  }, [sessionToken]);

  // Consume Attention → Agents focus handoff whenever the tab becomes active.
  useEffect(() => {
    if (!active) return;
    const focused = takeFocusAgentId();
    if (focused) {
      userPicked.current = true;
      setSelectedId(focused);
    }
  }, [active]);

  // Prefer agents that need attention; otherwise keep a sensible selection.
  useEffect(() => {
    if (agents.length === 0) {
      setSelectedId(null);
      return;
    }

    const focusedStillThere = selectedId && agents.some((a) => a.id === selectedId);
    const needing = agents.filter(needsAttention);
    const topNeed = needing[0] || null;

    // Auto-jump when a *new* agent starts needing attention (unless user just picked).
    if (topNeed && topNeed.id !== lastAutoAttention.current) {
      lastAutoAttention.current = topNeed.id;
      if (!userPicked.current || !focusedStillThere || (selected && !needsAttention(selected))) {
        setSelectedId(topNeed.id);
        return;
      }
    }
    if (!topNeed) lastAutoAttention.current = null;

    if (!focusedStillThere) {
      setSelectedId((topNeed || agents[0])!.id);
      userPicked.current = false;
    }
  }, [agents, selectedId, selected]);

  // Live agent stream with HTTP polling fallback.
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    function upsert(agent: AgentSession) {
      setAgents((cur) => {
        const idx = cur.findIndex((a) => a.id === agent.id);
        if (idx < 0) return [agent, ...cur];
        const next = cur.slice();
        next[idx] = agent;
        return next;
      });
    }

    function appendLog(agentId: string, chunk: string, truncated: boolean) {
      setAgents((cur) => cur.map((a) => {
        if (a.id !== agentId) return a;
        return { ...a, log: a.log + chunk, truncated: a.truncated || truncated };
      }));
    }

    function startPoll() {
      setStreamState("polling");
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = window.setInterval(() => { void refresh(); }, 2500);
    }

    function connect() {
      if (closed) return;
      setStreamState("connecting");
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws/agents?token=${encodeURIComponent(sessionToken)}`;
      try {
        ws = new WebSocket(url);
      } catch {
        startPoll();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        setStreamState("live");
        if (pollTimer) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      };
      ws.onmessage = (ev) => {
        let msg: { event?: string; payload?: any };
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg.event === "agents:snapshot" && Array.isArray(msg.payload?.agents)) {
          setAgents(msg.payload.agents);
        }
        if (msg.event === "agents:started" && msg.payload?.agent) upsert(msg.payload.agent);
        if (msg.event === "agents:updated" && msg.payload?.agent) upsert(msg.payload.agent);
        if (msg.event === "agents:log" && msg.payload?.agentId) {
          appendLog(msg.payload.agentId, msg.payload.chunk || "", Boolean(msg.payload.truncated));
        }
        if (msg.event === "agents:reply" && msg.payload?.agentId && msg.payload?.reply) {
          setAgents((cur) => cur.map((a) => {
            if (a.id !== msg.payload.agentId) return a;
            if (a.replies.some((r) => r.id === msg.payload.reply.id)) return a;
            return { ...a, replies: [...a.replies, msg.payload.reply] };
          }));
        }
      };
      ws.onclose = () => {
        if (closed) return;
        attempt += 1;
        if (attempt >= 3) {
          startPoll();
          return;
        }
        setStreamState("connecting");
        reconnectTimer = window.setTimeout(connect, Math.min(4000, 600 * attempt));
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* ignore */ }
      };
    }

    connect();
    void listAgents(sessionToken).then((d) => setPresets(d.presets)).catch(() => undefined);

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      try { ws?.close(); } catch { /* ignore */ }
      setStreamState("off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  useEffect(() => {
    if (!stickBottom.current || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [selected?.log, selected?.id]);

  async function onStartPreset(preset: AgentPreset) {
    setBusy(`start:${preset.id}`);
    setErr(null);
    const res = await guarded(() => startAgent(sessionToken, {
      presetId: preset.id,
      cwd: cwd.trim() || ".",
    }));
    setBusy(null);
    if (res?.agent) {
      userPicked.current = true;
      setAgents((cur) => [res.agent, ...cur.filter((a) => a.id !== res.agent.id)]);
      setSelectedId(res.agent.id);
      setShowStart(false);
    }
  }

  async function onStartCustom() {
    const command = customCommand.trim();
    if (!command) return;
    setBusy("start:custom");
    setErr(null);
    const res = await guarded(() => startAgent(sessionToken, {
      command,
      cwd: cwd.trim() || ".",
      label: command.split(/\s+/)[0],
    }));
    setBusy(null);
    if (res?.agent) {
      userPicked.current = true;
      setAgents((cur) => [res.agent, ...cur.filter((a) => a.id !== res.agent.id)]);
      setSelectedId(res.agent.id);
      setShowStart(false);
      setCustomCommand("");
    }
  }

  async function onReply(textOverride?: string) {
    if (!selected || selected.status !== "running") return;
    const text = (textOverride ?? reply).trim();
    if (!text) return;
    setBusy("reply");
    const res = await guarded(() => replyToAgent(sessionToken, selected.id, text));
    setBusy(null);
    if (res?.agent) {
      if (!textOverride) setReply("");
      upsertLocal(res.agent);
    }
  }

  async function onAction(action: "approve" | "reject" | "enter") {
    if (!selected || selected.status !== "running") return;
    setBusy(`action:${action}`);
    const res = await guarded(() => agentAction(sessionToken, selected.id, action));
    setBusy(null);
    if (res?.agent) upsertLocal(res.agent);
  }

  async function onStop() {
    if (!selected || selected.status !== "running") return;
    setBusy("stop");
    const res = await guarded(() => stopAgent(sessionToken, selected.id));
    setBusy(null);
    if (res?.agent) upsertLocal(res.agent);
  }

  function upsertLocal(agent: AgentSession) {
    setAgents((cur) => {
      const idx = cur.findIndex((a) => a.id === agent.id);
      if (idx < 0) return [agent, ...cur];
      const next = cur.slice();
      next[idx] = agent;
      return next;
    });
  }

  const needsYou = selected ? needsAttention(selected) : false;
  const installedPresets = presets.filter((p) => p.installed);
  const missingPresets = presets.filter((p) => !p.installed);

  return (
    <div className="h-full min-h-0 flex flex-col md:flex-row">
      <aside className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-line bg-panel/40 flex flex-col max-h-[40vh] md:max-h-none">
        <div className="px-3 py-2.5 border-b border-line flex items-center gap-2">
          <Bot className="w-4 h-4 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ink font-medium">Agents</div>
            <div className="text-[11px] font-mono text-muted">
              {agents.filter((a) => a.status === "running").length} running
              {attentionCount > 0 ? ` · ${attentionCount} need you` : ""}
              {" · "}{streamLabel(streamState)}
            </div>
          </div>
          <button
            onClick={() => void refresh()}
            className="p-1.5 rounded border border-line text-muted hover:text-ink"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowStart(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-accent/40 text-accent text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> Start
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-line">
          {agents.length === 0 && (
            <div className="p-4 text-sm text-muted">
              Belum ada agent. Tekan <span className="text-ink">Start</span> untuk menjalankan Claude, Codex, Cursor Agent, dll.
            </div>
          )}
          {agents.map((a) => {
            const isActive = selected?.id === a.id;
            const attention = needsAttention(a);
            return (
              <button
                key={a.id}
                onClick={() => selectAgent(a.id, { manual: true })}
                className={`w-full text-left px-3 py-2.5 hover:bg-bg/50 ${isActive ? "bg-bg/60" : ""}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot status={a.status} attention={attention} />
                  <span className="text-sm text-ink truncate">{a.label || a.agent}</span>
                  {attention && (
                    <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-warn border border-warn/40 rounded px-1">
                      needs you
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] font-mono text-muted truncate">{a.command}</div>
                <div className="text-[11px] font-mono text-muted">{a.cwd} · {formatDuration(a.durationMs)}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        {!selected ? (
          <EmptyState onStart={() => setShowStart(true)} installedCount={installedPresets.length} />
        ) : (
          <>
            <header className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-line flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Bot className="w-4 h-4 text-accent shrink-0" />
                  <h2 className="text-sm sm:text-base text-ink font-medium truncate">{selected.label}</h2>
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusTone(selected.status)}`}>
                    {selected.status}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-muted truncate">{selected.command} · {selected.cwd}</div>
              </div>
              {selected.status === "running" && (
                <button
                  onClick={() => void onStop()}
                  disabled={busy === "stop"}
                  className="inline-flex items-center gap-1 text-xs border border-danger/40 text-danger rounded px-2 py-1"
                >
                  <Square className="w-3.5 h-3.5" /> Stop
                </button>
              )}
            </header>

            {needsYou && selected.attention && (
              <div className="shrink-0 mx-3 sm:mx-4 mt-3 border border-warn/40 bg-warn/10 rounded-md px-3 py-2 flex flex-wrap items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{selected.attention.label}</div>
                  <div className="text-xs font-mono text-muted line-clamp-2">{selected.attention.snippet}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void onAction("approve")}
                    disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-ok/20 text-ok border border-ok/40"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => void onAction("reject")}
                    disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-danger/40 text-danger"
                  >
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            )}

            <pre
              ref={logRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
              className="flex-1 min-h-0 overflow-auto px-3 sm:px-4 py-3 text-[12px] leading-relaxed font-mono text-ink/90 whitespace-pre-wrap break-words"
            >
              {selected.truncated && <span className="text-muted">…log truncated…{"\n"}</span>}
              {stripAnsi(selected.log) || <span className="text-muted">Waiting for agent output…</span>}
            </pre>

            {selected.replies.length > 0 && (
              <div className="shrink-0 px-3 sm:px-4 pb-2 flex flex-wrap gap-1.5">
                {selected.replies.slice(-6).map((r) => (
                  <span
                    key={r.id}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-line text-muted"
                    title={r.at}
                  >
                    you · {r.kind}: {r.text.slice(0, 40)}
                  </span>
                ))}
              </div>
            )}

            <footer className="shrink-0 border-t border-line p-2 sm:p-3 space-y-2">
              {selected.status === "running" ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <QuickBtn label="Yes" onClick={() => void onAction("approve")} disabled={Boolean(busy)} />
                    <QuickBtn label="No" onClick={() => void onAction("reject")} disabled={Boolean(busy)} />
                    <QuickBtn
                      label="Enter"
                      icon={<CornerDownLeft className="w-3 h-3" />}
                      onClick={() => void onAction("enter")}
                      disabled={Boolean(busy)}
                    />
                    {QUICK_REPLIES.map((q) => (
                      <QuickBtn
                        key={q}
                        label={q}
                        onClick={() => void onReply(q)}
                        disabled={Boolean(busy)}
                      />
                    ))}
                  </div>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void onReply();
                    }}
                  >
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void onReply();
                        }
                      }}
                      rows={2}
                      placeholder="Balas agent… (Enter kirim, Shift+Enter baris baru)"
                      className="flex-1 min-w-0 resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent/50"
                    />
                    <button
                      type="submit"
                      disabled={!reply.trim() || busy === "reply"}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent text-bg text-sm disabled:opacity-40"
                    >
                      {busy === "reply" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Send
                    </button>
                  </form>
                </>
              ) : (
                <div className="text-sm text-muted px-1">
                  Agent sudah berhenti{selected.exitCode != null ? ` (exit ${selected.exitCode})` : ""}.
                  Start agent baru dari sidebar.
                </div>
              )}
              {err && <div className="text-xs text-danger">{err}</div>}
            </footer>
          </>
        )}
      </section>

      {showStart && (
        <StartModal
          installed={installedPresets}
          missing={missingPresets}
          cwd={cwd}
          setCwd={setCwd}
          customCommand={customCommand}
          setCustomCommand={setCustomCommand}
          busy={busy}
          err={err}
          onClose={() => setShowStart(false)}
          onPreset={(p) => void onStartPreset(p)}
          onCustom={() => void onStartCustom()}
        />
      )}
    </div>
  );
}

function streamLabel(s: StreamState): string {
  if (s === "live") return "live";
  if (s === "polling") return "polling";
  if (s === "connecting") return "connecting";
  return "idle";
}

function statusTone(status: AgentSession["status"]): string {
  if (status === "running") return "border-ok/40 text-ok";
  if (status === "failed") return "border-danger/40 text-danger";
  if (status === "stopped") return "border-warn/40 text-warn";
  return "border-line text-muted";
}

function StatusDot({ status, attention }: { status: AgentSession["status"]; attention: boolean }) {
  const color = attention
    ? "bg-warn"
    : status === "running"
      ? "bg-ok"
      : status === "failed"
        ? "bg-danger"
        : "bg-muted";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color} ${status === "running" ? "animate-pulse" : ""}`} />;
}

function QuickBtn({
  label, onClick, disabled, icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-line text-muted hover:text-ink disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ onStart, installedCount }: { onStart: () => void; installedCount: number }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <Bot className="w-10 h-10 text-accent/70" />
      <div>
        <h2 className="text-lg text-ink font-medium">Agent Hub</h2>
        <p className="mt-1 text-sm text-muted max-w-sm">
          Jalankan coding agent di host, lalu approve / balas dari browser — tanpa CLI dan tanpa remote desktop.
        </p>
        <p className="mt-2 text-xs font-mono text-muted">
          {installedCount > 0
            ? `${installedCount} agent CLI terdeteksi di host`
            : "Belum ada agent CLI terdeteksi — install claude/codex/agent, atau pakai custom command"}
        </p>
      </div>
      <button
        onClick={onStart}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent text-bg text-sm"
      >
        <Play className="w-4 h-4" /> Start an agent
      </button>
    </div>
  );
}

function StartModal({
  installed, missing, cwd, setCwd, customCommand, setCustomCommand, busy, err, onClose, onPreset, onCustom,
}: {
  installed: AgentPreset[];
  missing: AgentPreset[];
  cwd: string;
  setCwd: (v: string) => void;
  customCommand: string;
  setCustomCommand: (v: string) => void;
  busy: string | null;
  err: string | null;
  onClose: () => void;
  onPreset: (p: AgentPreset) => void;
  onCustom: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-xl sm:rounded-xl border border-line bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <Bot className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-ink flex-1">Start agent</h3>
          <button onClick={onClose} className="p-1 text-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          {err && (
            <div className="border border-danger/40 bg-danger/5 text-danger rounded-md px-3 py-2 text-xs whitespace-pre-wrap font-mono">
              {err}
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-muted">Working directory</span>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm font-mono text-ink"
              placeholder="."
            />
          </label>

          {installed.length > 0 && (
            <PresetGrid
              title="Installed on this host"
              presets={installed}
              busy={busy}
              onPreset={onPreset}
              showInstalled
            />
          )}

          {missing.length > 0 && (
            <PresetGrid
              title={installed.length > 0 ? "Not on PATH" : "Presets"}
              presets={missing}
              busy={busy}
              onPreset={onPreset}
              muted
            />
          )}

          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted">Custom command</div>
            <div className="flex gap-2">
              <input
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCustom();
                }}
                className="flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm font-mono text-ink"
                placeholder="claude | codex | agent …"
              />
              <button
                onClick={onCustom}
                disabled={!customCommand.trim() || Boolean(busy)}
                className="px-3 py-2 rounded-md bg-accent text-bg text-sm disabled:opacity-40"
              >
                {busy === "start:custom" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetGrid({
  title, presets, busy, onPreset, showInstalled, muted,
}: {
  title: string;
  presets: AgentPreset[];
  busy: string | null;
  onPreset: (p: AgentPreset) => void;
  showInstalled?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{title}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => onPreset(p)}
            disabled={Boolean(busy)}
            className={`text-left border rounded-md px-3 py-2 disabled:opacity-40 ${
              muted
                ? "border-line/70 opacity-80 hover:opacity-100 hover:border-line"
                : "border-line hover:border-accent/50"
            }`}
          >
            <div className="text-sm text-ink flex items-center gap-1.5">
              {busy === `start:${p.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-accent" />}
              <span className="truncate">{p.label}</span>
              {showInstalled && (
                <span className="ml-auto text-[10px] uppercase tracking-wider text-ok border border-ok/40 rounded px-1">
                  ready
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted mt-0.5 line-clamp-2">{p.description}</div>
            <div className="text-[11px] font-mono text-muted mt-1">{p.command}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
