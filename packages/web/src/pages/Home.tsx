import { useEffect, useMemo, useState } from "react";
import {
  QrCode, Shield, Cable, Copy, Check, X, ExternalLink,
  RefreshCw, Loader2, AlertCircle, Wifi, WifiOff, ArrowRight,
} from "lucide-react";
import { fetchInfo, AgentInfo, fetchVersion, VersionInfo } from "../lib/api";

type AgentStatus = "loading" | "live" | "offline";

export function HomePage() {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [status, setStatus] = useState<AgentStatus>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [i, v] = await Promise.all([
          fetchInfo(),
          fetchVersion().catch(() => null as VersionInfo | null),
        ]);
        if (cancelled) return;
        setInfo(i);
        setVersion(v);
        setStatus("live");
        setErrMsg(null);
      } catch (err) {
        if (cancelled) return;
        setStatus("offline");
        setErrMsg((err as Error).message || "Agent unreachable");
      }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const tunnelHost = useMemo(() => {
    if (!info?.tunnelUrl) return null;
    try { return new URL(info.tunnelUrl).hostname; } catch { return info.tunnelUrl; }
  }, [info?.tunnelUrl]);

  const pairUrl = info?.pairUrl ?? null;
  const hasPairUrl = Boolean(pairUrl);

  return (
    <div className="min-h-full flex flex-col bg-bg">
      {/* Top bar */}
      <header className="px-5 py-3 border-b border-line flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-muted">§ Lawang</span>
          <span className="hidden sm:inline text-muted">/</span>
          <span className="hidden sm:inline font-mono text-xs text-ink truncate max-w-[200px]">
            {info?.machineName ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <StatusPill status={status} />
          {info && <span className="text-muted">v{info.version}</span>}
          {version?.outdated && version.latest && (
            <a
              href={`https://www.npmjs.com/package/lawang/v/${version.latest}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 px-2 py-0.5 border border-warn/40 text-warn rounded hover:bg-warn/10"
              title="Newer version on npm"
            >
              ↑ {version.latest}
            </a>
          )}
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="px-5 sm:px-8 pt-10 pb-12 max-w-5xl mx-auto w-full">
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-accent">
            § 01 — agent online
          </div>
          <h1 className="mt-3 text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            Pair a device.<br/>
            <span className="text-accent italic font-normal">Open shell anywhere.</span>
          </h1>
          <p className="mt-5 text-muted max-w-xl text-sm sm:text-base leading-relaxed">
            Show the QR, scan it from your phone, approve from this terminal,
            and you are inside the shell. No accounts, no broker.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setQrOpen(true)}
              disabled={!hasPairUrl}
              className="inline-flex items-center gap-2 bg-accent text-bg font-medium px-4 py-3 rounded text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <QrCode className="w-4 h-4" />
              Show pairing QR
              <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href="/qr"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 border border-line text-ink hover:text-accent hover:border-accent/50 px-4 py-3 rounded text-sm"
            >
              <ExternalLink className="w-4 h-4" />
              Open QR fullscreen
            </a>
          </div>

          {!hasPairUrl && info && (
            <div className="mt-4 inline-flex items-center gap-2 text-xs text-warn">
              <AlertCircle className="w-3.5 h-3.5" />
              No active pair token. Run <code className="font-mono mx-1">lawang rotate</code> on the host.
            </div>
          )}
        </section>

        {/* Status grid */}
        <section className="px-5 sm:px-8 max-w-5xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-line">
          <StatusCard
            icon={<QrCode className="w-4 h-4" />}
            label="Pair URL"
            value={hasPairUrl ? "active" : "expired"}
            tone={hasPairUrl ? "ok" : "warn"}
            sub={hasPairUrl ? truncate(pairUrl!, 36) : "run lawang rotate"}
            divider
          />
          <StatusCard
            icon={<Cable className="w-4 h-4" />}
            label="Tunnel"
            value={tunnelHost ? "cloudflared" : "local only"}
            tone={tunnelHost ? "ok" : "muted"}
            sub={tunnelHost ?? "no public URL"}
            divider
          />
          <StatusCard
            icon={<Shield className="w-4 h-4" />}
            label="Approval"
            value="host-gated"
            tone="ok"
            sub="every device must be approved"
          />
        </section>

        {/* How it works */}
        <section className="px-5 sm:px-8 py-10 max-w-5xl mx-auto w-full border-t border-line">
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-accent">
            § 02 — how pairing works
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Step n="01" title="Show the QR" body="Tap the button above. Modal opens with the live QR + pair URL." />
            <Step n="02" title="Scan & request" body="Browser on the device hits /api/pair/request with a one-time token." />
            <Step n="03" title="Approve in CLI" body="Host answers y/N at the prompt. Approved = session token issued." />
          </div>
        </section>

        {/* Quick command (fallback for headless / SSH users) */}
        <section className="px-5 sm:px-8 pb-12 max-w-5xl mx-auto w-full border-t border-line pt-8">
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-muted">
            § 03 — install elsewhere
          </div>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <CommandBlock title="Run on another machine">{`npm i -g lawang
cd my-project
lawang start`}</CommandBlock>
            <CommandBlock title="Quick admin">{`lawang rotate            # new pair token
lawang devices           # trusted devices
lawang verify            # security smoke test
lawang install-service   # auto-start on boot`}</CommandBlock>
          </div>
        </section>
      </main>

      <footer className="px-5 sm:px-8 py-4 text-[11px] font-mono text-muted border-t border-line flex items-center justify-between flex-wrap gap-2">
        <span>local-first remote terminal</span>
        <div className="flex items-center gap-3">
          <a href="https://www.npmjs.com/package/lawang" target="_blank" rel="noopener" className="hover:text-accent">npm</a>
          <span className="opacity-30">·</span>
          <a href="/api/version" target="_blank" rel="noopener" className="hover:text-accent">version</a>
        </div>
      </footer>

      {qrOpen && hasPairUrl && (
        <QrModal pairUrl={pairUrl!} onClose={() => setQrOpen(false)} />
      )}
    </div>
  );
}

/* ─────────── Status pill ─────────── */

function StatusPill({ status }: { status: AgentStatus }) {
  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 border border-line text-muted rounded">
        <Loader2 className="w-3 h-3 animate-spin" /> connecting
      </span>
    );
  }
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 border border-ok/40 text-ok rounded">
        <Wifi className="w-3 h-3" /> agent live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 border border-danger/40 text-danger rounded">
      <WifiOff className="w-3 h-3" /> offline
    </span>
  );
}

/* ─────────── Status card ─────────── */

function StatusCard({
  icon, label, value, sub, tone, divider,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "muted";
  divider?: boolean;
}) {
  const valueClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <div className={`px-4 sm:px-6 py-5 ${divider ? "md:border-r border-line" : ""}`}>
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted">
        <span className="text-accent">{icon}</span>
        {label}
      </div>
      <div className={`mt-2 text-lg font-mono ${valueClass}`}>{value}</div>
      <div className="mt-1 text-xs font-mono text-muted truncate" title={sub}>{sub}</div>
    </div>
  );
}

/* ─────────── Step ─────────── */

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="border border-line rounded p-4 bg-panel/40">
      <div className="font-mono text-2xl text-accent leading-none">{n}</div>
      <div className="mt-3 text-ink font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted leading-relaxed">{body}</div>
    </div>
  );
}

/* ─────────── Command block ─────────── */

function CommandBlock({ title, children }: { title: string; children: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  }
  return (
    <div className="border border-line rounded bg-panel/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">{title}</span>
        <button
          onClick={copy}
          className="text-[11px] inline-flex items-center gap-1 text-muted hover:text-accent"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="px-3 py-3 text-xs font-mono text-ink whitespace-pre overflow-x-auto">{children}</pre>
    </div>
  );
}

/* ─────────── QR modal ─────────── */

function QrModal({ pairUrl, onClose }: { pairUrl: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [qrSrc, setQrSrc] = useState(`/qr.svg?ts=${Date.now()}`);
  const [stale, setStale] = useState(false);
  const [lastUrl, setLastUrl] = useState(pairUrl);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/info", { cache: "no-store" });
        const j = (await r.json()) as { pairUrl?: string | null };
        if (cancelled) return;
        if (j.pairUrl && j.pairUrl !== lastUrl) {
          setLastUrl(j.pairUrl);
          setQrSrc(`/qr.svg?ts=${Date.now()}`);
          setStale(false);
        } else if (!j.pairUrl) {
          setStale(true);
        }
      } catch { /* network blip */ }
    }
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [lastUrl]);

  async function copyUrl() {
    try {
      await navigator.clipboard?.writeText(lastUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-accent" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Scan to pair</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 flex flex-col items-center gap-4">
          <div className={`relative ${stale ? "opacity-40 grayscale" : ""}`}>
            <img
              src={qrSrc}
              alt="Pair QR"
              className="w-full max-w-[320px] aspect-square bg-white p-3 rounded"
              onError={() => setStale(true)}
            />
          </div>

          {stale && (
            <div className="text-xs text-warn flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Token expired. Run <code className="font-mono mx-1">lawang rotate</code> on the host.
            </div>
          )}

          <div className="w-full">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">Pair URL</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono text-ink bg-bg border border-line rounded px-2 py-2 truncate" title={lastUrl}>
                {lastUrl}
              </code>
              <button
                onClick={copyUrl}
                title="Copy URL"
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 border border-line rounded text-muted hover:text-accent hover:border-accent/50"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted self-start">
            <RefreshCw className="w-3 h-3" />
            QR auto-refreshes every 5 seconds.
          </div>
        </div>

        <footer className="px-4 py-3 border-t border-line text-[11px] font-mono text-muted">
          esc to close
        </footer>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
