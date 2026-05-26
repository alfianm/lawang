# PRD — Aplikasi Remote Access Terminal, File Explorer, dan Remote Desktop

## 1. Ringkasan Produk

Produk ini adalah aplikasi remote access berbasis web/mobile yang memungkinkan pengguna mengakses komputer pribadi, laptop development, atau server miliknya dari browser/HP tanpa perlu port forwarding.

Fokus awal produk adalah **remote terminal yang aman dan cepat digunakan**. Fitur lanjutan seperti file explorer, code editor, Git integration, dan remote desktop masuk tahap berikutnya setelah fondasi terminal, pairing, tunnel, dan security stabil.

Produk ini bukan sekadar landing page. Ini adalah aplikasi yang memberi akses langsung ke mesin pengguna. Artinya, standar security harus lebih tinggi daripada aplikasi CRUD biasa.

---

## 2. Tujuan Produk

### 2.1 Tujuan Utama

Membangun aplikasi remote access yang memungkinkan developer mengontrol terminal komputer/server miliknya dari perangkat lain secara aman, cepat, dan tanpa konfigurasi jaringan rumit.

### 2.2 Tujuan Bisnis

- Membuat MVP remote terminal berbasis QR pairing.
- Memvalidasi apakah developer butuh akses terminal dari HP/browser secara cepat.
- Menyiapkan fondasi untuk produk SaaS developer tool.
- Menjadi alternatif ringan untuk remote SSH, remote desktop, atau cloud IDE.

### 2.3 Tujuan Pengguna

Pengguna bisa:

- Menjalankan terminal komputer dari HP/browser.
- Mengakses project tanpa membuka port publik.
- Melakukan emergency fix dari luar laptop utama.
- Mengelola file project secara terbatas dan aman.
- Melakukan pairing device menggunakan QR code.

---

## 3. Masalah yang Ingin Diselesaikan

Developer sering mengalami situasi seperti:

- Perlu restart service tapi sedang jauh dari laptop.
- Perlu cek log server lokal/dev machine.
- Perlu menjalankan command cepat dari HP.
- Tidak mau setup SSH, VPN, domain, atau port forwarding.
- Ingin akses project lokal dari perangkat lain tanpa konfigurasi ribet.

Solusi yang ditawarkan:

> Jalankan satu command di laptop/server, scan QR code, lalu akses terminal dari browser/HP secara aman.

---

## 4. Target Pengguna

### 4.1 Primary User

**Developer individu / freelancer**

Karakteristik:

- Sering bekerja dengan terminal.
- Punya project lokal.
- Menggunakan Node.js, Laravel, Docker, Git, SSH, atau server VPS.
- Butuh akses cepat dari HP/browser.
- Tidak ingin setup networking manual.

### 4.2 Secondary User

**Small team / startup technical founder**

Karakteristik:

- Butuh akses cepat ke dev machine atau staging server.
- Ingin tool internal ringan.
- Peduli produktivitas tapi belum butuh enterprise remote management.

### 4.3 Non-Target User

Produk ini **bukan** untuk:

- Mengakses perangkat orang lain tanpa izin.
- Spyware, monitoring diam-diam, atau RAT ilegal.
- Enterprise device management kompleks.
- Pengganti TeamViewer penuh di versi awal.
- Pengguna non-teknis yang tidak paham risiko terminal.

---

## 5. Positioning Produk

### 5.1 Value Proposition

> Remote terminal dan project access dari browser/HP tanpa SSH setup, tanpa port forwarding, dan dengan QR-based pairing.

### 5.2 Pembeda Utama

- Local-first.
- Install sederhana via CLI.
- QR pairing.
- Tidak perlu public IP.
- Terminal berbasis browser/mobile.
- Fokus developer workflow.
- File explorer dan code editor sebagai fitur lanjutan.

---

## 6. Prinsip Produk

1. **Security first**  
   Produk ini memberi akses ke mesin pengguna. Security bukan fitur tambahan, tapi fondasi.

2. **MVP kecil dulu**  
   Remote terminal harus stabil sebelum membangun remote desktop.

3. **Local-first**  
   Jangan simpan command output, file project, atau credential pengguna di server pusat kecuali benar-benar diperlukan.

4. **Explicit consent**  
   Setiap device baru harus dipairing dan disetujui oleh pemilik host.

5. **No hidden access**  
   Pengguna host harus tahu kapan ada session aktif.

6. **Fail closed**  
   Kalau token invalid, session expired, tunnel error, atau pairing gagal, akses harus ditolak.

---

## 7. Scope Produk

## 7.1 MVP Scope — Version 0.1

Fokus: **Remote Terminal via Browser/HP**

### Fitur MVP

- CLI agent.
- Local server.
- QR code pairing.
- One-time token.
- Web terminal.
- WebSocket real-time terminal streaming.
- Cloudflare/ngrok tunnel.
- Session expiry.
- Manual stop session dari CLI.
- Basic device info display.
- Basic audit log lokal.

### Tidak Masuk MVP

- Remote desktop.
- File editor penuh.
- Multi-user team management.
- Billing.
- AI assistant.
- Mobile native app.
- Push notification.
- Persistent cloud dashboard.
- Background daemon/service.

---

## 7.2 Version 0.2

Fokus: **File Explorer + Device Management**

Fitur:

- Browse folder project.
- Read file.
- Download file.
- Upload file.
- Rename/delete file dengan konfirmasi.
- Root folder sandbox.
- Trusted devices.
- Revoke trusted device.
- Session history lokal.
- Better auth handshake.

---

## 7.3 Version 0.3

Fokus: **Code Editor + Git Workflow**

Fitur:

- Monaco editor.
- Save file.
- Git status.
- Git diff.
- Git pull.
- Git commit.
- Git push dengan konfirmasi.
- Command shortcuts.
- Environment detection.

---

## 7.4 Version 0.4+

Fokus: **Remote Desktop**

Fitur:

- Screen capture.
- WebRTC stream.
- Mouse control.
- Keyboard control.
- Permission setup macOS/Windows/Linux.
- Latency optimization.
- TURN server support.
- Session recording setting opsional.

Remote desktop tidak boleh dikerjakan sebelum terminal, tunnel, auth, dan permission model matang.

---

## 8. User Journey MVP

## 8.1 First-Time User Flow

1. User install CLI:

```bash
npm install -g remote-app
```

2. User masuk ke folder project:

```bash
cd my-project
```

3. User menjalankan agent:

```bash
remote-app start
```

4. CLI menampilkan QR code dan URL sementara.

5. User scan QR dari HP/browser.

6. Browser membuka halaman pairing.

7. CLI menampilkan request approval:

```txt
New device wants to connect:
Device: iPhone Safari
Location: Unknown
Approve? [y/N]
```

8. User approve.

9. Browser masuk ke terminal.

10. User menjalankan command.

11. Output terminal tampil real-time.

12. User selesai dan menutup session.

---

## 8.2 Returning User Flow

1. User menjalankan:

```bash
remote-app start
```

2. Jika device sudah trusted, browser bisa connect dengan session token baru.

3. User tetap harus melihat status session aktif di CLI.

---

## 8.3 Session End Flow

Session berakhir jika:

- User klik disconnect.
- Host menekan `Ctrl+C`.
- Token expired.
- Tunnel mati.
- Tidak ada aktivitas selama X menit.
- Host menjalankan command revoke.

---

## 9. Functional Requirements

## 9.1 CLI Agent

### Deskripsi

CLI agent adalah aplikasi lokal yang dijalankan di komputer pengguna. Agent bertanggung jawab membuat local server, membuka pseudo terminal, membuat QR pairing, mengelola session, dan menghubungkan client browser ke terminal.

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| CLI-001 | User dapat menginstall CLI via npm | Must |
| CLI-002 | User dapat menjalankan agent dengan `remote-app start` | Must |
| CLI-003 | CLI membuat local HTTP/WebSocket server | Must |
| CLI-004 | CLI membuat one-time token untuk pairing | Must |
| CLI-005 | CLI menampilkan QR code di terminal | Must |
| CLI-006 | CLI menampilkan URL manual jika QR tidak bisa discan | Must |
| CLI-007 | CLI meminta approval saat device baru connect | Must |
| CLI-008 | CLI menampilkan daftar session aktif | Should |
| CLI-009 | CLI bisa menghentikan semua session | Must |
| CLI-010 | CLI menyimpan config lokal | Should |

### Acceptance Criteria

- User bisa menjalankan CLI tanpa konfigurasi rumit.
- QR code muncul maksimal 5 detik setelah command start.
- Jika pairing token expired, client tidak bisa connect.
- Jika user tidak approve device, terminal tidak terbuka.
- Saat CLI dihentikan, semua client disconnect.

---

## 9.2 Web Terminal

### Deskripsi

Web terminal adalah interface browser/mobile untuk menjalankan command ke shell host.

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| TERM-001 | Browser menampilkan terminal interaktif | Must |
| TERM-002 | Input user dikirim real-time ke host | Must |
| TERM-003 | Output shell tampil real-time di browser | Must |
| TERM-004 | Resize terminal mengikuti ukuran browser | Should |
| TERM-005 | Copy/paste didukung | Should |
| TERM-006 | Mobile keyboard usable | Should |
| TERM-007 | Tombol shortcut mobile seperti Ctrl+C, Ctrl+L, Tab | Should |
| TERM-008 | Terminal disconnect jika session expired | Must |

### Acceptance Criteria

- User bisa menjalankan command seperti `ls`, `pwd`, `npm run dev`, `php artisan`, dan melihat output.
- Terminal tetap responsif untuk output panjang.
- Jika koneksi putus, UI menampilkan status disconnected.
- Tidak ada command yang bisa dikirim sebelum authentication selesai.

---

## 9.3 Pairing dan Authentication

### Deskripsi

Pairing digunakan untuk menghubungkan browser/mobile dengan host device secara aman.

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| AUTH-001 | Sistem membuat one-time pairing token | Must |
| AUTH-002 | Token memiliki expiry, default 10-30 menit | Must |
| AUTH-003 | QR code berisi tunnel URL dan pairing token | Must |
| AUTH-004 | Device baru harus disetujui dari host CLI | Must |
| AUTH-005 | Setelah approve, sistem membuat session token | Must |
| AUTH-006 | Session token disimpan hanya di client dan host | Must |
| AUTH-007 | Session token bisa direvoke | Must |
| AUTH-008 | Trusted device didukung di versi 0.2 | Should |

### Acceptance Criteria

- Token yang sudah dipakai tidak bisa dipakai ulang.
- Token expired tidak bisa connect.
- Session invalid langsung diputus.
- Device tidak dikenal tidak bisa masuk tanpa approval.

---

## 9.4 Tunnel

### Deskripsi

Tunnel memungkinkan client mengakses local agent tanpa port forwarding.

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| TUN-001 | Agent bisa membuat public temporary URL | Must |
| TUN-002 | Tunnel berjalan outbound-only dari host | Must |
| TUN-003 | Tunnel URL hanya valid selama agent aktif | Must |
| TUN-004 | Agent menampilkan status tunnel | Must |
| TUN-005 | Agent fallback ke localhost mode jika tunnel gagal | Should |

### Acceptance Criteria

- User tidak perlu setting router/firewall.
- Jika tunnel mati, client disconnect.
- Tunnel tidak boleh membuka akses tanpa auth.

---

## 9.5 File Explorer — Version 0.2

### Deskripsi

File explorer memungkinkan user melihat dan mengelola file dalam folder project yang diizinkan.

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| FILE-001 | User bisa melihat daftar file/folder | Should |
| FILE-002 | User bisa membuka file teks | Should |
| FILE-003 | User bisa download file | Should |
| FILE-004 | User bisa upload file | Could |
| FILE-005 | User bisa rename file | Could |
| FILE-006 | User bisa delete file dengan konfirmasi | Could |
| FILE-007 | Akses dibatasi ke root folder yang dipilih | Must |
| FILE-008 | Path traversal wajib diblokir | Must |

### Acceptance Criteria

- Client tidak bisa mengakses file di luar root folder.
- Request seperti `../../etc/passwd` harus ditolak.
- File besar diberi batas ukuran.
- Operasi delete harus membutuhkan konfirmasi.

---

## 9.6 Code Editor — Version 0.3

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| EDIT-001 | User bisa edit file teks | Should |
| EDIT-002 | User bisa save file | Should |
| EDIT-003 | Editor support syntax highlighting | Should |
| EDIT-004 | Sistem mencegah overwrite konflik sederhana | Could |
| EDIT-005 | File binary tidak dibuka sebagai teks | Must |

---

## 9.7 Git Integration — Version 0.3

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| GIT-001 | User bisa melihat git status | Should |
| GIT-002 | User bisa melihat diff | Should |
| GIT-003 | User bisa melakukan commit | Could |
| GIT-004 | User bisa melakukan pull/push dengan konfirmasi | Could |
| GIT-005 | Operasi destructive harus diberi warning | Must |

---

## 9.8 Remote Desktop — Version 0.4+

### Requirement

| ID | Requirement | Priority |
|---|---|---|
| RD-001 | User bisa melihat screen host | Could |
| RD-002 | User bisa menggerakkan mouse | Could |
| RD-003 | User bisa mengetik keyboard | Could |
| RD-004 | Permission setup per OS | Must |
| RD-005 | Host bisa mematikan control kapan saja | Must |
| RD-006 | Session harus terlihat jelas di host | Must |

### Catatan

Remote desktop sangat sensitif. Jangan membangun fitur ini sebelum model auth, session, approval, dan audit log benar-benar aman.

---

## 10. Non-Functional Requirements

## 10.1 Security

Security wajib, bukan opsional.

Requirement:

- Semua koneksi eksternal harus HTTPS/WSS.
- Pairing token harus random dan high entropy.
- Token harus expired.
- Token hanya bisa dipakai sekali.
- Device baru harus butuh approval manual.
- Session harus bisa direvoke.
- Agent harus menampilkan session aktif.
- Akses file harus sandboxed.
- Command execution hanya tersedia setelah auth valid.
- Jangan simpan command output di cloud.
- Jangan hardcode secret.
- Jangan expose endpoint `/exec` publik tanpa auth.
- Rate limit request pairing.
- Validasi origin.
- Validasi payload WebSocket.
- Audit log lokal untuk connect/disconnect/device approval.

## 10.2 Performance

- Terminal input latency target: < 200ms dalam koneksi normal.
- Startup CLI target: < 5 detik sampai QR tampil.
- Web terminal load target: < 3 detik.
- Support output panjang minimal 10.000 baris dengan virtualized terminal buffer.

## 10.3 Reliability

- Jika tunnel mati, client harus tahu status disconnected.
- Jika host restart, semua session lama invalid.
- Agent tidak boleh crash karena output terminal panjang.
- Client reconnect hanya boleh dilakukan dengan session valid.

## 10.4 Privacy

- Command output tidak dikirim ke server pusat kecuali melalui tunnel transport yang diperlukan.
- File project tidak disimpan di cloud.
- Logs sensitif tidak boleh dikumpulkan otomatis.
- Analytics hanya boleh event non-sensitif, misalnya app started, session connected, session ended.

## 10.5 Compatibility

MVP harus mendukung:

- macOS.
- Linux.
- Windows sebagai target berikutnya jika node-pty stabil.
- Browser modern: Chrome, Edge, Safari mobile.

---

## 11. Architecture

## 11.1 High-Level Architecture

```txt
[Browser / Mobile]
        |
        | HTTPS / WSS
        v
[Public Tunnel URL]
        |
        v
[Local Agent]
        |
        |-- node-pty -> Shell
        |-- fs       -> File Explorer
        |-- git      -> Git Commands
        |-- config   -> Local Storage
```

## 11.2 MVP Architecture

```txt
CLI Agent
  - Start local server
  - Start tunnel
  - Generate QR token
  - Handle pairing
  - Spawn terminal process
  - Bridge terminal I/O to WebSocket

Web Client
  - Pairing screen
  - Terminal UI
  - Session state
  - Disconnect handling
```

## 11.3 Future SaaS Architecture

```txt
Cloud Backend
  - User accounts
  - Device registry
  - Session broker
  - Billing
  - Notification
  - Team access

Local Agent
  - Maintains secure outbound connection
  - Executes local actions only after authorized session
```

---

## 12. Recommended Tech Stack

## 12.1 CLI / Local Agent

- Node.js + TypeScript.
- Commander.js untuk CLI command.
- Fastify untuk local HTTP server.
- Socket.IO atau native WebSocket untuk real-time transport.
- node-pty untuk shell terminal.
- qrcode-terminal untuk QR.
- cloudflared/ngrok/localtunnel untuk tunnel.
- zod untuk validation.
- lowdb/SQLite/encrypted JSON untuk config lokal.

## 12.2 Web Client

- Next.js.
- React.
- Tailwind CSS.
- shadcn/ui.
- xterm.js.
- Socket.IO client.
- Zustand/Jotai untuk state ringan.

## 12.3 File Editor

- Monaco Editor.
- simple-git.
- fs/promises.

## 12.4 Cloud Backend — Later

- Cloudflare Workers.
- Durable Objects untuk session coordination.
- KV/R2 untuk metadata non-sensitif.
- PostgreSQL/Supabase kalau butuh account dan billing.
- Redis/Upstash untuk rate limit/session cache.

---

## 13. Data Model

## 13.1 Local Config

```json
{
  "machineId": "uuid",
  "machineName": "MacBook Alfian",
  "trustedDevices": [],
  "settings": {
    "rootPath": "/Users/user/project",
    "tokenExpiryMinutes": 15,
    "idleTimeoutMinutes": 30
  }
}
```

## 13.2 Pairing Token

```json
{
  "tokenId": "uuid",
  "tokenHash": "hashed-token",
  "createdAt": "datetime",
  "expiresAt": "datetime",
  "usedAt": null,
  "status": "active"
}
```

## 13.3 Session

```json
{
  "sessionId": "uuid",
  "deviceId": "uuid",
  "createdAt": "datetime",
  "lastActiveAt": "datetime",
  "status": "active",
  "permissions": ["terminal"]
}
```

## 13.4 Trusted Device — V0.2

```json
{
  "deviceId": "uuid",
  "name": "iPhone Safari",
  "fingerprintHash": "hash",
  "createdAt": "datetime",
  "lastUsedAt": "datetime",
  "revokedAt": null
}
```

## 13.5 Audit Log Lokal

```json
{
  "eventId": "uuid",
  "type": "device_connected",
  "deviceName": "Chrome on Android",
  "timestamp": "datetime",
  "metadata": {}
}
```

---

## 14. API / Event Contract MVP

## 14.1 HTTP Endpoints

### `GET /health`

Purpose: cek agent aktif.

Response:

```json
{
  "status": "ok",
  "machineName": "MacBook",
  "version": "0.1.0"
}
```

### `POST /pair/request`

Purpose: client meminta pairing menggunakan token dari QR.

Request:

```json
{
  "pairingToken": "string",
  "deviceName": "iPhone Safari",
  "deviceType": "mobile"
}
```

Response pending:

```json
{
  "status": "pending",
  "requestId": "uuid"
}
```

Response approved:

```json
{
  "status": "approved",
  "sessionToken": "string"
}
```

Response rejected:

```json
{
  "status": "rejected"
}
```

---

## 14.2 WebSocket Events

### Client to Server

```txt
terminal:input
terminal:resize
session:disconnect
```

### Server to Client

```txt
terminal:output
session:connected
session:expired
session:revoked
error
```

### Event Example

```json
{
  "event": "terminal:input",
  "payload": {
    "data": "ls\n"
  }
}
```

---

## 15. Permission Model

## 15.1 MVP Permission

MVP hanya punya permission:

```txt
terminal
```

## 15.2 Future Permission

```txt
terminal
file:read
file:write
file:delete
git:read
git:write
screen:view
screen:control
```

Setiap session harus punya permission eksplisit.

---

## 16. UI Requirements

## 16.1 Landing Page

Section:

- Hero.
- Problem statement.
- Feature highlight.
- Demo terminal mockup.
- Install command.
- Security explanation.
- Roadmap.
- FAQ.
- GitHub/Docs CTA.

## 16.2 Pairing Page

Elemen:

- Product logo/name.
- Device name input opsional.
- Status: connecting, waiting approval, approved, rejected, expired.
- Warning: hanya connect ke device milik sendiri.

## 16.3 Terminal Page

Elemen:

- Terminal full-screen.
- Connection status.
- Machine name.
- Disconnect button.
- Mobile shortcut bar: Ctrl, Esc, Tab, arrows, Ctrl+C.

## 16.4 CLI UI

CLI harus menampilkan:

```txt
Remote App started
Local URL: http://localhost:3999
Tunnel URL: https://xxxx.trycloudflare.com
Pairing expires in: 15 minutes
Scan this QR to connect

Active sessions: 0
```

Saat ada device connect:

```txt
New pairing request
Device: iPhone Safari
Approve? [y/N]
```

---

## 17. Security Threat Model

## 17.1 Risiko Utama

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Token QR bocor | Orang lain bisa mencoba connect | Token one-time, expiry, host approval |
| Tunnel URL ditebak/dibagikan | Unauthorized access | Auth wajib sebelum terminal |
| Session hijacking | Remote command execution | Session token random, secure transport, expiry |
| Path traversal file explorer | Akses file sensitif | Root sandbox, path normalization |
| Command endpoint exposed | Mesin jadi backdoor | Tidak ada unauthenticated command endpoint |
| Device lama masih trusted | Akses tak diinginkan | Revoke device |
| User tidak sadar session aktif | Privacy/security risk | CLI status jelas, kill switch |

## 17.2 Hard Rules

- Tidak boleh ada akses remote tanpa consent host.
- Tidak boleh silent background access di MVP.
- Tidak boleh autostart daemon sebelum security matang.
- Tidak boleh menyimpan secret dalam plain text jika bisa dihindari.
- Tidak boleh membuka seluruh filesystem secara default.
- Tidak boleh membuat fitur untuk bypass security device lain.

---

## 18. Success Metrics

## 18.1 MVP Product Metrics

- Time to first terminal session < 2 menit setelah install.
- QR pairing success rate > 90%.
- Terminal session crash rate < 5%.
- Median command latency < 200ms.
- 30% user mencoba session kedua setelah first use.

## 18.2 Technical Metrics

- Agent startup success rate.
- Tunnel creation success rate.
- WebSocket disconnect rate.
- Terminal process crash count.
- Pairing token rejection count.

## 18.3 Security Metrics

- Semua pairing request tercatat lokal.
- Semua rejected/expired token tercatat lokal.
- Tidak ada unauthenticated terminal access dalam security test.
- Path traversal test harus gagal 100%.

---

## 19. Milestone Development

## Milestone 1 — Prototype Lokal

Target:

- CLI start local server.
- Browser buka localhost.
- WebSocket connect.
- node-pty jalan.
- xterm.js tampil.

Estimasi: 3-5 hari.

Deliverable:

- Terminal dari browser lokal.

---

## Milestone 2 — QR Pairing

Target:

- Generate token.
- QR code.
- Pairing page.
- Manual approve dari CLI.
- Session token.

Estimasi: 3-5 hari.

Deliverable:

- Terminal hanya terbuka setelah pairing approved.

---

## Milestone 3 — Tunnel

Target:

- Integrasi Cloudflare/ngrok tunnel.
- Public URL.
- QR berisi public URL.
- Client dari HP bisa connect.

Estimasi: 3-5 hari.

Deliverable:

- Remote terminal dari HP di jaringan berbeda.

---

## Milestone 4 — MVP Hardening

Target:

- Token expiry.
- One-time use.
- Disconnect handling.
- Idle timeout.
- Basic audit log.
- CLI kill switch.
- Error handling.

Estimasi: 1 minggu.

Deliverable:

- MVP private beta.

---

## Milestone 5 — File Explorer

Target:

- List folder.
- Read file.
- Download file.
- Root sandbox.
- Path traversal protection.

Estimasi: 1-2 minggu.

Deliverable:

- Project file browser aman.

---

## Milestone 6 — Code Editor + Git

Target:

- Monaco editor.
- Save file.
- Git status/diff.
- Commit flow.

Estimasi: 1-2 minggu.

Deliverable:

- Basic remote coding workflow.

---

## Milestone 7 — Remote Desktop Research

Target:

- Spike WebRTC.
- Screen capture test.
- Input control test.
- Permission research per OS.

Estimasi: 2-4 minggu untuk research awal.

Deliverable:

- Technical feasibility report, bukan production feature.

---

## 20. Release Plan

## 20.1 Alpha

Audience:

- Internal developer.
- Teman dekat yang paham risiko terminal.

Scope:

- Terminal.
- QR pairing.
- Tunnel.

## 20.2 Private Beta

Audience:

- 10-30 developer.

Scope:

- Terminal stabil.
- Trusted device.
- Audit log.
- File explorer read-only.

## 20.3 Public Beta

Audience:

- Developer umum.

Scope:

- Terminal.
- File explorer.
- Basic editor.
- Docs lengkap.
- Security disclaimer.

---

## 21. Monetization — Later

Jangan pikirkan billing sebelum MVP terbukti dipakai.

Potensi monetisasi:

### Free

- 1 host device.
- Temporary sessions.
- Terminal only.

### Pro

- Multiple trusted devices.
- Persistent device list.
- File explorer/editor.
- Longer session.
- Git integration.

### Team

- Team device access.
- Role-based permissions.
- Audit log cloud.
- SSO.

---

## 22. Risiko Proyek

## 22.1 Risiko Scope Creep

Bahaya terbesar adalah ingin langsung bikin:

- Remote desktop.
- Mobile app native.
- AI coding agent.
- Team dashboard.
- Billing.
- Marketplace.

Itu semua akan membuat MVP tidak selesai.

Keputusan tegas:

> MVP hanya remote terminal via QR pairing dan tunnel.

## 22.2 Risiko Security

Produk ini bisa menjadi backdoor kalau salah desain.

Mitigasi:

- Pairing manual.
- Explicit approval.
- Session visible.
- No silent daemon.
- No unauthenticated endpoint.
- Audit log lokal.

## 22.3 Risiko Teknis

- node-pty berbeda perilaku antar OS.
- Mobile terminal UX sulit.
- Tunnel provider bisa rate limit.
- WebSocket reconnect bisa rumit.
- Remote desktop jauh lebih kompleks daripada terminal.

## 22.4 Risiko Legal/Ethical

Karena produk remote access bisa disalahgunakan, positioning dan desain harus jelas:

- Untuk device milik sendiri.
- Consent eksplisit.
- Tidak ada stealth mode.
- Tidak ada fitur persistence tersembunyi.
- Tidak ada bypass permission.

---

## 23. Open Questions

1. Apakah MVP hanya local accountless, atau perlu cloud account dari awal?
2. Tunnel provider final: Cloudflare, ngrok, atau custom relay?
3. Apakah Windows wajib di MVP?
4. Apakah trusted device masuk MVP atau v0.2?
5. Apakah file explorer read-only dulu atau langsung write?
6. Apakah perlu publish sebagai open-source?
7. Apakah produk ini akan menjadi SaaS atau developer utility open-core?

---

## 24. Prioritas Eksekusi

Urutan yang benar:

1. Local web terminal.
2. node-pty bridge.
3. QR pairing.
4. Manual approval.
5. Tunnel.
6. Token expiry dan one-time use.
7. Session management.
8. Audit log.
9. Mobile terminal shortcuts.
10. File explorer read-only.
11. File write/editor.
12. Git integration.
13. Remote desktop research.

Jangan melompat ke remote desktop sebelum nomor 1-8 selesai.

---

## 25. Definition of Done MVP

MVP dianggap selesai jika:

- User bisa install CLI.
- User bisa start agent.
- QR code muncul.
- User bisa scan dari HP.
- Host harus approve device.
- Browser membuka terminal.
- User bisa menjalankan command real-time.
- Token expired tidak bisa dipakai.
- Session bisa disconnect.
- Agent bisa stop semua koneksi.
- Tidak ada akses terminal tanpa auth.
- Basic docs tersedia.

---

## 26. Brutal Reality Check

Kalau tujuanmu hanya membuat website yang terlihat seperti produk remote access, itu mudah.

Kalau tujuanmu membuat aplikasi remote access sungguhan, tantangannya bukan UI. Tantangannya adalah:

- terminal streaming stabil,
- tunnel reliable,
- auth aman,
- permission jelas,
- mobile terminal UX,
- handling edge case,
- security testing.

Kesalahan terbesar adalah menganggap ini seperti CRUD app. Bukan. Ini tool yang bisa menjalankan command di mesin user. Satu bug auth bisa mengubah produkmu menjadi celah keamanan.

Jadi strategi paling waras:

> Jangan bikin clone penuh. Bikin remote terminal MVP yang kecil, aman, dan benar-benar jalan. Setelah itu baru naik ke file explorer, editor, Git, dan remote desktop.

