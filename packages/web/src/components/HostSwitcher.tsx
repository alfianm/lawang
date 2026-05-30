import { useEffect, useRef, useState } from "react";
import { Server, ChevronDown, Plus, Check, Trash2 } from "lucide-react";
import { listHosts, navigateTo, KnownHost } from "../lib/hosts";

interface Props {
  currentName: string | null;
  onOpenManage: () => void;
}

export function HostSwitcher({ currentName, onOpenManage }: Props) {
  const [open, setOpen] = useState(false);
  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setHosts(listHosts());
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const others = hosts.filter((h) => !h.isCurrent);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Switch host"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink px-2 py-1 border border-line rounded font-mono max-w-[180px]"
      >
        <Server className="w-3 h-3 shrink-0" />
        <span className="truncate">{currentName ?? "host"}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-panel border border-line rounded shadow-xl z-30 overflow-hidden">
          <div className="px-3 py-2 border-b border-line">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted">Hosts in this browser</div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {hosts.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted">No saved hosts yet.</div>
            )}
            {hosts.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  if (h.isCurrent) { setOpen(false); return; }
                  navigateTo(h.origin);
                }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-bg/50 ${h.isCurrent ? "text-ink" : "text-muted"}`}
                title={h.origin}
              >
                <Server className={`w-3.5 h-3.5 shrink-0 ${h.isCurrent ? "text-accent" : "text-muted"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{h.name}</div>
                  <div className="font-mono text-[10px] text-muted truncate">{h.origin.replace(/^https?:\/\//, "")}</div>
                </div>
                {h.isCurrent && <Check className="w-3 h-3 text-accent shrink-0" />}
              </button>
            ))}
            {others.length === 0 && hosts.some((h) => h.isCurrent) && (
              <div className="px-3 py-2 text-[11px] text-muted">No other hosts saved yet.</div>
            )}
          </div>

          <div className="border-t border-line">
            <button
              onClick={() => { setOpen(false); onOpenManage(); }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-accent hover:bg-bg/50"
            >
              <Plus className="w-3 h-3" /> Manage hosts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
