import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Server, Trash2, Pencil, Check, X, ExternalLink, AlertCircle } from "lucide-react";
import { listHosts, addHost, renameHost, forgetHost, navigateTo, KnownHost } from "../lib/hosts";

interface Props {
  onBack: () => void;
}

export function HostsPage({ onBack }: Props) {
  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  function reload() { setHosts(listHosts()); }
  useEffect(reload, []);

  return (
    <div className="min-h-full flex flex-col bg-bg">
      <header className="px-5 py-3 border-b border-line flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> back
        </button>
        <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-muted">§ Hosts</span>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-xs bg-accent/15 border border-accent/40 text-accent rounded px-2 py-1 hover:bg-accent/25"
        >
          <Plus className="w-3 h-3" /> Add host
        </button>
      </header>

      <main className="flex-1 px-5 sm:px-8 py-8 max-w-3xl mx-auto w-full">
        <h1 className="text-2xl font-semibold tracking-tight">Saved hosts</h1>
        <p className="text-muted mt-2 text-sm max-w-xl">
          Lawang agents you have used from this browser. Switching hosts opens
          the agent's URL — your browser will hit that origin directly.
          Sessions stay on each host's storage; switching does not share tokens.
        </p>

        {adding && (
          <AddHostForm
            onCancel={() => setAdding(false)}
            onSaved={() => { setAdding(false); reload(); }}
          />
        )}

        <div className="mt-6 border border-line rounded">
          {hosts.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-muted">
              <Server className="w-6 h-6 mx-auto mb-2" />
              No hosts saved yet. The current host registers itself
              automatically when you open a session.
            </div>
          )}

          {hosts.map((h) => (
            <div key={h.id} className={`flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0 ${h.isCurrent ? "bg-accent/5" : ""}`}>
              <Server className={`w-4 h-4 shrink-0 ${h.isCurrent ? "text-accent" : "text-muted"}`} />
              <div className="min-w-0 flex-1">
                {editId === h.id ? (
                  <RenameForm initial={h.name} onCancel={() => setEditId(null)} onSubmit={(name) => { renameHost(h.id, name); setEditId(null); reload(); }} />
                ) : (
                  <>
                    <div className="text-sm text-ink truncate">{h.name}</div>
                    <div className="font-mono text-[11px] text-muted truncate">{h.origin}</div>
                  </>
                )}
                <div className="font-mono text-[10px] text-muted mt-0.5">
                  added {new Date(h.addedAt).toLocaleDateString()}
                  {!h.isCurrent && <> · last opened {new Date(h.lastSeenAt).toLocaleDateString()}</>}
                  {h.isCurrent && <> · <span className="text-accent">current</span></>}
                </div>
              </div>
              {!editId && (
                <div className="flex items-center gap-1 shrink-0">
                  {!h.isCurrent && (
                    <button
                      onClick={() => navigateTo(h.origin)}
                      className="text-[11px] inline-flex items-center gap-1 bg-accent text-bg rounded px-2 py-1 hover:opacity-90"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditId(h.id)}
                    title="Rename"
                    className="w-7 h-7 inline-flex items-center justify-center border border-line text-muted hover:text-ink rounded"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Forget "${h.name}"? Session token on this browser stays in place; you'll just lose this bookmark.`)) {
                        forgetHost(h.id);
                        reload();
                      }
                    }}
                    title="Forget"
                    className="w-7 h-7 inline-flex items-center justify-center border border-line text-muted hover:text-danger rounded"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted mt-4 flex items-start gap-1">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          Hosts are stored in this browser only. Open Lawang in another browser
          and you start with an empty list.
        </p>
      </main>
    </div>
  );
}

function AddHostForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!origin.trim()) { setError("Origin is required."); return; }
    const r = addHost({ name, origin });
    if ("error" in r) { setError(r.error); return; }
    onSaved();
  }

  return (
    <div className="mt-6 border border-line rounded p-4 bg-panel/40 space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-accent">Add a host</div>
      <label className="block">
        <span className="block text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Name (optional)</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Office MacBook"
          className="w-full bg-bg border border-line rounded px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] font-mono uppercase tracking-wider text-muted mb-1">Origin URL</span>
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="https://soft-fern.trycloudflare.com"
          className="w-full bg-bg border border-line rounded px-2 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </label>
      {error && <div className="text-xs text-danger flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="text-xs px-3 py-2 border border-line rounded text-muted hover:text-ink">Cancel</button>
        <button onClick={submit} className="text-xs inline-flex items-center gap-1 bg-accent text-bg rounded px-3 py-2 font-medium">
          <Check className="w-3 h-3" /> Save
        </button>
      </div>
    </div>
  );
}

function RenameForm({ initial, onCancel, onSubmit }: { initial: string; onCancel: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(name); if (e.key === "Escape") onCancel(); }}
        autoFocus
        className="flex-1 bg-bg border border-line rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      <button onClick={() => onSubmit(name)} className="w-7 h-7 inline-flex items-center justify-center bg-accent text-bg rounded">
        <Check className="w-3 h-3" />
      </button>
      <button onClick={onCancel} className="w-7 h-7 inline-flex items-center justify-center border border-line text-muted rounded">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
