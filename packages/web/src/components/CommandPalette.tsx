import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  Search, Terminal as TerminalIcon, FolderOpen, GitBranch, MessageSquare,
  RefreshCw, History, Bookmark, Power, Moon, Lock, RotateCw, ArrowRight, Wifi, Monitor,
} from "lucide-react";
import type { Tab } from "../lib/router";
import { fetchSnippets } from "../lib/paletteData";
import type { Snippet } from "../lib/api";

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  group: "navigate" | "session" | "host" | "snippets";
  icon: React.ReactNode;
  keywords?: string;
  run: () => void | Promise<void>;
};

interface Props {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  sessionToken: string;
}

export function CommandPalette({ open, onClose, actions, sessionToken }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset on open + autofocus.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
      void fetchSnippets(sessionToken).then(setSnippets).catch(() => setSnippets([]));
    }
  }, [open, sessionToken]);

  // Snippet runner is wired via static actions; we synthesize one action per snippet.
  const merged = useMemo<PaletteAction[]>(() => {
    const dynamic: PaletteAction[] = snippets.map((s) => ({
      id: `snippet:${s.id}`,
      label: s.label,
      hint: s.command,
      group: "snippets",
      icon: <Bookmark className="w-3.5 h-3.5" />,
      keywords: [s.label, s.command, ...(s.tags || [])].join(" "),
      run: () => {
        // Dispatch event that ChatPanel listens for (so we don't need prop drilling).
        window.dispatchEvent(new CustomEvent("lawang:run-snippet", { detail: s }));
      },
    }));
    return [...actions, ...dynamic];
  }, [actions, snippets]);

  const results = useMemo(() => filterAndScore(merged, query), [merged, query]);

  // Keep active in range as results change.
  useEffect(() => { if (active >= results.length) setActive(0); }, [results, active]);

  // Scroll active into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open, results.length]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) {
        void r.run();
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line w-full max-w-xl rounded shadow-2xl flex flex-col max-h-[70vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          <Search className="w-4 h-4 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command, snippet, or destination…"
            className="flex-1 bg-transparent text-sm font-mono focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted border border-line rounded px-1 py-0.5">esc</kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {results.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted">No matches.</div>
          )}
          {renderGroups(results, active, (a) => { void a.run(); onClose(); })}
        </div>

        <footer className="px-3 py-2 border-t border-line text-[10px] font-mono text-muted flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span><kbd className="border border-line rounded px-1">↑</kbd> <kbd className="border border-line rounded px-1">↓</kbd> navigate</span>
            <span><kbd className="border border-line rounded px-1">↵</kbd> run</span>
          </div>
          <span>{results.length} result{results.length === 1 ? "" : "s"}</span>
        </footer>
      </div>
    </div>
  );
}

/* ─────────── Grouping & filtering ─────────── */

function renderGroups(items: PaletteAction[], active: number, onPick: (a: PaletteAction) => void) {
  const groups = ["navigate", "session", "host", "snippets"] as const;
  const labelOf: Record<string, string> = {
    navigate: "Navigate",
    session: "Session",
    host: "Host",
    snippets: "Snippets",
  };
  let runningIdx = 0;
  return groups.map((g) => {
    const inGroup = items.filter((i) => i.group === g);
    if (inGroup.length === 0) return null;
    return (
      <div key={g} className="py-1">
        <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-muted">{labelOf[g]}</div>
        {inGroup.map((a) => {
          const idx = runningIdx++;
          const isActive = idx === active;
          return (
            <button
              key={a.id}
              data-idx={idx}
              onClick={() => onPick(a)}
              onMouseEnter={() => { /* hover-to-activate intentionally disabled to avoid jump */ }}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm ${
                isActive ? "bg-accent/15 text-ink" : "text-muted hover:bg-bg/50"
              }`}
            >
              <span className={isActive ? "text-accent" : "text-muted"}>{a.icon}</span>
              <span className="flex-1 truncate">{a.label}</span>
              {a.hint && (
                <span className="text-[10px] font-mono text-muted truncate max-w-[200px]" title={a.hint}>
                  {a.hint}
                </span>
              )}
              {isActive && <ArrowRight className="w-3 h-3 text-accent" />}
            </button>
          );
        })}
      </div>
    );
  });
}

function filterAndScore(items: PaletteAction[], query: string): PaletteAction[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // No query: show all in group order, snippets last.
    return items;
  }
  const qChars = q.replace(/\s+/g, "");
  return items
    .map((item) => ({ item, score: scoreItem(item, q, qChars) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

function scoreItem(item: PaletteAction, q: string, qChars: string): number {
  const haystack = `${item.label} ${item.keywords ?? ""} ${item.hint ?? ""}`.toLowerCase();
  if (haystack.includes(q)) return 100 + (item.label.toLowerCase().startsWith(q) ? 20 : 0);
  // Subsequence match (fuzzy): each char of qChars must appear in order.
  let i = 0;
  for (const c of haystack) {
    if (c === qChars[i]) i++;
    if (i === qChars.length) return 50;
  }
  return 0;
}

/* ─────────── Static action factories ─────────── */

export function buildStaticActions(opts: {
  goTo: (tab: Tab) => void;
  endSession: () => void;
  rotateToken: () => Promise<void>;
  openHostMenu?: () => void;
}): PaletteAction[] {
  return [
    {
      id: "go:overview",
      label: "Go to Overview",
      group: "navigate",
      icon: <LayoutDashboard className="w-3.5 h-3.5" />,
      keywords: "dashboard home summary",
      run: () => opts.goTo("overview"),
    },
    {
      id: "go:terminal",
      label: "Go to Terminal",
      group: "navigate",
      icon: <TerminalIcon className="w-3.5 h-3.5" />,
      keywords: "shell pty",
      run: () => opts.goTo("terminal"),
    },
    {
      id: "go:files",
      label: "Go to Files",
      group: "navigate",
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      keywords: "explorer browse",
      run: () => opts.goTo("files"),
    },
    {
      id: "go:git",
      label: "Go to Git",
      group: "navigate",
      icon: <GitBranch className="w-3.5 h-3.5" />,
      keywords: "diff status commit",
      run: () => opts.goTo("git"),
    },
    {
      id: "go:desktop",
      label: "Go to Desktop",
      group: "navigate",
      icon: <Monitor className="w-3.5 h-3.5" />,
      keywords: "screen remote desktop mouse keyboard",
      run: () => opts.goTo("desktop"),
    },
    {
      id: "go:chat",
      label: "Go to Chat",
      group: "navigate",
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      keywords: "command exec",
      run: () => opts.goTo("chat"),
    },
    {
      id: "go:proxy",
      label: "Go to Proxy",
      group: "navigate",
      icon: <Wifi className="w-3.5 h-3.5" />,
      keywords: "tunnel forward",
      run: () => opts.goTo("proxy"),
    },
    {
      id: "go:audit",
      label: "Go to Audit",
      group: "navigate",
      icon: <History className="w-3.5 h-3.5" />,
      keywords: "log events",
      run: () => opts.goTo("audit"),
    },
    {
      id: "session:rotate",
      label: "Rotate pairing token",
      hint: "issue a fresh QR without restarting",
      group: "session",
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      keywords: "qr pair token refresh",
      run: () => opts.rotateToken(),
    },
    {
      id: "session:history",
      label: "Open session history",
      group: "session",
      icon: <History className="w-3.5 h-3.5" />,
      keywords: "audit past devices",
      run: () => window.dispatchEvent(new CustomEvent("lawang:open-history")),
    },
    {
      id: "session:end",
      label: "End this session",
      group: "session",
      icon: <Power className="w-3.5 h-3.5" />,
      keywords: "logout disconnect",
      run: () => opts.endSession(),
    },
  ];
}
