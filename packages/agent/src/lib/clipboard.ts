import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ClipboardKind = "text" | "empty" | "unsupported";

export interface ClipboardReadResult {
  supported: boolean;
  provider: string;
  kind: ClipboardKind;
  text: string | null;
  truncated: boolean;
}

export interface ClipboardWriteResult {
  supported: boolean;
  provider: string;
  status: "ok";
  bytes: number;
}

export class ClipboardError extends Error {
  constructor(
    public code: "unsupported" | "read_failed" | "write_failed" | "too_large" | "empty",
    message: string,
  ) {
    super(message);
  }
}

const MAX_CLIPBOARD_CHARS = 64 * 1024;

export function clipboardCapabilities(): { supported: boolean; provider: string; platform: NodeJS.Platform } {
  if (process.platform === "darwin") return { supported: true, provider: "pbcopy/pbpaste", platform: "darwin" };
  if (process.platform === "linux") return { supported: true, provider: "xclip/wl-clipboard", platform: "linux" };
  if (process.platform === "win32") return { supported: true, provider: "PowerShell", platform: "win32" };
  return { supported: false, provider: "none", platform: process.platform };
}

export async function readHostClipboard(): Promise<ClipboardReadResult> {
  const caps = clipboardCapabilities();
  if (!caps.supported) {
    throw new ClipboardError("unsupported", "Host clipboard is not supported on this platform.");
  }
  try {
    let text = "";
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("/usr/bin/pbpaste", [], {
        timeout: 5000,
        maxBuffer: MAX_CLIPBOARD_CHARS * 2,
        encoding: "utf8",
      });
      text = stdout ?? "";
    } else if (process.platform === "linux") {
      text = await readLinuxClipboard();
    } else if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
        { timeout: 5000, maxBuffer: MAX_CLIPBOARD_CHARS * 2, encoding: "utf8" },
      );
      text = stdout ?? "";
    }
    const truncated = text.length > MAX_CLIPBOARD_CHARS;
    if (truncated) text = text.slice(0, MAX_CLIPBOARD_CHARS);
    return {
      supported: true,
      provider: caps.provider,
      kind: text.length === 0 ? "empty" : "text",
      text: text.length === 0 ? null : text,
      truncated,
    };
  } catch (err) {
    if (err instanceof ClipboardError) throw err;
    throw new ClipboardError("read_failed", `Unable to read host clipboard. ${errorMessage(err)}`.slice(0, 400));
  }
}

export async function writeHostClipboard(text: string): Promise<ClipboardWriteResult> {
  const caps = clipboardCapabilities();
  if (!caps.supported) {
    throw new ClipboardError("unsupported", "Host clipboard is not supported on this platform.");
  }
  if (typeof text !== "string") {
    throw new ClipboardError("empty", "Clipboard text is required.");
  }
  if (text.length === 0) {
    throw new ClipboardError("empty", "Clipboard text is empty.");
  }
  if (text.length > MAX_CLIPBOARD_CHARS) {
    throw new ClipboardError("too_large", `Clipboard text exceeds ${MAX_CLIPBOARD_CHARS} characters.`);
  }

  try {
    if (process.platform === "darwin") {
      await writeViaStdin("/usr/bin/pbcopy", [], text);
    } else if (process.platform === "linux") {
      await writeLinuxClipboard(text);
    } else if (process.platform === "win32") {
      // Set-Clipboard -Value via stdin-safe here-string alternative: encode as base64 to avoid quoting issues.
      const b64 = Buffer.from(text, "utf8").toString("base64");
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$bytes = [Convert]::FromBase64String('${b64}'); $text = [Text.Encoding]::UTF8.GetString($bytes); Set-Clipboard -Value $text`,
        ],
        { timeout: 8000, maxBuffer: 256 * 1024 },
      );
    }
    return {
      supported: true,
      provider: caps.provider,
      status: "ok",
      bytes: Buffer.byteLength(text),
    };
  } catch (err) {
    if (err instanceof ClipboardError) throw err;
    throw new ClipboardError("write_failed", `Unable to write host clipboard. ${errorMessage(err)}`.slice(0, 400));
  }
}

async function readLinuxClipboard(): Promise<string> {
  const attempts: Array<{ cmd: string; args: string[] }> = [
    { cmd: "wl-paste", args: ["--no-newline"] },
    { cmd: "xclip", args: ["-selection", "clipboard", "-o"] },
    { cmd: "xsel", args: ["--clipboard", "--output"] },
  ];
  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      const { stdout } = await execFileAsync(attempt.cmd, attempt.args, {
        timeout: 5000,
        maxBuffer: MAX_CLIPBOARD_CHARS * 2,
        encoding: "utf8",
        env: process.env,
      });
      return stdout ?? "";
    } catch (err) {
      lastErr = err;
    }
  }
  throw new ClipboardError(
    "read_failed",
    `Install wl-clipboard, xclip, or xsel. ${errorMessage(lastErr)}`.slice(0, 400),
  );
}

async function writeLinuxClipboard(text: string): Promise<void> {
  const attempts: Array<{ cmd: string; args: string[] }> = [
    { cmd: "wl-copy", args: [] },
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "xsel", args: ["--clipboard", "--input"] },
  ];
  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      await writeViaStdin(attempt.cmd, attempt.args, text);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new ClipboardError(
    "write_failed",
    `Install wl-clipboard, xclip, or xsel. ${errorMessage(lastErr)}`.slice(0, 400),
  );
}

function writeViaStdin(command: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      timeout: 8000,
      maxBuffer: 256 * 1024,
      env: process.env,
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    child.stdin?.on("error", reject);
    child.stdin?.end(text, "utf8");
  });
}

function errorMessage(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) return err.message;
  return String(err);
}
