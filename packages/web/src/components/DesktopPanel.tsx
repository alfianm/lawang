import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerDownLeft,
  Delete,
  ExternalLink,
  Keyboard,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  RefreshCw,
  Send,
  Settings,
} from "lucide-react";
import {
  AuthError,
  DesktopCapabilities,
  fetchDesktopCapabilities,
  fetchDesktopScreenshot,
  openDesktopSettings,
  sendDesktopInput,
} from "../lib/api";

interface Props {
  sessionToken: string;
  canControl: boolean;
  onAuthFailed: () => void;
}

export function DesktopPanel({ sessionToken, canControl, onAuthFailed }: Props) {
  const [caps, setCaps] = useState<DesktopCapabilities | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [refreshMs, setRefreshMs] = useState(1000);
  const [viewMode, setViewMode] = useState<"fit" | "large">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches ? "large" : "fit"
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState<"screen-recording" | "accessibility" | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastMoveAt = useRef(0);
  const inputBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchDesktopCapabilities(sessionToken)
      .then((c) => { if (!cancelled) setCaps(c); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
        else setError((err as Error).message);
      });
    return () => { cancelled = true; };
  }, [sessionToken]);

  useEffect(() => {
    if (!caps?.view.supported || paused) return;
    let cancelled = false;
    let timer: number | null = null;

    async function tick() {
      if (cancelled) return;
      setBusy(true);
      try {
        const next = await fetchDesktopScreenshot(sessionToken);
        if (cancelled) {
          URL.revokeObjectURL(next.url);
          return;
        }
        setError(null);
        setCapturedAt(next.capturedAt);
        setImageUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return next.url;
        });
      } catch (err) {
        if (err instanceof AuthError) onAuthFailed();
        else setError(readableError(err));
      } finally {
        if (!cancelled) {
          setBusy(false);
          timer = window.setTimeout(tick, refreshMs);
        }
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [caps?.view.supported, paused, refreshMs, retryKey, sessionToken]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  async function send(input: Parameters<typeof sendDesktopInput>[1]) {
    if (!canControl || !controlEnabled || inputBusy.current) return;
    inputBusy.current = true;
    try {
      await sendDesktopInput(sessionToken, input);
      setError(null);
    } catch (err) {
      if (err instanceof AuthError) onAuthFailed();
      else setError(readableError(err));
    } finally {
      inputBusy.current = false;
    }
  }

  function pointFromEvent(e: React.PointerEvent | React.MouseEvent) {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = clamp((e.clientX - rect.left) / rect.width);
    const y = clamp((e.clientY - rect.top) / rect.height);
    return { x, y };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!controlEnabled || !canControl) return;
    const now = Date.now();
    if (now - lastMoveAt.current < 150) return;
    lastMoveAt.current = now;
    const p = pointFromEvent(e);
    if (p) void send({ kind: "mouse_move", ...p });
  }

  function onClick(e: React.MouseEvent) {
    if (!controlEnabled || !canControl) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    if (p) void send({ kind: "mouse_click", ...p, button: "left", double: e.detail >= 2 });
  }

  function onContextMenu(e: React.MouseEvent) {
    if (!controlEnabled || !canControl) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    if (p) void send({ kind: "mouse_click", ...p, button: "right" });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!controlEnabled || !canControl) return;
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault();
    void send({
      kind: "key",
      key: e.key,
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
  }

  async function sendText() {
    const value = text;
    if (!value.trim()) return;
    setText("");
    await send({ kind: "text", text: value });
  }

  async function openSettings(target: "screen-recording" | "accessibility") {
    setSettingsBusy(target);
    try {
      await openDesktopSettings(sessionToken, target);
      setError(null);
    } catch (err) {
      if (err instanceof AuthError) onAuthFailed();
      else setError(readableError(err));
    } finally {
      setSettingsBusy(null);
    }
  }

  function checkAgain() {
    setError(null);
    setPaused(false);
    setRetryKey((value) => value + 1);
  }

  if (!caps) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading desktop…
      </div>
    );
  }

  if (!caps.view.supported) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md border border-warn/40 bg-warn/10 rounded p-4 text-sm">
          <div className="flex items-center gap-2 text-warn font-medium">
            <AlertTriangle className="w-4 h-4" /> Desktop unsupported
          </div>
          <p className="text-muted mt-2">{caps.view.reason || "This host does not expose desktop capture."}</p>
        </div>
      </div>
    );
  }

  const errorHint = error ? desktopSetupHint(caps, error) : null;

  return (
    <div className="h-full min-h-0 flex flex-col bg-bg overflow-hidden">
      <header className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-2 sm:px-3 py-2 border-b border-line bg-panel/60">
        <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
          <Monitor className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-ink">Desktop</span>
          <span className="text-xs text-muted font-mono truncate">{caps.view.provider}</span>
          <span className={`text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
            imageUrl && canControl && caps.control.supported
              ? "border-ok/40 text-ok"
              : "border-line text-muted"
          }`}>
            {imageUrl
              ? canControl && caps.control.supported ? "ready to control" : "view ready"
              : "setup required"}
          </span>
          {capturedAt && (
            <span className="text-[11px] text-muted font-mono">{new Date(capturedAt).toLocaleTimeString()}</span>
          )}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin w-full sm:w-auto">
          <label className="shrink-0 inline-flex items-center gap-1 text-xs text-muted">
            Refresh
            <select
              value={refreshMs}
              onChange={(e) => setRefreshMs(Number(e.target.value))}
              className="bg-bg border border-line rounded px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
              title="Desktop refresh interval"
            >
              <option value={500}>Fast</option>
              <option value={1000}>Normal</option>
              <option value={2000}>Slow</option>
            </select>
          </label>
          <button
            onClick={() => setViewMode((v) => v === "fit" ? "large" : "fit")}
            className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 border border-line rounded text-muted hover:text-ink"
            title={viewMode === "fit" ? "Use a larger pannable desktop view" : "Fit desktop to screen"}
          >
            {viewMode === "fit" ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            {viewMode === "fit" ? "Large" : "Fit"}
          </button>
          {canControl && caps.control.supported && (
            <button
              onClick={() => setControlEnabled((v) => !v)}
              className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 border rounded ${
                controlEnabled ? "border-warn/60 text-warn bg-warn/10" : "border-line text-muted hover:text-ink"
              }`}
            >
              <MousePointer2 className="w-3.5 h-3.5" /> Control
            </button>
          )}
          <button
            onClick={() => setPaused((v) => !v)}
            className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 border border-line rounded text-muted hover:text-ink"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${paused ? "" : "animate-spin"}`} /> {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 px-3 py-2 border-b border-danger/30 bg-danger/5 text-xs text-danger">
          <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          </div>
          {errorHint && (
            <div className="mt-1 text-muted">
              {errorHint}
            </div>
          )}
        </div>
      )}

      {!imageUrl && (
        <DesktopSetup
          caps={caps}
          canControl={canControl}
          error={error}
          busy={busy}
          settingsBusy={settingsBusy}
          onOpenSettings={openSettings}
          onRetry={checkAgain}
        />
      )}

      {caps.view.supported && (!canControl || !caps.control.supported) && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/30 text-xs text-muted">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            {!canControl
              ? "This session does not include screen control permission."
              : caps.control.reason || "Desktop control is not available on this host."}
          </span>
        </div>
      )}

      {canControl && controlEnabled && (
        <div className="shrink-0 border-b border-line bg-panel/40">
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-2 sm:px-3 py-2">
            <Keyboard className="w-4 h-4 text-muted shrink-0" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendText();
                }
              }}
              placeholder="Type text to host"
              className="flex-1 min-w-[180px] bg-bg border border-line rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <button
              onClick={() => void sendText()}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-bg text-xs font-medium"
            >
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </div>
          <MobileRemoteControls onKey={(key) => void send({ kind: "key", key })} />
        </div>
      )}

      <div
        ref={frameRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={() => frameRef.current?.focus()}
        className={`${imageUrl ? "flex-1" : "hidden"} min-h-0 p-2 outline-none ${
          viewMode === "large" ? "overflow-auto flex items-start justify-start" : "overflow-hidden flex items-start justify-center sm:items-center"
        } ${
          controlEnabled ? "cursor-crosshair" : "cursor-default"
        }`}
      >
        {imageUrl && (
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Remote desktop"
            draggable={false}
            onPointerMove={onPointerMove}
            onClick={onClick}
            onContextMenu={onContextMenu}
            className={viewMode === "large"
              ? "w-auto h-auto min-w-[720px] sm:min-w-[960px] max-w-none max-h-none select-none"
              : "max-w-full max-h-full object-contain select-none"
            }
          />
        )}
      </div>
    </div>
  );
}

function DesktopSetup({
  caps,
  canControl,
  error,
  busy,
  settingsBusy,
  onOpenSettings,
  onRetry,
}: {
  caps: DesktopCapabilities;
  canControl: boolean;
  error: string | null;
  busy: boolean;
  settingsBusy: "screen-recording" | "accessibility" | null;
  onOpenSettings: (target: "screen-recording" | "accessibility") => Promise<void>;
  onRetry: () => void;
}) {
  const isMac = caps.platform === "darwin";
  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-2xl border border-line bg-panel/40 rounded-md">
        <div className="px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Settings className="w-4 h-4 text-accent" />
            Siapkan remote desktop
          </div>
          <p className="mt-1 text-xs text-muted">
            Selesaikan langkah berikut pada komputer host, lalu periksa kembali koneksinya.
          </p>
        </div>

        <div className="divide-y divide-line">
          <SetupStep
            number="1"
            title="Izinkan perekaman layar"
            detail={isMac
              ? "Aktifkan aplikasi Terminal yang menjalankan Lawang pada Privacy & Security > Screen Recording."
              : caps.view.reason || `Pastikan provider ${caps.view.provider} dapat mengambil screenshot desktop.`}
            action={isMac ? (
              <SetupButton
                loading={settingsBusy === "screen-recording"}
                onClick={() => void onOpenSettings("screen-recording")}
                label="Buka di host"
              />
            ) : null}
          />
          <SetupStep
            number="2"
            title="Izinkan kontrol mouse dan keyboard"
            detail={!canControl
              ? "Sesi ini hanya memiliki izin melihat layar. Pair ulang dengan akses penuh untuk mengontrol desktop."
              : isMac
                ? "Aktifkan aplikasi Terminal yang menjalankan Lawang pada Privacy & Security > Accessibility."
                : caps.control.reason || `Kontrol tersedia melalui ${caps.control.provider}.`}
            action={isMac && canControl ? (
              <SetupButton
                loading={settingsBusy === "accessibility"}
                onClick={() => void onOpenSettings("accessibility")}
                label="Buka di host"
              />
            ) : null}
          />
          <SetupStep
            number="3"
            title={isMac ? "Mulai ulang Lawang bila izin baru diubah" : "Periksa kembali koneksi desktop"}
            detail={isMac
              ? "macOS biasanya memerlukan proses Lawang dihentikan dan dijalankan kembali setelah izin diberikan."
              : "Pastikan Lawang berjalan di dalam sesi desktop aktif, lalu tekan Cek ulang."}
          />
        </div>

        <div className="px-4 py-3 border-t border-line flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted">
            {error ? "Frame belum dapat diambil. Periksa izin di atas." : "Sedang memeriksa frame pertama dari host."}
          </div>
          <button
            onClick={onRetry}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-accent text-bg text-xs font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Cek ulang
          </button>
        </div>
      </div>
    </div>
  );
}

function SetupStep({
  number,
  title,
  detail,
  action,
}: {
  number: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-4">
      <span className="w-6 h-6 shrink-0 inline-flex items-center justify-center rounded border border-accent/40 text-accent text-xs font-mono">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{title}</div>
        <div className="mt-1 text-xs text-muted leading-relaxed">{detail}</div>
      </div>
      {action}
    </div>
  );
}

function SetupButton({ loading, onClick, label }: { loading: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 border border-line rounded text-xs text-muted hover:text-ink disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MobileRemoteControls({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div className="px-2 sm:px-3 pb-2 flex flex-wrap items-center gap-1.5">
      <KeyButton label="Esc" onClick={() => onKey("Escape")} />
      <KeyButton label="Tab" onClick={() => onKey("Tab")} />
      <KeyButton icon={<CornerDownLeft className="w-3.5 h-3.5" />} label="Enter" onClick={() => onKey("Enter")} />
      <KeyButton icon={<Delete className="w-3.5 h-3.5" />} label="Backspace" onClick={() => onKey("Backspace")} />
      <span className="w-px h-6 bg-line mx-1" />
      <KeyButton icon={<ArrowLeft className="w-3.5 h-3.5" />} label="Left" onClick={() => onKey("ArrowLeft")} compact />
      <KeyButton icon={<ArrowUp className="w-3.5 h-3.5" />} label="Up" onClick={() => onKey("ArrowUp")} compact />
      <KeyButton icon={<ArrowDown className="w-3.5 h-3.5" />} label="Down" onClick={() => onKey("ArrowDown")} compact />
      <KeyButton icon={<ArrowRight className="w-3.5 h-3.5" />} label="Right" onClick={() => onKey("ArrowRight")} compact />
    </div>
  );
}

function KeyButton({
  label,
  icon,
  compact,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`h-8 inline-flex items-center justify-center gap-1 border border-line rounded text-xs text-muted hover:text-ink hover:border-accent/40 ${
        compact ? "w-8 px-0" : "px-2"
      }`}
    >
      {icon}
      {!compact && <span>{label}</span>}
    </button>
  );
}

function clamp(n: number) {
  return Math.min(1, Math.max(0, n));
}

function readableError(err: unknown): string {
  const text = (err as Error).message || String(err);
  try {
    const jsonText = text.slice(text.indexOf("{"));
    const body = JSON.parse(jsonText);
    if (body.message) return body.message;
  } catch {
    // fall back to raw error
  }
  return text;
}

function desktopSetupHint(caps: DesktopCapabilities | null, text: string): string | null {
  if (caps?.platform === "darwin" && /screen recording|accessibility|permission/i.test(text)) {
    return "Enable macOS Screen Recording for the terminal app running Lawang. For mouse/keyboard control, also enable Accessibility.";
  }
  if (caps?.platform === "linux") {
    return "Linux desktop view needs grim, gnome-screenshot, scrot, or ImageMagick import. Control needs an X11 session with xdotool.";
  }
  if (caps?.platform === "win32") {
    return "Windows desktop view/control must run inside an active signed-in desktop session with PowerShell available.";
  }
  return null;
}
