import { useEffect, useState } from "react";
import {
  Bookmark, Plus, Pencil, Trash2, Loader2, AlertTriangle,
  Check, X, ArrowRight, Search, Hash,
} from "lucide-react";
import {
  listSnippets, createSnippet, updateSnippet, deleteSnippet,
  recordSnippetUsage, AuthError, Snippet,
} from "../lib/api";

interface Props {
  sessionToken: string;
  onAuthFailed: () => void;
  onUseSnippet: (snippet: Snippet) => void;   // parent insert ke input + run
  onClose: () => void;
}

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string };

export function SnippetDrawer({ sessionToken, onAuthFailed, onUseSnippet, onClose }: Props) {
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [filter, setFilter] = useState("");

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const r = await listSnippets(sessionToken);
      setSnippets(r.snippets);
    } catch (err) {
      if (err instanceof AuthError) { onAuthFailed(); return; }
      setError((err as Error).message);
      setSnippets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [sessionToken]);

  async function handleUse(s: Snippet) {
    onUseSnippet(s);
    void recordSnippetUsage(sessionToken, s.id).catch(() => {});
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this snippet?")) return;
    try {
      await deleteSnippet(sessionToken, id);
      await reload();
    } catch (err) {
      if (err instanceof AuthError) { onAuthFailed(); return; }
      setError((err as Error).message);
    }
  }

  const filtered = (snippets || []).filter((s) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      s.label.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q) ||
      (s.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-end md:items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line w-full max-w-xl max-h-[85vh] flex flex-col rounded"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 text-sm">
            <Bookmark className="w-4 h-4 text-accent" />
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Snippets</span>
          </div>
          <div className="flex items-center gap-2">
            {mode.kind === "list" && (
              <button
                onClick={() => setMode({ kind: "create" })}
                className="text-[11px] inline-flex items-center gap-1 bg-accent/15 text-accent border border-accent/40 rounded px-2 py-1 hover:bg-accent/25"
              >
                <Plus className="w-3 h-3" /> New
              </button>
            )}
            <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {mode.kind === "list" && (
          <>
            <div className="px-4 py-2 border-b border-line">
              <div className="flex items-center gap-2 bg-bg border border-line rounded px-2 py-1.5">
                <Search className="w-3.5 h-3.5 text-muted" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by label, command, or tag…"
                  className="flex-1 bg-transparent text-sm font-mono focus:outline-none"
                />
                {filter && (
                  <button onClick={() => setFilter("")} className="text-muted hover:text-ink">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="p-6 text-muted text-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> loading…
                </div>
              )}
              {error && (
                <div className="p-4 mx-4 mt-3 border border-danger/40 bg-danger/5 text-danger text-xs flex items-start gap-2 rounded">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <EmptyHint hasAny={!!snippets?.length} hasFilter={!!filter.trim()} onCreate={() => setMode({ kind: "create" })} />
              )}
              {!loading && filtered.length > 0 && (
                <ul className="divide-y divide-line">
                  {filtered.map((s) => (
                    <li key={s.id} className="px-4 py-3 group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-ink truncate">{s.label}</span>
                            {s.usageCount > 0 && (
                              <span className="text-[10px] font-mono text-muted">used {s.usageCount}×</span>
                            )}
                            {s.tags && s.tags.length > 0 && s.tags.map((t) => (
                              <span key={t} className="text-[10px] font-mono text-accent/80 inline-flex items-center gap-0.5">
                                <Hash className="w-2.5 h-2.5" />{t}
                              </span>
                            ))}
                          </div>
                          <code className="block mt-1 text-xs font-mono text-muted truncate" title={s.command}>{s.command}</code>
                          {s.description && (
                            <p className="mt-1 text-[11px] text-muted">{s.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 md:opacity-60 transition-opacity">
                          <IconButton onClick={() => setMode({ kind: "edit", id: s.id })} title="Edit">
                            <Pencil className="w-3 h-3" />
                          </IconButton>
                          <IconButton onClick={() => handleDelete(s.id)} title="Delete" tone="danger">
                            <Trash2 className="w-3 h-3" />
                          </IconButton>
                          <button
                            onClick={() => handleUse(s)}
                            className="ml-1 inline-flex items-center gap-1 text-[11px] bg-accent text-bg rounded px-2 py-1 hover:opacity-90"
                          >
                            Run <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {mode.kind === "create" && (
          <SnippetForm
            initial={null}
            onCancel={() => setMode({ kind: "list" })}
            onSubmit={async (input) => {
              try {
                await createSnippet(sessionToken, input);
                setMode({ kind: "list" });
                await reload();
              } catch (err) {
                if (err instanceof AuthError) { onAuthFailed(); return "Auth failed"; }
                if ((err as Error).message === "duplicate_label") return "A snippet with that label already exists.";
                return (err as Error).message;
              }
              return null;
            }}
          />
        )}

        {mode.kind === "edit" && snippets && (
          (() => {
            const target = snippets.find((s) => s.id === mode.id);
            if (!target) {
              setMode({ kind: "list" });
              return null;
            }
            return (
              <SnippetForm
                initial={target}
                onCancel={() => setMode({ kind: "list" })}
                onSubmit={async (input) => {
                  try {
                    await updateSnippet(sessionToken, target.id, input);
                    setMode({ kind: "list" });
                    await reload();
                  } catch (err) {
                    if (err instanceof AuthError) { onAuthFailed(); return "Auth failed"; }
                    if ((err as Error).message === "duplicate_label") return "A snippet with that label already exists.";
                    return (err as Error).message;
                  }
                  return null;
                }}
              />
            );
          })()
        )}
      </div>
    </div>
  );
}

function IconButton({ onClick, title, children, tone }: { onClick: () => void; title: string; children: React.ReactNode; tone?: "danger" }) {
  const cls = tone === "danger"
    ? "text-muted hover:text-danger border border-line hover:border-danger/40"
    : "text-muted hover:text-ink border border-line hover:border-accent/40";
  return (
    <button onClick={onClick} title={title} className={`inline-flex items-center justify-center w-7 h-7 rounded ${cls}`}>
      {children}
    </button>
  );
}

function EmptyHint({ hasAny, hasFilter, onCreate }: { hasAny: boolean; hasFilter: boolean; onCreate: () => void }) {
  if (hasFilter) {
    return <div className="p-6 text-muted text-sm">No snippets match your filter.</div>;
  }
  if (!hasAny) {
    return (
      <div className="p-6 text-center">
        <Bookmark className="w-6 h-6 text-muted mx-auto mb-2" />
        <p className="text-sm text-ink mb-1">No snippets yet</p>
        <p className="text-xs text-muted mb-4">Save commands you run often. Tap to insert them into Chat in one tap.</p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1 bg-accent text-bg text-sm rounded px-3 py-1.5 hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" /> Add your first
        </button>
      </div>
    );
  }
  return null;
}

function SnippetForm({
  initial, onCancel, onSubmit,
}: {
  initial: Snippet | null;
  onCancel: () => void;
  onSubmit: (input: { label: string; command: string; cwd?: string; description?: string; tags?: string[] }) => Promise<string | null>;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [cwd, setCwd] = useState(initial?.cwd ?? ".");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tagsRaw, setTagsRaw] = useState((initial?.tags ?? []).join(" "));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!label.trim() || !command.trim()) {
      setError("Label and command are required.");
      return;
    }
    setSubmitting(true);
    const tags = tagsRaw.split(/\s+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
    const r = await onSubmit({
      label: label.trim(),
      command: command.trim(),
      cwd: cwd.trim() || undefined,
      description: description.trim() || undefined,
      tags: tags.length ? tags : undefined,
    });
    setSubmitting(false);
    if (r) setError(r);
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <Field label="Label">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="git push current"
          className="w-full bg-bg border border-line rounded px-2 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </Field>
      <Field label="Command">
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          rows={3}
          placeholder="git push origin HEAD"
          className="w-full bg-bg border border-line rounded px-2 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="cwd">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="."
            className="w-full bg-bg border border-line rounded px-2 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </Field>
        <Field label="Tags (space-separated)">
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="git deploy"
            className="w-full bg-bg border border-line rounded px-2 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </Field>
      </div>
      <Field label="Description (optional)">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Push current branch to origin."
          className="w-full bg-bg border border-line rounded px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </Field>
      {error && (
        <div className="text-xs text-danger flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {error}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <button onClick={onCancel} disabled={submitting} className="text-xs px-3 py-2 border border-line rounded text-muted hover:text-ink disabled:opacity-50">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="text-xs inline-flex items-center gap-1 bg-accent text-bg rounded px-3 py-2 font-medium disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
          {submitting ? "Saving…" : <><Check className="w-3 h-3" /> Save</>}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-mono uppercase tracking-wider text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
