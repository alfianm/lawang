import { useEffect, useState } from "react";
import { Power, Moon, AlertTriangle, X, Loader2, Check, RotateCw, Lock } from "lucide-react";
import {
  fetchPowerCapabilities, performPower,
  PowerAction, PowerCapabilities, AuthError,
} from "../lib/api";

interface Props {
  sessionToken: string;
  machineName: string;
  onAuthFailed: () => void;
}

export function PowerMenu({ sessionToken, machineName, onAuthFailed }: Props) {
  const [open, setOpen] = useState(false);
  const [caps, setCaps] = useState<PowerCapabilities | null>(null);
  const [confirm, setConfirm] = useState<PowerAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ action: PowerAction; willHappenAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPowerCapabilities(sessionToken)
      .then((c) => { if (!cancelled) setCaps(c); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
      });
    return () => { cancelled = true; };
  }, [sessionToken]);

  async function trigger(action: PowerAction) {
    setSubmitting(true);
    setError(null);
    try {
      const r = await performPower(sessionToken, action, action === "lock" ? 0 : 5);
      if (action === "lock") {
        // Lock is instantaneous and harmless; close the menu silently.
        close();
        return;
      }
      setDone({ action, willHappenAt: r.willHappenAt });
    } catch (err) {
      if (err instanceof AuthError) { onAuthFailed(); return; }
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    setOpen(false);
    setConfirm(null);
    setDone(null);
    setError(null);
  }

  if (!caps) return null;
  const anySupported = caps.sleep.supported || caps.shutdown.supported || caps.reboot.supported || caps.lock.supported;
  if (!anySupported) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Sleep / shutdown host"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-warn px-2 py-1 border border-line rounded"
      >
        <Power className="w-3.5 h-3.5" /> host
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-3"
          onClick={close}
        >
          <div
            className="bg-panel border border-line w-full max-w-sm rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-line">
              <div className="flex items-center gap-2 text-sm">
                <Power className="w-4 h-4 text-warn" />
                <span className="font-mono text-xs uppercase tracking-wider text-muted">Host power</span>
              </div>
              <button onClick={close} className="text-muted hover:text-ink p-1" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="p-4 space-y-4">
              {!confirm && !done && (
                <>
                  <p className="text-sm text-ink">
                    Control <span className="font-mono text-accent">{machineName}</span> directly. The agent will signal the OS as the user that started it.
                  </p>
                  <div className="grid gap-2">
                    {caps.lock.supported && (
                      <ActionRow
                        icon={<Lock className="w-4 h-4 text-muted" />}
                        title="Lock screen"
                        desc="Lock the host immediately. Session keeps running."
                        onClick={() => trigger("lock")}
                      />
                    )}
                    {caps.sleep.supported && (
                      <ActionRow
                        icon={<Moon className="w-4 h-4 text-accent" />}
                        title="Sleep"
                        desc="Suspend the host. Agent process pauses with the OS."
                        onClick={() => setConfirm("sleep")}
                      />
                    )}
                    {caps.reboot.supported && (
                      <ActionRow
                        icon={<RotateCw className="w-4 h-4 text-warn" />}
                        title="Reboot"
                        desc="Restart the host. Session will end while it boots back up."
                        onClick={() => setConfirm("reboot")}
                      />
                    )}
                    {caps.shutdown.supported && (
                      <ActionRow
                        icon={<Power className="w-4 h-4 text-danger" />}
                        title="Shut down"
                        desc="Power off the host. Session will end and the agent will stop."
                        onClick={() => setConfirm("shutdown")}
                        danger
                      />
                    )}
                  </div>
                </>
              )}

              {confirm && !done && (
                <>
                  <div className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4 text-warn mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-ink">{confirmTitle(confirm)}</p>
                      <p className="text-muted mt-1">{confirmCopy(confirm)}</p>
                    </div>
                  </div>
                  {error && <p className="text-xs text-danger">{error}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setConfirm(null)} disabled={submitting} className="text-xs px-3 py-2 border border-line rounded text-muted hover:text-ink disabled:opacity-50">
                      Cancel
                    </button>
                    <button
                      onClick={() => trigger(confirm)}
                      disabled={submitting}
                      className={`text-xs inline-flex items-center gap-1 px-3 py-2 rounded text-bg font-medium disabled:opacity-50 ${confirmBg(confirm)}`}
                    >
                      {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Yes, {confirmVerb(confirm)}
                    </button>
                  </div>
                </>
              )}

              {done && (
                <div className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-ok mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-ink">{doneTitle(done.action)}</p>
                    <p className="text-muted mt-1 text-xs font-mono">
                      target: {new Date(done.willHappenAt).toLocaleTimeString()}
                    </p>
                    <p className="text-muted mt-2 text-xs">
                      You may be disconnected when the host actually goes offline.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionRow({
  icon, title, desc, onClick, danger,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 px-3 py-3 border rounded hover:bg-bg ${
        danger ? "border-danger/40 hover:border-danger/60" : "border-line hover:border-accent/40"
      }`}
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className={`text-sm font-medium ${danger ? "text-danger" : "text-ink"}`}>{title}</div>
        <div className="text-xs text-muted mt-0.5">{desc}</div>
      </div>
    </button>
  );
}


function confirmTitle(a: PowerAction): string {
  if (a === "sleep") return "Sleep this machine?";
  if (a === "reboot") return "Reboot this machine?";
  if (a === "shutdown") return "Shut down this machine?";
  return "Lock this machine?";
}
function confirmCopy(a: PowerAction): string {
  if (a === "sleep") return "Triggers in 5 seconds after you confirm. Unsaved work in apps may be at risk.";
  if (a === "reboot") return "Triggers in 5 seconds. The host will reboot and your session will end until it comes back online.";
  if (a === "shutdown") return "Triggers in 5 seconds. All running programs on the host will be asked to quit.";
  return "Locks the screen instantly.";
}
function confirmBg(a: PowerAction): string {
  if (a === "shutdown") return "bg-danger";
  if (a === "reboot")   return "bg-warn";
  return "bg-accent";
}
function confirmVerb(a: PowerAction): string {
  if (a === "sleep") return "sleep";
  if (a === "reboot") return "reboot";
  if (a === "shutdown") return "shut down";
  return "lock";
}
function doneTitle(a: PowerAction): string {
  if (a === "sleep") return "Sleep queued";
  if (a === "reboot") return "Reboot queued";
  if (a === "shutdown") return "Shutdown queued";
  return "Lock triggered";
}
