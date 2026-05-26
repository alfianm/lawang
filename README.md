# Lawang

Local-first remote terminal for your own machine. Run a single command, scan a QR code, get a browser/mobile terminal that the host has to approve before it opens.

> MVP v0.1 dari `prd_remote_access_app.md`. Tidak ada akun, tidak ada broker, tidak ada data yang menumpang ke server orang lain.

## Highlights

- CLI agent dengan HTTP + WebSocket server lokal.
- Pairing one-time via QR + approval eksplisit di CLI host.
- Granular permissions saat approve: full / read-only / terminal-only.
- Terminal xterm.js dengan shortcut bar mobile-friendly.
- Reconnect-safe terminal: PTY tetap hidup ~5 menit saat WS putus, output ter-replay otomatis.
- File explorer + Monaco editor (read/write, upload, rename, delete, mkdir).
- Git panel (status, diff, log, stage, commit, pull, push).
- Local sites proxy: expose `localhost:3000`, `:5173`, dst. lewat `/proxy/<port>/...`.
- Audit log viewer di web (filter per kategori + search) selain file `audit.log` di disk.
- Tunnel publik opsional via `cloudflared` (auto-detect).
- Trusted devices + audit log JSONL di `~/.lawang/`.

## Quick start

```bash
npm install
npm run build
npm start
```

Scan QR yang dicetak CLI atau buka pair URL manual di browser device kedua. Jawab `y` di CLI host untuk approve, lalu kamu langsung di shell.

Mode developer:

```bash
npm run dev:agent   # terminal 1
npm run dev:web     # terminal 2 → http://localhost:5173
```

Flag tambahan yang sering dipakai:

```bash
lawang start --proxy 3000,5173    # whitelist port lokal yang boleh diproxy
lawang start --proxy open         # izinkan semua port (mode dev)
lawang start --no-tunnel          # hanya LAN
lawang start --idle-timeout 60    # menit timeout sesi idle
lawang start --keep-awake         # cegah laptop sleep selama agent jalan
```

Subcommand admin:

```bash
lawang sessions                # list sesi aktif
lawang sessions --revoke <id>  # revoke sesi by id (8+ char prefix)
lawang devices                 # list trusted device
lawang devices --revoke <id>   # revoke trusted device
lawang ping                    # cek agent jalan
```

## Posisi vs alternatif

Project sejenis seperti `9remote` punya remote desktop, dashboard cloud, dan
aplikasi mobile native. Kita tidak. Yang kita prioritaskan: **local-first,
open source, transparan**. Tidak ada broker cloud, tidak ada akun, audit log
disimpan lokal dalam JSONL yang mudah dibaca. Cocok kalau kamu ingin
self-host dan paham apa yang berjalan di mesin sendiri.

## Dokumentasi

Tiga sumber, sesuai gaya yang kamu suka:

- **Markdown lengkap** → [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md). Tech stack, arsitektur, endpoint, cara menjalankan, keamanan, troubleshooting.
- **Website editorial** → folder [`site/`](site/). Static HTML + CSS, tanpa build step. Preview lokal:
  ```bash
  cd site && python3 -m http.server 4173
  # buka http://localhost:4173
  ```
  - `site/index.html` — landing page.
  - `site/docs.html` — dokumentasi dengan TOC sticky dan diagram SVG.
  - `site/api.html` — API reference dengan contoh `curl` per endpoint.
- **PRD produk** → [`prd_remote_access_app.md`](prd_remote_access_app.md). Visi, milestone berikutnya, risiko.

## Layout repo

```
packages/agent  — Node.js agent (Fastify + ws + node-pty)
packages/web    — React + xterm.js client (di-serve oleh agent)
scripts/        — utility build (copy-web)
docs/           — dokumentasi markdown
site/           — landing page + docs static (HTML/CSS/SVG)
```

## Roadmap

Milestone berikutnya (file explorer lanjutan, remote desktop research, dll) ada di `prd_remote_access_app.md`. Intentionally out of scope untuk v0.1.

## License

MIT.
