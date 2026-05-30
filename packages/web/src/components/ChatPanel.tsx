import { useEffect, useMemo, useRef, useState } from "react";
import { Send, FolderOpen, ChevronRight, Loader2, AlertTriangle, Clock, Check, Folder, X, RefreshCw, RotateCcw, Pencil, Copy, Terminal as TerminalIcon, Info, Bookmark } from "lucide-react";
import { SnippetDrawer } from "./SnippetDrawer";
import type { Snippet } from "../lib/api";
import { execCommand, listFiles, AuthError, ExecResult, DirEntry } from "../lib/api";

interface Props {
  sessionToken: string;
  rootName: string;
  onAuthFailed: () => void;
  onSwitchToTerminal?: () => void;
}

interface Bubble {
  id: string;
  cwd: string;
  command: string;
  result?: ExecResult;
  pending?: boolean;
  error?: string;
  startedAt: number;
}

const QUICK_ACTIONS = [
  "ls -la",
  "pwd",
  "git status",
  "git log --oneline -10",
  "npm run",
  "node -v",
];

// Pola perintah yang butuh TTY/pseudo-TTY interaktif. Heuristik konservatif —
// kalau output di-pipe atau ditangkap (`> file`, `| cat`, `--help`), kita tidak
// flag karena biasanya non-interactive saat itu.
const INTERACTIVE_TOKENS = [
  "vim", "vi", "nvim", "nano", "emacs", "pico",
  "less", "more",
  "htop", "top", "btop", "atop", "iotop",
  "tmux", "screen",
  "ssh", "telnet", "mosh", "ftp", "sftp",
  "psql", "mysql", "redis-cli", "mongo", "mongosh", "sqlite3",
  "python", "python3", "node", "irb", "pry", "lua", "deno",
  "man", "watch",
];

interface InteractiveHint {
  level: "warn";
  matched: string;
  message: string;
}

export function detectInteractive(commandRaw: string): InteractiveHint | null {
  const command = commandRaw.trim();
  if (!command) return null;
  // Skip when output is being piped, redirected, or captured.
  if (/[|<>]/.test(command)) return null;
  // Skip when --help / -h is asked — that exits cleanly.
  if (/(^|\s)(--help|-h|--version|-V)(\s|$)/.test(command)) return null;

  // Tokenize the FIRST sub-command (split on `;`, `&&`, `||`).
  const firstSegment = command.split(/&&|\|\||;/)[0]!.trim();
  const tokens = firstSegment.split(/\s+/);
  const head = (tokens[0] ?? "").toLowerCase();
  if (!head) return null;

  // Strip env-var assignments like FOO=bar before the binary.
  const isEnvAssign = /^[A-Z_][A-Z0-9_]*=/.test(head);
  const bin = isEnvAssign ? (tokens[1] ?? "").toLowerCase() : head;
  if (!bin) return null;

  // Plain REPLs (`python`, `node`, `irb`) are interactive only without args.
  const argTokens = tokens.slice(isEnvAssign ? 2 : 1);
  const reploLike = new Set(["python", "python3", "node", "irb", "pry", "lua", "deno"]);
  if (reploLike.has(bin) && argTokens.length > 0) return null;

  if (!INTERACTIVE_TOKENS.includes(bin)) return null;
  return {
    level: "warn",
    matched: bin,
    message: `“${bin}” usually opens a full-screen TTY. Chat tab can't render it. Switch to the Terminal tab for that.`,
  };
}

export function ChatPanel({ sessionToken, rootName, onAuthFailed, onSwitchToTerminal }: Props) {
  const [cwd, setCwd] = useState<string>(() => sessionStorage.getItem("lawang:chat:cwd") || ".");
  const [bubbles, setBubbles] = useState<Bubble[]>(() => {
    try {
      const raw = sessionStorage.getItem("lawang:chat:log");
      return raw ? (JSON.parse(raw) as Bubble[]) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [historyCursor, setHistoryCursor] = useState(-1);
  const interactiveHint = useMemo(() => detectInteractive(input), [input]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Persist log + cwd across tab switches.
  useEffect(() => {
    sessionStorage.setItem("lawang:chat:cwd", cwd);
  }, [cwd]);
  useEffect(() => {
    try {
      const trimmed = bubbles.slice(-200);
      sessionStorage.setItem("lawang:chat:log", JSON.stringify(trimmed));
    } catch { /* quota — ignore */ }
  }, [bubbles]);

  useEffect(() => {
    function onRun(e: Event) {
      const detail = (e as CustomEvent).detail as { command?: string; cwd?: string } | null;
      if (!detail?.command) return;
      const targetCwd = detail.cwd && detail.cwd !== "." ? detail.cwd : cwd;
      void send(detail.command, targetCwd);
    }
    window.addEventListener("lawang:run-snippet", onRun);
    return () => window.removeEventListener("lawang:run-snippet", onRun);
  }, [cwd, sessionToken]);

  // Auto-scroll to bottom on new bubble.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles.length]);

  async function send(commandRaw: string, cwdOverride?: string) {
    const command = commandRaw.trim();
    if (!command) return;
    const targetCwd = cwdOverride ?? cwd;
    const id = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const bubble: Bubble = { id, cwd: targetCwd, command, pending: true, startedAt: Date.now() };
    setBubbles((b) => [...b, bubble]);
    setHistoryCursor(-1);
    setInput("");

    try {
      const result = await execCommand(sessionToken, command, targetCwd);
      setBubbles((b) => b.map((x) => (x.id === id ? { ...x, pending: false, result } : x)));
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthFailed();
        return;
      }
      setBubbles((b) => b.map((x) => (x.id === id ? { ...x, pending: false, error: (err as Error).message } : x)));
    }
  }

  function clearLog() {
    setBubbles([]);
    sessionStorage.removeItem("lawang:chat:log");
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
      return;
    }
    // Shell-like history recall, only when caret is at the start/end of a single-line input.
    const target = e.currentTarget;
    const singleLine = !target.value.includes("\n");
    if (!singleLine) return;
    if (e.key === "ArrowUp") {
      const cmds = collectCommands(bubbles);
      if (cmds.length === 0) return;
      e.preventDefault();
      const next = historyCursor < 0 ? cmds.length - 1 : Math.max(0, historyCursor - 1);
      setHistoryCursor(next);
      setInput(cmds[next] ?? "");
      requestAnimationFrame(() => target.setSelectionRange(target.value.length, target.value.length));
    } else if (e.key === "ArrowDown") {
      const cmds = collectCommands(bubbles);
      if (historyCursor < 0) return;
      e.preventDefault();
      const next = historyCursor + 1;
      if (next >= cmds.length) {
        setHistoryCursor(-1);
        setInput("");
      } else {
        setHistoryCursor(next);
        setInput(cmds[next] ?? "");
      }
    }
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Top bar: cwd breadcrumb + actions */}
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line bg-panel">
        <div className="flex items-center gap-1 min-w-0 text-xs font-mono">
          <button
            className="inline-flex items-center gap-1 text-muted hover:text-ink"
            onClick={() => setPickerOpen((v) => !v)}
            title="Pick folder"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <Breadcrumb cwd={cwd} rootName={rootName} onPick={setCwd} />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1 border border-line rounded px-2 py-1"
            onClick={() => setSnippetsOpen(true)}
            title="Snippets"
          >
            <Bookmark className="w-3 h-3" /> snippets
          </button>
          <button
            className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1 border border-line rounded px-2 py-1"
            onClick={clearLog}
            title="Clear chat"
          >
            <RefreshCw className="w-3 h-3" /> clear
          </button>
        </div>
      </header>

      {pickerOpen && (
        <FolderPicker
          sessionToken={sessionToken}
          rootName={rootName}
          initialCwd={cwd}
          onAuthFailed={onAuthFailed}
          onPick={(p) => { setCwd(p); setPickerOpen(false); inputRef.current?.focus(); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Bubble list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {bubbles.length === 0 && <EmptyState onPick={(c) => setInput(c)} />}
        {bubbles.map((b) => (
          <BubbleRow
            key={b.id}
            bubble={b}
            onRerun={() => void send(b.command, b.cwd)}
            onEdit={() => {
              setInput(b.command);
              if (b.cwd && b.cwd !== cwd) setCwd(b.cwd);
              inputRef.current?.focus();
            }}
          />
        ))}
      </div>

      {/* Quick actions */}
      <div className="px-3 py-2 border-t border-line flex gap-2 overflow-x-auto scrollbar-thin">
        {QUICK_ACTIONS.map((c) => (
          <button
            key={c}
            onClick={() => setInput((v) => (v ? v : c))}
            className="text-[11px] font-mono text-muted hover:text-ink border border-line rounded-full px-2.5 py-1 whitespace-nowrap"
          >
            {c}
          </button>
        ))}
      </div>

      {interactiveHint && (
        <div className="mx-3 mb-2 mt-1 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium">Interactive command detected</div>
            <p className="text-warn/80 mt-0.5">{interactiveHint.message}</p>
          </div>
          {onSwitchToTerminal && (
            <button
              type="button"
              onClick={onSwitchToTerminal}
              className="shrink-0 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider border border-warn/60 text-warn rounded px-2 py-1 hover:bg-warn/20"
            >
              <TerminalIcon className="w-3 h-3" /> open terminal
            </button>
          )}
        </div>
      )}

      {/* Input bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
        className="flex items-end gap-2 px-3 py-3 border-t border-line bg-panel"
      >
        <span className="hidden md:inline text-[11px] font-mono text-muted px-2 py-1 border border-line rounded shrink-0 max-w-[40%] truncate" title={cwd}>
          {rootName}/{cwd === "." ? "" : cwd}
        </span>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder="Type a command…  (Enter to send · Shift+Enter newline · ↑/↓ history)"
          className="flex-1 resize-none bg-bg border border-line rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent/40 min-h-[36px] max-h-[160px]"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1 bg-accent text-bg rounded px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          disabled={!input.trim()}
        >
          <Send className="w-4 h-4" /> Send
        </button>
      </form>

      {snippetsOpen && (
        <SnippetDrawer
          sessionToken={sessionToken}
          onAuthFailed={onAuthFailed}
          onClose={() => setSnippetsOpen(false)}
          onUseSnippet={(snippet: Snippet) => {
            setSnippetsOpen(false);
            const targetCwd = snippet.cwd && snippet.cwd !== "." ? snippet.cwd : cwd;
            void send(snippet.command, targetCwd);
          }}
        />
      )}
    </div>
  );
}

/* ─────────── Empty state ─────────── */

function EmptyState({ onPick }: { onPick: (cmd: string) => void }) {
  return (
    <div className="text-center py-10 text-muted text-sm">
      <p className="mb-3">No commands yet. Tap a chip below or type your own.</p>
      <div className="flex flex-wrap gap-2 justify-center">
        {QUICK_ACTIONS.slice(0, 4).map((c) => (
          <button
            key={c}
            onClick={() => onPick(c)}
            className="text-[11px] font-mono border border-line rounded-full px-3 py-1 hover:text-ink hover:border-accent/50"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────── Breadcrumb ─────────── */

function Breadcrumb({ cwd, rootName, onPick }: { cwd: string; rootName: string; onPick: (p: string) => void }) {
  const segments = useMemo(() => (cwd === "." ? [] : cwd.split("/").filter(Boolean)), [cwd]);
  return (
    <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-thin">
      <button
        onClick={() => onPick(".")}
        className="text-accent hover:text-accent/80 truncate max-w-[160px]"
        title="Project root"
      >
        {rootName}
      </button>
      {segments.map((seg, i) => {
        const target = segments.slice(0, i + 1).join("/");
        return (
          <span key={target} className="flex items-center gap-0.5">
            <ChevronRight className="w-3 h-3 text-muted shrink-0" />
            <button
              onClick={() => onPick(target)}
              className="text-muted hover:text-ink truncate max-w-[140px]"
              title={target}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/* ─────────── Folder picker ─────────── */

function FolderPicker({
  sessionToken, rootName, initialCwd, onAuthFailed, onPick, onClose,
}: {
  sessionToken: string;
  rootName: string;
  initialCwd: string;
  onAuthFailed: () => void;
  onPick: (cwd: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(initialCwd);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listFiles(sessionToken, path)
      .then((r) => { if (!cancelled) setEntries(r.entries.filter((e) => e.type === "dir")); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
        setEntries([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionToken, path]);

  function up() {
    if (path === "." || path === "") return;
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    setPath(parts.join("/") || ".");
  }

  return (
    <div className="border-b border-line bg-panel/80 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={up} disabled={path === "."} className="text-muted hover:text-ink disabled:opacity-30">
            ↑
          </button>
          <span className="truncate text-muted" title={path}>
            {rootName}/{path === "." ? "" : path}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPick(path)}
            className="text-[11px] inline-flex items-center gap-1 bg-accent/15 text-accent border border-accent/40 rounded px-2 py-0.5 hover:bg-accent/25"
          >
            <Check className="w-3 h-3" /> use this folder
          </button>
          <button onClick={onClose} className="text-muted hover:text-ink p-0.5"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="mt-2 max-h-40 overflow-y-auto">
        {loading && <div className="text-xs text-muted px-1 py-2 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> loading…</div>}
        {!loading && entries && entries.length === 0 && (
          <div className="text-xs text-muted px-1 py-2">No subfolders here.</div>
        )}
        {!loading && entries && entries.length > 0 && (
          <ul className="text-sm font-mono">
            {entries.map((e) => (
              <li key={e.path}>
                <button
                  onClick={() => setPath(e.path)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-bg text-ink"
                >
                  <Folder className="w-3.5 h-3.5 text-muted" />
                  <span className="truncate">{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─────────── Bubble + formatter ─────────── */

function collectCommands(bubbles: Bubble[]): string[] {
  // Newest at the end; deduplicate consecutive duplicates so ↑ feels right.
  const out: string[] = [];
  for (const b of bubbles) {
    if (out.length === 0 || out[out.length - 1] !== b.command) out.push(b.command);
  }
  return out;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function BubbleRow({
  bubble, onRerun, onEdit,
}: {
  bubble: Bubble;
  onRerun: () => void;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState<"none" | "cmd" | "out">("none");

  function flash(kind: "cmd" | "out", text: string) {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(kind);
      setTimeout(() => setCopied("none"), 1200);
    });
  }

  const stdout = bubble.result?.stdout ?? "";
  const stderr = bubble.result?.stderr ?? "";
  const combined = stderr ? `${stdout}\n${stderr}` : stdout;

  return (
    <div className="space-y-1.5 group">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/15 border border-accent/30 px-3 py-2">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="text-[10px] font-mono text-accent/80 truncate" title={bubble.cwd}>
              {bubble.cwd === "." ? "/" : bubble.cwd}
            </div>
            <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
              <ActionButton
                onClick={() => flash("cmd", bubble.command)}
                title="Copy command"
                tone="accent"
              >
                {copied === "cmd" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </ActionButton>
              <ActionButton onClick={onEdit} title="Edit & resend" tone="accent">
                <Pencil className="w-3 h-3" />
              </ActionButton>
              <ActionButton
                onClick={onRerun}
                title="Re-run command"
                tone="accent"
                disabled={bubble.pending}
              >
                <RotateCcw className="w-3 h-3" />
              </ActionButton>
            </div>
          </div>
          <pre className="text-sm font-mono text-ink whitespace-pre-wrap break-words">{bubble.command}</pre>
        </div>
      </div>

      <div className="flex justify-start">
        <div className="max-w-[92%] rounded-lg rounded-bl-sm border border-line bg-panel px-3 py-2 w-full">
          {bubble.pending && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> running…
            </div>
          )}
          {bubble.error && (
            <div className="flex items-center gap-2 text-xs text-danger">
              <AlertTriangle className="w-3.5 h-3.5" /> {bubble.error}
            </div>
          )}
          {bubble.result && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <ResultBody r={bubble.result} />
                </div>
                {(stdout || stderr) && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <ActionButton
                      onClick={() => flash("out", combined)}
                      title="Copy output"
                      tone="muted"
                    >
                      {copied === "out" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </ActionButton>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  onClick, title, children, tone, disabled,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  tone: "accent" | "muted";
  disabled?: boolean;
}) {
  const cls = tone === "accent"
    ? "text-accent/70 hover:text-accent border border-accent/30 hover:border-accent/60"
    : "text-muted hover:text-ink border border-line hover:border-accent/40";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`inline-flex items-center justify-center w-6 h-6 rounded ${cls} disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function ResultBody({ r }: { r: ExecResult }) {
  const ok = r.exitCode === 0 && !r.timedOut;
  const formatted = formatOutput(r);
  return (
    <div>
      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono mb-2">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>
          {ok ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          exit {r.exitCode ?? "—"}{r.signal ? ` ${r.signal}` : ""}
        </span>
        <span className="inline-flex items-center gap-1 text-muted">
          <Clock className="w-3 h-3" /> {Math.max(1, Math.round(r.durationMs))}ms
        </span>
        {r.timedOut && <span className="text-warn">timed out</span>}
        {r.truncated && <span className="text-warn">output truncated</span>}
      </div>

      {formatted.kind === "empty" && (
        <p className="text-xs text-muted italic">(no output)</p>
      )}

      {formatted.kind === "json" && (
        <pre className="text-xs font-mono text-ink overflow-x-auto whitespace-pre">{formatted.body}</pre>
      )}

      {formatted.kind === "diff" && (
        <pre className="text-xs font-mono overflow-x-auto whitespace-pre">
          {formatted.lines.map((line, i) => (
            <div key={i} className={diffTone(line)}>{line || "\u00A0"}</div>
          ))}
        </pre>
      )}

      {formatted.kind === "text" && (
        <pre className="text-xs font-mono text-ink overflow-x-auto whitespace-pre-wrap break-words">{formatted.body}</pre>
      )}

      {r.stderr && formatted.kind !== "empty" && (
        <details className="mt-2">
          <summary className="text-[11px] text-warn cursor-pointer">stderr ({r.stderr.length} bytes)</summary>
          <pre className="mt-1 text-xs font-mono text-warn/90 whitespace-pre-wrap break-words">{r.stderr}</pre>
        </details>
      )}
    </div>
  );
}

function diffTone(line: string): string {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "text-muted";
  if (line.startsWith("@@")) return "text-accent";
  if (line.startsWith("+")) return "text-ok";
  if (line.startsWith("-")) return "text-danger";
  return "text-ink";
}

type Formatted =
  | { kind: "empty" }
  | { kind: "json"; body: string }
  | { kind: "diff"; lines: string[] }
  | { kind: "text"; body: string };

function formatOutput(r: ExecResult): Formatted {
  const out = (r.stdout || "").trimEnd();
  if (!out && !r.stderr) return { kind: "empty" };
  if (!out && r.stderr) return { kind: "text", body: r.stderr };

  // Try JSON
  const trimmed = out.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const parsed = JSON.parse(trimmed);
      return { kind: "json", body: JSON.stringify(parsed, null, 2) };
    } catch {
      // fall through
    }
  }

  // Diff heuristic
  const lines = out.split(/\r?\n/);
  const looksDiff =
    lines.length > 2 &&
    (lines.some((l) => l.startsWith("@@")) || (lines[0]?.startsWith("diff --git ") || lines[0]?.startsWith("--- ")));
  if (looksDiff) return { kind: "diff", lines };

  return { kind: "text", body: out };
}
