import { useEffect, useMemo, useRef, useState } from "react";
import {
  Folder, FileText, FileCode, FileImage, File as FileIcon,
  ChevronRight, Home, Download, RefreshCw, Loader2, AlertTriangle, ArrowLeft, X,
  FilePlus, FolderPlus, Upload, Pencil, Trash2, Save, MoreVertical, Search
} from "lucide-react";
import {
  AuthError, DirEntry, FileReadResponse, ListDirResponse,
  downloadUrl, listFiles, readFile,
  writeFile, uploadFile, makeDir, renameEntry, deleteEntry,
} from "../lib/api";
import { lazy, Suspense } from "react";
const CodeEditor = lazy(() => import("./CodeEditor").then(m => ({ default: m.CodeEditor })));

type Toast = { id: number; tone: "ok" | "error"; text: string };

export function FilesPanel(props: {
  sessionToken: string;
  onAuthFailed: () => void;
  rootName: string;
  canWrite?: boolean;
}) {
  const canWrite = props.canWrite !== false;
  const [cwd, setCwd] = useState<string>(".");
  const [data, setData] = useState<ListDirResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<DirEntry | null>(null);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; danger?: boolean; onConfirm: () => void | Promise<void> }>(null);
  const [prompt, setPrompt] = useState<null | { title: string; placeholder?: string; initial?: string; onConfirm: (value: string) => void | Promise<void> }>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 3500);
  }

  function reload() { setReloadTick((n) => n + 1); }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    listFiles(props.sessionToken, cwd)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { props.onAuthFailed(); return; }
        if ((e as Error).message?.startsWith("http_404")) setErr("Path not found.");
        else if ((e as Error).message?.startsWith("http_403")) setErr("Path is outside the project root.");
        else setErr((e as Error).message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, props.sessionToken, reloadTick]);

  function navigate(entry: DirEntry) {
    if (entry.type === "dir") { setOpenFile(null); setCwd(entry.path); return; }
    setOpenFile(entry);
  }

  function up() {
    if (cwd === "." || cwd === "") return;
    const parts = cwd.split("/").filter(Boolean);
    parts.pop();
    setCwd(parts.length ? parts.join("/") : ".");
    setOpenFile(null);
  }

  function joinPath(name: string) {
    if (cwd === "." || cwd === "") return name;
    return `${cwd}/${name}`;
  }

  async function handleNewFile() {
    setPrompt({
      title: "New file",
      placeholder: "filename.txt",
      onConfirm: async (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        try {
          await writeFile(props.sessionToken, joinPath(trimmed), "");
          toast({ tone: "ok", text: `Created ${trimmed}` });
          reload();
        } catch (e) { toastError(e); }
      },
    });
  }

  async function handleNewDir() {
    setPrompt({
      title: "New folder",
      placeholder: "new-folder",
      onConfirm: async (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        try {
          await makeDir(props.sessionToken, joinPath(trimmed));
          toast({ tone: "ok", text: `Created ${trimmed}/` });
          reload();
        } catch (e) { toastError(e); }
      },
    });
  }

  async function handleUpload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    let okCount = 0;
    for (const f of Array.from(files)) {
      try {
        await uploadFile(props.sessionToken, joinPath(f.name), f);
        okCount += 1;
      } catch (e) { toastError(e, `Upload failed: ${f.name}`); }
    }
    if (okCount > 0) toast({ tone: "ok", text: `Uploaded ${okCount} file${okCount > 1 ? "s" : ""}` });
    reload();
  }

  function handleRename(entry: DirEntry) {
    setPrompt({
      title: `Rename ${entry.name}`,
      initial: entry.name,
      onConfirm: async (newName) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === entry.name) return;
        const parent = entry.path.includes("/") ? entry.path.split("/").slice(0, -1).join("/") : "";
        const target = parent ? `${parent}/${trimmed}` : trimmed;
        try {
          await renameEntry(props.sessionToken, entry.path, target);
          toast({ tone: "ok", text: `Renamed to ${trimmed}` });
          if (openFile && openFile.path === entry.path) setOpenFile({ ...entry, name: trimmed, path: target });
          reload();
        } catch (e) { toastError(e); }
      },
    });
  }

  function handleDelete(entry: DirEntry) {
    setConfirm({
      title: `Delete ${entry.name}?`,
      body: entry.type === "dir"
        ? `This will permanently delete the folder and everything inside it. This action cannot be undone.`
        : `This will permanently delete this file. This action cannot be undone.`,
      danger: true,
      onConfirm: async () => {
        try {
          await deleteEntry(props.sessionToken, entry.path);
          toast({ tone: "ok", text: `Deleted ${entry.name}` });
          if (openFile && openFile.path === entry.path) setOpenFile(null);
          reload();
        } catch (e) { toastError(e); }
      },
    });
  }

  function toastError(e: unknown, fallback = "Action failed") {
    if (e instanceof AuthError) { props.onAuthFailed(); return; }
    const msg = (e as Error).message || fallback;
    toast({ tone: "error", text: msg });
  }

  const crumbs = useMemo(() => buildCrumbs(cwd), [cwd]);
  const filteredEntries = useMemo(() => {
    const entries = data?.entries || [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      return entry.name.toLowerCase().includes(q) || entry.path.toLowerCase().includes(q);
    });
  }, [data, query]);
  const rootLabel = props.rootName || "root";

  return (
    <div
      className="relative h-full flex flex-col md:flex-row min-h-0"
      onDragOver={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!canWrite) return;
        void handleUpload(e.dataTransfer.files);
      }}
    >
      <div className={`md:w-1/2 md:max-w-md md:border-r border-line flex flex-col min-h-0 ${openFile ? "hidden md:flex" : "flex"}`}>
        <Toolbar
          rootLabel={rootLabel}
          crumbs={crumbs}
          onCrumb={(p) => { setCwd(p); setOpenFile(null); }}
          onUp={up}
          onRefresh={reload}
          loading={loading}
        />
        <ActionBar
          query={query}
          onQueryChange={setQuery}
          canWrite={canWrite}
          onNewFile={handleNewFile}
          onNewDir={handleNewDir}
          onUploadClick={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
        />
        <div className="flex-1 overflow-auto">
          {err && (
            <div className="m-3 flex items-start gap-2 text-sm text-danger bg-danger/5 border border-danger/30 rounded p-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}
          {!err && data && (
            <ul role="list" className="divide-y divide-line">
              {cwd !== "." && (
                <li>
                  <button onClick={up} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-panel text-sm">
                    <ArrowLeft className="w-4 h-4 text-muted" />
                    <span className="text-muted">..</span>
                  </button>
                </li>
              )}
              {data.entries.length === 0 ? (
                <li className="px-3 py-6 text-sm text-muted text-center">Empty folder</li>
              ) : filteredEntries.length === 0 ? (
                <li className="px-3 py-6 text-sm text-muted text-center">No matches</li>
              ) : (
                filteredEntries.map((e) => (
                  <EntryRow
                    key={e.path}
                    entry={e}
                    canWrite={canWrite}
                    onOpen={() => navigate(e)}
                    onRename={() => handleRename(e)}
                    onDelete={() => handleDelete(e)}
                  />
                ))
              )}
            </ul>
          )}
          {!err && !data && loading && (
            <div className="p-4 text-sm text-muted flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> loading…
            </div>
          )}
        </div>
      </div>

      <div className={`flex-1 min-h-0 ${openFile ? "flex" : "hidden md:flex"} flex-col`}>
        {openFile ? (
          <FilePreview
            sessionToken={props.sessionToken}
            entry={openFile}
            canWrite={canWrite}
            onClose={() => setOpenFile(null)}
            onAuthFailed={props.onAuthFailed}
            onSaved={() => { reload(); }}
            onError={(e) => toastError(e)}
          />
        ) : (
          <div className="hidden md:flex h-full items-center justify-center text-muted text-sm">
            Select a file to preview.
          </div>
        )}
      </div>

      {dragging && canWrite && (
        <div className="absolute inset-0 z-30 bg-accent/10 border-2 border-accent/60 border-dashed flex items-center justify-center pointer-events-none">
          <div className="rounded-md border border-accent/50 bg-panel px-4 py-3 text-sm text-ink shadow-lg">
            <Upload className="w-5 h-5 text-accent inline-block mr-2" />
            Drop files to upload into {cwd === "." ? rootLabel : cwd}
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} />
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { await confirm.onConfirm(); setConfirm(null); }}
        />
      )}
      {prompt && (
        <PromptModal
          title={prompt.title}
          placeholder={prompt.placeholder}
          initial={prompt.initial}
          onCancel={() => setPrompt(null)}
          onConfirm={async (v) => { await prompt.onConfirm(v); setPrompt(null); }}
        />
      )}
    </div>
  );
}

function ActionBar(props: {
  query: string;
  onQueryChange: (value: string) => void;
  canWrite: boolean;
  onNewFile: () => void;
  onNewDir: () => void;
  onUploadClick: () => void;
}) {
  return (
    <div className="border-b border-line bg-panel/40">
      {props.canWrite ? (
        <div className="flex items-center gap-1 px-2 py-1">
          <ToolButton onClick={props.onNewFile} title="New file" icon={<FilePlus className="w-4 h-4" />} label="File" />
          <ToolButton onClick={props.onNewDir} title="New folder" icon={<FolderPlus className="w-4 h-4" />} label="Folder" />
          <ToolButton onClick={props.onUploadClick} title="Upload files" icon={<Upload className="w-4 h-4" />} label="Upload" />
        </div>
      ) : (
        <div className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-muted">
          Read-only session
        </div>
      )}
      <div className="px-2 pb-2">
        <label className="flex items-center gap-2 rounded border border-line bg-bg px-2 py-1.5 text-xs text-muted">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <input
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            placeholder="Search current folder"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none"
          />
          {props.query && (
            <button
              type="button"
              onClick={() => props.onQueryChange("")}
              className="text-muted hover:text-ink"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>
      </div>
    </div>
  );
}

function ToolButton(props: { onClick: () => void; title: string; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      className="inline-flex items-center gap-1 text-xs text-ink/90 px-2 py-1.5 rounded hover:bg-line"
    >
      {props.icon}
      <span className="hidden sm:inline">{props.label}</span>
    </button>
  );
}

function EntryRow(props: {
  entry: DirEntry;
  canWrite: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="relative">
      <div className="flex items-center hover:bg-panel">
        <button onClick={props.onOpen} className="flex-1 flex items-center gap-2 px-3 py-2 text-left min-w-0">
          <EntryIcon entry={props.entry} />
          <span className="flex-1 truncate text-sm">{props.entry.name}</span>
          <span className="text-[11px] text-muted font-mono shrink-0">
            {props.entry.type === "dir" ? "" : formatSize(props.entry.size)}
          </span>
        </button>
        {props.canWrite && (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="px-2 py-2 text-muted hover:text-ink"
            title="More"
            aria-label="More actions"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
      </div>
      {menuOpen && props.canWrite && (
        <>
          <button className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
          <div className="absolute right-2 top-9 z-20 w-40 rounded border border-line bg-panel shadow-lg text-sm overflow-hidden">
            <button
              onClick={() => { setMenuOpen(false); props.onRename(); }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-line text-left"
            >
              <Pencil className="w-3.5 h-3.5" /> Rename
            </button>
            <button
              onClick={() => { setMenuOpen(false); props.onDelete(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-danger hover:bg-line text-left"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function Toolbar(props: {
  rootLabel: string;
  crumbs: { label: string; path: string }[];
  onCrumb: (p: string) => void;
  onUp: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-2 border-b border-line bg-panel/60">
      <button onClick={() => props.onCrumb(".")} title="Project root" className="inline-flex items-center justify-center w-8 h-8 text-muted hover:text-ink">
        <Home className="w-4 h-4" />
      </button>
      <button onClick={props.onUp} title="Up one level" disabled={props.crumbs.length <= 1} className="inline-flex items-center justify-center w-8 h-8 text-muted hover:text-ink disabled:opacity-30">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-thin px-1 text-sm font-mono">
        {props.crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-1 shrink-0">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted/60" />}
            <button onClick={() => props.onCrumb(c.path)} className="text-muted hover:text-ink truncate max-w-[40vw]">
              {i === 0 ? props.rootLabel : c.label}
            </button>
          </span>
        ))}
      </div>
      <button onClick={props.onRefresh} title="Refresh" className="inline-flex items-center justify-center w-8 h-8 text-muted hover:text-ink">
        {props.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
      </button>
    </div>
  );
}

function FilePreview(props: {
  sessionToken: string;
  entry: DirEntry;
  canWrite?: boolean;
  onClose: () => void;
  onAuthFailed: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const canWrite = props.canWrite !== false;
  const [data, setData] = useState<FileReadResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null); setData(null); setEditing(false); setDraft("");
    readFile(props.sessionToken, props.entry.path)
      .then((d) => { if (!cancelled) { setData(d); setDraft(d.encoding === "utf8" ? d.content : ""); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { props.onAuthFailed(); return; }
        if ((e as Error).message?.startsWith("http_413")) setErr("File is too large to preview. Use download.");
        else if ((e as Error).message?.startsWith("http_404")) setErr("File not found.");
        else setErr((e as Error).message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.entry.path, props.sessionToken]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      await writeFile(props.sessionToken, props.entry.path, draft, "utf8");
      setData({ ...data, content: draft, size: new Blob([draft]).size, modifiedAt: new Date().toISOString() });
      setEditing(false);
      props.onSaved();
    } catch (e) { props.onError(e); }
    finally { setSaving(false); }
  }

  const dlUrl = downloadUrl(props.sessionToken, props.entry.path);
  const canEdit = canWrite && !!data && !data.isBinary;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/60">
        <button onClick={props.onClose} className="md:hidden inline-flex items-center justify-center w-8 h-8 text-muted hover:text-ink" title="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <EntryIcon entry={props.entry} />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{props.entry.name}</div>
          <div className="text-[11px] text-muted font-mono truncate">
            {props.entry.path} • {formatSize(data?.size ?? props.entry.size)} • {data?.mime ?? "…"}
            {!canWrite ? " • read-only" : ""}
          </div>
        </div>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs text-ink border border-line hover:border-accent/40 rounded px-2 py-1" title="Edit">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        {canEdit && editing && (
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs text-bg bg-accent rounded px-2 py-1 disabled:opacity-50" title="Save">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
          </button>
        )}
        <a href={dlUrl} download={props.entry.name} className="inline-flex items-center gap-1 text-xs text-accent border border-accent/40 hover:bg-accent/10 rounded px-2 py-1" title="Download">
          <Download className="w-3.5 h-3.5" /> Download
        </a>
        <button onClick={props.onClose} className="hidden md:inline-flex items-center justify-center w-8 h-8 text-muted hover:text-ink" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-bg min-h-0">
        {loading && (
          <div className="p-4 text-sm text-muted flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> loading…
          </div>
        )}
        {err && (
          <div className="m-3 flex items-start gap-2 text-sm text-danger bg-danger/5 border border-danger/30 rounded p-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}
        {!loading && !err && data && (
          editing ? (
            <div className="h-full">
              <Suspense fallback={<div className="p-4 text-muted text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading editor…</div>}>
                <CodeEditor
                  path={props.entry.path}
                  value={draft}
                  onChange={setDraft}
                  onSave={save}
                />
              </Suspense>
            </div>
          ) : (
            <PreviewBody data={data} />
          )
        )}
      </div>
    </div>
  );
}

function PreviewBody({ data }: { data: FileReadResponse }) {
  if (data.isBinary && data.mime.startsWith("image/")) {
    const src = `data:${data.mime};base64,${data.content}`;
    return (
      <div className="flex items-center justify-center p-4">
        <img src={src} alt={data.path} className="max-w-full max-h-[70vh] object-contain rounded" />
      </div>
    );
  }
  if (data.isBinary) {
    return (
      <div className="p-6 text-sm text-muted">
        Binary file ({data.mime}). Use the download button to fetch it locally.
      </div>
    );
  }
  return (
    <pre className="text-xs leading-relaxed font-mono p-4 whitespace-pre-wrap break-words">
      {data.content}
    </pre>
  );
}

function EntryIcon({ entry }: { entry: DirEntry }) {
  if (entry.type === "dir") return <Folder className="w-4 h-4 text-accent" />;
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";
  if (["png","jpg","jpeg","gif","svg","webp"].includes(ext)) return <FileImage className="w-4 h-4 text-muted" />;
  if (["js","ts","tsx","jsx","mjs","cjs","json","yaml","yml","html","css","sh","py","go","rs","java","rb","php"].includes(ext)) {
    return <FileCode className="w-4 h-4 text-muted" />;
  }
  if (["md","txt","log"].includes(ext)) return <FileText className="w-4 h-4 text-muted" />;
  return <FileIcon className="w-4 h-4 text-muted" />;
}

function buildCrumbs(p: string) {
  if (!p || p === ".") return [{ label: "/", path: "." }];
  const parts = p.split("/").filter(Boolean);
  const out: { label: string; path: string }[] = [{ label: "/", path: "." }];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push({ label: part, path: acc });
  }
  return out;
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ---- Modals + toasts ----

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

function ConfirmModal(props: { title: string; body: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-md border border-line bg-panel p-4">
        <div className="flex items-start gap-2 text-ink">
          {props.danger && <AlertTriangle className="w-4 h-4 text-danger mt-0.5" />}
          <h2 className="font-medium">{props.title}</h2>
        </div>
        <p className="text-sm text-muted mt-2">{props.body}</p>
        <div className="mt-4 flex justify-end gap-2 text-sm">
          <button onClick={props.onCancel} className="text-muted hover:text-ink px-3 py-1.5">Cancel</button>
          <button
            onClick={props.onConfirm}
            className={`rounded px-3 py-1.5 text-bg font-medium ${props.danger ? "bg-danger" : "bg-accent"}`}
          >
            {props.danger ? "Delete" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptModal(props: { title: string; placeholder?: string; initial?: string; onCancel: () => void; onConfirm: (v: string) => void }) {
  const [val, setVal] = useState(props.initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
      <form
        onSubmit={(e) => { e.preventDefault(); props.onConfirm(val); }}
        className="w-full max-w-sm rounded-md border border-line bg-panel p-4"
      >
        <h2 className="font-medium text-ink">{props.title}</h2>
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={props.placeholder}
          className="mt-3 w-full bg-bg border border-line rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        <div className="mt-4 flex justify-end gap-2 text-sm">
          <button type="button" onClick={props.onCancel} className="text-muted hover:text-ink px-3 py-1.5">Cancel</button>
          <button type="submit" className="rounded px-3 py-1.5 bg-accent text-bg font-medium">OK</button>
        </div>
      </form>
    </div>
  );
}
