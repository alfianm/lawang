import { useEffect, useState } from "react";
import { Clipboard, ClipboardPaste, ClipboardCopy, Loader2, X } from "lucide-react";
import {
  AuthError,
  fetchClipboardCapabilities,
  readClipboard,
  writeClipboard,
} from "../lib/api";

interface Props {
  sessionToken: string;
  onAuthFailed: () => void;
}

type Toast = { id: number; tone: "ok" | "error"; text: string };

export function ClipboardBridge({ sessionToken, onAuthFailed }: Props) {
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function toast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { ...t, id }]);
    window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 2800);
  }

  useEffect(() => {
    let cancelled = false;
    fetchClipboardCapabilities(sessionToken)
      .then((c) => {
        if (cancelled) return;
        setSupported(c.supported);
        setProvider(c.provider);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
        setSupported(false);
      });
    return () => { cancelled = true; };
  }, [sessionToken]);

  async function pullFromHost() {
    setBusy("pull");
    try {
      const r = await readClipboard(sessionToken);
      if (r.kind === "empty" || !r.text) {
        toast({ tone: "error", text: "Host clipboard is empty." });
        setPreview(null);
      } else {
        try { await navigator.clipboard.writeText(r.text); } catch { /* ignore */ }
        setPreview(r.text);
        toast({ tone: "ok", text: r.truncated ? "Copied from host (truncated)." : "Copied from host." });
      }
    } catch (err) {
      if (err instanceof AuthError) onAuthFailed();
      else toast({ tone: "error", text: (err as Error).message || "Read failed" });
    } finally {
      setBusy(null);
    }
  }

  async function pushToHost() {
    setBusy("push");
    try {
      let text = "";
      try { text = await navigator.clipboard.readText(); } catch {
        toast({ tone: "error", text: "Browser blocked clipboard read. Paste into the box below." });
        setBusy(null);
        setOpen(true);
        return;
      }
      if (!text.trim()) {
        toast({ tone: "error", text: "Device clipboard is empty." });
        setBusy(null);
        return;
      }
      await writeClipboard(sessionToken, text);
      setPreview(text);
      toast({ tone: "ok", text: "Pasted to host clipboard." });
    } catch (err) {
      if (err instanceof AuthError) onAuthFailed();
      else toast({ tone: "error", text: (err as Error).message || "Write failed" });
    } finally {
      setBusy(null);
    }
  }

  async function pushDraft(text: string) {
    setBusy("push");
    try {
      await writeClipboard(sessionToken, text);
      setPreview(text);
      toast({ tone: "ok", text: "Pasted to host clipboard." });
      setOpen(false);
    } catch (err) {
      if (err instanceof AuthError) onAuthFailed();
      else toast({ tone: "error", text: (err as Error).message || "Write failed" });
    } finally {
      setBusy(null);
    }
  }

  if (supported === false) return null;

  return (
    <>
      <div className="inline-flex items-center gap-0.5 border border-line rounded overflow-hidden">
        <button
          onClick={() => void pullFromHost()}
          disabled={busy !== null}
          title="Copy host clipboard to this device"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-muted hover:text-ink disabled:opacity-50"
        >
          {busy === "pull" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">From host</span>
        </button>
        <span className="w-px self-stretch bg-line" />
        <button
          onClick={() => void pushToHost()}
          disabled={busy !== null}
          title="Paste this device clipboard to host"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-muted hover:text-ink disabled:opacity-50"
        >
          {busy === "push" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardPaste className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">To host</span>
        </button>
        <span className="w-px self-stretch bg-line" />
        <button
          onClick={() => setOpen(true)}
          title={provider ? `Clipboard · ${provider}` : "Clipboard"}
          className="inline-flex items-center px-1.5 py-1 text-muted hover:text-ink"
        >
          <Clipboard className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <ClipboardModal
          busy={busy === "push"}
          preview={preview}
          onClose={() => setOpen(false)}
          onPush={pushDraft}
        />
      )}

      <div className="fixed bottom-3 left-3 z-50 flex flex-col gap-2 pointer-events-none">
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
    </>
  );
}

function ClipboardModal({
  busy, preview, onClose, onPush,
}: {
  busy: boolean;
  preview: string | null;
  onClose: () => void;
  onPush: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(preview || "");

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-panel border border-line w-full max-w-lg rounded flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 text-sm">
            <Clipboard className="w-4 h-4 text-accent" />
            <span className="font-mono text-xs uppercase tracking-wider text-muted">Clipboard bridge</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3 overflow-auto">
          <p className="text-xs text-muted">
            Paste text here to send it to the host clipboard. Useful when the browser blocks direct clipboard access.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            placeholder="Paste text to send to host…"
            className="w-full bg-bg border border-line rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent/40 resize-y"
          />
          <button
            onClick={() => void onPush(draft)}
            disabled={busy || !draft.trim()}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-accent text-bg rounded text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
            Send to host clipboard
          </button>
        </div>
      </div>
    </div>
  );
}
