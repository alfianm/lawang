import { execFile, execFileSync } from "node:child_process";
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

export type DesktopImage = { buffer: Buffer; mime: "image/jpeg" | "image/png" };
export type DesktopSettingsTarget = "screen-recording" | "accessibility";

interface DesktopProvider {
  capabilities(): DesktopCapabilities;
  capture(): Promise<DesktopImage>;
  input(input: DesktopInput): Promise<{ status: "ok" }>;
}

interface LinuxCaptureTool {
  command: string;
  provider: string;
  ext: ".jpg" | ".png";
  mime: DesktopImage["mime"];
  args(file: string): string[];
}

export class DesktopError extends Error {
  constructor(public code: "unsupported" | "capture_failed" | "control_failed" | "invalid_input", message: string) {
    super(message);
  }
}

export function desktopCapabilities(): DesktopCapabilities {
  return desktopProvider().capabilities();
}

export async function captureDesktopJpeg(): Promise<DesktopImage> {
  return desktopProvider().capture();
}

export async function performDesktopInput(input: DesktopInput): Promise<{ status: "ok" }> {
  return desktopProvider().input(input);
}

export async function openDesktopSettings(target: DesktopSettingsTarget): Promise<{ status: "opened" }> {
  if (process.platform !== "darwin") {
    throw new DesktopError("unsupported", "Opening desktop privacy settings is currently supported on macOS only.");
  }
  const pane = target === "screen-recording"
    ? "Privacy_ScreenCapture"
    : "Privacy_Accessibility";
  try {
    await execFileAsync("/usr/bin/open", [`x-apple.systempreferences:com.apple.preference.security?${pane}`], {
      timeout: 8000,
      maxBuffer: 128 * 1024,
    });
    return { status: "opened" };
  } catch (err) {
    throw new DesktopError("control_failed", `Unable to open macOS privacy settings. ${errorMessage(err)}`.slice(0, 500));
  }
}

function desktopProvider(): DesktopProvider {
  if (process.platform === "darwin") return macProvider;
  if (process.platform === "linux") return linuxProvider;
  if (process.platform === "win32") return windowsProvider;
  return unsupportedProvider(
    process.platform,
    "Remote desktop capture is not implemented for this host platform.",
    "Remote desktop control is not implemented for this host platform.",
  );
}

const macProvider: DesktopProvider = {
  capabilities() {
    return {
      platform: process.platform,
      view: { supported: true, provider: "screencapture" },
      control: { supported: true, provider: "CoreGraphics/System Events" },
    };
  },

  async capture() {
    const tmp = tempScreenFile(".jpg");
    try {
      await execFileAsync("/usr/sbin/screencapture", ["-x", "-t", "jpg", tmp], { timeout: 8000, maxBuffer: 128 * 1024 });
      return { buffer: await readNonEmptyFile(tmp), mime: "image/jpeg" };
    } catch (err) {
      throw new DesktopError("capture_failed", explainMacPermissionFailure(err, "Screen Recording"));
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  },

  async input(input) {
    try {
      if (input.kind === "mouse_move") {
        await runMacMouseScript("move", input.x, input.y, "left", false);
      } else if (input.kind === "mouse_click") {
        await runMacMouseScript("click", input.x, input.y, input.button || "left", Boolean(input.double));
      } else if (input.kind === "key") {
        await runMacKey(input);
      } else if (input.kind === "text") {
        await runMacText(input.text);
      } else {
        throw new DesktopError("invalid_input", "Unsupported input event.");
      }
      return { status: "ok" };
    } catch (err) {
      if (err instanceof DesktopError) throw err;
      throw new DesktopError("control_failed", explainMacPermissionFailure(err, "Accessibility"));
    }
  },
};

const linuxProvider: DesktopProvider = {
  capabilities() {
    const viewTool = linuxCaptureTool();
    const controlTool = linuxControlTool();
    return {
      platform: process.platform,
      view: viewTool
        ? { supported: true, provider: viewTool.provider }
        : { supported: false, provider: "none", reason: linuxViewReason() },
      control: controlTool
        ? { supported: true, provider: controlTool }
        : { supported: false, provider: "none", reason: linuxControlReason() },
    };
  },

  async capture() {
    const tool = linuxCaptureTool();
    if (!tool) throw new DesktopError("unsupported", linuxViewReason());
    const tmp = tempScreenFile(tool.ext);
    try {
      await execFileAsync(tool.command, tool.args(tmp), { timeout: 10000, maxBuffer: 512 * 1024 });
      return { buffer: await readNonEmptyFile(tmp), mime: tool.mime };
    } catch (err) {
      throw new DesktopError("capture_failed", `Linux desktop capture failed with ${tool.provider}. ${errorMessage(err)}`.slice(0, 500));
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  },

  async input(input) {
    const tool = linuxControlTool();
    if (!tool) throw new DesktopError("unsupported", linuxControlReason());
    try {
      await runLinuxXdotool(input);
      return { status: "ok" };
    } catch (err) {
      if (err instanceof DesktopError) throw err;
      throw new DesktopError("control_failed", `Linux desktop control failed with ${tool}. ${errorMessage(err)}`.slice(0, 500));
    }
  },
};

const windowsProvider: DesktopProvider = {
  capabilities() {
    const powerShell = windowsPowerShell();
    const supported = Boolean(powerShell);
    const reason = supported
      ? undefined
      : "Windows remote desktop requires powershell.exe or pwsh.exe in PATH.";
    return {
      platform: process.platform,
      view: supported ? { supported: true, provider: "PowerShell/.NET CopyFromScreen" } : { supported: false, provider: "none", reason },
      control: supported ? { supported: true, provider: "PowerShell/User32 SendKeys" } : { supported: false, provider: "none", reason },
    };
  },

  async capture() {
    const powerShell = windowsPowerShell();
    if (!powerShell) throw new DesktopError("unsupported", "Windows remote desktop requires powershell.exe or pwsh.exe in PATH.");
    const tmp = tempScreenFile(".jpg");
    try {
      await runPowerShell(powerShell, [WINDOWS_CAPTURE_PS, tmp], 10000, 512 * 1024);
      return { buffer: await readNonEmptyFile(tmp), mime: "image/jpeg" };
    } catch (err) {
      throw new DesktopError("capture_failed", `Windows desktop capture failed. ${errorMessage(err)}`.slice(0, 500));
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  },

  async input(input) {
    const powerShell = windowsPowerShell();
    if (!powerShell) throw new DesktopError("unsupported", "Windows remote desktop requires powershell.exe or pwsh.exe in PATH.");
    try {
      if (input.kind === "mouse_move") {
        await runPowerShell(powerShell, [WINDOWS_INPUT_PS, "mouse_move", String(clamp01(input.x)), String(clamp01(input.y))], 8000, 256 * 1024);
      } else if (input.kind === "mouse_click") {
        await runPowerShell(powerShell, [
          WINDOWS_INPUT_PS,
          "mouse_click",
          String(clamp01(input.x)),
          String(clamp01(input.y)),
          input.button || "left",
          input.double ? "1" : "0",
        ], 8000, 256 * 1024);
      } else if (input.kind === "key") {
        const keys = windowsKeyChord(input);
        if (keys) await runPowerShell(powerShell, [WINDOWS_INPUT_PS, "sendkeys", keys], 8000, 256 * 1024);
      } else if (input.kind === "text") {
        const keys = windowsSendKeysText(input.text);
        if (keys) await runPowerShell(powerShell, [WINDOWS_INPUT_PS, "sendkeys", keys], 8000, 256 * 1024);
      } else {
        throw new DesktopError("invalid_input", "Unsupported input event.");
      }
      return { status: "ok" };
    } catch (err) {
      if (err instanceof DesktopError) throw err;
      throw new DesktopError("control_failed", `Windows desktop control failed. ${errorMessage(err)}`.slice(0, 500));
    }
  },
};

function unsupportedProvider(platform: NodeJS.Platform, viewReason: string, controlReason: string): DesktopProvider {
  return {
    capabilities() {
      return {
        platform,
        view: { supported: false, provider: "none", reason: viewReason },
        control: { supported: false, provider: "none", reason: controlReason },
      };
    },
    async capture() {
      throw new DesktopError("unsupported", viewReason);
    },
    async input() {
      throw new DesktopError("unsupported", controlReason);
    },
  };
}

function linuxCaptureTool(): LinuxCaptureTool | null {
  const hasDisplay = Boolean(process.env.DISPLAY);
  const hasWayland = Boolean(process.env.WAYLAND_DISPLAY);

  if (hasWayland && executableExists("grim")) {
    return {
      command: "grim",
      provider: "grim",
      ext: ".png",
      mime: "image/png",
      args: (file) => [file],
    };
  }

  if ((hasDisplay || hasWayland) && executableExists("gnome-screenshot")) {
    return {
      command: "gnome-screenshot",
      provider: "gnome-screenshot",
      ext: ".png",
      mime: "image/png",
      args: (file) => ["-f", file],
    };
  }

  if (hasDisplay && executableExists("scrot")) {
    return {
      command: "scrot",
      provider: "scrot",
      ext: ".jpg",
      mime: "image/jpeg",
      args: (file) => ["-z", file],
    };
  }

  if (hasDisplay && executableExists("import")) {
    return {
      command: "import",
      provider: "ImageMagick import",
      ext: ".jpg",
      mime: "image/jpeg",
      args: (file) => ["-window", "root", file],
    };
  }

  return null;
}

function linuxControlTool(): string | null {
  if (process.env.DISPLAY && executableExists("xdotool")) return "xdotool";
  return null;
}

function linuxViewReason(): string {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return "No Linux display session was detected. Start Lawang inside an active desktop session.";
  }
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) {
    return "Wayland capture needs grim or gnome-screenshot installed and available to the user running Lawang.";
  }
  return "Linux capture needs one of these tools installed: gnome-screenshot, scrot, or ImageMagick import.";
}

function linuxControlReason(): string {
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) {
    return "Wayland desktop control is not available yet. Use an X11 session with xdotool for view + control.";
  }
  if (!process.env.DISPLAY) {
    return "No X11 DISPLAY was detected. Start Lawang inside an active X11 desktop session.";
  }
  return "Linux desktop control needs xdotool installed and available to the user running Lawang.";
}

async function runLinuxXdotool(input: DesktopInput) {
  if (input.kind === "mouse_move") {
    const point = await linuxPoint(input.x, input.y);
    await execFileAsync("xdotool", ["mousemove", "--sync", String(point.x), String(point.y)], { timeout: 8000, maxBuffer: 128 * 1024 });
    return;
  }
  if (input.kind === "mouse_click") {
    const point = await linuxPoint(input.x, input.y);
    const button = input.button === "right" ? "3" : input.button === "middle" ? "2" : "1";
    await execFileAsync("xdotool", ["mousemove", "--sync", String(point.x), String(point.y)], { timeout: 8000, maxBuffer: 128 * 1024 });
    await execFileAsync("xdotool", ["click", "--repeat", input.double ? "2" : "1", button], { timeout: 8000, maxBuffer: 128 * 1024 });
    return;
  }
  if (input.kind === "key") {
    const key = linuxKeyChord(input);
    if (key) await execFileAsync("xdotool", ["key", "--clearmodifiers", key], { timeout: 8000, maxBuffer: 128 * 1024 });
    return;
  }
  if (input.kind === "text") {
    const clean = cleanText(input.text);
    if (clean) await execFileAsync("xdotool", ["type", "--clearmodifiers", "--delay", "0", clean], { timeout: 8000, maxBuffer: 128 * 1024 });
    return;
  }
  throw new DesktopError("invalid_input", "Unsupported input event.");
}

async function linuxPoint(x: number, y: number): Promise<{ x: number; y: number }> {
  const { stdout } = await execFileAsync("xdotool", ["getdisplaygeometry"], { timeout: 8000, maxBuffer: 32 * 1024 });
  const match = stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) throw new DesktopError("control_failed", "Unable to read X11 display geometry.");
  const width = Number(match[1]);
  const height = Number(match[2]);
  return {
    x: Math.round(clamp01(x) * Math.max(0, width - 1)),
    y: Math.round(clamp01(y) * Math.max(0, height - 1)),
  };
}

function linuxKeyChord(input: Extract<DesktopInput, { kind: "key" }>): string | null {
  const base = LINUX_KEY_NAMES[normalizeKey(input.key)] || (input.key.length === 1 ? input.key : null);
  if (!base) return null;
  const mods: string[] = [];
  if (input.ctrl) mods.push("ctrl");
  if (input.alt) mods.push("alt");
  if (input.shift) mods.push("shift");
  if (input.meta) mods.push("super");
  return [...mods, base].join("+");
}

function windowsPowerShell(): string | null {
  if (process.platform !== "win32") return null;
  if (executableExists("powershell.exe")) return "powershell.exe";
  if (executableExists("pwsh.exe")) return "pwsh.exe";
  return null;
}

async function runPowerShell(powerShell: string, commandAndArgs: string[], timeout: number, maxBuffer: number) {
  const [command, ...args] = commandAndArgs;
  await execFileAsync(powerShell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command, ...args], {
    timeout,
    maxBuffer,
  });
}

function windowsKeyChord(input: Extract<DesktopInput, { kind: "key" }>): string | null {
  const base = WINDOWS_KEY_NAMES[normalizeKey(input.key)] || (input.key.length === 1 ? windowsSendKeysText(input.key) : null);
  if (!base) return null;
  if (input.meta) return null;
  return `${input.ctrl ? "^" : ""}${input.alt ? "%" : ""}${input.shift ? "+" : ""}${base}`;
}

function windowsSendKeysText(text: string): string {
  return cleanText(text)
    .split("")
    .map((ch) => {
      if (ch === "\n") return "{ENTER}";
      if (ch === "\r") return "";
      if (ch === "{") return "{{}";
      if (ch === "}") return "{}}";
      if ("+^%~()[]".includes(ch)) return `{${ch}}`;
      return ch;
    })
    .join("");
}

async function runMacMouseScript(action: "move" | "click", x: number, y: number, button: "left" | "right" | "middle", double: boolean) {
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

async function runMacText(text: string) {
  const clean = cleanText(text);
  if (!clean) return;
  await execFileAsync("/usr/bin/osascript", ["-e", `tell application "System Events" to keystroke ${appleString(clean)}`], {
    timeout: 8000,
    maxBuffer: 128 * 1024,
  });
}

async function runMacKey(input: Extract<DesktopInput, { kind: "key" }>) {
  const key = normalizeKey(input.key);
  const modifierTerms = appleModifiers(input);
  const using = modifierTerms.length ? ` using {${modifierTerms.join(", ")}}` : "";
  const code = MAC_KEY_CODES[key];
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

function executableExists(command: string): boolean {
  try {
    if (process.platform === "win32") {
      execFileSync("where.exe", [command], { stdio: "ignore" });
    } else {
      execFileSync("/usr/bin/env", ["sh", "-c", `command -v ${shellQuote(command)} >/dev/null 2>&1`], { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  return key.toLowerCase();
}

function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 500);
}

function appleString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) throw new DesktopError("invalid_input", "Coordinates must be finite.");
  return Math.min(1, Math.max(0, n));
}

function tempScreenFile(ext: ".jpg" | ".png"): string {
  return path.join(os.tmpdir(), `lawang-screen-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
}

async function readNonEmptyFile(file: string): Promise<Buffer> {
  const buffer = await fs.readFile(file);
  if (buffer.length < 128) throw new Error("empty screenshot");
  return buffer;
}

function explainMacPermissionFailure(err: unknown, permission: "Screen Recording" | "Accessibility"): string {
  return `${permission} may need to be enabled for the terminal app running Lawang. ${errorMessage(err)}`.slice(0, 500);
}

function errorMessage(err: unknown): string {
  return ((err as Error)?.message || String(err)).replace(/\s+/g, " ").trim();
}

const MAC_KEY_CODES: Record<string, number> = {
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

const LINUX_KEY_NAMES: Record<string, string> = {
  enter: "Return",
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "BackSpace",
  delete: "Delete",
  arrowleft: "Left",
  arrowright: "Right",
  arrowdown: "Down",
  arrowup: "Up",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  pagedown: "Page_Down",
  space: "space",
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",
};

const WINDOWS_KEY_NAMES: Record<string, string> = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  escape: "{ESC}",
  esc: "{ESC}",
  backspace: "{BACKSPACE}",
  delete: "{DELETE}",
  arrowleft: "{LEFT}",
  arrowright: "{RIGHT}",
  arrowdown: "{DOWN}",
  arrowup: "{UP}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  space: " ",
  f1: "{F1}",
  f2: "{F2}",
  f3: "{F3}",
  f4: "{F4}",
  f5: "{F5}",
  f6: "{F6}",
  f7: "{F7}",
  f8: "{F8}",
  f9: "{F9}",
  f10: "{F10}",
  f11: "{F11}",
  f12: "{F12}",
};

const WINDOWS_CAPTURE_PS = `
$out = $args[0]
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
`;

const WINDOWS_INPUT_PS = `
$kind = $args[0]
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class LawangInput {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
if ($kind -eq "sendkeys") {
  [System.Windows.Forms.SendKeys]::SendWait($args[1])
  exit 0
}
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$x = [int]($bounds.Left + ([double]$args[1] * [Math]::Max(0, $bounds.Width - 1)))
$y = [int]($bounds.Top + ([double]$args[2] * [Math]::Max(0, $bounds.Height - 1)))
[LawangInput]::SetCursorPos($x, $y) | Out-Null
if ($kind -eq "mouse_move") { exit 0 }
$button = $args[3]
$double = $args[4] -eq "1"
$down = 0x0002
$up = 0x0004
if ($button -eq "right") {
  $down = 0x0008
  $up = 0x0010
} elseif ($button -eq "middle") {
  $down = 0x0020
  $up = 0x0040
}
$count = 1
if ($double) { $count = 2 }
for ($i = 0; $i -lt $count; $i++) {
  [LawangInput]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 25
  [LawangInput]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 70
}
`;

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
