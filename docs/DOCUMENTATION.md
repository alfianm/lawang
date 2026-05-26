# Lawang — Dokumentasi Teknis

Dokumen ini merangkum arsitektur, tech stack, struktur kode, alur kerja, dan cara
menjalankan project `lawang` (monorepo di `~/lawang`).
Sasaran pembaca: developer baru yang ingin memahami project secara cepat dan ikut
kontribusi tanpa harus membaca seluruh source code lebih dulu.

Versi proyek saat ini: `0.1.0` (MVP v0.1 dari `prd_remote_access_app.md`).

---

## 1. Apa itu Lawang

Lawang adalah local-first remote terminal untuk mesin sendiri. Host menjalankan
satu perintah CLI, lalu device lain (HP, tablet, laptop) bisa scan QR code untuk
mendapat akses terminal di browser. Setiap pairing harus di-approve secara eksplisit
oleh host. Cocok untuk:

- Membuka terminal Mac/Linux dari HP saat lagi di luar.
- Cek file dan git status dari device kedua.
- Coding ringan dengan Monaco editor langsung di browser.

Fitur MVP yang sudah jalan:

- CLI agent yang menyalakan HTTP + WebSocket server lokal.
- Pairing one-time via QR + approval di CLI host.
- Terminal berbasis xterm.js dengan shortcut bar untuk mobile.
- File explorer + Monaco editor (read/write, upload, rename, delete, mkdir).
- Git panel (status, diff, log, stage, commit, pull, push).
- Tunnel opsional via `cloudflared` (auto-detect kalau terpasang).
- Trusted devices (auto-approve) dan audit log lokal di `~/.lawang/audit.log`.
- Control socket lokal (`~/.lawang/agent.sock`) untuk operasi admin di luar HTTP.

Roadmap berikutnya (file explorer lanjutan, remote desktop, dll) ada di
`prd_remote_access_app.md`.

---

## 2. Tech Stack

**Repo & Runtime**
- npm workspaces monorepo (`packages/*`).
- Node.js `>= 18.17` (lihat `engines` di `packages/agent/package.json`).
- TypeScript `5.5.4` di kedua package.

**Agent (`packages/agent`)**
- `fastify@4` sebagai HTTP server.
- `@fastify/static` untuk serve build web.
- `@fastify/websocket` + `ws@8` untuk WS terminal.
- `node-pty@1` untuk PTY shell (bash/zsh/powershell).
- `commander@12` untuk CLI parsing.
- `qrcode` + `qrcode-terminal` untuk render QR (terminal & SVG).
- `simple-git` untuk operasi git aman.
- `zod` untuk validasi body request.
- `tsx` untuk dev mode, `tsc` untuk build production.

**Web (`packages/web`)**
- React `18.3` + Vite `5.4`.
- Tailwind CSS `3.4` (config di `tailwind.config.js`, dark theme custom).
- `@xterm/xterm` `5.5` + addon `fit` & `web-links` untuk terminal.
- `@monaco-editor/react` + `monaco-editor` untuk code editor.
- `lucide-react` untuk ikon.
- Routing custom berbasis hash (`packages/web/src/lib/router.ts`).

**Tooling lain**
- `cloudflared` (opsional, harus terpasang di PATH host) untuk public tunnel.
- `scripts/copy-web.js` untuk copy hasil build web ke `packages/agent/public`.

---

## 3. Struktur Repo

```
remoteapp/
├── package.json              # workspaces + skrip top-level
├── README.md                 # ringkasan project
├── prd_remote_access_app.md  # PRD lengkap (Bahasa Indonesia)
├── scripts/
│   └── copy-web.js           # copy dist web -> agent/public
└── packages/
    ├── agent/                # Node CLI + Fastify server (TS)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── public/           # hasil copy build web (di-build saat npm run build)
    │   └── src/
    │       ├── cli.ts        # entry CLI (commander), command `start` & `devices`
    │       ├── server.ts     # Fastify server + REST + WS terminal
    │       ├── index.ts
    │       └── lib/
    │           ├── audit.ts          # append-only audit log
    │           ├── banner.ts         # banner CLI + render QR ANSI
    │           ├── config.ts         # ~/.lawang/config.json loader
    │           ├── controlSocket.ts  # unix socket / TCP fallback untuk admin
    │           ├── git.ts            # wrapper simple-git
    │           ├── logger.ts         # logger berwarna ringan
    │           ├── network.ts        # deteksi IP LAN
    │           ├── pairing.ts        # token pairing & request queue
    │           ├── promptApprover.ts # prompt y/N di CLI host
    │           ├── rateLimit.ts      # in-memory rate limiter
    │           ├── sandbox.ts        # path traversal guard untuk file API
    │           ├── sessions.ts       # session store + idle sweep
    │           ├── terminal.ts       # spawn node-pty
    │           ├── tokens.ts         # tipe & helper hashing token
    │           ├── trustedDevices.ts # CRUD trusted devices
    │           └── tunnel.ts         # auto-detect cloudflared tunnel
    └── web/                  # React + xterm.js client
        ├── index.html
        ├── vite.config.ts
        ├── tailwind.config.js
        ├── postcss.config.js
        ├── tsconfig.json
        └── src/
            ├── main.tsx
            ├── App.tsx              # router shell
            ├── styles.css           # tailwind + xterm css
            ├── lib/
            │   ├── api.ts           # fetch helper untuk REST agent
            │   ├── device.ts        # deteksi user agent + fingerprint
            │   └── router.ts        # hash router minimal
            ├── pages/
            │   ├── Home.tsx         # landing kalau buka tanpa token
            │   ├── Pair.tsx         # form pairing + status
            │   └── Session.tsx      # tab Terminal / Files / Git
            └── components/
                ├── TerminalPanel.tsx
                ├── FilesPanel.tsx
                ├── CodeEditor.tsx
                └── GitPanel.tsx
```

Konfigurasi & data runtime ada di `~/.lawang/`:

- `config.json` — machine id, machine name, trusted devices, settings (mode `0o600`).
- `audit.log` — JSON-lines audit event (lihat `lib/audit.ts`).
- `agent.sock` (Unix) atau `agent.port` (Windows) — control channel admin.

---

## 4. Arsitektur & Alur

### 4.1 Komponen runtime

```
┌──────────── Host machine ────────────┐         ┌──────── Remote device ────────┐
│                                       │         │                                │
│  lawang start (Node CLI)          │         │   Browser (mobile / laptop)    │
│   ├─ Fastify HTTP  :3999              │ <────►  │   React + xterm.js client      │
│   │   ├─ /api/pair/request            │ HTTPS/  │     - /#/pair?token=…          │
│   │   ├─ /api/files, /api/file, …     │ HTTP    │     - /#/terminal              │
│   │   ├─ /api/git/*                   │         │     - /#/files, /#/git         │
│   │   └─ /api/info, /qr, /qr.svg      │         │                                │
│   ├─ WebSocket  /ws/terminal          │ <────►  │   xterm.js ↔ PTY               │
│   ├─ node-pty (bash/zsh/pwsh)         │         │                                │
│   ├─ cloudflared (opsional)           │         │                                │
│   └─ Control socket ~/.lawang/    │         │                                │
│       agent.sock (admin lokal)        │         │                                │
└───────────────────────────────────────┘         └────────────────────────────────┘
```

- Fastify mengikat `0.0.0.0:<port>` (default `3999`).
- Web client di-serve sebagai static asset dari `packages/agent/public` (hasil build web).
- Tunnel `cloudflared` dipakai sebagai public origin kalau binary tersedia di PATH.
- Audit log dan config disimpan di `~/.lawang` dengan permission `0o600`.

### 4.2 Alur pairing

1. Host jalan `lawang start`.
2. CLI generate pairing token (24 byte random, base64url) dengan TTL default 15 menit
   dan render QR + URL pair (`<base>/#/pair?token=…`).
3. Device buka URL → React `Pair.tsx` POST ke `/api/pair/request` dengan
   `pairingToken`, `deviceName`, `deviceType`, dan `deviceFingerprint` (random per
   device, disimpan di `localStorage`).
4. Server cek token (`PairingManager.validateRawToken`) dan trusted device.
   - Kalau fingerprint cocok dengan trusted device aktif → auto-approve.
   - Kalau tidak → masuk antrean dan CLI prompt host (y/N + opsional "trust this device").
5. Setelah approved, server consume token (one-time), keluarkan session token (32 byte
   random, hash disimpan di memori) dengan permission default
   `terminal, file:read, file:write, git:read, git:write`.
6. Client simpan session token di `sessionStorage` (`lawang:session`) lalu
   navigate ke `/#/terminal`.
7. Client buka WS `/ws/terminal?token=<sessionToken>`. Server validasi token,
   spawn PTY via `node-pty`, dan stream `terminal:output` / `terminal:input`.

### 4.3 Sesi & idle timeout

- `SessionStore` simpan sesi in-memory (lihat `lib/sessions.ts`).
- Idle timeout default 30 menit; sweeper jalan tiap 60 detik.
- Setiap REST/WS call yang valid memanggil `touch(sessionId)`.
- Sesi bisa direvoke via control socket (`sessions`, `revoke`, `revoke-all`).
- Saat `SIGINT`/`SIGTERM`, semua sesi di-revoke dan tunnel dihentikan.

### 4.4 Sandbox file & git

- Semua endpoint `/api/files`, `/api/file*`, `/api/dir`, `/api/git/*` melewati
  `resolveInside(root, relative)` yang menolak path traversal (`../`).
- File preview dibatasi 1 MB; upload pakai stream dengan limit body 16 MB.
- Git operasi pakai `simple-git` dengan working dir = root project.
- Rate limit per-IP via `RateLimiter`:
  - Pairing: 20 req/menit.
  - File read: 240 req/menit.
  - File write: 60 req/menit.

### 4.5 Audit log

File `~/.lawang/audit.log` adalah append-only JSONL. Event yang dicatat antara
lain `agent_started`, `pairing_requested`, `pairing_approved`, `pairing_rejected`,
`session_started`, `session_revoked`, `file_written`, `git_commit`, `git_push`, dll.
(lihat `AuditEventType` di `packages/agent/src/lib/audit.ts`).

---

## 5. Endpoint Ringkas

Semua endpoint kecuali yang ditandai publik membutuhkan header
`Authorization: Bearer <sessionToken>`.

**Publik**
- `GET /health` — health probe (machine name + version).
- `GET /api/info` — info ringkas (machine name, version, tunnel URL).
- `GET /qr` & `GET /qr.svg` — halaman & SVG QR pairing terkini.
- `POST /api/pair/request` — request pairing (rate limited).

**Sesi**
- `GET /api/session` — info sesi saat ini (root path, permissions, dll).
- `GET /api/env` — info environment: machine (hostname, platform, arch), runtime (node version), shell, dan project (name, version, package manager, lockfile, git repo, monorepo workspaces).

**Host power**
- `GET /api/system/power` — kapabilitas sleep/shutdown per platform (`darwin`, `linux`).
- `POST /api/system/power` — body `{ action: "sleep" | "shutdown" | "reboot" | "lock", confirm: true, delaySeconds? }`. Trigger di host: macOS pakai `pmset` / `osascript`, Linux pakai `systemctl` (suspend|poweroff|reboot) atau `loginctl lock-session`. `lock` tidak butuh delay. Butuh permission `terminal`. Audit event: `power_action`.
- `GET /api/system/battery` — info baterai host: percent, charging, acConnected, state, timeRemainingMin. Sumber `pmset` (macOS) atau sysfs `/sys/class/power_supply` (Linux).

**File API**
- `GET /api/files?path=<rel>` — list direktori.
- `GET /api/file?path=<rel>` — baca file (text auto-detect, binary base64).
- `GET /api/file/download?path=<rel>&token=<sessionToken>` — download stream.
- `PUT /api/file` — tulis ulang file (`{ path, content, encoding }`).
- `POST /api/file/upload?path=<rel>` — upload streaming `application/octet-stream`.
- `POST /api/dir` — `mkdir -p`.
- `POST /api/file/rename` — `{ from, to }`.
- `DELETE /api/file?path=<rel>` — hapus file/folder.

**Git API**
- `GET /api/git/status` · `GET /api/git/diff` · `GET /api/git/log`.
- `POST /api/git/stage` · `POST /api/git/unstage`.
- `POST /api/git/commit` · `POST /api/git/pull` · `POST /api/git/push`.

**WebSocket**
- `GET /ws/terminal?token=<sessionToken>` — pesan JSON
  `{ event, payload }` dengan event `session:connected`, `terminal:output`,
  `terminal:input`, `terminal:resize`, `terminal:exit`, `session:disconnect`.

---

## 6. Cara Menjalankan

### 6.1 Prasyarat

- Node.js `>= 18.17` (cek `node -v`).
- npm `>= 9` (terbawa Node 18+).
- Toolchain native untuk `node-pty` (compiler C/C++ + `node-gyp`).
  Lihat [§6.1.1 Kenapa butuh toolchain native](#611-kenapa-butuh-toolchain-native).
  Ringkasnya:
  - macOS — `xcode-select --install` (memasang `clang`, header sistem, `make`).
  - Linux — `python3`, `make`, `g++` (Debian/Ubuntu: `apt install build-essential python3`).
  - Windows — Visual Studio Build Tools 2022 (workload "Desktop development with C++") + `python3`.
- Opsional: `cloudflared` di PATH agar tunnel publik aktif otomatis
  (`brew install cloudflared` di macOS).
- Opsional: HP / device kedua di jaringan yang sama untuk akses LAN.

#### 6.1.1 Kenapa butuh toolchain native

`node-pty` adalah dependency yang membungkus syscall **pseudo-terminal** milik
OS — `forkpty` di Unix, ConPTY/winpty di Windows. Karena fitur ini disediakan
kernel dan tidak bisa diimplementasi pakai JavaScript murni, package-nya
berupa **native addon**: source C/C++ yang harus dikompilasi jadi binary
`.node` saat `npm install`.

Tanpa native PTY, terminal di browser tidak bisa beneran menjalankan `bash`
atau `zsh` — fitur seperti escape sequence warna, resize via `SIGWINCH`,
job control (`Ctrl+C`/`Ctrl+Z`), prompt interaktif (`sudo`, `git push`), dan
TUI seperti `vim`/`htop` semuanya butuh PTY asli, bukan sekadar `child_process`.

Saat `npm install`, `node-gyp` dipanggil dan butuh:

- **Compiler C/C++** untuk membuild source `node-pty`.
- **`make`** sebagai build runner.
- **`python3`** sebagai orchestrator `node-gyp` (bukan untuk runtime).

Hasil kompilasinya tersimpan di
`node_modules/node-pty/build/Release/pty.node`. Setelah itu di-cache, jadi
kamu cuma menyentuh toolchain ini sekali — kecuali ganti versi Node mayor,
upgrade OS yang mengubah ABI, atau pindah arsitektur (mis. Intel → Apple
Silicon). Saat itu terjadi, hapus `node_modules` lalu `npm install` ulang.

Indikator gagal install yang umum:

- `gyp ERR! find Python` → install `python3` lalu retry.
- `xcrun: error: invalid active developer path` → jalankan
  `xcode-select --install`.
- `error: Microsoft Visual C++ 14.0 or greater is required` → install Visual
  Studio Build Tools workload C++.

Kalau kamu mau menghindari toolchain di mesin host (mis. server produksi
minim), build di mesin developer dulu, lalu copy `node_modules` atau pakai
Docker multi-stage build.

### 6.2 Install dependency

```bash
cd ~/lawang
npm install
```

npm akan resolve workspace `lawang` dan `lawang-web` sekaligus.

### 6.3 Build production

```bash
npm run build
```

Skrip ini menjalankan:

1. `npm run build -w lawang-web` → Vite build ke `packages/web/dist`.
2. `npm run build -w lawang` → `tsc` ke `packages/agent/dist` lalu
   `node ../../scripts/copy-web.js` menyalin `web/dist` ke `agent/public`.

Build web saja: `npm run build:web`. Build agent saja: `npm run build:agent`
(catatan: agent build mengharapkan `web/dist` sudah ada untuk dicopy).

### 6.4 Start agent

```bash
npm start
# setara: node packages/agent/dist/cli.js start
```

CLI akan mencetak banner berisi:

- `Local URL`, `LAN URL`, `Tunnel URL` (kalau cloudflared ada).
- `Pair URL` lengkap dengan token.
- QR code besar di terminal + URL `<localUrl>/qr` untuk QR full screen di laptop.

Scan QR dari device kedua atau buka pair URL manual. Approve dari CLI host saat
prompt muncul.

Stop dengan `Ctrl+C` (akan flush audit dan revoke semua sesi).

### 6.5 Mode development

Disarankan dua terminal:

```bash
# Terminal 1 — Vite dev server (proxy /api & /ws ke localhost:3999)
npm run dev:web

# Terminal 2 — Agent dengan tsx watch
npm run dev:agent
```

Akses UI dev di `http://localhost:5173`. Untuk pairing, gunakan token yang dicetak
oleh agent (port 3999). Vite sudah memproxy `/api`, `/health`, dan `/ws/*` ke agent
(lihat `packages/web/vite.config.ts`).

### 6.6 Opsi CLI yang penting

Subcommand `start` (default):

- `-p, --port <port>` — port bind, default `3999`.
- `-r, --root <path>` — root project yang diekspos, default `process.cwd()`.
- `--no-tunnel` — matikan auto-start cloudflared.
- `--token-ttl <minutes>` — TTL pairing token, default `15`.
- `--idle-timeout <minutes>` — idle timeout sesi, default `30`.
- `--qr-size <small|large|off>` — ukuran QR di terminal, default `large`.
- `--keep-awake` — cegah host sleep selama agent jalan (`caffeinate -i -s` di macOS, `systemd-inhibit` di Linux).

Subcommand `devices`:

- `lawang devices` — list trusted devices.
- `lawang devices --revoke <id|prefix>` — revoke device tertentu.
- `lawang devices --revoke-all` — revoke semua trusted device.
- `lawang devices --json` — output JSON.

Subcommand `sessions` (butuh agent jalan):

- `lawang sessions` — list sesi aktif.
- `lawang sessions --revoke <id|prefix>` — revoke sesi tertentu.
- `lawang sessions --revoke-all` — revoke semua sesi aktif.
- `lawang ping` — cek apakah agent sedang berjalan.

Subcommand `history` (offline, baca dari `~/.lawang/audit.log`):

- `lawang history` — list 25 sesi terakhir (default).
- `lawang history --limit <n>` — atur jumlah baris.
- `lawang history --json` — output JSON.

Subcommand `rotate` (butuh agent jalan):

- `lawang rotate` — generate pairing token baru tanpa restart agent.
  Halaman `/qr` di laptop akan auto-refresh QR-nya tiap 5 detik, jadi tinggal
  scan ulang dari HP. Sesi yang masih aktif dan trusted device tetap utuh.
- `lawang rotate --json` — output JSON.

Subcommand `verify` (butuh agent jalan):

- `lawang verify` — smoke-test hard rules dari PRD § 17 / 18.3.
  Memeriksa: control ping, /health, no unauthenticated access, path traversal
  guard, push confirmation, dan WS Origin check. Exit 0 kalau semua lulus,
  1 kalau ada yang fail. Cocok untuk CI atau pre-release sanity check.
- `lawang verify --base <url>` — base URL berbeda (default `http://localhost:3999`).
- `lawang verify --json` — output JSON.

Contoh:

```bash
# Start di port custom, root khusus, tanpa tunnel
node packages/agent/dist/cli.js start \
  --port 4100 \
  --root ~/projects/myapp \
  --no-tunnel \
  --qr-size small

# Cek trusted device
node packages/agent/dist/cli.js devices

# Revoke pakai prefix id
node packages/agent/dist/cli.js devices --revoke 1a2b3c4d
```

### 6.7 Lokasi data runtime

- `~/.lawang/config.json` — machine id, trusted devices, setting.
- `~/.lawang/audit.log` — audit JSONL.
- `~/.lawang/agent.sock` (Unix) atau `~/.lawang/agent.port` (Windows) —
  control socket lokal yang dipakai untuk admin (sessions/revoke).

File-file di atas memakai mode `0o600` agar hanya user yang menjalankan CLI bisa
membaca.

---

## 7. Akses dari Mana Saja (Cloudflared Setup)

Bagian ini ditujukan untuk user yang baru pertama kali install Lawang dan
ingin akses laptopnya dari HP saat di luar rumah. Kalau kamu cuma butuh
akses dari Wi-Fi yang sama, lewati section ini — Lawang sudah jalan.

### 7.1 Tiga skenario, tiga jawaban

**Skenario A — HP dan laptop di Wi-Fi yang sama (rumah, kafe, kantor)**

Tidak butuh apa-apa selain Lawang. Banner CLI cetak `LAN URL`, scan QR
yang muncul di terminal, selesai.

```bash
lawang start --no-tunnel
```

`--no-tunnel` skip cek cloudflared supaya banner tidak warning.

**Skenario B — HP di luar (4G, kafe lain), laptop di rumah**

Butuh cloudflared di laptop. Lihat §7.2 untuk install. Setelah cloudflared
ada di PATH:

```bash
lawang start
```

Lawang auto-spawn cloudflared, dapat URL `https://random-name.trycloudflare.com`,
QR berisi URL itu. Scan dari HP, selesai.

**Skenario C — Mau URL tetap (lawang.namadomain.com)**

Butuh akun Cloudflare + domain. Lihat §7.3 (advanced).

### 7.2 Install cloudflared

Cuma di laptop kamu sendiri (mesin host yang menjalankan Lawang). HP user
tidak perlu cloudflared.

**macOS** (Homebrew):
```bash
brew install cloudflared
```

**Linux Debian / Ubuntu**:
```bash
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb
```

**Linux Fedora / RHEL**:
```bash
curl -L --output cloudflared.rpm \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
sudo rpm -i cloudflared.rpm
```

**Linux generic** (binary tarball):
```bash
curl -L --output cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

**Windows**:
```powershell
winget install --id Cloudflare.cloudflared
# atau:
scoop install cloudflared
```

Verifikasi:
```bash
cloudflared --version
which cloudflared    # Linux/macOS
where cloudflared    # Windows
```

Output harus tunjuk path binary, bukan "command not found".

### 7.3 Tutorial end-to-end skenario B

Yang paling sering dipakai: laptop di rumah, HP di luar.

**Langkah 1 — Pasang cloudflared** (lihat §7.2 di atas).

**Langkah 2 — Jalankan Lawang**:
```bash
lawang start --keep-awake
```

`--keep-awake` cegah laptop sleep selama agent jalan. Penting kalau laptop
biasanya idle dan kamu mau akses dari luar.

**Langkah 3 — Baca banner CLI**:
```
Local URL   : http://localhost:3999
LAN URL     : http://192.168.1.42:3999
Tunnel URL  : https://soft-fern.trycloudflare.com    ← ini yang dipakai HP
Pair URL    : https://soft-fern.trycloudflare.com/#/pair?token=k3X...
Token TTL   : 15 minutes
```

Plus QR ASCII besar di bawahnya. Atau buka `http://localhost:3999/qr` di
browser laptop untuk QR yang lebih besar di layar.

**Langkah 4 — Scan dari HP** (HP boleh di Wi-Fi manapun atau 4G).

Browser HP load `https://soft-fern.trycloudflare.com/#/pair?token=...`,
kirim request pairing.

**Langkah 5 — Approve di laptop**:
```
─── Pairing request ───────────────────────
  Device   : iPhone Safari
  Type     : mobile
  Remote   : 1.2.3.4
  Fingerprint : present
───────────────────────────────────────────

Approve this device? [y/N]
```

Ketik `y` Enter. Optional: trust device supaya pairing berikutnya
auto-approve.

**Langkah 6 — Sesi terbuka di HP**. Tab Terminal default, ada Files, Git,
Chat juga.

**Langkah 7 — HP mati / putus / scan ulang**:
```bash
# di laptop
lawang rotate
```

Token baru terbit tanpa restart agent. Halaman `/qr` di laptop auto-refresh,
tinggal scan ulang dari HP.

### 7.4 Yang harus dipahami soal cloudflared

- **Cloudflared terinstall di laptop user, bukan di server developer Lawang**.
  Setiap user punya cloudflared masing-masing.
- **URL random tiap restart agent**. Untuk URL tetap, butuh akun Cloudflare
  (skenario C).
- **Data tidak nyangkut di server siapapun**. Cloudflare cuma transport
  pipe terenkripsi. Audit log, file, command output tetap di laptop user.
- **Cloudflare melihat metadata** (IP yang konek, volume traffic), bukan
  konten. Sama seperti CDN biasa.
- **Bandwidth dipakai dari koneksi internet user**. Kalau user pakai Lawang
  dari luar dan transfer file besar, kuota internet rumah user yang habis,
  bukan kita.

### 7.5 URL stabil dengan named tunnel (advanced)

Hanya kalau user butuh URL yang tidak random. Skip kalau pakai Lawang
santai.

Prasyarat:
- Akun Cloudflare gratis (cloudflare.com).
- Domain dengan nameserver pointing ke Cloudflare.

```bash
# 1. Login (browser terbuka)
cloudflared tunnel login

# 2. Bikin tunnel
cloudflared tunnel create lawang
# catat UUID dari output

# 3. Buat config
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <UUID>
credentials-file: ~/.cloudflared/<UUID>.json

ingress:
  - hostname: lawang.namadomain.com
    service: http://localhost:3999
  - service: http_status:404
EOF

# 4. Routing DNS otomatis
cloudflared tunnel route dns lawang lawang.namadomain.com

# 5. Jalankan tunnel di terminal terpisah
cloudflared tunnel run lawang
```

Lalu jalankan Lawang dengan `--no-tunnel` (tunnel sudah dipegang manual):
```bash
lawang start --no-tunnel
```

Pair URL akan pakai `localhost:3999` di banner CLI, tapi URL publik di
`https://lawang.namadomain.com` sudah aktif dan reachable.

### 7.6 Troubleshooting

**`cloudflared not found. Falling back to local-only access.`**

Lawang tidak temukan binary di PATH. Cek `which cloudflared`. Kalau
ternyata terinstall, mungkin path-nya tidak terbawa ke shell agent. Restart
terminal atau cek `$PATH`.

**`Timed out waiting for tunnel URL`**

Cloudflare lambat respons (>20 detik). Biasanya jaringan flaky atau
Cloudflare lagi maintenance. Coba lagi, atau pakai `--no-tunnel` sementara.

**HP error "ERR_CERT_INVALID" atau "Connection not secure"**

Pakai URL `https://*.trycloudflare.com`, bukan IP langsung. Cloudflare
yang handle TLS, jadi URL HTTPS valid.

**HP error 502 / 521**

Cloudflare aktif tapi laptop tidak respond. Cek `lawang start` masih jalan
(bukan ke-Ctrl+C). Kalau jalan, cek firewall laptop blokir port 3999.

---

## 8. Konfigurasi Tambahan

### 8.1 Cloudflared tunnel

- Cukup pasang `cloudflared` dan agent akan auto-spawn `cloudflared tunnel --url
  http://localhost:<port>`.
- URL tunnel diparse dari log (`https://<sub>.trycloudflare.com`) dan dipakai
  sebagai base pair URL.
- Kalau cloudflared gagal/timeout 20 detik, agent fallback ke LAN/local URL.
- Matikan dengan flag `--no-tunnel`.

### 8.2 Trusted devices

- Saat host menjawab `y` ke prompt approve, akan muncul pertanyaan tambahan
  "Trust this device for future sessions?". Kalau dijawab `y` dan client kirim
  `deviceFingerprint`, fingerprint akan di-hash (SHA-256) dan disimpan di config.
- Pairing berikutnya dari device yang sama (fingerprint cocok) akan auto-approve
  tanpa prompt.
- Revoke kapan saja via `lawang devices --revoke <id>`.

### 8.3 Permissions

Permission default per sesi: `terminal`, `file:read`, `file:write`, `git:read`,
`git:write`. Endpoint memvalidasi permission yang dibutuhkan; di MVP semua
permission diberikan ke setiap sesi yang approved.

---

## 9. Keamanan & Hal yang Perlu Diperhatikan

- **Pairing token one-time**: setelah approved, token di-consume dan tidak bisa
  dipakai ulang.
- **Pairing token one-time**: kalau device pertama gagal masuk (misal HP mati setelah scan), jalankan `lawang rotate` di mesin host untuk dapat token baru tanpa restart.
- **Hash semua secret**: pairing token, session token, dan device fingerprint
  disimpan dalam bentuk hash SHA-256 (`tokens.ts`). Raw token cuma keluar ke
  client owner (host CLI dan device yang minta).
- **Origin allowlist (WebSocket)**: upgrade `/ws/terminal` cuma diterima dari
  Origin yang cocok dengan loopback, LAN private range, host tunnel saat ini,
  atau pair URL host. Origin asing → HTTP 403 + audit `ws_rejected`.
- **WS frame cap**: tiap frame ≤ 64 KB; payload `terminal:input` ≤ 32 KB; resize
  ≤ 1024×256. Lebih dari itu → close 4413 + audit.
- **Path traversal**: setiap akses file lewat `resolveInside` (`sandbox.ts`) yang
  memastikan path final masih di dalam root.
- **Body limit**: Fastify dibatasi `bodyLimit: 16 MB`. File preview maksimum 1 MB;
  request body JSON `PUT /api/file` dibatasi ~8 MB base64.
- **Bind address**: agent listen di `0.0.0.0`. Di jaringan publik, andalkan tunnel
  (cloudflared) sehingga LAN IP tidak ikut terekspos. Untuk pemakaian aman lokal
  saja, jalankan di Wi-Fi pribadi.
- **Audit dulu sebelum revoke**: cek `~/.lawang/audit.log` untuk lihat siapa
  yang pairing/akses kapan.

---

## 10. Troubleshooting

- **`npm install` gagal di `node-pty`**: cek toolchain native. macOS: jalankan
  `xcode-select --install`. Linux: install `python3`, `make`, `g++`. Windows:
  install Visual Studio Build Tools (workload "Desktop development with C++"). Latar belakang lengkap kenapa toolchain ini wajib ada di
  [§6.1.1 Kenapa butuh toolchain native](#611-kenapa-butuh-toolchain-native).
- **`cloudflared not found. Falling back to local-only access.`**: install
  cloudflared di PATH. Untuk macOS: `brew install cloudflared`.
- **QR di terminal tidak terbaca**: pakai `--qr-size large`, atau buka
  `http://localhost:<port>/qr` di laptop untuk versi full-screen.
- **`Token expired or invalid` di UI**: token TTL habis atau agent direstart.
  Restart agent untuk dapat token baru, atau perpanjang dengan
  `--token-ttl <menit>`.
- **Approval prompt tidak muncul**: pastikan terminal yang menjalankan agent
  punya stdin (jangan jalan via service tanpa TTY). Untuk background service,
  pakai trusted device atau wrap dengan `script`/`tmux`.
- **WebSocket auto-close 4401**: session token salah/expired. Login ulang dari
  pair URL.

---

## 11. Menjalankan Lawang sebagai Service

Default-nya `lawang start` jalan di foreground — tutup terminal atau
Ctrl+C berarti agent mati. Untuk hosting di server / Pi / VPS yang harus
selalu reachable, pakai service manager.

### 11.1 Pilih sesuai konteks

| Skenario                              | Solusi rekomendasi                  |
|---------------------------------------|-------------------------------------|
| Test cepat di mesin sendiri           | tmux / nohup                        |
| Linux server (VPS, Pi, headless)      | `lawang install-service` (systemd)  |
| Mac sebagai server di rumah           | `lawang install-service` (launchd)  |
| Server yang sudah pakai Node manager  | PM2                                 |
| Container infra                       | Docker dengan `--restart unless-stopped` |

### 11.2 systemd / launchd via `lawang install-service`

Generate file unit yang sesuai platform, lalu register:

```bash
# Linux: bikin ~/.config/systemd/user/lawang.service
lawang install-service --root ~/projects/myapp --no-tunnel --register

# macOS: bikin ~/Library/LaunchAgents/dev.lawang.lawang.plist
lawang install-service --root ~/projects/myapp --register
```

Tanpa `--register`, file unit cuma ditulis dan kamu register manual:

```bash
# Linux
systemctl --user daemon-reload
systemctl --user enable --now lawang
loginctl enable-linger $USER          # supaya tetap jalan tanpa user login

# macOS
launchctl load -w ~/Library/LaunchAgents/dev.lawang.lawang.plist
```

Cek status:
```bash
lawang service-status
```

Hapus service:
```bash
lawang uninstall-service
```

Inspect file unit tanpa nulis ke disk:
```bash
lawang install-service --print
```

### 11.3 tmux / nohup (quick & dirty)

Cocok untuk uji coba atau session SSH yang tidak boleh putus.

```bash
# tmux
tmux new -s lawang
lawang start --keep-awake
# detach: Ctrl+B, lalu D
# reattach: tmux attach -t lawang

# nohup background
nohup lawang start > ~/lawang.log 2>&1 &
# stop: pkill -f "lawang start"
```

### 11.4 PM2

Kalau server kamu sudah pakai PM2 untuk Node app lain:
```bash
npm i -g pm2
pm2 start "lawang start --no-tunnel" --name lawang
pm2 save
pm2 startup           # ikuti instruksi yang dicetak
```

### 11.5 Docker

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache build-base python3 git
RUN npm i -g lawang
EXPOSE 3999
CMD ["lawang", "start", "--no-tunnel"]
```

```bash
docker run -d \
  --name lawang \
  --restart unless-stopped \
  -p 3999:3999 \
  -v $HOME:/work \
  -w /work \
  yourname/lawang
```

### 11.6 Catatan keamanan

- Service jalan sebagai user yang menjalankan `install-service`. Tidak
  pakai sudo, tidak boot-time root daemon.
- Audit log tetap di `~/.lawang/audit.log`. Cek berkala untuk siapa yang
  pairing.
- File systemd unit punya hardening minimal (`NoNewPrivileges`,
  `ProtectSystem=full`, `PrivateTmp`). Kalau butuh lebih, edit unit file
  di `~/.config/systemd/user/lawang.service`.
- launchd plist mengisi `PATH` dengan default common bin paths supaya
  `cloudflared` / `git` ditemukan saat agent dispawn.

---

## 12. Quick Start

```bash
# 1. Clone & install
cd ~/lawang
npm install

# 2. Build sekali
npm run build

# 3. Jalankan agent
npm start

# 4. Scan QR dari HP, atau buka pair URL di browser device kedua
# 5. Approve dari CLI host (y/N), opsional trust device
# 6. Sesi terbuka di /#/terminal — terminal, files, dan git siap dipakai
```

Untuk dev iterasi cepat:

```bash
npm run dev:agent   # terminal 1
npm run dev:web     # terminal 2 (akses http://localhost:5173)
```

Selesai. Untuk konteks produk yang lebih luas (visi, milestone berikutnya, risiko),
rujuk `prd_remote_access_app.md` di root repo.
