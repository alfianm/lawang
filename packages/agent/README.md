# Lawang

> Local-first remote terminal with QR pairing.

Run a single command on your laptop, scan a QR from your phone, get a
browser-based shell — but only after you explicitly approve from the host
CLI. No accounts, no cloud broker, no data riding to anyone else's server.

```bash
npm i -g lawang
lawang start
```

Scan the QR shown in the terminal (or open `http://localhost:3999/qr` for
a fullscreen version), approve the request from the host CLI, and you're in.

## What it does

- **CLI agent** boots a local HTTP + WebSocket server (Fastify + ws + node-pty).
- **One-time QR pairing** with explicit host approval. Token is random, hashed,
  TTL 15 minutes, single-use.
- **Mobile-friendly web terminal** using xterm.js with shortcut bar.
- **File explorer + Monaco editor** for read/write within the project root.
- **Git panel** for status, diff, log, stage, commit, pull, push.
- **Chat tab** for one-shot commands rendered as bubbles with formatted
  output (JSON, diff, exit code).
- **Optional cloudflared tunnel** auto-detected for public access.
- **Trusted devices** for auto-approve, with revoke.
- **Audit log** at `~/.lawang/audit.log` (JSONL, append-only).
- **Power controls** from the UI: sleep / shutdown / reboot / lock host.
- **Battery indicator** + `--keep-awake` mode.

## Commands

```bash
lawang start [--keep-awake] [--no-tunnel] [--port 3999] [--root .]
lawang rotate                  # new pairing token without restarting
lawang devices [--revoke <id>] # manage trusted devices
lawang sessions                # list active sessions
lawang history                 # past sessions from audit log
lawang verify                  # smoke-test security hard rules
lawang ping                    # check if agent is running
```

## Requirements

- Node.js `>= 18.17`
- Optional: `cloudflared` for public tunnel (`brew install cloudflared` on
  macOS).
- macOS, Linux. Windows compat exists but is not yet fully tested.

## Security

- Pairing token: random 24-byte base64url, SHA-256 hashed, one-time consumed.
- Session token: random 32-byte, hashed in memory.
- Path traversal guard on all file/git endpoints.
- WebSocket Origin allowlist + 64 KB frame cap + 32 KB input cap.
- Rate limiting on pairing (20/min), file read (240/min), file write (60/min).
- All secrets stored as hashes; raw tokens only ever leave to legitimate
  client device.

Run `lawang verify` to confirm hard rules are still enforced.

## License

MIT.

## Links

- Full docs: see [`docs/DOCUMENTATION.md`](https://github.com/lawang-app/lawang/blob/main/docs/DOCUMENTATION.md)
- API reference: see [`site/api.html`](https://lawang.dev/api.html)
- PRD: see [`prd_remote_access_app.md`](https://github.com/lawang-app/lawang/blob/main/prd_remote_access_app.md)
