import { useEffect, useState } from "react";
import { Terminal as TerminalIcon, FolderOpen, GitBranch, Power, Wifi, WifiOff, Globe, ScrollText, Monitor } from "lucide-react";
import { TerminalPanel } from "../components/TerminalPanel";
import { FilesPanel } from "../components/FilesPanel";
import { GitPanel } from "../components/GitPanel";
import { DesktopPanel } from "../components/DesktopPanel";
import { ProxyPanel } from "../components/ProxyPanel";
import { AuditPanel } from "../components/AuditPanel";
import { SessionMeta } from "../components/SessionMeta";
import { ChatPanel } from "../components/ChatPanel";
import { PowerMenu } from "../components/PowerMenu";
import { BatteryIndicator } from "../components/BatteryIndicator";
import { UpdateBanner } from "../components/UpdateBanner";
import { CommandPalette, buildStaticActions } from "../components/CommandPalette";
import { rotatePairingViaApi } from "../lib/api";
import { HostSwitcher } from "../components/HostSwitcher";
import { rememberCurrentHost } from "../lib/hosts";
import { invalidatePaletteCache } from "../lib/paletteData";
import { MessageSquare } from "lucide-react";
import { fetchSession, SessionInfoResponse } from "../lib/api";

export function SessionPage(props: {
  sessionToken: string;
  tab: "terminal" | "files" | "git" | "desktop" | "chat" | "proxy" | "audit";
  onTabChange: (tab: "terminal" | "files" | "git" | "desktop" | "chat" | "proxy" | "audit") => void;
  onDisconnected: () => void;
}) {
  const [info, setInfo] = useState<SessionInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const triggered = isMac
        ? (e.metaKey && e.key.toLowerCase() === "k")
        : (e.ctrlKey && e.key.toLowerCase() === "k");
      if (triggered) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSession(props.sessionToken)
      .then((s) => {
        if (cancelled) return;
        setInfo(s);
        try { rememberCurrentHost({ machineName: s.machineName }); } catch { /* ignore */ }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Session expired or revoked.");
        sessionStorage.removeItem("lawang:session");
        setTimeout(() => props.onDisconnected(), 800);
      });
    return () => { cancelled = true; };
  }, [props.sessionToken]);

  function handleEndSession() {
    sessionStorage.removeItem("lawang:session");
    props.onDisconnected();
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b border-line bg-panel gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs font-mono text-muted truncate">
            <span className="text-ink">{info?.machineName ?? "host"}</span>
            <span className="opacity-50 mx-1">•</span>
            <span className="truncate">{info?.rootPath ?? "…"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <HostSwitcher
            currentName={info?.machineName ?? null}
            onOpenManage={() => { window.location.hash = "/hosts"; }}
          />
          <SessionMeta sessionToken={props.sessionToken} onAuthFailed={handleEndSession} />
          {info && info.permissions && (
            <span
              className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-1 rounded border border-line text-muted"
              title={info.permissions.join(", ")}
            >
              scope: {scopeLabel(info.permissions)}
            </span>
          )}
          <BatteryIndicator sessionToken={props.sessionToken} onAuthFailed={handleEndSession} />
          <UpdateBanner />
          {error ? (
            <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-1 rounded border border-danger/40 text-danger">
              <WifiOff className="w-3.5 h-3.5" /> {error}
            </span>
          ) : info ? (
            <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-1 rounded border border-ok/40 text-ok">
              <Wifi className="w-3.5 h-3.5" /> session live
            </span>
          ) : null}
          {info && (
            <PowerMenu
              sessionToken={props.sessionToken}
              machineName={info.machineName}
              onAuthFailed={handleEndSession}
            />
          )}
          <button
            onClick={handleEndSession}
            title="End session"
            className="inline-flex items-center gap-1 text-xs text-danger hover:text-danger/80 px-2 py-1 border border-line rounded"
          >
            <Power className="w-3.5 h-3.5" /> End
          </button>
        </div>
      </header>

      <nav className="flex border-b border-line bg-panel/60">
        <TabButton active={props.tab === "terminal"} onClick={() => props.onTabChange("terminal")} icon={<TerminalIcon className="w-4 h-4" />}>
          Terminal
        </TabButton>
        {hasPerm(info, "file:read") && (
          <TabButton active={props.tab === "files"} onClick={() => props.onTabChange("files")} icon={<FolderOpen className="w-4 h-4" />}>
            Files
          </TabButton>
        )}
        {hasPerm(info, "git:read") && (
          <TabButton active={props.tab === "git"} onClick={() => props.onTabChange("git")} icon={<GitBranch className="w-4 h-4" />}>
            Git
          </TabButton>
        )}
        {hasPerm(info, "screen:view") && (
          <TabButton active={props.tab === "desktop"} onClick={() => props.onTabChange("desktop")} icon={<Monitor className="w-4 h-4" />}>
            Desktop
          </TabButton>
        )}
        {hasPerm(info, "file:write") && (
          <TabButton active={props.tab === "proxy"} onClick={() => props.onTabChange("proxy")} icon={<Globe className="w-4 h-4" />}>
            Proxy
          </TabButton>
        )}
        <TabButton active={props.tab === "chat"} onClick={() => props.onTabChange("chat")} icon={<MessageSquare className="w-4 h-4" />}>
          Chat
        </TabButton>
        {hasPerm(info, "file:read") && (
          <TabButton active={props.tab === "audit"} onClick={() => props.onTabChange("audit")} icon={<ScrollText className="w-4 h-4" />}>
            Audit
          </TabButton>
        )}
      </nav>

      <div className="flex-1 min-h-0">
        {/* Keep terminal mounted across tab switches so the shell session does not die */}
        <div className={props.tab === "terminal" ? "h-full" : "hidden"}>
          <TerminalPanel sessionToken={props.sessionToken} onAuthFailed={handleEndSession} />
        </div>
        {props.tab === "files" && (
          <div className="h-full">
            <FilesPanel sessionToken={props.sessionToken} onAuthFailed={handleEndSession} rootName={info?.rootPath?.split("/").pop() || "root"} />
          </div>
        )}
        {props.tab === "git" && (
          <div className="h-full">
            <GitPanel sessionToken={props.sessionToken} onAuthFailed={handleEndSession} />
          </div>
        )}
        {props.tab === "desktop" && (
          <div className="h-full">
            <DesktopPanel
              sessionToken={props.sessionToken}
              canControl={hasPerm(info, "screen:control")}
              onAuthFailed={handleEndSession}
            />
          </div>
        )}
        {props.tab === "proxy" && (
          <div className="h-full">
            <ProxyPanel sessionToken={props.sessionToken} onAuthFailed={handleEndSession} />
          </div>
        )}
        {props.tab === "chat" && (
          <div className="h-full">
            <ChatPanel
              sessionToken={props.sessionToken}
              onAuthFailed={handleEndSession}
              rootName={info?.rootPath?.split("/").pop() || "root"}
              onSwitchToTerminal={() => props.onTabChange("terminal")}
            />
          </div>
        )}
        {props.tab === "audit" && (
          <div className="h-full">
            <AuditPanel sessionToken={props.sessionToken} onAuthFailed={handleEndSession} />
          </div>
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessionToken={props.sessionToken}
        actions={buildStaticActions({
          goTo: (tab) => props.onTabChange(tab),
          endSession: handleEndSession,
          rotateToken: async () => {
            try {
              await rotatePairingViaApi(props.sessionToken);
            } catch {
              /* palette closes regardless */
            }
            invalidatePaletteCache();
          },
        })}
      />
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px ${
        active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function scopeLabel(perms: string[]): string {
  const set = new Set(perms);
  if (set.has("file:write") && set.has("git:write") && set.has("screen:control")) return "full";
  if (set.has("file:read") && !set.has("file:write")) return "read-only";
  if (set.has("terminal") && !set.has("file:read")) return "terminal";
  return "custom";
}

function hasPerm(info: SessionInfoResponse | null, perm: string): boolean {
  if (!info || !info.permissions) return true; // optimistic before info loads
  return info.permissions.includes(perm);
}
