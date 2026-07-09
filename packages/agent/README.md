# Lawang - Remote Workspace for Your Own Machine

**Open your terminal, files, Git workflow, local dev servers, and a desktop preview from any browser.**

Run one command on your laptop or workstation, scan a QR code from a phone,
tablet, or another browser, approve the device on the host, and use a local-first
remote workspace without a hosted account.

```bash
npm install -g lawang
lawang start
```

Open the QR URL printed by the CLI, or visit `http://localhost:3999/qr`.

## Why Lawang?

Lawang is built for developer workflows where SSH, VPN, and classic remote
desktop tools feel too heavy or too narrow:

- Browser-based terminal, files, code editing, Git, localhost proxy, audit log,
  host controls, and desktop preview in one workspace.
- QR pairing with host approval by default.
- Optional unattended mode for trusted LAN/private setups.
- No account, no central cloud dashboard, and no hosted broker storing your
  terminal output or project files.
- Open source and local-first.

## Quick Start

```bash
npm install -g lawang
lawang start
```

Then:

1. Open the QR URL shown in the terminal.
2. Scan the QR from another device.
3. Approve the pairing request on the host CLI.
4. Use the Lawang browser workspace.

For unattended LAN use:

```bash
lawang start --unattended-lan-only --pair-pin 123456 --session-ttl 120
```

This keeps the host awake, auto-approves valid pairing tokens, limits pairing to
LAN/private addresses, requires a PIN, and expires sessions after 120 minutes.

## What's New in 0.9.0

Lawang 0.9.0 improves remote-from-phone workflows:

- Clipboard bridge between browser device and host.
- Attention notifications when terminals or process jobs need input.
- AI agent cards for running coding agents in Ops.
- Reachability status (tunnel / LAN / local) in Overview and session header.
- Share-link and trusted-device list/revoke from Ops.
- Live process log streaming over WebSocket.
- Richer mobile terminal key bar (sticky Ctrl/Alt, navigation keys).
- Permission-aware Files, Git, Proxy, and Ops UI.

See the root [CHANGELOG.md](../../CHANGELOG.md) for details.

## Features

### Remote terminal

- Real PTY shell over WebSocket.
- xterm.js browser terminal.
- Mobile shortcut bar for common shell keys.
- Reconnect-safe terminal sessions for short disconnects.
- One-shot command chat for quick commands and formatted output.

### Files and code

- Browse the project root from the browser.
- Read, edit, save, upload, download, rename, delete, and create folders.
- Search the current folder.
- Drag and drop uploads.
- Monaco-powered browser code editor.
- Path traversal and large/binary file guards.

### Git workflow

- Git status, diff, and recent log.
- Stage and unstage files.
- Commit, pull, and push from the web UI.
- First-time upstream setup when pushing a branch with no tracking branch.

### Remote desktop preview

- macOS view via `screencapture`.
- macOS control via CoreGraphics/System Events.
- Linux view via `grim`, `gnome-screenshot`, `scrot`, or ImageMagick `import`.
- Linux X11 control via `xdotool`.
- Windows view/control via PowerShell and active desktop session APIs.
- Responsive Fit/Large modes for desktop and mobile browsers.

Remote desktop is still a preview feature. It is useful for inspection and light
control, but it is not a WebRTC-grade streamer yet.

### Localhost proxy

- Expose local dev servers, for example `localhost:3000` or `localhost:5173`.
- Open proxied apps inside the session under `/proxy/<port>/...`.
- Use an allow-list or development open mode.

```bash
lawang start --proxy 3000,5173
lawang start --proxy open
```

### Device and session control

- One-time QR pairing token.
- Host approval required by default.
- Optional pairing PIN via `--pair-pin`.
- Optional LAN/private pairing restriction via `--pair-lan-only`.
- Permission scopes: full, read-only, files, or terminal.
- Trusted device revoke.
- Active session list and revoke from CLI or browser.
- Token rotation without restarting the agent.

### Host utilities

- Host lock, sleep, reboot, and shutdown actions from the UI.
- Ops tab with Setup Doctor, Secure Share Session, Process Monitor, Port
  Explorer, and Service Installer.
- Battery indicator.
- Keep-awake mode.
- Service install helper for launchd/systemd.
- Update banner when a newer NPM version is available.

### Audit and safety

- Local JSONL audit log at `~/.lawang/audit.log`.
- Browser audit viewer.
- Security smoke checks via `lawang verify`.
- Hashed pairing/session tokens.
- File sandboxing.
- Origin checks and rate limits.
- Bounded WebSocket frames.

## Commands

```bash
lawang start [--keep-awake] [--no-tunnel] [--port 3999] [--root .]
lawang start --proxy 3000,5173
lawang start --proxy open
lawang start --auto-approve
lawang start --auto-approve --auto-approve-scope files
lawang start --unattended
lawang start --unattended-lan-only
lawang start --pair-pin 123456 --session-ttl 120
lawang install-service --unattended --register

lawang rotate
lawang devices
lawang devices --revoke <id>
lawang sessions
lawang sessions --revoke <id>
lawang history
lawang verify
lawang ping
```

## Requirements

- Node.js `>= 18.17`
- Optional `cloudflared` for public tunnel support
- macOS, Linux, or Windows host for core workflows

Remote desktop requirements:

- macOS: Screen Recording permission for view, Accessibility permission for
  control
- Linux: `grim`, `gnome-screenshot`, `scrot`, or ImageMagick `import` for view
- Linux control: X11 session with `xdotool`
- Windows: PowerShell and an active signed-in desktop session

## Security Model

- Pairing tokens are random, short-lived, one-time, and stored only as hashes.
- Session tokens are random and stored only as hashes in memory.
- Optional pairing PINs are hashed before comparison.
- Host approval is required by default.
- Permission scopes are enforced on every API and WebSocket path.
- File access is sandboxed to the selected root.
- Sensitive operations are written to the local audit log.

For unattended hosts, prefer:

```bash
lawang start --unattended-lan-only --pair-pin 123456 --session-ttl 120
```

## Bahasa Indonesia

Lawang adalah alat remote access lokal untuk membuka terminal, file, Git,
localhost proxy, kontrol host, dan preview remote desktop dari browser.

Jalankan Lawang di laptop atau mesin kerja, scan QR dari perangkat lain, approve
perangkat tersebut, lalu gunakan workspace langsung dari browser HP, tablet, atau
laptop lain.

Fitur utama:

- Terminal remote dengan PTY sungguhan.
- File explorer dan editor kode dari browser.
- Git status, diff, commit, pull, dan push.
- Proxy untuk local dev server lewat `/proxy/<port>`.
- Remote desktop preview untuk macOS, Linux, dan Windows dengan requirement OS
  masing-masing.
- Pairing PIN, LAN-only pairing, session TTL, trusted device revoke, dan audit
  log lokal.
- Mode `--unattended-lan-only` untuk host yang ingin siap diakses di jaringan
  terpercaya.

Install:

```bash
npm install -g lawang
lawang start
```

Mode unattended yang lebih ketat:

```bash
lawang start --unattended-lan-only --pair-pin 123456 --session-ttl 120
```

## Publish Notes

NPM requires a new version for every README update:

```bash
cd packages/agent
npm version patch --no-git-tag-version
npm publish
```

If you already changed the version to the wrong bump, set it explicitly:

```bash
npm version 0.7.2 --no-git-tag-version
```

## Links

- GitHub: [github.com/alfianm/lawang](https://github.com/alfianm/lawang)
- NPM: [npmjs.com/package/lawang](https://www.npmjs.com/package/lawang)
- Documentation: [docs/DOCUMENTATION.md](https://github.com/alfianm/lawang/blob/main/docs/DOCUMENTATION.md)
- Static docs site: [site/](https://github.com/alfianm/lawang/tree/main/site)
- Issues: [github.com/alfianm/lawang/issues](https://github.com/alfianm/lawang/issues)

## License

MIT.
