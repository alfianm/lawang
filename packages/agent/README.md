# Lawang

> Local-first remote access for your own machine, with QR pairing and explicit host approval.

Run one command on your laptop or server, scan a QR code from your phone,
tablet, or another browser, then open a secure remote workspace for your
project. Lawang is built for developer workflows: terminal, files, code edit,
Git, localhost proxy, audit log, host controls, and an early remote desktop
mode.

No accounts. No central cloud dashboard. No broker that stores your command
output or project files. The host keeps control and must approve new devices.

```bash
npm i -g lawang
lawang start
```

Scan the QR shown in the terminal (or open `http://localhost:3999/qr` for
a fullscreen version), approve the request from the host CLI, and you're in.

## Features

### Remote terminal

- Overview dashboard with host status, active sessions, permissions, and quick
  navigation after pairing.
- Browser terminal powered by xterm.js and `node-pty`.
- Mobile shortcut bar for `Esc`, `Tab`, `Ctrl+C`, arrows, and common shell keys.
- Reconnect-safe PTY: short disconnects keep the shell alive and replay buffered
  output when the browser returns.
- One-shot command chat tab for quick commands with formatted output, exit code,
  JSON, and diff rendering.

### Files and code

- Browse the project root from the browser.
- Read, edit, save, upload, rename, delete, and create folders inside the
  sandboxed root.
- Search the current folder and drag files into the browser to upload.
- Monaco editor for code editing directly from the remote browser.
- File preview protects large/binary files and blocks path traversal.

### Git workflow

- Git status, diff, and recent log.
- Stage and unstage files.
- Commit, pull, and push from the web UI.
- Push supports first-time upstream setup when the branch has no tracking
  branch.

### Remote desktop preview

- Desktop tab for screen viewing on macOS hosts.
- Mouse move/click, keyboard events, and text input when the session has
  `screen:control`.
- Responsive Fit/Large view modes for desktop and mobile browsers.
- macOS needs Screen Recording permission for viewing and Accessibility
  permission for control.

### Localhost proxy

- Expose local dev servers through the Lawang session, for example
  `localhost:3000` or `localhost:5173`.
- Access proxied apps under `/proxy/<port>/...`.
- Optional allow-list mode or open dev mode via `--proxy open`.

### Device and session control

- One-time QR pairing with explicit approval from the host CLI.
- Optional extra pairing PIN via `--pair-pin` and LAN-only pairing via
  `--pair-lan-only`.
- Permission scopes: full access, read-only, or terminal-only.
- Trusted devices can skip future approval and can be revoked later.
- Optional `--auto-approve` mode for trusted environments where valid pairing
  tokens should skip the interactive host prompt.
- `--unattended` combines auto-approve with keep-awake for always-ready hosts.
- List and revoke active sessions from the CLI or browser session panel.
- Rotate the pairing token without restarting the agent.

### Host utilities

- Host power actions from the UI: sleep, shutdown, reboot, and lock.
- Battery indicator in the web session.
- `--keep-awake` mode to prevent sleep while the agent is running.
- Update banner when a newer npm version is available.

### Audit and safety

- Local JSONL audit log at `~/.lawang/audit.log`.
- Audit viewer in the browser with filters and search.
- Security smoke test via `lawang verify`.
- Rate limits, origin checks, hashed tokens, sandboxed file paths, and bounded
  WebSocket frames.

## Commands

```bash
lawang start [--keep-awake] [--no-tunnel] [--port 3999] [--root .]
lawang start --proxy 3000,5173    # expose selected local dev ports
lawang start --proxy open         # allow any localhost port in dev mode
lawang start --auto-approve       # skip host prompt for valid pairing tokens
lawang start --auto-approve --auto-approve-scope files
lawang start --unattended         # auto-approve + keep-awake
lawang start --unattended-lan-only
lawang start --pair-pin 123456 --session-ttl 120
lawang install-service --unattended --register

lawang rotate                     # new pairing token without restarting
lawang devices [--revoke <id>]    # manage trusted devices
lawang sessions [--revoke <id>]   # list or revoke active sessions
lawang history                    # past sessions from audit log
lawang verify                     # smoke-test security hard rules
lawang ping                       # check if agent is running
```

## Requirements

- Node.js `>= 18.17`
- Optional: `cloudflared` for public tunnel (`brew install cloudflared` on
  macOS).
- macOS and Linux for core terminal/file/Git features.
- Remote desktop preview currently targets macOS hosts.
- Windows compatibility exists but is not yet fully tested.

## Security

- Pairing token: random 24-byte base64url, SHA-256 hashed, one-time consumed.
- Optional pairing PIN is hashed in memory and checked before approval.
- Session token: random 32-byte, hashed in memory.
- Optional session max lifetime via `--session-ttl <minutes>`.
- Permission scopes are enforced on every API and WebSocket path.
- Path traversal guard on all file endpoints.
- WebSocket Origin allowlist + 64 KB frame cap + 32 KB input cap.
- Rate limiting on pairing, file reads, writes, and desktop frames.
- All secrets stored as hashes; raw tokens only ever leave to legitimate
  client device.
- Audit log records pairing, sessions, file writes, Git actions, proxy access,
  power actions, and desktop control events.

Run `lawang verify` to confirm hard rules are still enforced.

## Publish notes

The npm package includes the built agent (`dist/`) and built web UI (`public/`).
If you are publishing a README-only update, npm still requires a new version:

```bash
cd packages/agent
npm version patch --no-git-tag-version
npm publish
```

## License

MIT.

## Links

- Full docs: see [`docs/DOCUMENTATION.md`](https://github.com/alfianm/lawang-app/blob/main/docs/DOCUMENTATION.md)
- API reference: see [`site/api.html`](https://github.com/alfianm/lawang-app/blob/main/site/api.html)
- PRD: see [`prd_remote_access_app.md`](https://github.com/alfianm/lawang-app/blob/main/prd_remote_access_app.md)
