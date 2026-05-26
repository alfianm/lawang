#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import { loadConfig, saveConfig } from "./lib/config";
import { PairingManager } from "./lib/pairing";
import { SessionStore } from "./lib/sessions";
import { startServer } from "./server";
import { startTunnel, TunnelHandle } from "./lib/tunnel";
import { printStartBanner } from "./lib/banner";
import { log } from "./lib/logger";
import { recordEvent, flushAudit } from "./lib/audit";
import { pickLanAddress } from "./lib/network";
import { TrustedDeviceStore } from "./lib/trustedDevices";
import { startKeepAwake, KeepAwakeHandle } from "./lib/keepAwake";
import { LocalProxyManager } from "./lib/localProxy";
import { TerminalSessionStore } from "./lib/terminalSessions";
import { runVerify } from "./lib/verify";
import { checkForUpdate, UpdateInfo } from "./lib/updateCheck";
import {
  buildContext as buildServiceCtx,
  detectPlatform,
  writeUnit,
  removeUnit,
  registrationSteps,
  unregistrationSteps,
  runStep,
  probeStatus,
  renderUnit,
} from "./lib/service";
import {
  startControlServer,
  buildControlHandler,
  controlRequest,
  ControlServer,
} from "./lib/controlSocket";
import { readSessionHistory, formatDuration } from "./lib/auditReader";

const pkg = require("../package.json") as { name?: string; version: string };

const program = new Command();
program
  .name("lawang")
  .description("Run a secure remote terminal for the current machine, pair via QR.")
  .version(pkg.version);

program
  .command("start", { isDefault: true })
  .description("Start the local agent and tunnel.")
  .option("-p, --port <port>", "Local port to bind", (v) => parseInt(v, 10), 3999)
  .option("-r, --root <path>", "Project root exposed to the session", process.cwd())
  .option("--no-tunnel", "Disable cloudflared tunnel")
  .option("--token-ttl <minutes>", "Pairing token TTL in minutes", (v) => parseInt(v, 10), 15)
  .option("--idle-timeout <minutes>", "Idle session timeout in minutes", (v) => parseInt(v, 10), 30)
  .option("--qr-size <size>", "QR size in terminal: small | large | off", "large")
  .option("--keep-awake", "Prevent the host machine from sleeping while the agent is running")
  .option(
    "--proxy <ports>",
    "Comma separated list of localhost ports to expose under /proxy/<port>. Use 'open' to allow any.",
    ""
  )
  .action(async (opts) => {
    const rootPath = path.resolve(opts.root);
    if (!fs.existsSync(rootPath)) {
      log.error(`Project root not found: ${rootPath}`);
      process.exit(1);
    }
    const cfg = await loadConfig(rootPath, opts.port);
    cfg.settings.tokenExpiryMinutes = opts.tokenTtl;
    cfg.settings.idleTimeoutMinutes = opts.idleTimeout;
    await saveConfig(cfg);

    const pairing = new PairingManager(cfg.settings.tokenExpiryMinutes);
    const sessions = new SessionStore(cfg.settings.idleTimeoutMinutes);
    const trusted = new TrustedDeviceStore(cfg);
    const terminals = new TerminalSessionStore();
    sessions.onEnd((sessionId) => terminals.end(sessionId));

    const proxyArg = String(opts.proxy || "").trim();
    let proxy: LocalProxyManager;
    if (!proxyArg) {
      proxy = new LocalProxyManager({ allowList: [] });
    } else if (proxyArg.toLowerCase() === "open") {
      proxy = new LocalProxyManager({ allowList: null });
    } else {
      const ports = proxyArg
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
      proxy = new LocalProxyManager({ allowList: ports });
    }

    const publicDir = path.resolve(__dirname, "../public");

    let tunnel: TunnelHandle = { url: null, provider: "none", stop: async () => undefined };
    let getTunnelUrl = () => tunnel.url;

    let currentPairUrl = "";
    let rotateAndAnnouncePtr: (announce: boolean) => Promise<{ pairUrl: string; token: string; expiresAt: number }> = async () => { throw new Error("not_ready"); };
    const server = await startServer({
      port: opts.port,
      rootPath,
      machineName: cfg.machineName,
      version: pkg.version,
      pairing,
      sessions,
      trusted,
      proxy,
      terminals,
      publicDir: fs.existsSync(publicDir) ? publicDir : null,
      getTunnelUrl: () => getTunnelUrl(),
      getPairUrl: () => currentPairUrl,
    });

    if (opts.tunnel) {
      try {
        tunnel = await startTunnel(opts.port);
        if (tunnel.url) log.success(`Tunnel ready: ${tunnel.url}`);
      } catch (err) {
        log.warn(`Tunnel failed to start: ${(err as Error).message}`);
      }
    }
    getTunnelUrl = () => tunnel.url;

    let control: ControlServer | null = null;
    try {
      control = await startControlServer(buildControlHandler({
        sessions,
        machineName: cfg.machineName,
        pid: process.pid,
        rotatePairing: () => rotateAndAnnouncePtr(true),
      }));
      log.info(`Control socket: ${control.address}`);
    } catch (err) {
      log.warn(`Control socket failed: ${(err as Error).message}`);
    }

    const lanIp = pickLanAddress();
    const localUrl = `http://localhost:${opts.port}`;
    const lanUrl = lanIp ? `http://${lanIp}:${opts.port}` : null;

    const qrSize = (["small","large","off"] as const).includes(opts.qrSize) ? opts.qrSize as "small"|"large"|"off" : "small";
    const pairBase = tunnel.url || lanUrl || localUrl;
    const computePairUrl = (rawToken: string) => `${pairBase}/#/pair?token=${encodeURIComponent(rawToken)}`;
    const rotateAndAnnounce = async (announce: boolean): Promise<{ pairUrl: string; token: string; expiresAt: number }> => {
      const t = pairing.rotate();
      currentPairUrl = computePairUrl(t.rawToken);
      if (announce) {
        log.success("Pairing token rotated.");
        log.info(`New pair URL: ${currentPairUrl}`);
        try {
          await printStartBanner({
            localUrl,
            lanUrl,
            tunnelUrl: tunnel.url,
            pairUrl: currentPairUrl,
            qrPageUrl: `${localUrl}/qr`,
            pairingExpiresMin: cfg.settings.tokenExpiryMinutes,
            rootPath,
            machineName: cfg.machineName,
            qrSize,
          });
        } catch { /* banner is best-effort */ }
      }
      return { pairUrl: currentPairUrl, token: t.rawToken, expiresAt: t.expiresAt };
    };

    rotateAndAnnouncePtr = rotateAndAnnounce;
    const token = pairing.rotate();
    currentPairUrl = computePairUrl(token.rawToken);
    const qrPageUrl = `${localUrl}/qr`;

    recordEvent("agent_started", {
      metadata: {
        port: opts.port,
        rootPath,
        tunnel: tunnel.provider,
        version: pkg.version,
        lan: lanIp,
      },
    });

    await printStartBanner({
      localUrl,
      lanUrl,
      tunnelUrl: tunnel.url,
      pairUrl: currentPairUrl,
      qrPageUrl,
      pairingExpiresMin: cfg.settings.tokenExpiryMinutes,
      rootPath,
      machineName: cfg.machineName,
      qrSize,
    });

    const trustedCount = trusted.active().length;
    if (trustedCount > 0) {
      log.info(`Trusted devices: ${trustedCount} (auto-approve enabled)`);
    }

    // Update check, best-effort, never blocks startup.
    let latestUpdate: UpdateInfo | null = null;
    void checkForUpdate({ pkgName: pkg.name || "lawang", currentVersion: pkg.version })
      .then((info) => {
        latestUpdate = info;
        if (info.outdated && info.latest) {
          const banner = [
            "",
            log.paint("yellow", "  ┌─ Update available ─────────────────────────┐"),
            `  ${log.paint("yellow", "│")}  ${info.current} → ${log.paint("bold", info.latest)}${" ".repeat(Math.max(0, 38 - info.current.length - info.latest.length))}${log.paint("yellow", "│")}`,
            `  ${log.paint("yellow", "│")}  Run: ${log.paint("cyan", "npm i -g lawang@latest")}${" ".repeat(15)}${log.paint("yellow", "│")}`,
            log.paint("yellow", "  └────────────────────────────────────────────┘"),
            "",
          ];
          process.stdout.write(banner.join("\n") + "\n");
        }
      })
      .catch(() => undefined);
    // Expose latest update info to the server so /api/version can read it.
    (globalThis as any).__lawangUpdateInfo = () => latestUpdate;

    let keepAwake: KeepAwakeHandle | null = null;
    if (opts.keepAwake) {
      keepAwake = startKeepAwake();
      if (keepAwake.provider === "noop") {
        log.warn(`keep-awake: ${keepAwake.reason}`);
      } else {
        log.success(`keep-awake: ${keepAwake.reason}`);
      }
    }

    let stopping = false;
    const shutdown = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      log.warn(`Received ${signal}, shutting down…`);
      sessions.revokeAll("revoked");
      terminals.endAll();
      try { keepAwake?.stop(); } catch {}
      try { await tunnel.stop(); } catch {}
      try { await server.close(); } catch {}
      try { if (control) await control.close(); } catch {}
      pairing.dispose();
      sessions.dispose();
      recordEvent("agent_stopped");
      await flushAudit();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    let lastCount = -1;
    setInterval(() => {
      const count = sessions.list().length;
      if (count !== lastCount) {
        lastCount = count;
        log.info(`Active sessions: ${count}`);
      }
    }, 5_000).unref();
  });

program
  .command("devices")
  .description("Manage trusted devices stored in ~/.lawang/config.json")
  .option("--revoke <deviceId>", "Revoke a trusted device by id (full or 8+ char prefix)")
  .option("--revoke-all", "Revoke every trusted device")
  .option("--json", "Print as JSON")
  .action(async (opts) => {
    const cfg = await loadConfig(process.cwd(), 0);
    const trusted = new TrustedDeviceStore(cfg);

    if (opts.revokeAll) {
      let count = 0;
      for (const d of trusted.active()) {
        await trusted.revoke(d.deviceId);
        count += 1;
      }
      log.success(`Revoked ${count} trusted device(s).`);
      await flushAudit();
      return;
    }

    if (opts.revoke) {
      const needle = String(opts.revoke);
      const match = trusted.list().find((d) => d.deviceId === needle || d.deviceId.startsWith(needle));
      if (!match) {
        log.error(`No trusted device matching "${needle}"`);
        process.exit(1);
      }
      const revoked = await trusted.revoke(match.deviceId);
      log.success(`Revoked: ${revoked?.name} (${revoked?.deviceId})`);
      await flushAudit();
      return;
    }

    const list = trusted.list();
    if (opts.json) {
      process.stdout.write(JSON.stringify(list, null, 2) + "\n");
      return;
    }
    if (list.length === 0) {
      log.info("No trusted devices yet. Approve a device with 'trust' answered yes during pairing.");
      return;
    }
    process.stdout.write("\n");
    for (const d of list) {
      const status = d.revokedAt ? log.paint("yellow", "revoked") : log.paint("green", "active");
      process.stdout.write(
        `  ${log.paint("bold", d.deviceId.slice(0, 8))}  ${status}  ${d.name}\n` +
          `    added: ${d.createdAt}\n` +
          `    last : ${d.lastUsedAt || "—"}${d.revokedAt ? `\n    revoked: ${d.revokedAt}` : ""}\n\n`
      );
    }
  });

program
  .command("sessions")
  .description("List or revoke sessions on the running agent")
  .option("--revoke <sessionId>", "Revoke a session by id (full or 8+ char prefix)")
  .option("--revoke-all", "Revoke every active session")
  .option("--json", "Print as JSON")
  .action(async (opts) => {
    try {
      if (opts.revokeAll) {
        const r = await controlRequest({ cmd: "revoke-all" }) as { revoked: number };
        log.success(`Revoked ${r.revoked} session(s).`);
        return;
      }
      if (opts.revoke) {
        const r = await controlRequest({ cmd: "revoke", args: { sessionId: String(opts.revoke) } }) as { revoked: string };
        log.success(`Revoked session ${r.revoked}.`);
        return;
      }
      const list = (await controlRequest({ cmd: "sessions" })) as Array<{
        sessionId: string;
        deviceName: string;
        deviceType: string;
        remoteAddr: string;
        createdAt: string;
        lastActiveAt: string;
      }>;
      if (opts.json) {
        process.stdout.write(JSON.stringify(list, null, 2) + "\n");
        return;
      }
      if (list.length === 0) {
        log.info("No active sessions.");
        return;
      }
      process.stdout.write("\n");
      for (const s of list) {
        process.stdout.write(
          `  ${log.paint("bold", s.sessionId.slice(0, 8))}  ${s.deviceName} (${s.deviceType})\n` +
            `    remote   : ${s.remoteAddr}\n` +
            `    started  : ${s.createdAt}\n` +
            `    last seen: ${s.lastActiveAt}\n\n`
        );
      }
    } catch (err) {
      const msg = (err as Error).message || "control_failed";
      if (msg === "agent_not_running") log.error("Agent is not running. Start it first with `lawang start`.");
      else log.error(`Sessions command failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("rotate")
  .description("Rotate the pairing token in the running agent without restarting it")
  .option("--json", "Print as JSON")
  .action(async (opts) => {
    try {
      const r = await controlRequest({ cmd: "rotate" }) as { pairUrl: string; token: string; expiresAt: number };
      if (opts.json) {
        process.stdout.write(JSON.stringify(r, null, 2) + "\n");
        return;
      }
      log.success("Rotated.");
      log.info(`Pair URL: ${r.pairUrl}`);
      log.info(`Expires : ${new Date(r.expiresAt).toISOString()}`);
    } catch (err) {
      const msg = (err as Error).message || "control_failed";
      if (msg === "agent_not_running") log.error("Agent is not running. Start it first with `lawang start`.");
      else if (msg === "rotate_not_supported") log.error("This agent build does not support rotation.");
      else log.error(`Rotate failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("ping")
  .description("Check whether the local agent is running")
  .action(async () => {
    try {
      const r = await controlRequest({ cmd: "ping" }) as { ok: boolean; machineName: string; pid: number };
      log.success(`Agent ok: ${r.machineName} (pid ${r.pid})`);
    } catch (err) {
      const msg = (err as Error).message || "control_failed";
      if (msg === "agent_not_running") log.error("Agent is not running.");
      else log.error(`Ping failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("history")
  .description("Show past sessions reconstructed from the local audit log")
  .option("--limit <n>", "Maximum sessions to show", (v) => parseInt(v, 10), 25)
  .option("--json", "Print as JSON")
  .action(async (opts) => {
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 25;
    const records = await readSessionHistory(limit);

    if (opts.json) {
      process.stdout.write(JSON.stringify(records, null, 2) + "\n");
      return;
    }

    if (records.length === 0) {
      log.info("No session history yet. Pair a device first.");
      return;
    }

    process.stdout.write("\n");
    for (const r of records) {
      const tone = r.endReason === "revoked" ? "yellow" : r.endReason === "expired" ? "yellow" : r.endedAt ? "green" : "cyan";
      const status = r.endedAt ? r.endReason ?? "ended" : "active";
      const duration = formatDuration(r.startedAt, r.endedAt);
      process.stdout.write(
        `  ${log.paint("bold", r.sessionId.slice(0, 8))}  ${log.paint(tone, status)}  ${r.deviceName}\n` +
          `    started : ${r.startedAt}\n` +
          `    ended   : ${r.endedAt ?? "—"}  (${duration})\n` +
          `    remote  : ${r.remoteAddr ?? "—"}${r.trusted ? "  · trusted" : ""}\n\n`
      );
    }
  });

program
  .command("verify")
  .description("Smoke-test the running agent: hard rules from PRD section 17 / 18.3")
  .option("--base <url>", "Base URL of the agent", "http://localhost:3999")
  .option("--json", "Print as JSON")
  .action(async (opts) => {
    const report = await runVerify(String(opts.base));
    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      process.exit(report.ok ? 0 : 1);
    }
    process.stdout.write(`\nVerify ${report.baseUrl}\n`);
    for (const c of report.checks) {
      const tag = c.ok ? log.paint("green", "✓") : log.paint("red", "✗");
      const detail = c.detail ? `  ${log.paint("bold", "·")} ${c.detail}` : "";
      process.stdout.write(`  ${tag}  ${c.name}${detail}\n`);
    }
    process.stdout.write("\n");
    if (report.ok) {
      log.success("All checks passed.");
      process.exit(0);
    }
    // Special-case: agent not running. Tampilkan tip yang actionable, bukan generic.
    const ping = report.checks[0];
    if (ping && !ping.ok && ping.detail === "agent_not_running") {
      log.error("Agent is not running.");
      log.info("Start it in another terminal first:  lawang start");
      log.info("Then run again:                       lawang verify");
      process.exit(1);
    }
    log.error("Some checks failed. See output above.");
    process.exit(1);
  });

program
  .command("install-service")
  .description("Generate a systemd user unit (Linux) or launchd plist (macOS) so Lawang auto-starts at login")
  .option("--root <path>", "Project root the service should run in", process.cwd())
  .option("--no-tunnel", "Add --no-tunnel to the service args")
  .option("--keep-awake", "Add --keep-awake to the service args (Linux only is meaningful)")
  .option("--register", "Register the unit with systemctl/launchctl after writing it")
  .option("--print", "Only print the unit file, do not write or register")
  .action(async (opts) => {
    const platform = detectPlatform();
    if (platform === "unsupported") {
      log.error(`Service install is not supported on ${process.platform}. Use a process manager like PM2 or run inside tmux instead.`);
      process.exit(1);
    }
    const args: string[] = ["start"];
    if (opts.tunnel === false) args.push("--no-tunnel");
    if (opts.keepAwake) args.push("--keep-awake");
    args.push("--root", path.resolve(opts.root));

    const binaryPath = process.execPath === "node" ? "lawang" : process.execPath;
    // Prefer the installed `lawang` binary so PATH-resolved by systemd/launchd, falling back to node + cli.js.
    const finalBinary = (process.argv[1] && process.argv[1].endsWith("lawang")) ? "lawang" : "lawang";

    const ctx = buildServiceCtx({
      rootPath: path.resolve(opts.root),
      binaryPath: finalBinary,
      extraArgs: args.slice(1), // skip the leading "start" because renderUnit will add it
    });

    if (opts.print) {
      process.stdout.write(renderUnit(ctx));
      return;
    }

    await writeUnit(ctx);
    log.success(`Wrote ${ctx.unitPath}`);
    if (opts.register) {
      for (const step of registrationSteps(ctx)) {
        const r = runStep(step);
        if (r.ok) log.success(`✓ ${step.description}`);
        else {
          log.warn(`✗ ${step.description}`);
          if (r.stderr) process.stderr.write(r.stderr + "\n");
        }
      }
    } else {
      log.info("Run with --register to enable + start the service automatically.");
      if (ctx.platform === "linux-systemd") {
        log.info("Or manually:  systemctl --user daemon-reload && systemctl --user enable --now lawang");
        log.info("Survive logout: loginctl enable-linger $USER");
      } else {
        log.info(`Or manually:  launchctl load -w ${ctx.unitPath}`);
      }
    }
  });

program
  .command("uninstall-service")
  .description("Disable + remove the service unit installed by `install-service`")
  .action(async () => {
    const platform = detectPlatform();
    if (platform === "unsupported") {
      log.error(`Service install is not supported on ${process.platform}.`);
      process.exit(1);
    }
    const ctx = buildServiceCtx({ rootPath: process.cwd(), binaryPath: "lawang" });
    for (const step of unregistrationSteps(ctx)) {
      const r = runStep(step);
      if (r.ok) log.success(`✓ ${step.description}`);
      else log.warn(`✗ ${step.description}: ${r.stderr.trim() || "non-zero exit"}`);
    }
    const removed = await removeUnit(ctx);
    if (removed) log.success(`Removed ${ctx.unitPath}`);
    else log.info("Unit file already absent.");
  });

program
  .command("service-status")
  .description("Show whether the Lawang service is installed and active")
  .action(() => {
    const ctx = buildServiceCtx({ rootPath: process.cwd(), binaryPath: "lawang" });
    if (ctx.platform === "unsupported") {
      log.error(`Service install is not supported on ${process.platform}.`);
      process.exit(1);
    }
    const status = probeStatus(ctx);
    process.stdout.write("\n");
    process.stdout.write(`  unit     : ${ctx.unitPath}\n`);
    process.stdout.write(`  installed: ${status.installed ? log.paint("green", "yes") : log.paint("yellow", "no")}\n`);
    process.stdout.write(`  active   : ${status.active ? log.paint("green", "yes") : log.paint("yellow", "no")}\n`);
    process.stdout.write(`  via      : ${status.source}\n\n`);
  });

program.parseAsync().catch((err) => {
  log.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
