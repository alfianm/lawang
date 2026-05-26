import { useEffect, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { fetchVersion, VersionInfo } from "../lib/api";

const DISMISS_KEY = "lawang:update-dismiss";

export function UpdateBanner() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetchVersion();
        if (!cancelled) setInfo(r);
      } catch {
        // silent: no banner if we cannot determine versions
      }
    }
    void load();
    const t = setInterval(load, 60 * 60 * 1000); // refresh hourly
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!info || !info.outdated || !info.latest) return null;
  if (dismissed === info.latest) return null;

  function dismiss() {
    if (!info?.latest) return;
    try { localStorage.setItem(DISMISS_KEY, info.latest); } catch { /* ignore */ }
    setDismissed(info.latest);
  }

  return (
    <div className="hidden md:inline-flex items-center gap-2 text-[11px] font-mono text-warn px-2 py-1 border border-warn/40 rounded">
      <ArrowUpCircle className="w-3 h-3" />
      <span>
        update <strong className="text-ink">{info.latest}</strong> available
      </span>
      <code className="text-muted text-[10px]">npm i -g lawang@latest</code>
      <button
        onClick={dismiss}
        title="Dismiss until next version"
        className="text-muted hover:text-ink"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
