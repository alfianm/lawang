# Lawang

[![npm](https://img.shields.io/npm/v/lawang?color=0ea5e9)](https://www.npmjs.com/package/lawang)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-339933.svg)](packages/agent/package.json)

Local-first remote access for your own machine.

Run one command on your laptop or server, scan a QR code from a phone, tablet,
or another browser, and open a secure remote workspace for your project. Lawang
is built for developer workflows: terminal, files, code editing, Git, localhost
proxying, audit logs, host controls, and an early remote desktop mode.

No account. No central cloud dashboard. No hosted broker that stores your
commands, files, or session data. The host remains in control.

```bash
npm i -g lawang
lawang start
```

Open the QR page shown in the terminal, pair the browser, approve the request on
the host, and start working.

## Why Lawang

Most remote access tools either rely on SSH setup, a cloud dashboard, a native
mobile app, or a third-party relay. Lawang is intentionally smaller:

- **Local-first**: the agent runs on your machine and serves the browser UI.
- **Browser-native**: use any modern browser on phone, tablet, or desktop.
- **Developer-focused**: terminal, files, Git, snippets, logs, and local dev
  ports are in one session.
- **Explicit trust model**: QR pairing, host approval, permissions, optional
  PIN, trusted device revoke, session revoke, and audit logs.
- **Open source**: inspect the code and run it yourself.

## Features

### Remote workspace

- Overview dashboard with host status, active sessions, permissions, and quick
  navigation.
- Browser terminal powered by xterm.js and `node-pty`.
- Reconnect-safe PTY sessions with output replay after short disconnects.
- One-shot command chat with formatted output for JSON, diffs, and exit codes.
- Command palette with navigation and session actions.

### Files and code

- Browse the project root from the browser.
- Read, edit, save, upload, rename, delete, and create folders inside the
  sandboxed root.
- Search the current folder and drag files into the browser to upload.
- Monaco editor for browser-based code editing.
- File preview guards for large, binary, and outside-root paths.

### Git workflow

- Git status, diff, and recent log.
- Stage and unstage files.
- Commit, pull, and push from the web UI.
- Push supports first-time upstream setup when the current branch has no
  tracking branch.

### Remote desktop preview

- Desktop tab for screen viewing on macOS hosts.
- Mouse movement, clicks, keyboard events, and text input when the session has
  `screen:control`.
- Fit and large view modes for mobile and desktop browsers.
- macOS requires Screen Recording permission for view and Accessibility
  permission for control.

### Localhost proxy

- Expose local dev servers such as `localhost:3000` and `localhost:5173`.
- Access proxied apps at `/proxy/<port>/...`.
- Use an explicit allow-list or `--proxy open` for development.

### Device and session control

- One-time QR pairing with explicit host approval by default.
- Permission presets: full access, read-only, or terminal-only.
- Optional pairing PIN with `--pair-pin`.
- Optional LAN-only pairing with `--pair-lan-only`.
- Trusted devices can skip future approval and can be revoked.
- Active sessions can be listed and revoked from CLI or browser.
- Pairing tokens can be rotated without restarting the agent.

### Host utilities

- Host power actions from the UI: sleep, shutdown, reboot, and lock.
- Battery indicator in the browser session.
- `--keep-awake` mode to prevent host sleep while the agent is running.
- `--unattended` mode for trusted environments.
- `--session-ttl` for maximum session lifetime.

### Audit and safety

- Local JSONL audit log at `~/.lawang/audit.log`.
- Browser audit viewer with filters and search.
- Security smoke test via `lawang verify`.
- Rate limits, origin checks, hashed tokens, sandboxed file paths, and bounded
  WebSocket frames.

## Quick Start

### Install from npm

```bash
npm i -g lawang
lawang start
```

Then open one of the URLs printed by the CLI:

- `http://localhost:3999/qr` for a fullscreen QR on the host.
- The LAN or tunnel pair URL for another device.

### Useful start modes

```bash
lawang start --no-tunnel
lawang start --proxy 3000,5173
lawang start --proxy open
lawang start --keep-awake
lawang start --pair-pin 123456
lawang start --unattended-lan-only --pair-pin 123456 --session-ttl 120
```

### Admin commands

```bash
lawang rotate
lawang sessions
lawang sessions --revoke <session-id>
lawang devices
lawang devices --revoke <device-id>
lawang history
lawang service-status
lawang verify
```

## Security Model

Lawang is designed for access to machines you own or administer.

- Pairing tokens are random, one-time, time-limited, and stored only as hashes.
- Session tokens are random and stored only as hashes in memory.
- Optional pairing PINs are hashed in memory before comparison.
- Every API and WebSocket path checks session permissions.
- File APIs are sandboxed to the selected project root.
- WebSocket input and frame sizes are capped.
- Pairing, sessions, file writes, Git actions, proxy usage, host power actions,
  and desktop control events are logged locally.

Recommended production-like local setup:

```bash
lawang start --unattended-lan-only --pair-pin <pin> --session-ttl 120
```

Run the built-in smoke test:

```bash
lawang verify
```

## Requirements

- Node.js `>= 18.17`
- macOS or Linux for core terminal, files, Git, and host utilities
- macOS for current remote desktop preview
- Optional `cloudflared` for public tunnel support

Windows compatibility exists in parts of the codebase, but it is not yet a
fully tested target.

## Development

Clone the repository:

```bash
git clone https://github.com/alfianm/lawang-app.git
cd lawang-app
npm install
npm run build
npm start
```

Run the agent and web app separately during development:

```bash
npm run dev:agent
npm run dev:web
```

The web dev server runs separately, while the production build is copied into
`packages/agent/public` and served by the agent.

## Repository Layout

```text
packages/agent  Node.js CLI agent, Fastify server, REST APIs, WebSocket terminal
packages/web    React browser client, terminal, files, Git, desktop, audit UI
scripts/        Build utilities
docs/           Technical documentation
site/           Static documentation site
```

Runtime data is stored under `~/.lawang/`:

```text
config.json   machine settings and trusted devices
audit.log     JSONL audit log
agent.sock    local control socket on Unix-like systems
```

## Documentation

- [Technical documentation](docs/DOCUMENTATION.md)
- [Static website](site/)
- [API reference](site/api.html)
- [Product requirements and roadmap](prd_remote_access_app.md)
- [Changelog](CHANGELOG.md)

## Roadmap

Near-term priorities:

- Broader remote desktop support and better streaming performance.
- More granular permission presets.
- Stronger network allow-list controls.
- Multi-terminal management.
- Better file search and bulk operations.
- More complete Windows support.

See [prd_remote_access_app.md](prd_remote_access_app.md) for the longer product
plan.

## Contributing

Contributions are welcome.

Good first areas:

- UI polish and accessibility improvements.
- Documentation and examples.
- Test coverage for CLI and API behavior.
- Platform-specific fixes for Linux, macOS, and Windows.
- Security hardening and threat-model review.

Before opening a pull request:

```bash
npm run build
```

If your change affects pairing, permissions, sessions, file access, proxying, or
desktop control, include a short security note in the PR description.

## License

MIT. See [LICENSE](LICENSE).
