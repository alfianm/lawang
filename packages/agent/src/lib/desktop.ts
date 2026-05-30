import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DesktopInput =
  | { kind: "mouse_move"; x: number; y: number }
  | { kind: "mouse_click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { kind: "key"; key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }
  | { kind: "text"; text: string };

export interface DesktopCapability {
  supported: boolean;
  provider: string;
  reason?: string;
}

export interface DesktopCapabilities {
  platform: NodeJS.Platform;
  view: DesktopCapability;
  control: DesktopCapability;
}

export class DesktopError extends Error {
  constructor(public code: "unsupported" | "capture_failed" | "control_failed" | "invalid_input", message: string) {
    super(message);
  }
}

export function desktopCapabilities(): DesktopCapabilities {
  if (process.platform === "darwin") {
    return {
      platform: process.platform,
      view: { supported: true, provider: "screencapture" },
      control: { supported: true, provider: "CoreGraphics/System Events" },
    };
  }
  return {
    platform: process.platform,
    view: { supported: false, provider: "none", reason: "Remote desktop capture is currently implemented for macOS hosts only." },
    control: { supported: false, provider: "none", reason: "Remote desktop control is currently implemented for macOS hosts only." },
  };
}

export async function captureDesktopJpeg(): Promise<{ buffer: Buffer; mime: "image/jpeg" }> {
  if (process.platform !== "darwin") {
    throw new DesktopError("unsupported", "Remote desktop capture is currently implemented for macOS hosts only.");
  }
  const tmp = path.join(os.tmpdir(), `lawang-screen-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  try {
    await execFileAsync("/usr/sbin/screencapture", ["-x", "-t", "jpg", tmp], { timeout: 8000, maxBuffer: 128 * 1024 });
    const buffer = await fs.readFile(tmp);
    if (buffer.length < 128) throw new Error("empty screenshot");
    return { buffer, mime: "image/jpeg" };
  } catch (err) {
    throw new DesktopError("capture_failed", explainMacPermissionFailure(err, "Screen Recording"));
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

export async function performDesktopInput(input: DesktopInput): Promise<{ status: "ok" }> {
  if (process.platform !== "darwin") {
    throw new DesktopError("unsupported", "Remote desktop control is currently implemented for macOS hosts only.");
  }
  try {
    if (input.kind === "mouse_move") {
      await runMouseScript("move", input.x, input.y, "left", false);
    } else if (input.kind === "mouse_click") {
      await runMouseScript("click", input.x, input.y, input.button || "left", Boolean(input.double));
    } else if (input.kind === "key") {
      await runKey(input);
    } else if (input.kind === "text") {
      await runText(input.text);
    } else {
      throw new DesktopError("invalid_input", "Unsupported input event.");
    }
    return { status: "ok" };
  } catch (err) {
    if (err instanceof DesktopError) throw err;
    throw new DesktopError("control_failed", explainMacPermissionFailure(err, "Accessibility"));
  }
}

async function runMouseScript(action: "move" | "click", x: number, y: number, button: "left" | "right" | "middle", double: boolean) {
  const nx = clamp01(x);
  const ny = clamp01(y);
  const script = path.join(os.tmpdir(), `lawang-mouse-${process.pid}-${Date.now()}.swift`);
  await fs.writeFile(script, MOUSE_SWIFT, "utf8");
  try {
    await execFileAsync("/usr/bin/swift", [script, action, String(nx), String(ny), button, double ? "1" : "0"], {
      timeout: 8000,
      maxBuffer: 256 * 1024,
    });
  } finally {
    await fs.unlink(script).catch(() => undefined);
  }
}

async function runText(text: string) {
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 500);
  if (!clean) return;
  await execFileAsync("/usr/bin/osascript", ["-e", `tell application "System Events" to keystroke ${appleString(clean)}`], {
    timeout: 8000,
    maxBuffer: 128 * 1024,
  });
}

async function runKey(input: Extract<DesktopInput, { kind: "key" }>) {
  const key = normalizeKey(input.key);
  const modifierTerms = appleModifiers(input);
  const using = modifierTerms.length ? ` using {${modifierTerms.join(", ")}}` : "";
  const code = KEY_CODES[key];
  const expr = code !== undefined
    ? `key code ${code}${using}`
    : key.length === 1
      ? `keystroke ${appleString(key)}${using}`
      : null;
  if (!expr) return;
  await execFileAsync("/usr/bin/osascript", ["-e", `tell application "System Events" to ${expr}`], {
    timeout: 8000,
    maxBuffer: 128 * 1024,
  });
}

function appleModifiers(input: Extract<DesktopInput, { kind: "key" }>): string[] {
  const out: string[] = [];
  if (input.shift) out.push("shift down");
  if (input.ctrl) out.push("control down");
  if (input.alt) out.push("option down");
  if (input.meta) out.push("command down");
  return out;
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  return key.toLowerCase();
}

function appleString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) throw new DesktopError("invalid_input", "Coordinates must be finite.");
  return Math.min(1, Math.max(0, n));
}

function explainMacPermissionFailure(err: unknown, permission: "Screen Recording" | "Accessibility"): string {
  const msg = (err as Error)?.message || String(err);
  return `${permission} may need to be enabled for the terminal app running Lawang. ${msg}`.slice(0, 500);
}

const KEY_CODES: Record<string, number> = {
  enter: 36,
  return: 36,
  tab: 48,
  escape: 53,
  esc: 53,
  backspace: 51,
  delete: 117,
  arrowleft: 123,
  arrowright: 124,
  arrowdown: 125,
  arrowup: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  space: 49,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

const MOUSE_SWIFT = `
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 6 else {
  fputs("invalid arguments\\n", stderr)
  exit(2)
}

let action = args[1]
let nx = max(0.0, min(1.0, Double(args[2]) ?? 0.0))
let ny = max(0.0, min(1.0, Double(args[3]) ?? 0.0))
let buttonName = args[4]
let doubleClick = args[5] == "1"
let bounds = CGDisplayBounds(CGMainDisplayID())
let point = CGPoint(x: bounds.origin.x + nx * bounds.width, y: bounds.origin.y + ny * bounds.height)
let source = CGEventSource(stateID: .hidSystemState)

func button(_ name: String) -> CGMouseButton {
  if name == "right" { return .right }
  if name == "middle" { return .center }
  return .left
}

func downType(_ b: CGMouseButton) -> CGEventType {
  if b == .right { return .rightMouseDown }
  if b == .center { return .otherMouseDown }
  return .leftMouseDown
}

func upType(_ b: CGMouseButton) -> CGEventType {
  if b == .right { return .rightMouseUp }
  if b == .center { return .otherMouseUp }
  return .leftMouseUp
}

let b = button(buttonName)
if action == "move" {
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: b)?.post(tap: .cghidEventTap)
} else if action == "click" {
  let clicks = doubleClick ? 2 : 1
  for i in 1...clicks {
    let down = CGEvent(mouseEventSource: source, mouseType: downType(b), mouseCursorPosition: point, mouseButton: b)
    let up = CGEvent(mouseEventSource: source, mouseType: upType(b), mouseCursorPosition: point, mouseButton: b)
    down?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
    up?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
    down?.post(tap: .cghidEventTap)
    usleep(25000)
    up?.post(tap: .cghidEventTap)
    usleep(70000)
  }
} else {
  fputs("unknown action\\n", stderr)
  exit(2)
}
`;
