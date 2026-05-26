import { useEffect, useState } from "react";
import {
  Globe, Plus, Trash2, RefreshCw, Loader2, ExternalLink, AlertTriangle,
} from "lucide-react";
import {
  AuthError, ProxyState, ProxyTarget,
  fetchProxy, addProxyTarget, removeProxyTarget, discoverProxyPorts,
} from "../lib/api";

type Toast = { id: number; tone: "ok" | "error"; text: string };

export function ProxyPanel(props: { sessionToken: string; onAuthFailed: () => void }) {
  const [state, setState] = useState<ProxyState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [discovered, setDiscovered] = useState<number[] | null>(null);
  const [draftPort, setDraftPort] = useState<string>("");
  const [draftLabel, setDraftLabel] = useState<string>("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  function toast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 3000);
  }

  function refresh() { setRefreshTick((n) => n + 1); }

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetchProxy(props.sessionToken)
      .then((s) => { if (!cancelled) setState(s); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { props.onAuthFailed(); return; }
        setErr((e as Error).message);
      });
    return () => { cancelled = true; };
  }, [props.sessionToken, refreshTick]);

  async function handleAdd(port: number, label?: string | null) {
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      toast({ tone: "error", text: "Port harus antara 1-65535." });
      return;
    }
    setBusy(`add:${port}`);
    try {
      await addProxyTarget(props.sessionToken, { port, label: label?.trim() || undefined });
      toast({ tone: "ok", text: `Port ${port} di-expose.` });
      setDraftPort(""); setDraftLabel("");
      refresh();
    } catch (e) {
      if (e instanceof AuthError) { props.onAuthFailed(); return; }
      const msg = (e as Error).message;
      if (msg.includes("port_not_allowed")) toast({ tone: "error", text: "Port tidak ada di allow-list. Jalankan agent dengan --proxy 'open' atau tambahkan ke flag." });
      else toast({ tone: "error", text: msg });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(port: number) {
    setBusy(`del:${port}`);
    try {
      await removeProxyTarget(props.sessionToken, port);
      toast({ tone: "ok", text: `Port ${port} dilepas.` });
      refresh();
    } catch (e) {
      if (e instanceof AuthError) { props.onAuthFailed(); return; }
      toast({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function handleDiscover() {
    setBusy("discover");
    try {
      const r = await discoverProxyPorts(props.sessionToken);
      setDiscovered(r.ports);
      if (r.ports.length === 0) toast({ tone: "ok", text: "Tidak ada port dev umum yang listening." });
    } catch (e) {
      if (e instanceof AuthError) { props.onAuthFailed(); return; }
      toast({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function buildProxyUrl(t: ProxyTarget): string {
    const base = `${window.location.origin}/proxy/${t.port}/`;
    return base;
  }

  if (err) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="max-w-sm rounded-md border border-line bg-panel p-4 text-sm">
          <div className="flex items-center gap-2 text-warn"><AlertTriangle className="w-4 h-4" /> Proxy unavailable</div>
          <div className="text-muted mt-2">{err}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/60">
        <Globe className="w-4 h-4 text-accent" />
        <div className="text-sm font-mono truncate flex-1">
          Local sites proxy
          {state && state.allowList && (
            <span className="text-muted text-xs ml-2">
              allow-list: {state.allowList.length === 0 ? "kosong" : state.allowList.join(", ")}
            </span>
          )}
          {state && !state.allowList && (
            <span className="text-muted text-xs ml-2">allow-list: open</span>
          )}
        </div>
        <button
          onClick={handleDiscover}
          disabled={busy === "discover"}
          className="inline-flex items-center gap-1 text-xs text-ink border border-line hover:border-accent/40 rounded px-2 py-1 disabled:opacity-40"
          title="Scan port dev umum"
        >
          {busy === "discover" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Scan
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="px-3 py-3 border-b border-line">
          <div className="text-xs text-muted mb-2">Tambahkan port lokal yang ingin diakses lewat browser remote.</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={65535}
              value={draftPort}
              onChange={(e) => setDraftPort(e.target.value)}
              placeholder="3000"
              className="w-24 bg-bg border border-line rounded px-2 py-1.5 font-mono text-xs"
            />
            <input
              type="text"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="label opsional"
              className="flex-1 min-w-[120px] bg-bg border border-line rounded px-2 py-1.5 text-xs"
            />
            <button
              onClick={() => handleAdd(parseInt(draftPort, 10), draftLabel)}
              disabled={!draftPort || !!busy}
              className="inline-flex items-center gap-1 text-xs text-bg bg-accent rounded px-2.5 py-1.5 disabled:opacity-40"
            >
              {busy?.startsWith("add:") ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Tambah
            </button>
          </div>
        </div>

        {discovered && discovered.length > 0 && (
          <div className="px-3 py-3 border-b border-line">
            <div className="text-xs text-muted mb-2">Port listening yang terdeteksi:</div>
            <div className="flex flex-wrap gap-1.5">
              {discovered.map((p) => (
                <button
                  key={p}
                  onClick={() => handleAdd(p)}
                  disabled={!!busy || (state?.targets.some((t) => t.port === p) ?? false)}
                  className="inline-flex items-center gap-1 text-xs border border-line hover:border-accent/40 rounded px-2 py-1 disabled:opacity-40"
                >
                  <Plus className="w-3 h-3" /> {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <ul className="divide-y divide-line">
          {(state?.targets ?? []).map((t) => (
            <li key={t.port} className="px-3 py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono truncate">
                  :{t.port}
                  {t.label && <span className="text-muted ml-2">{t.label}</span>}
                </div>
                <div className="text-[11px] text-muted truncate">{t.host} → /proxy/{t.port}/</div>
              </div>
              <a
                href={buildProxyUrl(t)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                Buka <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={() => handleRemove(t.port)}
                disabled={busy === `del:${t.port}`}
                className="inline-flex items-center gap-1 text-xs text-danger hover:text-danger/80 border border-line hover:border-danger/40 rounded px-2 py-1 disabled:opacity-40"
              >
                {busy === `del:${t.port}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Hapus
              </button>
            </li>
          ))}
          {state && state.targets.length === 0 && (
            <li className="px-3 py-6 text-center text-muted text-xs">
              Belum ada port yang di-expose. Tambahkan port di atas, atau klik Scan.
            </li>
          )}
        </ul>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
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
