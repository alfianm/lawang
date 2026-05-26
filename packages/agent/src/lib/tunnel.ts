import { spawn, ChildProcess } from "node:child_process";
import { log } from "./logger";

export interface TunnelHandle {
  url: string | null;
  provider: "cloudflared" | "none";
  stop: () => Promise<void>;
}

function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn("which", [bin]);
    let out = "";
    p.stdout.on("data", (b) => (out += b.toString()));
    p.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    p.on("error", () => resolve(null));
  });
}

export async function startTunnel(port: number): Promise<TunnelHandle> {
  const bin = await which("cloudflared");
  if (!bin) {
    log.warn("cloudflared not found. Falling back to local-only access.");
    return { url: null, provider: "none", stop: async () => undefined };
  }

  return await new Promise<TunnelHandle>((resolve, reject) => {
    const child: ChildProcess = spawn(bin, [
      "tunnel",
      "--url",
      `http://localhost:${port}`,
      "--no-autoupdate",
    ]);
    let resolved = false;
    const buf: string[] = [];
    const onData = (b: Buffer) => {
      const text = b.toString();
      buf.push(text);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        resolve({
          url: match[0],
          provider: "cloudflared",
          stop: async () => {
            child.kill("SIGTERM");
          },
        });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`cloudflared exited early (${code}).\n${buf.join("")}`));
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill("SIGTERM");
        reject(new Error("Timed out waiting for tunnel URL"));
      }
    }, 20000);
  });
}
