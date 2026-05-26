import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { configDir } from "./config";
import { log } from "./logger";
import { SessionStore } from "./sessions";

const SOCK_NAME = "agent.sock";
const PORT_FILE = "agent.port";

export interface ControlRequest {
  cmd: string;
  args?: Record<string, unknown>;
}

export type ControlHandler = (req: ControlRequest) => Promise<unknown> | unknown;

export interface ControlServer {
  close: () => Promise<void>;
  address: string;
}

function isWindows() {
  return process.platform === "win32";
}

function unixSocketPath() {
  return path.join(configDir(), SOCK_NAME);
}

function tcpPortFile() {
  return path.join(configDir(), PORT_FILE);
}

async function readJsonLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        socket.off("data", onData);
        socket.off("error", onErr);
        resolve(buf.slice(0, idx));
      }
    };
    const onErr = (err: Error) => {
      socket.off("data", onData);
      reject(err);
    };
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

function writeJsonLine(socket: net.Socket, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(JSON.stringify(payload) + "\n", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function startControlServer(handler: ControlHandler): Promise<ControlServer> {
  const useUnix = !isWindows();
  const sockPath = unixSocketPath();
  const portFile = tcpPortFile();

  if (useUnix) {
    try { fs.unlinkSync(sockPath); } catch { /* not present */ }
  }

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    readJsonLine(socket)
      .then(async (line) => {
        let req: ControlRequest;
        try {
          req = JSON.parse(line) as ControlRequest;
        } catch {
          await writeJsonLine(socket, { ok: false, error: "invalid_json" });
          socket.end();
          return;
        }
        try {
          const result = await handler(req);
          await writeJsonLine(socket, { ok: true, result });
        } catch (err) {
          await writeJsonLine(socket, { ok: false, error: (err as Error).message });
        } finally {
          socket.end();
        }
      })
      .catch(() => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    const onErr = (err: Error) => reject(err);
    server.once("error", onErr);
    if (useUnix) {
      server.listen(sockPath, () => {
        server.off("error", onErr);
        try { fs.chmodSync(sockPath, 0o600); } catch { /* best effort */ }
        resolve();
      });
    } else {
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onErr);
        const addr = server.address();
        if (addr && typeof addr === "object") {
          fs.writeFileSync(portFile, String(addr.port), { mode: 0o600 });
        }
        resolve();
      });
    }
  });

  return {
    address: useUnix ? sockPath : `tcp:${(server.address() as net.AddressInfo).port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (useUnix) {
        try { fs.unlinkSync(sockPath); } catch { /* ignore */ }
      } else {
        try { fs.unlinkSync(portFile); } catch { /* ignore */ }
      }
    },
  };
}

export async function controlRequest(req: ControlRequest, timeoutMs = 4000): Promise<unknown> {
  const useUnix = !isWindows();
  const sockPath = unixSocketPath();
  const portFile = tcpPortFile();

  let target: { path?: string; host?: string; port?: number };
  if (useUnix) {
    if (!fs.existsSync(sockPath)) throw new Error("agent_not_running");
    target = { path: sockPath };
  } else {
    if (!fs.existsSync(portFile)) throw new Error("agent_not_running");
    const port = parseInt(fs.readFileSync(portFile, "utf8").trim(), 10);
    if (!Number.isFinite(port)) throw new Error("agent_port_unreadable");
    target = { host: "127.0.0.1", port };
  }

  return await new Promise<unknown>((resolve, reject) => {
    const socket = net.createConnection(target as net.NetConnectOpts);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("control_timeout"));
    }, timeoutMs);
    socket.once("connect", async () => {
      try {
        await writeJsonLine(socket, req);
        const line = await readJsonLine(socket);
        clearTimeout(timer);
        const parsed = JSON.parse(line) as { ok: boolean; result?: unknown; error?: string };
        if (!parsed.ok) reject(new Error(parsed.error || "control_failed"));
        else resolve(parsed.result);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      } finally {
        socket.end();
      }
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export interface SessionsHandlerDeps {
  sessions: SessionStore;
  machineName: string;
  pid: number;
  rotatePairing?: () => Promise<{ pairUrl: string; token: string; expiresAt: number }>;
}

export function buildControlHandler(deps: SessionsHandlerDeps): ControlHandler {
  return async (req) => {
    switch (req.cmd) {
      case "ping":
        return { ok: true, machineName: deps.machineName, pid: deps.pid };
      case "sessions": {
        return deps.sessions.list().map((s) => ({
          sessionId: s.sessionId,
          deviceName: s.deviceName,
          deviceType: s.deviceType,
          remoteAddr: s.remoteAddr,
          createdAt: new Date(s.createdAt).toISOString(),
          lastActiveAt: new Date(s.lastActiveAt).toISOString(),
        }));
      }
      case "revoke": {
        const id = String((req.args || {}).sessionId || "");
        if (!id) throw new Error("missing_sessionId");
        const match = deps.sessions.list().find((s) => s.sessionId === id || s.sessionId.startsWith(id));
        if (!match) throw new Error("session_not_found");
        deps.sessions.end(match.sessionId, "revoked");
        return { revoked: match.sessionId };
      }
      case "revoke-all": {
        const list = deps.sessions.list();
        deps.sessions.revokeAll("revoked");
        return { revoked: list.length };
      }
      case "rotate": {
        if (!deps.rotatePairing) throw new Error("rotate_not_supported");
        const out = await deps.rotatePairing();
        return out;
      }
      default:
        throw new Error(`unknown_command:${req.cmd}`);
    }
  };
}

export function describeSocketAddress(): string {
  return isWindows() ? path.join(os.homedir(), ".lawang", PORT_FILE) : unixSocketPath();
}
