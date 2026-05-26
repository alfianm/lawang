import { useEffect, useState } from "react";
import { Battery, BatteryCharging, BatteryWarning, BatteryFull, Plug } from "lucide-react";
import { fetchBattery, BatteryInfo, AuthError } from "../lib/api";

interface Props {
  sessionToken: string;
  onAuthFailed: () => void;
}

export function BatteryIndicator({ sessionToken, onAuthFailed }: Props) {
  const [info, setInfo] = useState<BatteryInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const r = await fetchBattery(sessionToken);
        if (!cancelled) setInfo(r);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) onAuthFailed();
      }
    }
    void load();
    timer = setInterval(load, 60_000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [sessionToken]);

  if (!info || !info.supported) return null;

  // No battery (desktop on AC): show a tiny plug glyph if AC info present, else nothing.
  if (!info.hasBattery) {
    if (info.acConnected) {
      return (
        <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono text-muted px-2 py-1 border border-line rounded" title="Host on AC power, no battery">
          <Plug className="w-3 h-3" /> AC
        </span>
      );
    }
    return null;
  }

  const pct = info.percent ?? 0;
  const tone = batteryTone(pct, info.charging);
  const Icon = pickIcon(info, pct);

  return (
    <span
      className={`hidden md:inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 border rounded ${tone}`}
      title={tooltip(info)}
    >
      <Icon className="w-3 h-3" />
      <span>{info.percent != null ? `${info.percent}%` : "—"}</span>
      {info.timeRemainingMin != null && info.state === "discharging" && (
        <span className="opacity-60">·{formatMinutes(info.timeRemainingMin)}</span>
      )}
    </span>
  );
}

function pickIcon(info: BatteryInfo, pct: number) {
  if (info.charging) return BatteryCharging;
  if (pct >= 90) return BatteryFull;
  if (pct <= 15) return BatteryWarning;
  return Battery;
}

function batteryTone(pct: number, charging: boolean | null): string {
  if (charging) return "border-ok/40 text-ok";
  if (pct <= 15) return "border-danger/40 text-danger";
  if (pct <= 30) return "border-warn/40 text-warn";
  return "border-line text-muted";
}

function tooltip(info: BatteryInfo): string {
  const parts: string[] = [];
  if (info.percent != null) parts.push(`${info.percent}%`);
  if (info.state) parts.push(info.state);
  if (info.acConnected) parts.push("AC connected");
  if (info.timeRemainingMin != null) parts.push(`${formatMinutes(info.timeRemainingMin)} remaining`);
  return parts.join(" · ");
}

function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}
