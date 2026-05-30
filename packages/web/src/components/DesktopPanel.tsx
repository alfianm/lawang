import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Keyboard, Loader2, Monitor, MousePointer2, RefreshCw, Send } from "lucide-react";
import {
  AuthError,
  DesktopCapabilities,
  fetchDesktopCapabilities,
  fetchDesktopScreenshot,
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
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
          timer = window.setTimeout(tick, 1000);
        }
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [caps?.view.supported, paused, sessionToken]);

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

  return (
    <div className="h-full flex flex-col bg-bg">
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-line bg-panel/60">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-ink">Desktop</span>
          <span className="text-xs text-muted font-mono truncate">{caps.view.provider}</span>
          {capturedAt && (
            <span className="text-[11px] text-muted font-mono">{new Date(capturedAt).toLocaleTimeString()}</span>
          )}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />}
        </div>

        <div className="flex items-center gap-2">
          {canControl && caps.control.supported && (
            <button
              onClick={() => setControlEnabled((v) => !v)}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 border rounded ${
                controlEnabled ? "border-warn/60 text-warn bg-warn/10" : "border-line text-muted hover:text-ink"
              }`}
            >
              <MousePointer2 className="w-3.5 h-3.5" /> Control
            </button>
          )}
          <button
            onClick={() => setPaused((v) => !v)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-line rounded text-muted hover:text-ink"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${paused ? "" : "animate-spin"}`} /> {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-danger/30 bg-danger/5 text-xs text-danger">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {canControl && controlEnabled && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/40">
          <Keyboard className="w-4 h-4 text-muted" />
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
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-bg text-xs font-medium"
          >
            <Send className="w-3.5 h-3.5" /> Send
          </button>
        </div>
      )}

      <div
        ref={frameRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={() => frameRef.current?.focus()}
        className={`flex-1 min-h-0 overflow-hidden flex items-center justify-center outline-none ${
          controlEnabled ? "cursor-crosshair" : "cursor-default"
        }`}
      >
        {imageUrl ? (
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Remote desktop"
            draggable={false}
            onPointerMove={onPointerMove}
            onClick={onClick}
            onContextMenu={onContextMenu}
            className="max-w-full max-h-full object-contain select-none"
          />
        ) : (
          <div className="text-muted text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Waiting for first frame…
          </div>
        )}
      </div>
    </div>
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
