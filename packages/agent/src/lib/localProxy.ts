import http from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";
import { recordEvent } from "./audit";
import { log } from "./logger";

export interface ProxyTarget {
  port: number;
  host: string;
  label: string | null;
  addedAt: number;
}

export interface ProxyState {
  targets: ProxyTarget[];
  allowList: number[] | null;
}

const DEFAULT_HOST = "127.0.0.1";
const PORT_PATTERN = /^\/proxy\/(\d{1,5})(\/.*)?$/;

function decodeBasePath(prefix: string): string | null {
  // /proxy/3000 or /proxy/3000/ -> "/"
  const m = PORT_PATTERN.exec(prefix);
  if (!m) return null;
  const tail = m[2] || "/";
  return tail.startsWith("/") ? tail : `/${tail}`;
}

export class LocalProxyManager {
  private targets = new Map<number, ProxyTarget>();
  private allowList: Set<number> | null;

  constructor(opts: { allowList?: number[] | null } = {}) {
    this.allowList = opts.allowList && opts.allowList.length > 0 ? new Set(opts.allowList) : null;
    if (opts.allowList) {
      for (const port of opts.allowList) {
        this.add(port, DEFAULT_HOST, null);
      }
    }
  }

  state(): ProxyState {
    return {
      targets: [...this.targets.values()].sort((a, b) => a.port - b.port),
      allowList: this.allowList ? [...this.allowList].sort((a, b) => a - b) : null,
    };
  }

  list(): ProxyTarget[] {
    return this.state().targets;
  }

  has(port: number): boolean {
    return this.targets.has(port);
  }

  isAllowed(port: number): boolean {
    if (!this.allowList) return true;
    return this.allowList.has(port);
  }

  validatePort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  add(port: number, host = DEFAULT_HOST, label: string | null = null): ProxyTarget {
    if (!this.validatePort(port)) throw new Error("invalid_port");
    if (!this.isAllowed(port)) throw new Error("port_not_allowed");
    const target: ProxyTarget = {
      port,
      host: host || DEFAULT_HOST,
      label: label?.trim() || null,
      addedAt: Date.now(),
    };
    this.targets.set(port, target);
    return target;
  }

  remove(port: number): boolean {
    return this.targets.delete(port);
  }

  resolve(port: number): ProxyTarget | null {
    if (!this.validatePort(port)) return null;
    if (!this.isAllowed(port)) return null;
    const existing = this.targets.get(port);
    if (existing) return existing;
    // Allow ad-hoc when allow-list is open. We don't auto-register so the
    // discovery list stays explicit, but we still proxy on demand.
    return { port, host: DEFAULT_HOST, label: null, addedAt: Date.now() };
  }
}

function isHopByHop(name: string) {
  switch (name.toLowerCase()) {
    case "connection":
    case "keep-alive":
    case "proxy-authenticate":
    case "proxy-authorization":
    case "te":
    case "trailers":
    case "transfer-encoding":
    case "upgrade":
      return true;
    default:
      return false;
  }
}

function rewriteHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (isHopByHop(key)) continue;
    out[key] = value as string | string[];
  }
  return out;
}

function rewriteRedirectLocation(value: string | string[] | undefined, basePath: string): string | string[] | undefined {
  if (!value) return value;
  const transform = (loc: string) => {
    if (!loc) return loc;
    // Only rewrite same-host absolute paths back into proxy-prefixed paths.
    if (loc.startsWith("/") && !loc.startsWith(basePath)) {
      return basePath.replace(/\/?$/, "") + loc;
    }
    return loc;
  };
  if (Array.isArray(value)) return value.map(transform);
  return transform(value);
}

export function proxyHttpRequest(
  manager: LocalProxyManager,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  prefix: string,
): boolean {
  const m = PORT_PATTERN.exec(url.pathname);
  if (!m) return false;
  const port = parseInt(m[1], 10);
  const target = manager.resolve(port);
  if (!target) {
    res.statusCode = 403;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "forbidden", reason: "port_not_allowed" }));
    return true;
  }

  const downstreamPath = decodeBasePath(`/proxy/${port}` + (m[2] || "")) || "/";
  const tailQuery = url.search || "";
  const fullPath = downstreamPath + tailQuery;

  const basePath = `${prefix}/proxy/${port}`;

  const outgoing = http.request(
    {
      host: target.host,
      port: target.port,
      method: req.method,
      path: fullPath,
      headers: rewriteHeaders(req.headers),
      // Disable keep-alive to keep proxy lifecycle predictable.
      agent: false,
    },
    (upstream) => {
      const headers = rewriteHeaders(upstream.headers);
      if (upstream.headers.location) {
        const rewritten = rewriteRedirectLocation(upstream.headers.location, basePath);
        if (rewritten !== undefined) {
          headers["location"] = Array.isArray(rewritten) ? rewritten.join(", ") : rewritten;
        }
      }
      res.writeHead(upstream.statusCode || 502, headers);
      upstream.pipe(res);
    }
  );
  outgoing.on("error", (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        status: "bad_gateway",
        reason: "upstream_failed",
        message: err.message,
        port,
      }));
    } else {
      res.destroy(err);
    }
  });
  req.on("aborted", () => outgoing.destroy());
  req.pipe(outgoing);
  recordEvent("proxy_forwarded", {
    metadata: { port, method: req.method, path: fullPath, remoteAddr: req.socket.remoteAddress || null },
  });
  return true;
}

export function proxyUpgrade(
  manager: LocalProxyManager,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  const url = new URL(req.url || "/", `http://${req.headers.host || "x"}`);
  const m = PORT_PATTERN.exec(url.pathname);
  if (!m) return false;
  const port = parseInt(m[1], 10);
  const target = manager.resolve(port);
  if (!target) {
    socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return true;
  }

  const downstreamPath = decodeBasePath(`/proxy/${port}` + (m[2] || "")) || "/";
  const fullPath = downstreamPath + (url.search || "");

  const upstream = net.connect(target.port, target.host, () => {
    const headers = Object.entries(req.headers)
      .filter(([k]) => !isHopByHop(k))
      .map(([k, v]) => {
        const value = Array.isArray(v) ? v.join(", ") : v;
        return `${k}: ${value}`;
      })
      .join("\r\n");
    const requestLine = `${req.method} ${fullPath} HTTP/1.1`;
    upstream.write(
      `${requestLine}\r\n${headers}\r\nConnection: Upgrade\r\nUpgrade: ${req.headers.upgrade || "websocket"}\r\n\r\n`
    );
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  recordEvent("proxy_forwarded", {
    metadata: { port, method: "UPGRADE", path: fullPath, upgrade: true },
  });
  return true;
}

export async function probeListeningPorts(host = DEFAULT_HOST, candidates: number[]): Promise<number[]> {
  const results: number[] = [];
  await Promise.all(
    candidates.map(
      (port) =>
        new Promise<void>((resolve) => {
          const sock = net.connect({ host, port });
          let settled = false;
          const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch { /* ignore */ }
            if (ok) results.push(port);
            resolve();
          };
          sock.setTimeout(150);
          sock.once("connect", () => finish(true));
          sock.once("error", () => finish(false));
          sock.once("timeout", () => finish(false));
        })
    )
  );
  return results.sort((a, b) => a - b);
}

export const COMMON_DEV_PORTS = [
  3000, 3001, 3002, 3003, 4000, 4173, 4200, 5000, 5173, 5174, 5500,
  5555, 6006, 7000, 7777, 8000, 8001, 8080, 8081, 8088, 8888, 9000,
];
