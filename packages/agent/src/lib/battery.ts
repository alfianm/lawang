import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";

export interface BatteryInfo {
  supported: boolean;
  hasBattery: boolean;
  percent: number | null;       // 0..100
  charging: boolean | null;
  acConnected: boolean | null;
  state: "charging" | "discharging" | "charged" | "unknown" | null;
  timeRemainingMin: number | null; // null when not estimable
  source: string;               // pmset / sysfs / unsupported
}

const UNSUPPORTED: BatteryInfo = {
  supported: false, hasBattery: false, percent: null, charging: null,
  acConnected: null, state: null, timeRemainingMin: null, source: "unsupported",
};

export async function readBattery(): Promise<BatteryInfo> {
  if (process.platform === "darwin") return await readDarwin();
  if (process.platform === "linux") return await readLinux();
  return UNSUPPORTED;
}

async function readDarwin(): Promise<BatteryInfo> {
  // pmset -g batt — works without sudo; returns nothing on machines without a battery.
  let out: string;
  try {
    out = await runCapture("pmset", ["-g", "batt"]);
  } catch {
    return UNSUPPORTED;
  }
  const text = out.toString();
  if (!/InternalBattery/i.test(text)) {
    return { ...UNSUPPORTED, supported: true, source: "pmset" };
  }
  // Lines like:
  // -InternalBattery-0 (id=4521987)\t87%; discharging; 4:12 remaining present: true
  // Now drawing from 'AC Power'
  const acConnected = /'AC Power'/i.test(text) || /AC attached/i.test(text);
  const m = text.match(/(\d{1,3})%;\s*([^;]+);\s*([^\n;]*)/);
  let percent: number | null = null;
  let state: BatteryInfo["state"] = "unknown";
  let charging: boolean | null = null;
  let timeRemainingMin: number | null = null;
  if (m) {
    const p = Math.max(0, Math.min(100, parseInt(m[1]!, 10)));
    if (Number.isFinite(p)) percent = p;
    const stateRaw = m[2]!.trim().toLowerCase();
    if (stateRaw.includes("charging") && !stateRaw.includes("discharging")) {
      state = "charging"; charging = true;
    } else if (stateRaw.includes("charged")) {
      state = "charged"; charging = false;
    } else if (stateRaw.includes("discharging")) {
      state = "discharging"; charging = false;
    } else {
      state = "unknown";
    }
    const tm = (m[3] ?? "").match(/(\d{1,2}):(\d{2})\s+remaining/i);
    if (tm) timeRemainingMin = parseInt(tm[1]!, 10) * 60 + parseInt(tm[2]!, 10);
  }
  return {
    supported: true, hasBattery: true,
    percent, charging, acConnected, state,
    timeRemainingMin,
    source: "pmset",
  };
}

async function readLinux(): Promise<BatteryInfo> {
  const root = "/sys/class/power_supply";
  let entries: string[] = [];
  try { entries = await fsp.readdir(root); } catch { return UNSUPPORTED; }
  let battery: string | null = null;
  let acOnline: boolean | null = null;
  for (const name of entries) {
    const dir = path.join(root, name);
    let typ: string | null = null;
    try { typ = (await fsp.readFile(path.join(dir, "type"), "utf8")).trim(); } catch { /* ignore */ }
    if (typ === "Battery" && !battery) battery = dir;
    else if (typ === "Mains") {
      try {
        const online = (await fsp.readFile(path.join(dir, "online"), "utf8")).trim();
        acOnline = online === "1";
      } catch { /* ignore */ }
    }
  }
  if (!battery) {
    return { ...UNSUPPORTED, supported: true, acConnected: acOnline, source: "sysfs" };
  }
  const capacity = await readNumberSafe(path.join(battery, "capacity"));
  const statusRaw = (await readStringSafe(path.join(battery, "status")) ?? "").toLowerCase();
  let state: BatteryInfo["state"] = "unknown";
  let charging: boolean | null = null;
  if (statusRaw.startsWith("charging")) { state = "charging"; charging = true; }
  else if (statusRaw.startsWith("full"))  { state = "charged";  charging = false; }
  else if (statusRaw.startsWith("discharging")) { state = "discharging"; charging = false; }

  // Time remaining: derive from energy_now / power_now if both exist.
  let timeRemainingMin: number | null = null;
  if (state === "discharging") {
    const energyNow = await readNumberSafe(path.join(battery, "energy_now"));
    const powerNow  = await readNumberSafe(path.join(battery, "power_now"));
    if (energyNow != null && powerNow != null && powerNow > 0) {
      timeRemainingMin = Math.round((energyNow / powerNow) * 60);
    }
  }
  return {
    supported: true, hasBattery: true,
    percent: capacity,
    charging,
    acConnected: acOnline,
    state,
    timeRemainingMin,
    source: "sysfs",
  };
}

async function readStringSafe(p: string): Promise<string | null> {
  try { return (await fsp.readFile(p, "utf8")).trim(); } catch { return null; }
}
async function readNumberSafe(p: string): Promise<number | null> {
  const s = await readStringSafe(p);
  if (s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function runCapture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(err);
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (b) => chunks.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`${bin} exited ${code}`));
    });
  });
}
