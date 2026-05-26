import path from "node:path";
import fs from "node:fs";
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import QRCode from "qrcode";
import { PairingManager } from "./lib/pairing";
import { SessionStore } from "./lib/sessions";
import { RateLimiter } from "./lib/rateLimit";
import { askApproval, permissionsForPreset, PermissionPreset } from "./lib/promptApprover";
import { spawnTerminal, defaultUserCwd } from "./lib/terminal";
import { TerminalSessionStore } from "./lib/terminalSessions";
import { log } from "./lib/logger";
import { recordEvent } from "./lib/audit";
import {
  listDir, readFile, statForDownload, SandboxError,
  writeFile, streamWriteFile, renameEntry, removeEntry, makeDir,
} from "./lib/sandbox";
import * as git from "./lib/git";
import { detectEnvironment } from "./lib/environment";
import { readSessionHistory, queryEvents, eventTypeCounts } from "./lib/auditReader";
import { runOneShot, ExecError } from "./lib/exec";
import { performPowerAction, powerCapabilities, PowerError, PowerAction } from "./lib/power";
import { readBattery } from "./lib/battery";
import { Permission, SessionInfo } from "./lib/tokens";
import { TrustedDeviceStore } from "./lib/trustedDevices";
import {
  LocalProxyManager,
  proxyHttpRequest,
  proxyUpgrade,
  probeListeningPorts,
  COMMON_DEV_PORTS,
} from "./lib/localProxy";

interface AgentDeps {
  port: number;
  rootPath: string;
  machineName: string;
  version: string;
  pairing: PairingManager;
  sessions: SessionStore;
  trusted: TrustedDeviceStore;
  proxy: LocalProxyManager;
  terminals: TerminalSessionStore;
  publicDir: string | null;
  getTunnelUrl: () => string | null;
  getPairUrl: () => string;
}

export interface AgentServer {
  fastify: FastifyInstance;
  close: () => Promise<void>;
}

const PairBody = z.object({
  pairingToken: z.string().min(8).max(256),
  deviceName: z.string().trim().min(1).max(80).optional(),
  deviceType: z.enum(["mobile", "desktop", "unknown"]).optional(),
  deviceFingerprint: z.string().trim().min(8).max(256).optional(),
});

const WriteBody = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().max(8_000_000), // ~8 MB base64 cap
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});

const RenameBody = z.object({
  from: z.string().min(1).max(1024),
  to: z.string().min(1).max(1024),
});

const MkdirBody = z.object({
  path: z.string().min(1).max(1024),
});

export async function startServer(deps: AgentDeps): Promise<AgentServer> {
  const fastify = Fastify({ logger: false, trustProxy: false, bodyLimit: 16 * 1024 * 1024 });
  const pairLimiter = new RateLimiter(60_000, 20);
  const fileLimiter = new RateLimiter(60_000, 240);
  const writeLimiter = new RateLimiter(60_000, 60);


  // Bypass body parsing for raw uploads so req.raw can be piped into a file.
  fastify.addContentTypeParser("application/octet-stream", (_req, _payload, done) => done(null));
  fastify.addContentTypeParser("*", (_req, payload, done) => {
    // Other unknown types: drain the body without buffering.
    payload.resume();
    done(null);
  });

  if (deps.publicDir && fs.existsSync(deps.publicDir)) {
    await fastify.register(fastifyStatic, {
      root: deps.publicDir,
      prefix: "/",
      decorateReply: false,
      wildcard: false,
    });
  }

  fastify.get("/health", async () => ({
    status: "ok",
    machineName: deps.machineName,
    version: deps.version,
  }));

  fastify.get("/api/info", async () => ({
    machineName: deps.machineName,
    version: deps.version,
    tunnelUrl: deps.getTunnelUrl(),
    pairUrl: deps.getPairUrl() || null,
  }));
  fastify.get("/api/version", async () => {
    const getInfo = (globalThis as any).__lawangUpdateInfo;
    const info = typeof getInfo === "function" ? getInfo() : null;
    return {
      current: deps.version,
      latest: info?.latest ?? null,
      outdated: Boolean(info?.outdated),
      checkedAt: info?.checkedAt ?? null,
    };
  });



  fastify.get("/qr.svg", async (req, reply) => {
    const url = deps.getPairUrl();
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 512 });
    reply.header("Cache-Control", "no-store");
    reply.type("image/svg+xml").send(svg);
  });

  fastify.get("/qr", async (req, reply) => {
    const url = deps.getPairUrl();
    const safe = url.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Pair QR · Lawang</title><style>body{margin:0;background:#0b0d10;color:#e6edf3;font-family:Inter,system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;}h1{font-size:18px;margin:0 0 12px;color:#8b949e;font-weight:500;}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ade80;margin-right:8px;vertical-align:middle;}.qr-wrap{position:relative;width:min(72vmin,640px);}.qr-wrap img{width:100%;height:auto;background:#fff;padding:12px;border-radius:12px;display:block;}.qr-wrap.stale img{opacity:0.4;filter:grayscale(0.4);}p.url{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#8b949e;margin-top:16px;word-break:break-all;max-width:640px;}small{display:block;margin-top:8px;color:#566270;}small.warn{color:#f4b350;}</style></head><body><h1><span class="dot" id="status"></span>Scan this QR with your phone</h1><div class="qr-wrap" id="wrap"><img id="qr" src="/qr.svg" alt="Pair QR" /></div><p class="url" id="url">${safe}</p><small id="hint">QR auto-refreshes every few seconds. Run <code>lawang rotate</code> to issue a new token without restarting.</small><script>(function(){var lastUrl=${JSON.stringify(url)};var wrap=document.getElementById('wrap');var img=document.getElementById('qr');var urlEl=document.getElementById('url');var status=document.getElementById('status');var hint=document.getElementById('hint');function tick(){fetch('/api/info',{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){if(j&&j.pairUrl&&j.pairUrl!==lastUrl){lastUrl=j.pairUrl;img.src='/qr.svg?ts='+Date.now();urlEl.textContent=j.pairUrl;wrap.classList.remove('stale');status.style.background='#4ade80';hint.classList.remove('warn');hint.textContent='QR refreshed.';setTimeout(function(){hint.textContent='QR auto-refreshes every few seconds. Run lawang rotate to issue a new token.';},2500);}else if(j&&!j.pairUrl){wrap.classList.add('stale');status.style.background='#f4b350';hint.classList.add('warn');hint.textContent='Pairing token expired. Run lawang rotate (or restart the agent) to get a new one.';}else{status.style.background='#4ade80';}}).catch(function(){status.style.background='#ff6b6b';});}setInterval(tick,5000);})();</script></body></html>`;
    reply.header("Cache-Control", "no-store");
    reply.type("text/html").send(html);
  });

  fastify.post("/api/pair/request", async (req, reply) => {
    const ip = req.ip || "unknown";
    if (!pairLimiter.hit(ip)) {
      reply.code(429);
      return { status: "rate_limited" };
    }
    const parsed = PairBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { status: "invalid_request" };
    }
    const token = deps.pairing.validateRawToken(parsed.data.pairingToken);
    if (!token) {
      recordEvent("auth_failed", { metadata: { reason: "invalid_pairing_token", remoteAddr: ip } });
      reply.code(401);
      return { status: "rejected", reason: "invalid_or_expired_token" };
    }

    const userAgent = (req.headers["user-agent"] as string | undefined) || "";
    const deviceName = parsed.data.deviceName || guessDeviceName(userAgent);
    const deviceType = parsed.data.deviceType || guessDeviceType(userAgent);
    const fingerprint = parsed.data.deviceFingerprint || null;

    const trustedMatch = fingerprint ? deps.trusted.match(fingerprint) : null;
    if (trustedMatch) {
      deps.pairing.consumeToken();
      await deps.trusted.touch(trustedMatch.device.deviceId);
      const trustedPreset = (trustedMatch.device.preset || "full") as PermissionPreset;
      const trustedPermissions = permissionsForPreset(trustedPreset);
      const { token: sessionToken } = deps.sessions.create({
        deviceName: trustedMatch.device.name,
        deviceType,
        remoteAddr: ip,
        trusted: true,
        permissions: trustedPermissions,
      });
      recordEvent("pairing_auto_approved", {
        deviceName: trustedMatch.device.name,
        metadata: {
          deviceId: trustedMatch.device.deviceId,
          remoteAddr: ip,
          preset: trustedPreset,
        },
      });
      log.success(`Trusted device auto-approved: ${trustedMatch.device.name} (${trustedMatch.device.deviceId.slice(0, 8)}, scope: ${trustedPreset})`);
      return {
        status: "approved",
        sessionToken,
        machineName: deps.machineName,
        permissions: trustedPermissions,
        trusted: true,
      };
    }

    const { request, promise } = deps.pairing.enqueue({
      deviceName, deviceType, remoteAddr: ip, userAgent, fingerprint,
    });
    const approval = await askApproval(request, { canTrust: !!fingerprint });
    deps.pairing.decide(request.requestId, approval.decision);
    if (approval.decision === "approved" && approval.trust && fingerprint) {
      try {
        await deps.trusted.upsert({
          name: deviceName,
          rawFingerprint: fingerprint,
          preset: approval.preset,
        });
        log.success(`Device trusted: ${deviceName} (scope: ${approval.preset})`);
      } catch (err) {
        log.warn(`Failed to persist trusted device: ${(err as Error).message}`);
      }
    }
    // Wait for the pairing-promise to settle (consumes token + records event).
    const decision = await promise;

    if (decision !== "approved" || approval.decision !== "approved") {
      reply.code(403);
      return { status: "rejected" };
    }
    const { token: sessionToken } = deps.sessions.create({
      deviceName,
      deviceType,
      remoteAddr: ip,
      trusted: false,
      permissions: approval.permissions,
    });
    deps.pairing.attachSessionToken(request.requestId, sessionToken);
    return {
      status: "approved",
      sessionToken,
      machineName: deps.machineName,
      permissions: approval.permissions,
      trusted: false,
      preset: approval.preset,
    };
  });

  function authenticate(req: FastifyRequest, reply: FastifyReply, perm: Permission): SessionInfo | null {
    const header = (req.headers["authorization"] as string | undefined) || "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) {
      reply.code(401).send({ status: "unauthorized" });
      return null;
    }
    const session = deps.sessions.byTokenRaw(m[1].trim());
    if (!session) {
      recordEvent("auth_failed", { metadata: { reason: "invalid_session_token", route: req.url } });
      reply.code(401).send({ status: "unauthorized" });
      return null;
    }
    if (!session.permissions.includes(perm)) {
      reply.code(403).send({ status: "forbidden" });
      return null;
    }
    deps.sessions.touch(session.sessionId);
    return session;
  }

  fastify.get("/api/session", async (req, reply) => {
    const s = authenticate(req, reply, "terminal");
    if (!s) return;
    return {
      sessionId: s.sessionId,
      machineName: deps.machineName,
      rootPath: deps.rootPath,
      permissions: s.permissions,
      deviceName: s.deviceName,
      createdAt: new Date(s.createdAt).toISOString(),
    };
  });

  fastify.get("/api/sessions/history", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" });

  const ExecBody = z.object({
    command: z.string().min(1).max(4000),
    cwd: z.string().max(1024).default("."),
    timeoutMs: z.number().int().min(1000).max(60000).optional(),
  });

  fastify.post("/api/exec", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "terminal");
    if (!session) return;

    const parsed = ExecBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ status: "invalid_request" });
      return;
    }

    try {
      const result = await runOneShot(deps.rootPath, parsed.data.cwd, parsed.data.command, parsed.data.timeoutMs);
      recordEvent("chat_exec", {
        deviceName: session.deviceName,
        metadata: {
          sessionId: session.sessionId,
          cwd: result.cwd,
          command: parsed.data.command.slice(0, 200),
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
        },
      });
      deps.sessions.touch(session.sessionId);
      return result;
    } catch (err) {
      if (err instanceof ExecError) {
        if (err.code === "outside_root") reply.code(403).send({ status: "forbidden", reason: err.code });
        else reply.code(400).send({ status: "invalid_request", reason: err.code });
        return;
      }
      reply.code(500).send({ status: "error", message: (err as Error).message });
    }
  }); return; }
    const session = authenticate(req, reply, "file:read");
    if (!session) return;
    const limitRaw = (req.query as { limit?: string } | undefined)?.limit;
    const limit = Math.min(Math.max(parseInt(String(limitRaw ?? "25"), 10) || 25, 1), 200);
    try {
      const records = await readSessionHistory(limit);
      return { records, limit };
    } catch (err) {
      reply.code(500).send({ status: "error", message: (err as Error).message });
    }
  });

  fastify.get("/api/files", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "file:read");
    if (!s) return;
    const q = (req.query as Record<string, string>) || {};
    try {
      const result = await listDir(deps.rootPath, q.path || ".");
      return { path: result.path, rootName: path.basename(deps.rootPath) || "root", entries: result.entries };
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });

  fastify.get("/api/file", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "file:read");
    if (!s) return;
    const q = (req.query as Record<string, string>) || {};
    if (!q.path) { reply.code(400).send({ status: "invalid_request", reason: "missing_path" }); return; }
    try {
      return await readFile(deps.rootPath, q.path);
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });

  fastify.get("/api/file/download", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const q = (req.query as Record<string, string>) || {};
    const tokenRaw = (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") || q.token || "";
    const session = tokenRaw ? deps.sessions.byTokenRaw(tokenRaw) : undefined;
    if (!session || !session.permissions.includes("file:read")) {
      recordEvent("auth_failed", { metadata: { reason: "invalid_session_token", route: req.url } });
      reply.code(401).send({ status: "unauthorized" });
      return;
    }
    deps.sessions.touch(session.sessionId);
    if (!q.path) { reply.code(400).send({ status: "invalid_request", reason: "missing_path" }); return; }
    try {
      const { absolute, name, size } = statForDownload(deps.rootPath, q.path);
      reply.header("Content-Length", String(size));
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Disposition", `attachment; filename="${name.replace(/["\\\r\n]/g, "_")}"`);
      const stream = fs.createReadStream(absolute);
      return reply.send(stream);
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });

  // ---- Write endpoints ----

  fastify.put("/api/file", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "file:write");
    if (!s) return;
    const parsed = WriteBody.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400).send({ status: "invalid_request" }); return; }
    try {
      const out = await writeFile(deps.rootPath, parsed.data.path, parsed.data.content, parsed.data.encoding);
      recordEvent("file_written", { deviceName: s.deviceName, metadata: { path: out.path, size: out.size, sessionId: s.sessionId } });
      return { status: "ok", ...out };
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });

  fastify.post("/api/file/upload", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "file:write");
    if (!s) return;
    const dest = (req.query as Record<string, string>)?.path;
    if (!dest) { reply.code(400).send({ status: "invalid_request", reason: "missing_path" }); return; }
    try {
      const out = await streamWriteFile(deps.rootPath, dest, req.raw);
      recordEvent("file_uploaded", { deviceName: s.deviceName, metadata: { path: out.path, size: out.size, sessionId: s.sessionId } });
      return { status: "ok", ...out };
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });

  fastify.post("/api/dir", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "file:write");
    if (!s) return;
    const parsed = MkdirBody.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400).send({ status: "invalid_request" }); return; }
    try {
      const out = await makeDir(deps.rootPath, parsed.data.path);
      return { status: "ok", ...out };
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });

  fastify.post("/api/file/rename", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "file:write");
    if (!s) return;
    const parsed = RenameBody.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400).send({ status: "invalid_request" }); return; }
    try {
      const out = await renameEntry(deps.rootPath, parsed.data.from, parsed.data.to);
      recordEvent("file_renamed", { deviceName: s.deviceName, metadata: { from: out.from, to: out.to, sessionId: s.sessionId } });
      return { status: "ok", ...out };
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });

  fastify.delete("/api/file", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "file:write");
    if (!s) return;
    const q = (req.query as Record<string, string>) || {};
    if (!q.path) { reply.code(400).send({ status: "invalid_request", reason: "missing_path" }); return; }
    try {
      await removeEntry(deps.rootPath, q.path);
      recordEvent("file_deleted", { deviceName: s.deviceName, metadata: { path: q.path, sessionId: s.sessionId } });
      return { status: "ok" };
    } catch (err) {
      handleSandboxError(reply, err);
    }
  });


  // ---- Git endpoints ----

  fastify.get("/api/env", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "file:read");
    if (!session) return;
    try {
      return await detectEnvironment(deps.rootPath);
    } catch (err) {
      reply.code(500).send({ status: "error", message: (err as Error).message });
    }
  });

  fastify.get("/api/git/status", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:read");
    if (!s) return;
    try {
      return await git.status(deps.rootPath);
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  fastify.get("/api/git/diff", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:read");
    if (!s) return;
    const q = (req.query as Record<string, string>) || {};
    if (!q.path) { reply.code(400).send({ status: "invalid_request", reason: "missing_path" }); return; }
    const staged = q.staged === "1" || q.staged === "true";
    try {
      return await git.diffFile(deps.rootPath, q.path, staged);
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  fastify.get("/api/git/log", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:read");
    if (!s) return;
    const q = (req.query as Record<string, string>) || {};
    const max = Math.min(200, Math.max(1, parseInt(q.max || "30", 10) || 30));
    try {
      return await git.log(deps.rootPath, max);
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  const GitStageBody = z.object({ paths: z.array(z.string().min(1)).min(1).max(500) });
  const GitCommitBody = z.object({ message: z.string().min(1).max(2000) });

  fastify.post("/api/git/stage", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:write");
    if (!s) return;
    const parsed = GitStageBody.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400).send({ status: "invalid_request" }); return; }
    try {
      const out = await git.stage(deps.rootPath, parsed.data.paths);
      recordEvent("git_stage", { deviceName: s.deviceName, metadata: { paths: parsed.data.paths, sessionId: s.sessionId } });
      return out;
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  fastify.post("/api/git/unstage", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:write");
    if (!s) return;
    const parsed = GitStageBody.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400).send({ status: "invalid_request" }); return; }
    try {
      const out = await git.unstage(deps.rootPath, parsed.data.paths);
      recordEvent("git_unstage", { deviceName: s.deviceName, metadata: { paths: parsed.data.paths, sessionId: s.sessionId } });
      return out;
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  fastify.post("/api/git/commit", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:write");
    if (!s) return;
    const parsed = GitCommitBody.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400).send({ status: "invalid_request" }); return; }
    try {
      const out = await git.commit(deps.rootPath, parsed.data.message);
      recordEvent("git_commit", { deviceName: s.deviceName, metadata: { commit: out.commit, sessionId: s.sessionId } });
      return out;
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  fastify.post("/api/git/pull", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:write");
    if (!s) return;
    try {
      const out = await git.pull(deps.rootPath);
      recordEvent("git_pull", { deviceName: s.deviceName, metadata: { ...out.summary, sessionId: s.sessionId } });
      return out;
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  const GitPushBody = z.object({
    remote: z.string().trim().min(1).max(120).optional(),
    branch: z.string().trim().min(1).max(200).optional(),
    setUpstream: z.boolean().optional(),
    confirm: z.literal(true),
  });

  fastify.post("/api/git/push", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const s = authenticate(req, reply, "git:write");
    if (!s) return;
    const parsed = GitPushBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ status: "invalid_request", reason: "confirmation_required" });
      return;
    }
    try {
      const out = await git.push(deps.rootPath, {
        remote: parsed.data.remote,
        branch: parsed.data.branch,
        setUpstream: parsed.data.setUpstream,
      });
      recordEvent("git_push", {
        deviceName: s.deviceName,
        metadata: {
          remote: out.remote,
          branch: out.branch,
          pushed: out.pushed.length,
          sessionId: s.sessionId,
        },
      });
      return out;
    } catch (err) {
      handleGitError(reply, err);
    }
  });

  fastify.get("/api/system/power", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "terminal");
    if (!session) return;
    return powerCapabilities();
  });

  const PowerBody = z.object({
    action: z.enum(["sleep", "shutdown", "reboot", "lock"]),
    confirm: z.literal(true),
    delaySeconds: z.number().int().min(0).max(120).optional(),
  });

  fastify.post("/api/system/power", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "terminal");
    if (!session) return;

    const parsed = PowerBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ status: "invalid_request", reason: "confirmation_required" });
      return;
    }
    const action: PowerAction = parsed.data.action;
    const delaySeconds = parsed.data.delaySeconds ?? 5;

    recordEvent("power_action", {
      deviceName: session.deviceName,
      metadata: {
        sessionId: session.sessionId,
        action,
        delaySeconds,
        remoteAddr: session.remoteAddr,
      },
    });

    // Run the action in the background so the HTTP response can return first.
    void performPowerAction(action, { delaySeconds }).catch((err) => {
      log.warn(`power action failed: ${(err as Error).message}`);
    });

    return {
      status: "queued",
      action,
      delaySeconds,
      willHappenAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    };
  });

  fastify.get("/api/system/battery", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "file:read");
    if (!session) return;
    try {
      return await readBattery();
    } catch (err) {
      reply.code(500).send({ status: "error", message: (err as Error).message });
    }
  });

  // ---- Audit log viewer ----

  fastify.get("/api/audit", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "file:read");
    if (!session) return;
    const q = (req.query as Record<string, string>) || {};
    const limit = Math.min(Math.max(parseInt(q.limit || "200", 10) || 200, 1), 2000);
    const types = (q.types || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const events = await queryEvents({
        limit,
        types: types.length > 0 ? (types as any) : undefined,
        search: q.search,
        since: q.since,
      });
      return { events, limit };
    } catch (err) {
      reply.code(500).send({ status: "error", message: (err as Error).message });
    }
  });

  fastify.get("/api/audit/summary", async (req, reply) => {
    if (!fileLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "file:read");
    if (!session) return;
    try {
      const counts = await eventTypeCounts();
      return { counts };
    } catch (err) {
      reply.code(500).send({ status: "error", message: (err as Error).message });
    }
  });

  // ---- Local sites proxy ----

  const ProxyAddBody = z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string().trim().min(1).max(255).optional(),
    label: z.string().trim().max(80).optional(),
  });

  fastify.get("/api/proxy", async (req, reply) => {
    const session = authenticate(req, reply, "file:read");
    if (!session) return;
    return {
      ...deps.proxy.state(),
      proxyBase: "/proxy",
    };
  });

  fastify.post("/api/proxy", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "file:write");
    if (!session) return;
    const parsed = ProxyAddBody.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400).send({ status: "invalid_request" }); return; }
    try {
      const target = deps.proxy.add(parsed.data.port, parsed.data.host, parsed.data.label ?? null);
      recordEvent("proxy_added", {
        deviceName: session.deviceName,
        metadata: {
          port: target.port,
          host: target.host,
          label: target.label,
          sessionId: session.sessionId,
        },
      });
      return { status: "ok", target };
    } catch (err) {
      const code = (err as Error).message;
      if (code === "port_not_allowed") { reply.code(403).send({ status: "forbidden", reason: code }); return; }
      if (code === "invalid_port") { reply.code(400).send({ status: "invalid_request", reason: code }); return; }
      reply.code(500).send({ status: "error", message: code });
    }
  });

  fastify.delete("/api/proxy/:port", async (req, reply) => {
    if (!writeLimiter.hit(req.ip || "unknown")) { reply.code(429).send({ status: "rate_limited" }); return; }
    const session = authenticate(req, reply, "file:write");
    if (!session) return;
    const params = req.params as { port: string };
    const port = parseInt(params.port, 10);
    if (!Number.isFinite(port)) { reply.code(400).send({ status: "invalid_request" }); return; }
    const removed = deps.proxy.remove(port);
    if (!removed) { reply.code(404).send({ status: "not_found" }); return; }
    recordEvent("proxy_removed", {
      deviceName: session.deviceName,
      metadata: { port, sessionId: session.sessionId },
    });
    return { status: "ok" };
  });

  fastify.get("/api/proxy/discover", async (req, reply) => {
    const session = authenticate(req, reply, "file:read");
    if (!session) return;
    const ports = await probeListeningPorts("127.0.0.1", COMMON_DEV_PORTS);
    return { ports };
  });

  // Forward the proxy request before Fastify routes it. Hook fires for every
  // request; if path matches `/proxy/<port>/*` we hijack the reply so we can
  // talk to req.raw / reply.raw directly without Fastify wrapping.
  fastify.addHook("onRequest", (req, reply, done) => {
    const path = (req.raw.url || "").split("?")[0];
    if (!/^\/proxy\/\d{1,5}(\/|$)/.test(path)) {
      done();
      return;
    }
    reply.hijack();
    const url = new URL(req.raw.url || "/", "http://x");
    proxyHttpRequest(deps.proxy, req.raw, reply.raw, url, "");
    done();
  });

  // SPA fallback
  if (deps.publicDir && fs.existsSync(deps.publicDir)) {
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET") {
        reply.code(404).send({ status: "not_found" });
        return;
      }
      const indexFile = path.join(deps.publicDir!, "index.html");
      if (fs.existsSync(indexFile)) {
        reply.type("text/html").send(fs.readFileSync(indexFile));
      } else {
        reply.code(404).send({ status: "not_found" });
      }
    });
  }

  await fastify.listen({ host: "0.0.0.0", port: deps.port });

  const wss = new WebSocketServer({ noServer: true });
  fastify.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://x");
    if (/^\/proxy\/\d{1,5}(\/|$)/.test(url.pathname)) {
      proxyUpgrade(deps.proxy, request, socket, head);
      return;
    }
    if (url.pathname !== "/ws/terminal") {
      socket.destroy();
      return;
    }
    if (!isOriginAllowed(request.headers.origin, deps)) {
      recordEvent("ws_rejected", { metadata: { reason: "origin_rejected", origin: request.headers.origin || null } });
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleTerminalSocket(ws, url, deps);
    });
  });

  return {
    fastify,
    close: async () => {
      wss.clients.forEach((c) => c.terminate());
      wss.close();
      await fastify.close();
    },
  };
}

function handleSandboxError(reply: FastifyReply, err: unknown) {
  if (err instanceof SandboxError) {
    if (err.code === "outside_root") reply.code(403).send({ status: "forbidden", reason: err.code });
    else if (err.code === "target_exists") reply.code(409).send({ status: "conflict", reason: err.code });
    else if (err.code === "not_found") reply.code(404).send({ status: "not_found" });
    else if (err.code === "too_large") reply.code(413).send({ status: "too_large" });
    else reply.code(400).send({ status: "invalid_request", reason: err.code });
  } else {
    reply.code(500).send({ status: "error" });
  }
}


function handleGitError(reply: FastifyReply, err: unknown) {
  if (err instanceof git.GitError) {
    if (err.code === "not_a_repo") reply.code(409).send({ status: "not_a_repo" });
    else if (err.code === "invalid_input") reply.code(400).send({ status: "invalid_request" });
    else reply.code(500).send({ status: "git_failed", message: err.message });
    return;
  }
  reply.code(500).send({ status: "error", message: (err as Error).message });
}

function handleTerminalSocket(ws: WebSocket, url: URL, deps: AgentDeps) {
  const token = url.searchParams.get("token") || "";
  const session = token ? deps.sessions.byTokenRaw(token) : undefined;

  if (!session || !session.permissions.includes("terminal")) {
    recordEvent("ws_rejected", { metadata: { reason: "invalid_session_token" } });
    ws.send(JSON.stringify({ event: "error", payload: { code: "AUTH", message: "Invalid or expired session." } }));
    ws.close(4401, "unauthorized");
    return;
  }

  const initialCols = parseInt(url.searchParams.get("cols") || "", 10);
  const initialRows = parseInt(url.searchParams.get("rows") || "", 10);
  let alive = true;

  const send = (event: string, payload: unknown = {}) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, payload }));
  };

  const { session: termSession, reused, replay } = deps.terminals.attachOrCreate({
    sessionId: session.sessionId,
    rootPath: deps.rootPath,
    cols: Number.isInteger(initialCols) && initialCols > 0 ? initialCols : undefined,
    rows: Number.isInteger(initialRows) && initialRows > 0 ? initialRows : undefined,
    listener: {
      onData: (data: string) => {
        if (!alive) return;
        send("terminal:output", { data });
        deps.sessions.touch(session.sessionId);
      },
      onExit: ({ exitCode, signal }) => {
        send("terminal:exit", { exitCode, signal });
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "shell_exit");
      },
    },
  });

  send("session:connected", {
    machineName: deps.machineName,
    sessionId: session.sessionId,
    cwd: deps.rootPath,
    shell: termSession.term.shell,
    resumed: reused,
    replayBytes: replay.length,
  });

  if (reused && replay.length > 0) {
    send("terminal:replay", { data: replay });
  }

  // Hard caps — jaga agar buffer per-pesan tidak bisa balon-kan memori
  // atau mengalirkan input yang tidak masuk akal ke PTY.
  const MAX_FRAME_BYTES = 64 * 1024;     // 64 KB per frame WS
  const MAX_INPUT_CHARS = 32 * 1024;     // 32 KB per chunk terminal:input
  const MAX_COLS = 1024;
  const MAX_ROWS = 256;

  ws.on("message", (raw) => {
    const buf = raw as Buffer;
    if (buf.length > MAX_FRAME_BYTES) {
      recordEvent("ws_rejected", { metadata: { reason: "frame_too_large", sessionId: session.sessionId, bytes: buf.length } });
      ws.close(4413, "frame_too_large");
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(buf.toString("utf8"));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as { event?: string; payload?: any };
    if (m.event === "terminal:input" && typeof m.payload?.data === "string") {
      const data = m.payload.data as string;
      if (data.length > MAX_INPUT_CHARS) {
        recordEvent("ws_rejected", { metadata: { reason: "input_too_large", sessionId: session.sessionId, length: data.length } });
        return;
      }
      deps.terminals.write(session.sessionId, data);
      deps.sessions.touch(session.sessionId);
    } else if (m.event === "terminal:resize") {
      const cols = Number(m.payload?.cols);
      const rows = Number(m.payload?.rows);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= MAX_COLS && rows <= MAX_ROWS) {
        deps.terminals.resize(session.sessionId, cols, rows);
      }
    } else if (m.event === "session:disconnect") {
      ws.close(1000, "client_disconnect");
    }
  });

  const onClose = () => {
    if (!alive) return;
    alive = false;
    // Detach but keep the PTY alive so a reconnecting client can resume.
    deps.terminals.detach(session.sessionId);
  };

  ws.on("close", onClose);
  ws.on("error", onClose);
}

function isOriginAllowed(originHeader: string | undefined, deps: AgentDeps): boolean {
  // Same-origin browser navigation menyertakan Origin yang menunjuk ke base URL kita.
  // Permintaan dari curl / native client biasanya tidak punya Origin sama sekali —
  // itu kita izinkan karena auth-nya tetap lewat session token bearer.
  if (!originHeader) return true;
  let parsed: URL;
  try { parsed = new URL(originHeader); } catch { return false; }
  const host = parsed.hostname.toLowerCase();
  // Selalu izinkan loopback dan link-local LAN range.
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
  // Izinkan host tunnel saat ini.
  const tunnel = deps.getTunnelUrl();
  if (tunnel) {
    try { if (new URL(tunnel).hostname.toLowerCase() === host) return true; } catch { /* ignore */ }
  }
  // Pair URL juga bawa origin yang sah; cek host-nya.
  const pair = deps.getPairUrl();
  if (pair) {
    try { if (new URL(pair).hostname.toLowerCase() === host) return true; } catch { /* ignore */ }
  }
  return false;
}

function guessDeviceName(ua: string) {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad/i.test(ua)) return "iOS Safari";
  if (/Android/i.test(ua)) return "Android browser";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser client";
}

function guessDeviceType(ua: string): "mobile" | "desktop" | "unknown" {
  if (!ua) return "unknown";
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return "mobile";
  return "desktop";
}
