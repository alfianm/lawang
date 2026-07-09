import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";

type Status = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export function TerminalPanel(props: { sessionToken: string; onAuthFailed: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [errorText, setErrorText] = useState<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      disableStdin: false,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: "#0b0d10",
        foreground: "#e6edf3",
        cursor: "#7cc4ff",
        cursorAccent: "#0b0d10",
        selectionBackground: "#264f78",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const sendResize = () => {
      if (!termRef.current || !fitRef.current || !wsRef.current) return;
      try { fitRef.current.fit(); } catch {}
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ event: "terminal:resize", payload: { cols, rows } }));
      }
    };

    const buildUrl = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const cols = termRef.current?.cols ?? 100;
      const rows = termRef.current?.rows ?? 32;
      return `${proto}//${window.location.host}/ws/terminal?token=${encodeURIComponent(props.sessionToken)}&cols=${cols}&rows=${rows}`;
    };

    const connect = () => {
      const ws = new WebSocket(buildUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setStatus("connected");
        sendResize();
        try { term.focus(); } catch {}
      };
      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg?.event === "terminal:replay") {
          // Server replayed buffered output; clear screen first so the replay
          // doesn't stack on top of stale frames from the previous session.
          try { term.reset(); } catch { /* ignore */ }
          term.write(msg.payload?.data ?? "");
        } else if (msg?.event === "session:connected") {
          if (msg.payload?.resumed) {
            // Brief hint so the user understands what happened.
            term.write("\r\n\x1b[2;36m[reconnected]\x1b[0m\r\n");
          }
        } else if (msg?.event === "terminal:output") {
          term.write(msg.payload?.data ?? "");
        } else if (msg?.event === "terminal:exit") {
          intentionalCloseRef.current = true;
          setStatus("disconnected");
          term.write("\r\n\x1b[33m[shell exited]\x1b[0m\r\n");
        } else if (msg?.event === "error") {
          setStatus("error");
          setErrorText(msg.payload?.message || "Unknown error");
        } else if (msg?.event === "session:expired" || msg?.event === "session:revoked") {
          intentionalCloseRef.current = true;
          setStatus("disconnected");
          setErrorText("Session ended by host.");
        }
      };
      ws.onerror = () => {
        // Real status will be set by onclose/scheduleReconnect.
      };
      ws.onclose = (ev) => {
        if (ev.code === 4401) {
          setStatus("error");
          setErrorText("Authentication failed. Pair again.");
          sessionStorage.removeItem("lawang:session");
          props.onAuthFailed();
          return;
        }
        if (intentionalCloseRef.current) {
          setStatus("disconnected");
          return;
        }
        scheduleReconnect();
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "terminal:input", payload: { data } }));
        }
      });
    };

    const scheduleReconnect = () => {
      const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
      reconnectAttemptRef.current = attempt;
      const delay = Math.min(500 * 2 ** (attempt - 1), 5000);
      setStatus("reconnecting");
      setErrorText(`reconnecting in ${Math.round(delay / 100) / 10}s…`);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        if (intentionalCloseRef.current) return;
        connect();
      }, delay);
    };

    connect();

    const onResize = () => sendResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    const ro = new ResizeObserver(() => sendResize());
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      ro.disconnect();
      try { wsRef.current?.close(1000, "panel_unmount"); } catch {}
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionToken]);

  function sendKey(data: string) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: "terminal:input", payload: { data } }));
    }
    termRef.current?.focus();
  }

  return (
    <div className="h-full flex flex-col">
      <div className="relative flex-1 bg-bg overflow-hidden">
        <div
          ref={containerRef}
          onPointerDown={() => { try { termRef.current?.focus(); } catch {} }}
          onClick={() => { try { termRef.current?.focus(); } catch {} }}
          className="absolute inset-0 px-2 pt-2 cursor-text"
        />
        {status !== "connected" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-sm font-mono text-muted bg-panel/80 px-3 py-2 rounded border border-line">
              {status === "connecting" && "connecting…"}
              {status === "reconnecting" && (errorText || "reconnecting…")}
              {status === "disconnected" && "disconnected"}
              {status === "error" && (errorText || "error")}
            </div>
          </div>
        )}
      </div>
      <ShortcutBar onKey={sendKey} />
    </div>
  );
}

const KEYS: { label: string; data: string; node?: React.ReactNode; title?: string; sticky?: boolean }[] = [
  { label: "Ctrl", data: "", sticky: true, title: "Hold Ctrl for next key" },
  { label: "Alt", data: "", sticky: true, title: "Hold Alt for next key" },
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "Ctrl+C", data: "\x03" },
  { label: "Ctrl+L", data: "\x0c" },
  { label: "Ctrl+D", data: "\x04" },
  { label: "Ctrl+Z", data: "\x1a" },
  { label: "Ctrl+A", data: "\x01" },
  { label: "Ctrl+E", data: "\x05" },
  { label: "Ctrl+U", data: "\x15" },
  { label: "Ctrl+W", data: "\x17" },
  { label: "Ctrl+R", data: "\x12" },
  { label: "Home", data: "\x1b[H", title: "Home" },
  { label: "End", data: "\x1b[F", title: "End" },
  { label: "PgUp", data: "\x1b[5~", title: "Page Up" },
  { label: "PgDn", data: "\x1b[6~", title: "Page Down" },
  { label: "↑", data: "\x1b[A", node: <ArrowUp className="w-3.5 h-3.5" />, title: "Up" },
  { label: "↓", data: "\x1b[B", node: <ArrowDown className="w-3.5 h-3.5" />, title: "Down" },
  { label: "←", data: "\x1b[D", node: <ArrowLeft className="w-3.5 h-3.5" />, title: "Left" },
  { label: "→", data: "\x1b[C", node: <ArrowRight className="w-3.5 h-3.5" />, title: "Right" },
];

function ShortcutBar({ onKey }: { onKey: (data: string) => void }) {
  const [mods, setMods] = useState<{ ctrl: boolean; alt: boolean }>({ ctrl: false, alt: false });
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");

  function press(k: (typeof KEYS)[number]) {
    if (k.sticky && k.label === "Ctrl") {
      setMods((m) => ({ ctrl: !m.ctrl, alt: false }));
      return;
    }
    if (k.sticky && k.label === "Alt") {
      setMods((m) => ({ alt: !m.alt, ctrl: false }));
      return;
    }
    if (k.data) onKey(k.data);
  }

  function pressLetter(ch: string) {
    if (mods.ctrl) {
      const code = ch.toUpperCase().charCodeAt(0) - 64;
      onKey(String.fromCharCode(code));
      setMods({ ctrl: false, alt: false });
      return;
    }
    if (mods.alt) {
      onKey(`\x1b${ch}`);
      setMods({ ctrl: false, alt: false });
      return;
    }
    onKey(ch);
  }

  return (
    <div className="border-t border-line bg-panel">
      <div className="flex gap-1 overflow-x-auto px-2 py-1 scrollbar-thin">
        {KEYS.map((k) => {
          const active = (k.label === "Ctrl" && mods.ctrl) || (k.label === "Alt" && mods.alt);
          return (
            <button
              key={k.label}
              title={k.title || k.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => press(k)}
              className={`shrink-0 inline-flex items-center justify-center min-w-[2.25rem] h-8 px-2 text-xs font-mono rounded border active:bg-line ${
                active
                  ? "bg-accent/20 border-accent text-accent"
                  : "text-ink/90 bg-bg border-line hover:border-accent/40"
              }`}
            >
              {k.node ? k.node : k.label}
            </button>
          );
        })}
      </div>
      {(mods.ctrl || mods.alt) && (
        <div className="flex gap-1 overflow-x-auto px-2 pb-1 scrollbar-thin">
          <span className="shrink-0 self-center text-[10px] font-mono uppercase tracking-wider text-muted px-1">
            {mods.ctrl ? "ctrl+" : "alt+"}
          </span>
          {letters.map((ch) => (
            <button
              key={ch}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pressLetter(ch)}
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 text-xs font-mono text-ink/90 bg-bg border border-line rounded hover:border-accent/40"
            >
              {ch}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
