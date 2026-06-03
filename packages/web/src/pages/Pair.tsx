import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2, AlertTriangle, ArrowRight, X } from "lucide-react";
import { fetchInfo, requestPairing, AgentInfo } from "../lib/api";
import { detectDevice, getOrCreateDeviceFingerprint } from "../lib/device";

type Status = "idle" | "submitting" | "waiting_approval" | "approved" | "rejected" | "expired" | "error" | "rate_limited";

export function PairPage(props: { token: string | null; onConnected: (sessionToken: string) => void; onCancel: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string>(detectDevice().name);
  const [pairingPin, setPairingPin] = useState("");
  const [grantedPreset, setGrantedPreset] = useState<string | null>(null);
  const [grantedPermissions, setGrantedPermissions] = useState<string[] | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => undefined);
  }, []);

  async function start() {
    if (!props.token) {
      setStatus("error");
      setErrorText("Pairing token missing from the URL.");
      return;
    }
    if (startedRef.current) return;
    if (info?.pairPinRequired && !pairingPin.trim()) {
      setStatus("error");
      setErrorText("Pairing PIN is required.");
      return;
    }
    startedRef.current = true;
    setStatus("submitting");
    try {
      const detected = detectDevice();
      setStatus("waiting_approval");
      const res = await requestPairing({
        pairingToken: props.token,
        deviceName: deviceName || detected.name,
        deviceType: detected.type,
        deviceFingerprint: getOrCreateDeviceFingerprint(),
        pairingPin: pairingPin.trim() || undefined,
      });
      if (res.status === "approved") {
        setGrantedPreset(res.preset || null);
        setGrantedPermissions(res.permissions || null);
        setStatus("approved");
        setTimeout(() => props.onConnected(res.sessionToken), 250);
      } else if (res.status === "rate_limited") {
        setStatus("rate_limited");
      } else {
        if ((res as any).reason === "invalid_or_expired_token") setStatus("expired");
        else if ((res as any).reason === "invalid_pairing_pin") {
          setErrorText("Pairing PIN is incorrect.");
          setStatus("error");
        } else if ((res as any).reason === "pin_required") {
          setErrorText("Pairing PIN is required.");
          setStatus("error");
        } else if ((res as any).reason === "pairing_network_denied") {
          setErrorText("This host only accepts pairing from localhost or LAN/private addresses.");
          setStatus("error");
        }
        else setStatus("rejected");
      }
    } catch (err) {
      setStatus("error");
      setErrorText((err as Error).message);
      startedRef.current = false;
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md border border-line rounded-md bg-panel p-6">
        <div className="flex items-center gap-2 text-ink">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <h1 className="text-lg font-semibold">Pair this device</h1>
        </div>
        <p className="text-sm text-muted mt-1">
          Connecting to <span className="font-mono text-ink">{info?.machineName ?? "host machine"}</span>.
          The host must approve before the terminal opens.
        </p>

        <div className="mt-5 space-y-3 text-sm">
          <div className="flex items-center gap-2 text-amber-300/90 bg-amber-500/5 border border-amber-500/30 rounded-md px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Only pair with devices you own. Approving grants shell access.</span>
          </div>

          <label className="block">
            <span className="text-xs text-muted">Device label</span>
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              disabled={status !== "idle"}
              className="mt-1 w-full bg-bg border border-line rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
              placeholder="iPhone Safari"
            />
          </label>
          {info?.pairPinRequired && (
            <label className="block">
              <span className="text-xs text-muted">Pairing PIN</span>
              <input
                value={pairingPin}
                onChange={(e) => setPairingPin(e.target.value)}
                disabled={status !== "idle" && status !== "error"}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="mt-1 w-full bg-bg border border-line rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-accent/40"
                placeholder="PIN from host"
              />
            </label>
          )}
          {info?.pairLanOnly && (
            <div className="text-xs text-muted border border-line rounded-md px-3 py-2">
              Pairing is limited to localhost or LAN/private network addresses.
            </div>
          )}
        </div>

        <div className="mt-5">
          {status === "idle" && (
            <div className="flex items-center gap-2">
              <button
                onClick={start}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-accent text-bg font-medium rounded-md py-2 px-4 hover:opacity-90"
              >
                Request access <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={props.onCancel}
                className="inline-flex items-center justify-center gap-1 text-muted hover:text-ink py-2 px-3"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          )}
          {status === "submitting" && <StateLine icon={<Loader2 className="w-4 h-4 animate-spin" />}>Submitting request…</StateLine>}
          {status === "waiting_approval" && (
            <StateLine icon={<Loader2 className="w-4 h-4 animate-spin" />}>
              Waiting for the host to approve. Check the CLI on the host machine.
            </StateLine>
          )}
          {status === "approved" && (
            <div className="space-y-1">
              <StateLine tone="ok">Approved. Opening terminal…</StateLine>
              {grantedPreset && (
                <div className="text-xs text-muted">
                  Scope granted: <span className="font-mono text-ink">{grantedPreset}</span>
                  {grantedPermissions && grantedPermissions.length > 0 && (
                    <span className="ml-2 opacity-80">({grantedPermissions.join(", ")})</span>
                  )}
                </div>
              )}
            </div>
          )}
          {status === "rejected" && (
            <Result tone="danger" title="Request rejected" onRetry={() => { startedRef.current = false; setStatus("idle"); }}>
              The host declined this device. Ask the host to start a new pairing or try again.
            </Result>
          )}
          {status === "expired" && (
            <Result tone="danger" title="Token expired or invalid">
              The QR code is no longer valid. Run <code className="font-mono">lawang start</code> again on the host.
            </Result>
          )}
          {status === "rate_limited" && (
            <Result tone="warn" title="Too many attempts" onRetry={() => { startedRef.current = false; setStatus("idle"); }}>
              Slow down a bit, then try again.
            </Result>
          )}
          {status === "error" && (
            <Result tone="danger" title="Connection error" onRetry={() => { startedRef.current = false; setStatus("idle"); }}>
              {errorText || "Failed to reach the agent."}
            </Result>
          )}
        </div>
      </div>
    </div>
  );
}

function StateLine({ icon, tone, children }: { icon?: React.ReactNode; tone?: "ok"; children: React.ReactNode }) {
  const color = tone === "ok" ? "text-ok" : "text-muted";
  return (
    <div className={`flex items-center gap-2 ${color} text-sm py-2`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

function Result({ title, tone, children, onRetry }: { title: string; tone: "danger" | "warn"; children: React.ReactNode; onRetry?: () => void }) {
  const palette = tone === "danger" ? "border-danger/40 bg-danger/5 text-danger" : "border-warn/40 bg-warn/10 text-warn";
  return (
    <div className={`rounded-md border px-3 py-3 ${palette}`}>
      <div className="font-medium">{title}</div>
      <div className="text-sm text-muted mt-1">{children}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 text-xs underline text-accent">Try again</button>
      )}
    </div>
  );
}
