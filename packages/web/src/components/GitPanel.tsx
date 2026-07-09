import { useEffect, useState } from "react";
import {
  GitBranch, RefreshCw, Loader2, AlertTriangle, Check, X, Plus, Minus,
  Download as PullIcon, Upload as PushIcon, GitCommit, ChevronRight, ChevronDown, FileText,
} from "lucide-react";
import {
  AuthError, GitStatus, gitStatus, gitDiff, gitStage, gitUnstage,
  gitCommit, gitPull, gitPush, gitLog,
} from "../lib/api";

type Toast = { id: number; tone: "ok" | "error"; text: string };

export function GitPanel(props: {
  sessionToken: string;
  onAuthFailed: () => void;
  canWrite?: boolean;
}) {
  const canWrite = props.canWrite !== false;
  const [data, setData] = useState<GitStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ path: string; staged: boolean; diff: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [logs, setLogs] = useState<{ hash: string; date: string; author: string; message: string }[] | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [pushPrompt, setPushPrompt] = useState<{ branch: string; tracking: string | null } | null>(null);

  function toast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 3500);
  }

  function refresh() { setRefreshTick((n) => n + 1); }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    gitStatus(props.sessionToken)
      .then((s) => { if (!cancelled) setData(s); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { props.onAuthFailed(); return; }
        if ((e as Error).message?.startsWith("http_409")) setErr("This project root is not a git repository.");
        else setErr((e as Error).message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.sessionToken, refreshTick]);

  useEffect(() => {
    if (!selected) { setDiff(null); return; }
    let cancelled = false;
    setDiffLoading(true);
    const file = data?.files.find((f) => f.path === selected);
    const staged = !!file?.staged;
    gitDiff(props.sessionToken, selected, staged)
      .then((d) => { if (!cancelled) setDiff(d); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { props.onAuthFailed(); return; }
        toast({ tone: "error", text: (e as Error).message });
      })
      .finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [selected, props.sessionToken, refreshTick, data?.files]);

  useEffect(() => {
    if (!logOpen) return;
    let cancelled = false;
    gitLog(props.sessionToken, 30)
      .then((r) => { if (!cancelled) setLogs(r.commits); })
      .catch((e) => { if (e instanceof AuthError) props.onAuthFailed(); });
    return () => { cancelled = true; };
  }, [logOpen, props.sessionToken, refreshTick]);

  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    try { return await fn(); }
    catch (e) {
      if (e instanceof AuthError) { props.onAuthFailed(); return null; }
      toast({ tone: "error", text: (e as Error).message || `${label} failed` });
      return null;
    } finally { setBusy(null); }
  }

  async function stageOne(p: string) {
    if (await withBusy("stage", () => gitStage(props.sessionToken, [p]))) refresh();
  }
  async function unstageOne(p: string) {
    if (await withBusy("unstage", () => gitUnstage(props.sessionToken, [p]))) refresh();
  }
  async function stageAll() {
    if (!data) return;
    const paths = data.files.filter((f) => !f.staged).map((f) => f.path);
    if (paths.length === 0) return;
    if (await withBusy("stage all", () => gitStage(props.sessionToken, paths))) refresh();
  }
  async function unstageAll() {
    if (!data) return;
    const paths = data.files.filter((f) => f.staged).map((f) => f.path);
    if (paths.length === 0) return;
    if (await withBusy("unstage all", () => gitUnstage(props.sessionToken, paths))) refresh();
  }
  async function doCommit() {
    if (!message.trim()) { toast({ tone: "error", text: "Commit message is required" }); return; }
    const out = await withBusy("commit", () => gitCommit(props.sessionToken, message));
    if (out) {
      toast({ tone: "ok", text: `Committed ${out.commit.slice(0, 7)}` });
      setMessage("");
      refresh();
    }
  }
  async function doPull() {
    const out = await withBusy("pull", () => gitPull(props.sessionToken));
    if (out) {
      const s = out.summary;
      toast({ tone: "ok", text: `Pull ok: ${s.changes} changes (+${s.insertions}/-${s.deletions})` });
      refresh();
    }
  }

  function openPush() {
    if (!data || !data.branch) return;
    setPushPrompt({ branch: data.branch, tracking: data.tracking });
  }

  async function confirmPush() {
    if (!pushPrompt) return;
    const setUpstream = !pushPrompt.tracking;
    const out = await withBusy("push", () => gitPush(props.sessionToken, { setUpstream }));
    if (out) {
      const updated = out.pushed.filter((p) => !p.alreadyUpdated).length;
      toast({
        tone: "ok",
        text: updated > 0
          ? `Pushed ${out.branch} → ${out.remote}`
          : `${out.remote}/${out.branch} already up to date`,
      });
      setPushPrompt(null);
      refresh();
    }
  }

  if (err) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="max-w-sm rounded-md border border-line bg-panel p-4 text-sm">
          <div className="flex items-center gap-2 text-warn"><AlertTriangle className="w-4 h-4" /> Git unavailable</div>
          <div className="text-muted mt-2">{err}</div>
        </div>
      </div>
    );
  }

  const staged = data?.files.filter((f) => f.staged) ?? [];
  const unstaged = data?.files.filter((f) => !f.staged) ?? [];

  return (
    <div className="h-full flex flex-col md:flex-row min-h-0">
      <div className="md:w-1/2 md:max-w-md md:border-r border-line flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/60">
          <GitBranch className="w-4 h-4 text-accent" />
          <div className="flex-1 min-w-0 text-sm font-mono truncate">
            {data?.detached ? "(detached)" : data?.branch || "—"}
            {data?.tracking && (
              <span className="text-muted text-xs ml-2">
                ↑{data.ahead} ↓{data.behind} • {data.tracking}
              </span>
            )}
          </div>
          <button
            onClick={doPull}
            disabled={!canWrite || !data || !!busy}
            className="inline-flex items-center gap-1 text-xs text-ink border border-line hover:border-accent/40 rounded px-2 py-1 disabled:opacity-40"
            title={canWrite ? "Git pull" : "Requires git:write"}
          >
            {busy === "pull" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PullIcon className="w-3.5 h-3.5" />}
            Pull
          </button>
          <button
            onClick={openPush}
            disabled={!canWrite || !data || !data.branch || data.detached || !!busy}
            className="inline-flex items-center gap-1 text-xs text-ink border border-line hover:border-accent/40 rounded px-2 py-1 disabled:opacity-40"
            title={!canWrite ? "Requires git:write" : data?.tracking ? `Push to ${data.tracking}` : "Push (set upstream)"}
          >
            {busy === "push" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PushIcon className="w-3.5 h-3.5" />}
            Push{data && data.ahead > 0 ? ` (${data.ahead})` : ""}
          </button>
          <button onClick={refresh} title="Refresh" className="inline-flex items-center justify-center w-8 h-8 text-muted hover:text-ink">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>

        {!canWrite && (
          <div className="px-3 py-1.5 border-b border-line text-[11px] font-mono uppercase tracking-wider text-muted bg-panel/40">
            Read-only git session
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {data && data.clean && (
            <div className="p-4 text-sm text-muted">Working tree is clean.</div>
          )}
          {data && !data.clean && (
            <>
              <SectionHeader title="Staged" count={staged.length} action={canWrite && staged.length > 0 ? { label: "Unstage all", onClick: unstageAll } : undefined} />
              <FileList files={staged} onSelect={setSelected} selected={selected} onAct={canWrite ? (p) => unstageOne(p) : undefined} actLabel="Unstage" actIcon={<Minus className="w-3.5 h-3.5" />} />
              <SectionHeader title="Changes" count={unstaged.length} action={canWrite && unstaged.length > 0 ? { label: "Stage all", onClick: stageAll } : undefined} />
              <FileList files={unstaged} onSelect={setSelected} selected={selected} onAct={canWrite ? (p) => stageOne(p) : undefined} actLabel="Stage" actIcon={<Plus className="w-3.5 h-3.5" />} />
            </>
          )}
        </div>

        {canWrite && (
        <div className="border-t border-line bg-panel/60 p-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Commit message"
            className="w-full bg-bg border border-line rounded px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={doCommit}
              disabled={!data || staged.length === 0 || !!busy}
              className="inline-flex items-center gap-1 text-xs text-bg bg-accent rounded px-2.5 py-1.5 disabled:opacity-40"
            >
              {busy === "commit" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommit className="w-3.5 h-3.5" />}
              Commit {staged.length > 0 ? `(${staged.length})` : ""}
            </button>
            <button
              onClick={() => setLogOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
            >
              {logOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              History
            </button>
          </div>
          {logOpen && logs && (
            <ul className="mt-2 max-h-40 overflow-auto text-[11px] font-mono divide-y divide-line border border-line rounded">
              {logs.map((c) => (
                <li key={c.hash} className="px-2 py-1.5">
                  <div className="text-ink truncate">{c.message.split("\n")[0]}</div>
                  <div className="text-muted">{c.hash.slice(0, 7)} • {c.author.split(" <")[0]} • {new Date(c.date).toLocaleString()}</div>
                </li>
              ))}
              {logs.length === 0 && <li className="px-2 py-2 text-muted">No commits yet.</li>}
            </ul>
          )}
        </div>
        )}
        {!canWrite && (
          <div className="border-t border-line bg-panel/60 p-2">
            <button
              onClick={() => setLogOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
            >
              {logOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              History
            </button>
            {logOpen && logs && (
              <ul className="mt-2 max-h-40 overflow-auto text-[11px] font-mono divide-y divide-line border border-line rounded">
                {logs.map((c) => (
                  <li key={c.hash} className="px-2 py-1.5">
                    <div className="text-ink truncate">{c.message.split("\n")[0]}</div>
                    <div className="text-muted">{c.hash.slice(0, 7)} • {c.author.split(" <")[0]} • {new Date(c.date).toLocaleString()}</div>
                  </li>
                ))}
                {logs.length === 0 && <li className="px-2 py-2 text-muted">No commits yet.</li>}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/60">
          <FileText className="w-4 h-4 text-muted" />
          <div className="flex-1 min-w-0 text-sm truncate">
            {selected ?? <span className="text-muted">Select a file to view diff</span>}
          </div>
          {selected && <button onClick={() => { setSelected(null); setDiff(null); }} className="text-muted hover:text-ink"><X className="w-4 h-4" /></button>}
        </div>
        <div className="flex-1 overflow-auto bg-bg min-h-0">
          {diffLoading && <div className="p-4 text-sm text-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading diff…</div>}
          {!diffLoading && diff && <DiffView text={diff.diff} />}
          {!diffLoading && !diff && !selected && (
            <div className="hidden md:flex h-full items-center justify-center text-muted text-sm">
              Click a file in the list to inspect changes.
            </div>
          )}
        </div>
      </div>

      <ToastStack toasts={toasts} />
      {pushPrompt && (
        <PushConfirm
          branch={pushPrompt.branch}
          tracking={pushPrompt.tracking}
          ahead={data?.ahead ?? 0}
          busy={busy === "push"}
          onCancel={() => setPushPrompt(null)}
          onConfirm={confirmPush}
        />
      )}
    </div>
  );
}

function SectionHeader(props: { title: string; count: number; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted bg-panel/40 border-y border-line">
      <span>{props.title} {props.count > 0 ? `(${props.count})` : ""}</span>
      {props.action && (
        <button onClick={props.action.onClick} className="text-accent hover:underline">{props.action.label}</button>
      )}
    </div>
  );
}

function FileList(props: {
  files: { path: string; staged: boolean; unstaged: boolean; untracked: boolean; index: string; workingDir: string }[];
  onSelect: (p: string) => void;
  selected: string | null;
  onAct?: (p: string) => void;
  actLabel: string;
  actIcon: React.ReactNode;
}) {
  if (props.files.length === 0) return null;
  return (
    <ul className="divide-y divide-line">
      {props.files.map((f) => (
        <li key={f.path}>
          <div className={`flex items-center gap-2 px-3 py-1.5 ${props.selected === f.path ? "bg-line" : "hover:bg-panel"}`}>
            <span className={`inline-block w-4 text-center text-[10px] font-mono ${labelColor(f)}`}>{statusGlyph(f)}</span>
            <button onClick={() => props.onSelect(f.path)} className="flex-1 text-left text-sm truncate">{f.path}</button>
            {props.onAct && (
              <button
                onClick={() => props.onAct?.(f.path)}
                title={props.actLabel}
                className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink border border-line hover:border-accent/40 rounded px-1.5 py-0.5"
              >
                {props.actIcon}
                {props.actLabel}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function statusGlyph(f: { index: string; workingDir: string; untracked: boolean; staged: boolean }) {
  if (f.untracked) return "U";
  if (f.staged && (f.workingDir === " " || f.workingDir === "")) return f.index.trim() || "•";
  return (f.workingDir || "M").trim() || "•";
}
function labelColor(f: { staged: boolean; untracked: boolean }) {
  if (f.untracked) return "text-warn";
  if (f.staged) return "text-ok";
  return "text-accent";
}

function DiffView({ text }: { text: string }) {
  if (!text || text.trim().length === 0) {
    return <div className="p-4 text-muted text-sm">No diff available (binary or no changes).</div>;
  }
  const lines = text.split("\n");
  return (
    <pre className="text-xs font-mono whitespace-pre">
      {lines.map((l, i) => {
        let cls = "block px-3 ";
        if (l.startsWith("+++") || l.startsWith("---")) cls += "text-muted";
        else if (l.startsWith("@@")) cls += "text-accent";
        else if (l.startsWith("+")) cls += "text-ok bg-ok/5";
        else if (l.startsWith("-")) cls += "text-danger bg-danger/5";
        else cls += "text-ink/80";
        return <span key={i} className={cls}>{l || " "}</span>;
      })}
    </pre>
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

function PushConfirm(props: {
  branch: string;
  tracking: string | null;
  ahead: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm">
      <div className="w-[min(420px,92vw)] rounded-md border border-line bg-panel p-4 shadow-xl">
        <div className="flex items-center gap-2 text-ink text-sm font-medium">
          <PushIcon className="w-4 h-4 text-accent" />
          Confirm git push
        </div>
        <div className="mt-3 text-xs text-muted space-y-1.5">
          <div>
            Branch: <span className="font-mono text-ink">{props.branch}</span>
          </div>
          <div>
            Target: <span className="font-mono text-ink">{props.tracking || `origin/${props.branch} (new upstream)`}</span>
          </div>
          {props.ahead > 0 && (
            <div>Ahead: <span className="font-mono text-ink">{props.ahead}</span> commit{props.ahead === 1 ? "" : "s"}</div>
          )}
          {!props.tracking && (
            <div className="text-warn">No upstream set. This will run with --set-upstream.</div>
          )}
          <div className="pt-1">This action publishes commits to the remote. It cannot be undone from here.</div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={props.onCancel}
            disabled={props.busy}
            className="text-xs text-muted hover:text-ink border border-line rounded px-3 py-1.5 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={props.onConfirm}
            disabled={props.busy}
            className="inline-flex items-center gap-1 text-xs text-bg bg-accent rounded px-3 py-1.5 disabled:opacity-40"
          >
            {props.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PushIcon className="w-3.5 h-3.5" />}
            Push
          </button>
        </div>
      </div>
    </div>
  );
}
