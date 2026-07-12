import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Bell, Terminal as TerminalIcon, Activity, X } from "lucide-react";
import { AttentionItem, AttentionResponse, AuthError, AgentCard, fetchAttention } from "../lib/api";
import { setFocusAgentId } from "../lib/agentFocus";
import type { Tab } from "../lib/router";

interface Props {
  sessionToken: string;
  onAuthFailed: () => void;
  onGoTo?: (tab: Tab) => void;
  /** Compact header badge mode */
  compact?: boolean;
}

export function AttentionIndicator({ sessionToken, onAuthFailed, onGoTo, compact }: Props) {
  const [data, setData] = useState<AttentionResponse | null>(null);
  const [open, setOpen] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const next = await fetchAttention(sessionToken);
        if (cancelled) return;
        setData(next);
        for (const item of next.items) {
          if (knownIds.current.has(item.id)) continue;
          knownIds.current.add(item.id);
          if (notified.current.has(item.id)) continue;
          if (item.kind === "prompt") continue;
          notified.current.add(item.id);
          void maybeNotify(item);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
      }
    }
    void tick();
    const timer = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionToken]);

  const count = data?.counts.attention ?? 0;
  const agents = data?.agents ?? [];
  const items = data?.items || [];

  function navigate(tab: Tab, agentId?: string | null) {
    if (tab === "agents" && agentId) setFocusAgentId(agentId);
    onGoTo?.(tab);
  }

  return (
    <>
      {compact ? (
        (count > 0 || agents.length > 0) && (
          <button
            onClick={() => setOpen(true)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] uppercase tracking-wide ${
              count > 0
                ? "border-warn/50 text-warn bg-warn/10"
                : "border-line text-muted hover:text-ink"
            }`}
            title={count > 0 ? `${count} item(s) need attention` : `${agents.length} agent(s) running`}
          >
            {count > 0 ? <Bell className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
            {count > 0 ? `attention ${count}` : `agents ${agents.length}`}
          </button>
        )
      ) : (
        (items.length > 0 || agents.length > 0) && (
          <AttentionPanel
            items={items}
            agents={agents}
            onNavigate={navigate}
            onOpenList={() => setOpen(true)}
          />
        )
      )}

      {open && (
        <AttentionModal
          items={items}
          agents={agents}
          onClose={() => setOpen(false)}
          onNavigate={(tab, agentId) => {
            setOpen(false);
            navigate(tab, agentId);
          }}
        />
      )}
    </>
  );
}

function attentionNav(item: AttentionItem): { tab: Tab; agentId?: string } {
  if (item.source === "agent") return { tab: "agents", agentId: item.agentId };
  if (item.source === "process") {
    if (item.agent) return { tab: "agents", agentId: item.jobId };
    return { tab: "ops" };
  }
  return { tab: "terminal" };
}

function agentCardNav(a: AgentCard): { tab: Tab; agentId?: string } {
  return { tab: "agents", agentId: a.agentId || a.jobId };
}

function AttentionPanel({
  items, agents, onNavigate, onOpenList,
}: {
  items: AttentionItem[];
  agents: AgentCard[];
  onNavigate: (tab: Tab, agentId?: string | null) => void;
  onOpenList: () => void;
}) {
  return (
    <section className="border border-line bg-panel/50 rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted">
        <Bell className="w-4 h-4 text-warn" />
        <span className="flex-1">Needs attention</span>
        <button onClick={onOpenList} className="text-accent hover:underline normal-case tracking-normal">
          View all
        </button>
      </div>
      <ul className="divide-y divide-line">
        {items.slice(0, 3).map((item) => {
          const nav = attentionNav(item);
          return (
            <li key={item.id} className="px-4 py-3">
              <button
                className="w-full text-left"
                onClick={() => onNavigate(nav.tab, nav.agentId)}
              >
                <div className="flex items-center gap-2 text-sm text-ink">
                  {item.source === "terminal" ? (
                    <TerminalIcon className="w-3.5 h-3.5 text-warn" />
                  ) : item.source === "agent" ? (
                    <Bot className="w-3.5 h-3.5 text-warn" />
                  ) : (
                    <Activity className="w-3.5 h-3.5 text-warn" />
                  )}
                  <span className="truncate">{item.label}</span>
                </div>
                <div className="mt-1 text-xs font-mono text-muted truncate">{item.snippet}</div>
              </button>
            </li>
          );
        })}
        {items.length === 0 && agents.slice(0, 2).map((a) => {
          const nav = agentCardNav(a);
          return (
            <li key={a.jobId} className="px-4 py-3">
              <button className="w-full text-left" onClick={() => onNavigate(nav.tab, nav.agentId)}>
                <div className="flex items-center gap-2 text-sm text-ink">
                  <Bot className="w-3.5 h-3.5 text-accent" />
                  <span className="truncate">{a.agent} · {a.command}</span>
                </div>
                <div className="mt-1 text-xs font-mono text-muted truncate">{a.cwd} · running</div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AttentionModal({
  items, agents, onClose, onNavigate,
}: {
  items: AttentionItem[];
  agents: AgentCard[];
  onClose: () => void;
  onNavigate: (tab: Tab, agentId?: string | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-panel border border-line w-full max-w-lg max-h-[75vh] flex flex-col rounded" onClick={(e) => e.stopPropagation()}>
        <header className="px-4 py-3 border-b border-line flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-warn" />
          <span className="text-xs font-mono uppercase tracking-wider text-muted flex-1">Attention</span>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="flex-1 overflow-auto">
          {items.length === 0 && agents.length === 0 && (
            <div className="p-6 text-sm text-muted text-center">Nothing needs attention right now.</div>
          )}
          {items.length > 0 && (
            <section>
              <div className="px-4 py-2 text-[11px] uppercase tracking-wider text-muted font-mono bg-bg/40">Alerts</div>
              <ul className="divide-y divide-line">
                {items.map((item) => {
                  const nav = attentionNav(item);
                  return (
                    <li key={item.id}>
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-bg/40"
                        onClick={() => onNavigate(nav.tab, nav.agentId)}
                      >
                        <div className="text-sm text-ink">{item.label}</div>
                        <div className="mt-1 text-xs font-mono text-muted line-clamp-2">{item.snippet}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {agents.length > 0 && (
            <section>
              <div className="px-4 py-2 text-[11px] uppercase tracking-wider text-muted font-mono bg-bg/40">Running agents</div>
              <ul className="divide-y divide-line">
                {agents.map((a) => {
                  const nav = agentCardNav(a);
                  return (
                    <li key={a.jobId}>
                      <button className="w-full text-left px-4 py-3 hover:bg-bg/40" onClick={() => onNavigate(nav.tab, nav.agentId)}>
                        <div className="flex items-center gap-2 text-sm text-ink">
                          <Bot className="w-3.5 h-3.5 text-accent" />
                          {a.agent}
                          {a.attention && a.attention.kind !== "prompt" && (
                            <span className="text-[10px] uppercase tracking-wider text-warn border border-warn/40 rounded px-1">needs you</span>
                          )}
                        </div>
                        <div className="mt-1 text-xs font-mono text-muted truncate">{a.command}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

async function maybeNotify(item: AttentionItem) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") return;
    new Notification(`Lawang · ${item.label}`, {
      body: item.snippet.slice(0, 120),
      tag: item.id,
    });
  } catch {
    /* ignore */
  }
}
