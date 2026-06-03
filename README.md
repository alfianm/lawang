# Lawang - Remote Workspace for Your Own Machine

**Open your terminal, files, Git workflow, local dev servers, and a macOS desktop preview from any browser.**

**Run one command, scan a QR code, approve the device, and work from your phone, tablet, or another laptop.**

[![npm version](https://img.shields.io/npm/v/lawang.svg)](https://www.npmjs.com/package/lawang)
[![Downloads](https://img.shields.io/npm/dm/lawang.svg)](https://www.npmjs.com/package/lawang)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-339933.svg)](packages/agent/package.json)

[Quick Start](#quick-start) |
[Comparison](#lawang-vs-other-remote-solutions) |
[Features](#key-features) |
[Setup](#setup-guide) |
[FAQ](#frequently-asked-questions) |
[Bahasa Indonesia](#bahasa-indonesia) |
[Docs](docs/DOCUMENTATION.md)

---

## Development Status

Lawang is open source and under active development.

The current package is usable for local-first remote developer workflows, but a
few areas are still considered early:

- Remote desktop currently targets macOS hosts.
- Windows support exists in parts of the codebase, but is not fully tested.
- Desktop streaming is a preview implementation, not a WebRTC-grade streamer
  yet.

The project is intentionally public so the security model, pairing flow, and
host-side behavior can be inspected.

---

## Why Lawang?

Remote access for developer work often has tradeoffs:

- **SSH is powerful but setup-heavy**: keys, firewall rules, known hosts, and
  mobile ergonomics can be painful.
- **VPN is often too much** for one quick terminal or file edit.
- **Desktop remote tools focus on screens**, not terminal, files, Git, or local
  dev ports.
- **Cloud dashboards add trust surface** and often require accounts.
- **Phone workflows are awkward** when terminal, files, and Git live in
  separate tools.

Lawang takes a smaller local-first approach:

- **One command** starts the host agent.
- **QR pairing** gives a browser a short-lived path into the host.
- **Host approval by default** keeps the machine in control.
- **All-in-one workspace** includes terminal, files, code editing, Git, proxy,
  audit log, host controls, and desktop preview.
- **No account required** and no hosted broker stores your terminal output or
  project files.
- **Open source** so the implementation is auditable.

---

## Quick Start

Install globally:

```bash
npm install -g lawang
lawang start
```

Then:

1. Open the QR URL printed by the CLI, or visit `http://localhost:3999/qr`.
2. Scan the QR from another device.
3. Approve the pairing request on the host CLI.
4. Use the browser workspace.

For a more locked-down unattended setup:

```bash
lawang start --unattended-lan-only --pair-pin 123456 --session-ttl 120
```

This keeps the host awake, skips the interactive approval prompt for valid
pairing tokens, limits pairing to LAN/private addresses, requires a PIN, and
expires sessions after 120 minutes.

---

## Lawang vs Other Remote Solutions

| Feature | **Lawang** | SSH Client | TeamViewer | Chrome Remote Desktop | Local Tunnel |
|---------|:----------:|:----------:|:----------:|:---------------------:|:------------:|
| Browser-based client | Yes | No | No | Yes | Partial |
| Mobile-friendly terminal | Yes | Partial | No | No | No |
| File explorer | Yes | No | Partial | No | No |
| Built-in code editor | Yes | No | No | No | No |
| Git panel | Yes | No | No | No | No |
| Localhost proxy | Yes | Manual | No | No | Yes |
| QR pairing | Yes | No | No | No | No |
| Host approval flow | Yes | Key-based | Account-based | Account-based | No |
| Permission scopes | Yes | No | No | No | No |
| Trusted device revoke | Yes | Manual | Account-based | Account-based | No |
| Audit log | Yes | Shell history only | No | No | No |
| Remote desktop | macOS preview | No | Yes | Yes | No |
| No account required | Yes | Yes | No | No | Yes |
| Open source | Yes | Varies | No | No | Varies |

Lawang is not trying to replace every remote access product. It is optimized for
developers who want a self-hosted browser workspace around their own machine.

---

## Key Features

| Feature | What it does | Why it matters |
|---------|--------------|----------------|
| **Overview dashboard** | Shows host status, active sessions, permissions, and quick actions | You land in a useful workspace after pairing |
| **Remote terminal** | Runs a real PTY shell through WebSocket | Work like you are at the host machine |
| **Reconnect-safe sessions** | Keeps terminal sessions alive across short disconnects | Phone sleep or Wi-Fi changes do not immediately kill the shell |
| **File explorer** | Browse, upload, download, rename, delete, and create folders | Manage project files without SSH/SFTP |
| **Code editor** | Monaco-powered browser editor | Make quick source edits from another device |
| **Git workflow** | Status, diff, log, stage, commit, pull, and push | Handle common Git tasks from the browser |
| **Command chat** | Run one-shot commands with formatted output | Quick commands without switching terminal context |
| **Command palette** | Navigate and run session actions with `Cmd-K` / `Ctrl-K` | Faster keyboard-driven workflow |
| **Localhost proxy** | Exposes selected local dev ports under `/proxy/<port>` | Test local web apps from phone or tablet |
| **Remote desktop preview** | macOS screen view and optional input control | Inspect or control the host when terminal is not enough |
| **Host controls** | Lock, sleep, reboot, or shut down from the UI | Manage the host at the end of a session |
| **Pairing PIN** | Adds an optional PIN on top of QR token pairing | Useful for unattended or shared-network setups |
| **LAN-only pairing** | Restricts pairing to local/private hostnames | Safer unattended mode |
| **Audit log** | Writes JSONL events locally | Review access and sensitive operations |
| **No account required** | Runs from your machine, no hosted dashboard | Keeps the trust boundary small |

---

## Available Platforms

### CLI Agent

```bash
npm install -g lawang
```

Host support:

- macOS: primary target
- Linux: core terminal, files, Git, proxy, audit, and service support
- Windows: partial, not yet fully tested

### Web Client

The browser UI is served by the agent.

Supported clients:

- Chrome, Safari, Firefox, Edge
- iOS and Android browsers
- Desktop browsers on macOS, Linux, and Windows

### Remote Desktop Preview

Current target:

- macOS host with Screen Recording permission for view
- macOS host with Accessibility permission for input control

---

## Use Cases

### Case 1: Check a project from your phone

Problem: you are away from your desk and need to inspect logs or run a quick
command.

```text
1. Open the Lawang pair URL
2. Pair and approve the device
3. Open Terminal or Chat
4. Run the command and review output
```

### Case 2: Test a local web app on a real phone

Problem: your app runs on `localhost:5173`, but you want to see it on a mobile
browser.

```bash
lawang start --proxy 5173
```

Open `/proxy/5173/` inside the Lawang session.

### Case 3: Make a small fix without opening an IDE

Problem: you need a quick config or source change.

```text
1. Open Files
2. Search the current folder
3. Edit in the browser editor
4. Commit and push from Git
```

### Case 4: Keep a trusted machine reachable on LAN

Problem: you want the host ready without approving every session interactively.

```bash
lawang start --unattended-lan-only --pair-pin 123456 --session-ttl 120
```

This combines keep-awake, auto-approve for valid tokens, LAN-only pairing, a PIN,
and session expiry.

---

## Setup Guide

### Option 1 - NPM package

Recommended for normal use:

```bash
npm install -g lawang
lawang start
```

### Option 2 - Run from source

Recommended for contributors:

```bash
git clone https://github.com/alfianm/lawang.git
cd lawang
npm install
npm run build
npm start
```

Development mode:

```bash
npm run dev:agent
npm run dev:web
```

### First Run and QR Pairing

On startup, Lawang creates a short-lived pairing token and shows a QR/pair URL.

New devices go through this flow:

1. Browser opens `/#/pair?token=...`.
2. Browser sends device label and fingerprint.
3. Host approves, rejects, or grants a permission scope.
4. Browser receives a session token.
5. Every API and WebSocket request checks that session token.

Optional hardening:

```bash
lawang start --pair-pin 123456
lawang start --pair-lan-only
lawang start --session-ttl 120
```

### Remote Desktop Setup on macOS

For screen viewing:

```text
System Settings -> Privacy & Security -> Screen Recording
Enable the terminal app running Lawang
```

For mouse and keyboard control:

```text
System Settings -> Privacy & Security -> Accessibility
Enable the terminal app running Lawang
```

Restart Lawang after changing macOS permissions.

### Local Sites Proxy

Expose selected local ports:

```bash
lawang start --proxy 3000,5173
```

Open them in the session:

```text
/proxy/3000/
/proxy/5173/
```

Development-only open mode:

```bash
lawang start --proxy open
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `lawang start` | Start the local agent and pairing flow |
| `lawang start --no-tunnel` | Disable public tunnel attempts |
| `lawang start --proxy 3000,5173` | Expose selected local dev ports |
| `lawang start --unattended` | Auto-approve valid pairing tokens and keep host awake |
| `lawang start --unattended-lan-only` | Unattended mode limited to LAN/private pairing hosts |
| `lawang start --pair-pin <pin>` | Require an extra PIN while pairing |
| `lawang rotate` | Rotate the QR pairing token without restarting |
| `lawang sessions` | List active sessions |
| `lawang sessions --revoke <id>` | Revoke an active session |
| `lawang devices` | List trusted devices |
| `lawang devices --revoke <id>` | Revoke a trusted device |
| `lawang history` | Show past sessions from audit log |
| `lawang install-service` | Generate systemd or launchd service unit |
| `lawang service-status` | Show service installation status |
| `lawang verify` | Run security smoke checks |

---

## Frequently Asked Questions

### Is Lawang secure?

Lawang is designed to keep the trust boundary local and inspectable:

- QR tokens are random, short-lived, one-time, and stored only as hashes.
- Session tokens are random and stored only as hashes in memory.
- Optional pairing PINs are hashed before comparison.
- Host approval is required by default.
- Permissions are checked on every API and WebSocket path.
- File access is sandboxed to the project root.
- Sensitive actions are recorded in a local audit log.

You should still expose it only in environments you trust and use
`--pair-pin`, `--pair-lan-only`, and `--session-ttl` for unattended hosts.

### Do I need an account?

No. Lawang does not require a hosted account or cloud dashboard.

### Do I need to open ports?

For LAN use, no port forwarding is needed if your device can reach the host on
the same network.

For remote internet access, Lawang can attempt a `cloudflared` tunnel when
available. You can also disable tunnel behavior:

```bash
lawang start --no-tunnel
```

### Does it work offline?

Yes, for LAN/local use. Use `--no-tunnel` if you want to keep it local-only.

### Can I use it with AI coding tools?

Yes. Any CLI tool that runs on the host can be used from the Lawang terminal,
including coding agents, linters, test runners, and deploy scripts.

### What platforms are supported?

Host:

- macOS: primary target
- Linux: supported for core workflows
- Windows: partial, still needs more testing

Client:

- Any modern browser
- Phone, tablet, or desktop browser

### Is this a replacement for SSH?

Not exactly. SSH remains the right tool for many server workflows. Lawang is a
browser workspace around a machine you own, with QR pairing, files, Git, local
proxying, audit logs, and a mobile-friendly UI.

---

## Tech Stack

- **Runtime:** Node.js and TypeScript
- **CLI:** Commander
- **HTTP server:** Fastify
- **WebSocket terminal:** `ws` and `node-pty`
- **Validation:** Zod
- **Git:** `simple-git`
- **QR:** `qrcode` and `qrcode-terminal`
- **Web client:** React, Vite, Tailwind CSS
- **Terminal UI:** xterm.js
- **Editor:** Monaco
- **Icons:** lucide-react
- **Optional tunnel:** cloudflared

Repository layout:

```text
packages/agent  CLI agent, server, API routes, terminal, security, audit
packages/web    Browser UI for pairing and remote workspace
scripts/        Build utilities
docs/           Technical documentation
site/           Static docs site
```

Runtime files:

```text
~/.lawang/config.json   machine settings and trusted devices
~/.lawang/audit.log     local JSONL audit events
~/.lawang/agent.sock    local control socket on Unix-like hosts
```

---

## Troubleshooting

### Port 3999 is already in use

Run on another port:

```bash
lawang start --port 4100
```

### Cloudflared tunnel failed

Use LAN-only mode:

```bash
lawang start --no-tunnel
```

Or install `cloudflared` manually and restart Lawang.

### Screen Recording or Accessibility permission denied on macOS

Grant permissions in:

```text
System Settings -> Privacy & Security
```

Enable the terminal app that runs Lawang, then restart the agent.

### QR code expired

Rotate the pairing token:

```bash
lawang rotate
```

Or restart:

```bash
lawang start
```

### Phone cannot connect

Check:

- Host and phone are on the same network for LAN mode.
- The URL uses the host LAN IP, not `localhost`, when opened from another
  device.
- Firewall settings allow the selected Lawang port.
- Tunnel mode is available if connecting from outside the LAN.

### Session was revoked or expired

Pair again with the latest QR token. If `--session-ttl` is enabled, sessions
expire after the configured maximum lifetime even if active.

---

## Bahasa Indonesia

Lawang adalah alat remote access lokal untuk membuka terminal, file, Git,
localhost proxy, kontrol host, dan preview remote desktop dari browser.

Jalankan Lawang di laptop atau mesin kerja, scan QR dari perangkat lain, approve
perangkat tersebut, lalu gunakan workspace langsung dari browser HP, tablet, atau
laptop lain.

Lawang tidak membutuhkan akun, tidak memakai dashboard cloud terpusat, dan host
tetap memegang kontrol atas pairing, permission, dan sesi aktif.

### Status Pengembangan

Lawang sudah bisa digunakan untuk workflow developer lokal, tetapi beberapa area
masih aktif dikembangkan:

- Remote desktop saat ini fokus untuk host macOS.
- Linux sudah mendukung workflow inti seperti terminal, file, Git, proxy, audit,
  dan service.
- Windows masih parsial dan belum sepenuhnya dites.
- Desktop streaming masih preview, belum ditujukan sebagai pengganti penuh
  TeamViewer atau Chrome Remote Desktop.

### Kenapa Lawang?

Remote access untuk kerja developer sering terasa kurang pas:

- SSH kuat, tetapi setup key, firewall, dan mobile client bisa merepotkan.
- VPN terlalu besar untuk sekadar cek terminal atau edit file singkat.
- Aplikasi remote desktop fokus ke layar, bukan terminal, Git, file, dan port
  development.
- Dashboard cloud menambah area trust.
- Workflow dari HP sering terpecah antara terminal, file manager, dan Git app.

Lawang mengambil pendekatan yang lebih kecil dan lokal:

- Satu command untuk menjalankan host agent.
- Pairing memakai QR token yang singkat masa berlakunya.
- Approval host aktif secara default.
- Workspace browser berisi terminal, file, editor, Git, proxy, audit log, host
  controls, dan remote desktop preview.
- Tanpa akun dan tanpa hosted broker yang menyimpan file atau output terminal.
- Open source, sehingga behavior host dan model keamanan bisa diperiksa.

### Mulai Cepat

Install dari NPM:

```bash
npm install -g lawang
lawang start
```

Lalu:

1. Buka URL QR yang muncul di CLI, atau buka `http://localhost:3999/qr`.
2. Scan QR dari perangkat lain.
3. Approve pairing request di host CLI.
4. Gunakan workspace Lawang dari browser.

Untuk mode unattended yang lebih ketat:

```bash
lawang start --unattended-lan-only --pair-pin 123456 --session-ttl 120
```

Mode tersebut menjaga host tetap awake, auto-approve pairing token yang valid,
membatasi pairing ke jaringan LAN/private, meminta PIN, dan membuat sesi expired
setelah 120 menit.

### Fitur Utama

| Fitur | Fungsi |
|-------|--------|
| Overview dashboard | Melihat status host, sesi aktif, permission, dan quick actions |
| Remote terminal | Membuka shell host lewat WebSocket dengan PTY sungguhan |
| Reconnect-safe terminal | Sesi terminal tetap hidup saat koneksi browser terputus sebentar |
| File explorer | Browse, upload, download, rename, delete, dan buat folder |
| Code editor | Edit file dari browser memakai Monaco editor |
| Git panel | Lihat status, diff, log, stage, commit, pull, dan push |
| Command chat | Jalankan command singkat dengan output yang mudah dibaca |
| Command palette | Navigasi cepat memakai `Cmd-K` atau `Ctrl-K` |
| Localhost proxy | Membuka local dev server lewat `/proxy/<port>` |
| Remote desktop preview | Melihat layar macOS host dan optional input control |
| Host controls | Lock, sleep, reboot, atau shutdown dari UI |
| Pairing PIN | Menambah PIN di atas token QR |
| LAN-only pairing | Membatasi pairing ke hostname/IP private |
| Audit log | Mencatat event sensitif ke JSONL lokal |
| Trusted device revoke | Mencabut akses perangkat yang sudah dipercaya |

### Platform

Host:

- macOS: target utama
- Linux: mendukung workflow inti
- Windows: parsial, masih perlu testing

Client:

- Browser modern seperti Chrome, Safari, Firefox, dan Edge
- Browser iOS dan Android
- Browser desktop di macOS, Linux, dan Windows

Remote desktop saat ini membutuhkan permission macOS:

```text
System Settings -> Privacy & Security -> Screen Recording
System Settings -> Privacy & Security -> Accessibility
```

### Setup dari Source

Untuk contributor atau development lokal:

```bash
git clone https://github.com/alfianm/lawang.git
cd lawang
npm install
npm run build
npm start
```

Mode development:

```bash
npm run dev:agent
npm run dev:web
```

### Command CLI

| Command | Keterangan |
|---------|------------|
| `lawang start` | Menjalankan agent dan pairing flow |
| `lawang start --no-tunnel` | Mematikan percobaan public tunnel |
| `lawang start --proxy 3000,5173` | Membuka local dev port tertentu |
| `lawang start --unattended` | Auto-approve pairing token valid dan menjaga host awake |
| `lawang start --unattended-lan-only` | Unattended mode khusus LAN/private network |
| `lawang start --pair-pin <pin>` | Meminta PIN tambahan saat pairing |
| `lawang start --session-ttl 120` | Membatasi umur sesi dalam menit |
| `lawang rotate` | Mengganti QR pairing token tanpa restart |
| `lawang sessions` | Melihat sesi aktif |
| `lawang sessions --revoke <id>` | Mencabut sesi aktif |
| `lawang devices` | Melihat trusted devices |
| `lawang devices --revoke <id>` | Mencabut trusted device |
| `lawang history` | Melihat riwayat sesi dari audit log |
| `lawang install-service` | Membuat unit service systemd atau launchd |
| `lawang service-status` | Melihat status service |
| `lawang verify` | Menjalankan security smoke checks |

### Pertanyaan Umum

#### Apakah Lawang aman?

Lawang dibuat dengan model local-first:

- QR token random, short-lived, one-time, dan disimpan sebagai hash.
- Session token random dan disimpan sebagai hash di memory.
- PIN pairing optional ikut di-hash sebelum dibandingkan.
- Approval host wajib secara default.
- Permission dicek di setiap API dan WebSocket path.
- File access dibatasi ke project root.
- Operasi sensitif dicatat di audit log lokal.

Untuk host unattended, gunakan `--pair-pin`, `--pair-lan-only`, dan
`--session-ttl`.

#### Apakah perlu akun?

Tidak. Lawang tidak membutuhkan akun atau cloud dashboard.

#### Apakah perlu membuka port router?

Untuk LAN, tidak perlu port forwarding selama perangkat client bisa mengakses IP
host. Untuk akses dari luar jaringan, Lawang dapat mencoba tunnel `cloudflared`
jika tersedia.

#### Apakah ini pengganti SSH?

Tidak sepenuhnya. SSH tetap cocok untuk banyak server workflow. Lawang lebih
ditujukan sebagai browser workspace untuk mesin yang kamu miliki, lengkap dengan
QR pairing, file explorer, Git, proxy local site, audit log, dan UI yang nyaman
di perangkat mobile.

### Troubleshooting Singkat

Jika port `3999` sudah dipakai:

```bash
lawang start --port 4100
```

Jika ingin LAN-only:

```bash
lawang start --no-tunnel
```

Jika QR expired:

```bash
lawang rotate
```

Jika HP tidak bisa connect:

- Pastikan host dan HP ada di jaringan yang sama.
- Gunakan IP LAN host, bukan `localhost`, saat dibuka dari perangkat lain.
- Pastikan firewall mengizinkan port Lawang.
- Untuk akses dari luar LAN, pastikan tunnel tersedia.

---

## Support and Links

- **NPM:** [npmjs.com/package/lawang](https://www.npmjs.com/package/lawang)
- **GitHub:** [github.com/alfianm/lawang](https://github.com/alfianm/lawang)
- **Issues:** [github.com/alfianm/lawang/issues](https://github.com/alfianm/lawang/issues)
- **Technical docs:** [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)
- **Static docs site:** [site/](site/)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

---

## Contributing

Contributions are welcome.

Good areas to help:

- UI polish and accessibility
- Linux and Windows testing
- Remote desktop performance
- Security hardening
- Documentation and examples
- API and CLI test coverage

Before opening a PR:

```bash
npm run build
```

If a change touches pairing, permissions, sessions, file access, proxying, or
desktop control, include a short security note in the pull request.

---

## License

MIT. See [LICENSE](LICENSE).

Built for developers who want remote access without handing their workflow to a
third-party dashboard.
