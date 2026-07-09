import { useEffect, useState } from "react";
import {
  Activity, BatteryCharging, Clock, FolderOpen, GitBranch, Globe, Monitor,
  Power, ScrollText, Server, ShieldAlert, Terminal as TerminalIcon, Users, Wrench, Wifi,
} from "lucide-react";
import {
  ActiveSessionRecord,
  AuthError,
  BatteryInfo,
  DesktopCapabilities,
  EnvironmentResponse,
  PowerCapabilities,
  SessionInfoResponse,
  fetchActiveSessions,
  fetchBattery,
  fetchDesktopCapabilities,
  fetchEnvironment,
  fetchPowerCapabilities,
} from "../lib/api";
import { AttentionIndicator } from "./AttentionIndicator";
import type { Tab } from "../lib/router";

interface Props {
  sessionToken: string;
  info: SessionInfoResponse | null;
  onGoTo: (tab: Tab) => void;
  onAuthFailed: () => void;
}

export function OverviewPanel({ sessionToken, info, onGoTo, onAuthFailed }: Props) {
  const [env, setEnv] = useState<EnvironmentResponse | null>(null);
  const [sessions, setSessions] = useState<ActiveSessionRecord[]>([]);
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [desktop, setDesktop] = useState<DesktopCapabilities | null>(null);
  const [power, setPower] = useState<PowerCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const canViewDesktop = info?.permissions?.includes("screen:view") ?? true;
        const settled = await Promise.allSettled([
          fetchEnvironment(sessionToken),
          fetchActiveSessions(sessionToken),
          fetchBattery(sessionToken),
          canViewDesktop ? fetchDesktopCapabilities(sessionToken) : Promise.resolve(null),
          fetchPowerCapabilities(sessionToken),
        ]);
        if (cancelled) return;
        const [envRes, sessionsRes, batteryRes, desktopRes, powerRes] = settled;
        if (envRes.status === "fulfilled") setEnv(envRes.value);
        if (sessionsRes.status === "fulfilled") setSessions(sessionsRes.value.sessions);
        if (batteryRes.status === "fulfilled") setBattery(batteryRes.value);
        if (desktopRes.status === "fulfilled") setDesktop(desktopRes.value);
        if (powerRes.status === "fulfilled") setPower(powerRes.value);
        const authFailure = settled.some((r) => r.status === "rejected" && r.reason instanceof AuthError);
        if (authFailure) onAuthFailed();
        else setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
        else setError((err as Error).message);
      }
    }
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionToken, info?.permissions]);

  const perms = info?.permissions || [];

  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 space-y-4">
        <section className="grid gap-3 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="border border-line bg-panel/50 rounded-md p-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted">
                  <Server className="w-4 h-4 text-accent" />
                  Host
                </div>
                <h1 className="mt-2 text-xl sm:text-2xl font-semibold text-ink truncate">
                  {info?.machineName || env?.machine.hostname || "host"}
                </h1>
                <p className="mt-1 text-sm text-muted font-mono truncate">
                  {info?.rootPath || env?.project.rootPath || "..."}
                </p>
              </div>
              <ModeBadge info={info} />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={<TerminalIcon className="w-4 h-4" />} label="Node" value={env?.runtime.node || "..."} />
              <Metric icon={<GitBranch className="w-4 h-4" />} label="Git" value={env?.project.isGitRepo ? "repo" : "none"} />
              <Metric icon={<Users className="w-4 h-4" />} label="Sessions" value={String(sessions.length || 0)} />
              <Metric icon={<Clock className="w-4 h-4" />} label="Started" value={info ? shortTime(info.createdAt) : "..."} />
            </div>
          </div>

          <div className="border border-line bg-panel/50 rounded-md p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-muted">Permissions</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {["terminal", "file:read", "file:write", "git:read", "git:write", "screen:view", "screen:control"].map((p) => (
                <span
                  key={p}
                  className={`text-[11px] font-mono px-2 py-1 rounded border ${
                    perms.includes(p) ? "border-ok/40 text-ok bg-ok/5" : "border-line text-muted"
                  }`}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </section>

        {error && (
          <div className="border border-danger/40 bg-danger/5 text-danger rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatusTile
            icon={<Wifi className="w-4 h-4" />}
            title="Reachability"
            value={reachLabel(info)}
            tone={info?.reachability?.mode === "tunnel" ? "ok" : info?.reachability?.mode === "lan" ? "ok" : "muted"}
          />
          <StatusTile
            icon={<BatteryCharging className="w-4 h-4" />}
            title="Battery"
            value={batteryLabel(battery)}
            tone={battery?.charging || battery?.acConnected ? "ok" : "muted"}
          />
          <StatusTile
            icon={<Monitor className="w-4 h-4" />}
            title="Desktop"
            value={desktop?.view.supported ? (desktop.control.supported ? "view + control" : "view only") : "unavailable"}
            tone={desktop?.view.supported ? "ok" : "muted"}
          />
          <StatusTile
            icon={<Power className="w-4 h-4" />}
            title="Host Power"
            value={power && Object.values(power).some((p) => p.supported) ? "available" : "unavailable"}
            tone={power && Object.values(power).some((p) => p.supported) ? "ok" : "muted"}
          />
          <StatusTile
            icon={<Activity className="w-4 h-4" />}
            title="Project"
            value={env?.project.name || env?.project.packageManager || "workspace"}
            tone="muted"
          />
        </section>

        {info?.reachability && (
          <section className="border border-line bg-panel/50 rounded-md px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm">
              <div className="text-xs font-mono uppercase tracking-wider text-muted shrink-0">Access URLs</div>
              <div className="min-w-0 flex-1 space-y-1 font-mono text-xs text-muted">
                {info.reachability.tunnelUrl && (
                  <div className="truncate"><span className="text-ok">tunnel</span> · {info.reachability.tunnelUrl}</div>
                )}
                {info.reachability.lanUrl && (
                  <div className="truncate"><span className="text-accent">lan</span> · {info.reachability.lanUrl}</div>
                )}
                <div className="truncate"><span className="text-muted">local</span> · {info.reachability.localUrl}</div>
              </div>
              {!info.reachability.tunnelUrl && (
                <div className="text-xs text-warn shrink-0">
                  No public tunnel — use LAN or install cloudflared / Tailscale.
                </div>
              )}
            </div>
          </section>
        )}

        <AttentionIndicator
          sessionToken={sessionToken}
          onAuthFailed={onAuthFailed}
          onGoTo={onGoTo}
        />

        <section>
          <div className="mb-2 text-xs font-mono uppercase tracking-wider text-muted">Quick actions</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction icon={<TerminalIcon className="w-4 h-4" />} title="Terminal" detail="Shell session" onClick={() => onGoTo("terminal")} />
            {perms.includes("file:read") && <QuickAction icon={<FolderOpen className="w-4 h-4" />} title="Files" detail={perms.includes("file:write") ? "Browse and edit" : "Browse (read-only)"} onClick={() => onGoTo("files")} />}
            {perms.includes("git:read") && <QuickAction icon={<GitBranch className="w-4 h-4" />} title="Git" detail={perms.includes("git:write") ? "Status and commit" : "Status (read-only)"} onClick={() => onGoTo("git")} />}
            {perms.includes("screen:view") && <QuickAction icon={<Monitor className="w-4 h-4" />} title="Desktop" detail="Screen view" onClick={() => onGoTo("desktop")} />}
            {perms.includes("file:write") && <QuickAction icon={<Globe className="w-4 h-4" />} title="Proxy" detail="Local apps" onClick={() => onGoTo("proxy")} />}
            {(perms.includes("terminal") || perms.includes("file:read")) && <QuickAction icon={<Wrench className="w-4 h-4" />} title="Ops" detail="Setup and host tools" onClick={() => onGoTo("ops")} />}
            {perms.includes("file:read") && <QuickAction icon={<ScrollText className="w-4 h-4" />} title="Audit" detail="Event log" onClick={() => onGoTo("audit")} />}
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <div className="border border-line bg-panel/50 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-line text-xs font-mono uppercase tracking-wider text-muted">
              Active sessions
            </div>
            {sessions.length === 0 ? (
              <div className="p-4 text-sm text-muted">No active sessions.</div>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.slice(0, 5).map((s) => (
                  <li key={s.sessionId} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-ink">{s.deviceName}</div>
                        <div className="mt-0.5 text-xs font-mono text-muted truncate">
                          {s.remoteAddr} · {scopeLabel(s.permissions)} · {shortTime(s.lastActiveAt)}
                        </div>
                      </div>
                      {s.current && <span className="text-[10px] uppercase tracking-wider text-ok border border-ok/40 rounded px-1">current</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border border-line bg-panel/50 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-line text-xs font-mono uppercase tracking-wider text-muted">
              Host details
            </div>
            <dl className="divide-y divide-line text-sm">
              <Detail label="Platform" value={env ? `${env.machine.platform} ${env.machine.arch}` : "..."} />
              <Detail label="Shell" value={env?.shell.name || env?.shell.path || "..."} />
              <Detail label="Package manager" value={env?.project.packageManager || "none"} />
              <Detail label="Monorepo" value={env?.project.monorepo ? "yes" : "no"} />
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="border border-line rounded-md px-3 py-2 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-mono text-ink truncate">{value}</div>
    </div>
  );
}

function StatusTile({
  icon, title, value, tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  tone: "ok" | "muted";
}) {
  return (
    <div className="border border-line bg-panel/50 rounded-md p-3">
      <div className={`flex items-center gap-2 text-sm ${tone === "ok" ? "text-ok" : "text-muted"}`}>
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <div className="mt-2 text-sm font-mono text-ink truncate">{value}</div>
    </div>
  );
}

function QuickAction({
  icon, title, detail, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left border border-line bg-panel/50 hover:border-accent/50 rounded-md px-3 py-3"
    >
      <div className="flex items-center gap-2 text-ink">
        <span className="text-accent">{icon}</span>
        <span className="font-medium">{title}</span>
      </div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-xs text-ink truncate">{value}</dd>
    </div>
  );
}

function ModeBadge({ info }: { info: SessionInfoResponse | null }) {
  const mode = info?.agentMode;
  if (!mode?.unattended && !mode?.autoApprove && !mode?.keepAwake) {
    return <span className="text-[11px] uppercase tracking-wider border border-line text-muted rounded px-2 py-1">manual approval</span>;
  }
  if (mode.unattended) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider border border-warn/50 text-warn bg-warn/10 rounded px-2 py-1">
        <ShieldAlert className="w-3.5 h-3.5" /> unattended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider border border-warn/50 text-warn bg-warn/10 rounded px-2 py-1">
      <ShieldAlert className="w-3.5 h-3.5" /> {mode.autoApprove ? "auto approve" : "keep awake"}
    </span>
  );
}

function reachLabel(info: SessionInfoResponse | null): string {
  const mode = info?.reachability?.mode;
  if (mode === "tunnel") return "tunnel";
  if (mode === "lan") return "LAN";
  if (mode === "local") return "local only";
  return "...";
}

function batteryLabel(battery: BatteryInfo | null): string {
  if (!battery) return "...";
  if (!battery.supported) return "unavailable";
  if (!battery.hasBattery) return battery.acConnected ? "AC power" : "no battery";
  const percent = battery.percent == null ? "unknown" : `${battery.percent}%`;
  if (battery.charging) return `${percent} charging`;
  return percent;
}

function scopeLabel(perms: string[]): string {
  const set = new Set(perms);
  if (set.has("file:write") && set.has("git:write") && set.has("screen:control")) return "full";
  if (set.has("file:read") && !set.has("file:write")) return "read-only";
  if (set.has("terminal") && !set.has("file:read")) return "terminal";
  return "custom";
}

function shortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
