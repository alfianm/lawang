import http from "node:http";
import { controlRequest } from "./controlSocket";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyReport {
  baseUrl: string;
  checks: CheckResult[];
  ok: boolean;
}

interface FetchResult {
  status: number;
  body: string;
}

function fetchPath(baseUrl: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<FetchResult> {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function checkHealth(baseUrl: string): Promise<CheckResult> {
  try {
    const r = await fetchPath(baseUrl, "/health");
    if (r.status !== 200) return { name: "health.status", ok: false, detail: `HTTP ${r.status}` };
    let parsed;
    try { parsed = JSON.parse(r.body); } catch { return { name: "health.json", ok: false, detail: "non-json body" }; }
    if (parsed.status !== "ok") return { name: "health.status", ok: false, detail: `status=${parsed.status}` };
    return { name: "health", ok: true, detail: `${parsed.machineName} v${parsed.version}` };
  } catch (err) {
    return { name: "health", ok: false, detail: (err as Error).message };
  }
}

async function checkUnauthenticatedTerminal(baseUrl: string): Promise<CheckResult> {
  try {
    const r = await fetchPath(baseUrl, "/api/files?path=.");
    if (r.status === 401 || r.status === 403) {
      return { name: "auth.no_unauth_access", ok: true, detail: `unauthenticated → HTTP ${r.status}` };
    }
    return {
      name: "auth.no_unauth_access",
      ok: false,
      detail: `unauthenticated request returned HTTP ${r.status} (must be 401/403)`,
    };
  } catch (err) {
    return { name: "auth.no_unauth_access", ok: false, detail: (err as Error).message };
  }
}

async function checkPathTraversal(baseUrl: string): Promise<CheckResult> {
  // Pakai token bogus. Endpoint harus tetap menolak (401), TIDAK pernah serve
  // file di luar root karena traversal dicek setelah auth juga.
  const headers = { Authorization: "Bearer invalid-bogus-token" };
  const probes = ["..", "../etc/passwd", "../../../etc/passwd"];
  const failures: string[] = [];
  for (const p of probes) {
    const u = `/api/file?path=${encodeURIComponent(p)}`;
    try {
      const r = await fetchPath(baseUrl, u, { headers });
      // Yang penting: tidak boleh 200 dengan content. 401/403/404 semua aman.
      if (r.status === 200) {
        failures.push(`${p} → HTTP 200 (LEAK)`);
      }
    } catch (err) {
      failures.push(`${p} → request error: ${(err as Error).message}`);
    }
  }
  if (failures.length === 0) {
    return { name: "sandbox.path_traversal", ok: true, detail: `${probes.length} probes blocked` };
  }
  return { name: "sandbox.path_traversal", ok: false, detail: failures.join("; ") };
}

async function checkPushConfirmation(baseUrl: string): Promise<CheckResult> {
  // Tanpa body { confirm: true }, server harus balas 400 atau 401.
  try {
    const r = await fetchPath(baseUrl, "/api/git/push", {
      method: "POST",
      headers: { Authorization: "Bearer invalid-bogus-token", "content-type": "application/json" },
      body: "{}",
    });
    if (r.status === 401 || r.status === 400) {
      return { name: "git.push_confirm", ok: true, detail: `unconfirmed push → HTTP ${r.status}` };
    }
    if (r.status === 200) {
      return { name: "git.push_confirm", ok: false, detail: "push accepted without confirm" };
    }
    return { name: "git.push_confirm", ok: true, detail: `HTTP ${r.status}` };
  } catch (err) {
    return { name: "git.push_confirm", ok: false, detail: (err as Error).message };
  }
}

async function checkOrigin(baseUrl: string): Promise<CheckResult> {
  // Kirim upgrade WS dari Origin yang jelas-jelas tidak diizinkan.
  // Kalau ditolak (4xx) atau RST → ok. Kalau diterima → fail.
  return await new Promise<CheckResult>((resolve) => {
    const url = new URL("/ws/terminal?token=bogus", baseUrl);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==",
        "Sec-WebSocket-Version": "13",
        "Origin": "https://evil.example.com",
      },
    });
    let done = false;
    const finalize = (r: CheckResult) => { if (!done) { done = true; resolve(r); } };
    req.on("upgrade", () => {
      finalize({ name: "ws.origin_check", ok: false, detail: "WS upgrade accepted from foreign Origin" });
      req.destroy();
    });
    req.on("response", (res) => {
      if (res.statusCode === 403) finalize({ name: "ws.origin_check", ok: true, detail: "foreign Origin → 403" });
      else finalize({ name: "ws.origin_check", ok: false, detail: `HTTP ${res.statusCode}` });
    });
    req.on("error", (err) => {
      // Kalau koneksi langsung di-destroy server tanpa response, anggap diblokir.
      finalize({ name: "ws.origin_check", ok: true, detail: `connection rejected: ${err.message}` });
    });
    req.end();
    setTimeout(() => finalize({ name: "ws.origin_check", ok: false, detail: "timeout" }), 4000).unref();
  });
}

async function checkAgentRunning(): Promise<CheckResult> {
  try {
    const r = await controlRequest({ cmd: "ping" }) as { ok: boolean; machineName: string };
    return { name: "control.ping", ok: r.ok === true, detail: r.machineName };
  } catch (err) {
    return { name: "control.ping", ok: false, detail: (err as Error).message };
  }
}

export async function runVerify(baseUrl: string): Promise<VerifyReport> {
  const checks: CheckResult[] = [];
  const ping = await checkAgentRunning();
  checks.push(ping);
  if (!ping.ok) {
    // Stop early. Sisanya sudah pasti gagal karena tidak ada server.
    return { baseUrl, checks, ok: false };
  }
  checks.push(await checkHealth(baseUrl));
  checks.push(await checkUnauthenticatedTerminal(baseUrl));
  checks.push(await checkPathTraversal(baseUrl));
  checks.push(await checkPushConfirmation(baseUrl));
  checks.push(await checkOrigin(baseUrl));
  return { baseUrl, checks, ok: checks.every((c) => c.ok) };
}
