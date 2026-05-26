# Publish Lawang ke npm — Tutorial Lengkap

Dokumen ini menjelaskan cara mempaketkan `lawang` ke npm, plus
sisi user: prasyarat, cara install, troubleshooting native dependency, dan
alur upgrade.

Versi acuan: `0.1.0`. Semua perintah diasumsikan dijalankan dari root repo
`~/lawang/` kecuali disebut lain.

---

## 1. Apa yang sebenarnya di-publish

Walau repo ini monorepo dengan dua package (`agent` dan `web`), yang
di-publish hanya **satu**: `lawang`. Hasil build web (`packages/web/dist`)
disalin ke `packages/agent/public/` saat `npm run build`, lalu ikut terbawa
ke tarball lewat field `files: ["dist", "public"]`.

Artefak yang user dapat:
- `dist/` — JavaScript hasil `tsc` dari source TypeScript agent.
- `public/` — bundle React + Tailwind + xterm.js + Monaco yang sudah di-minify.
- `package.json` — metadata + `bin: { "lawang": "dist/cli.js" }`.

Yang TIDAK di-publish: `node_modules`, source TypeScript, source React,
audit log, `.lawang/`.

---

## 2. Persiapan repo (one-time)

Sebelum publish pertama kali, ada beberapa hal yang perlu ditambahkan ke
`packages/agent/package.json` supaya npm tidak komplain dan halaman package
di npmjs.com terlihat benar:

```jsonc
{
  "name": "lawang",          // atau ganti unscoped, lihat §3
  "version": "0.1.0",
  "description": "Lawang local agent: terminal bridge + QR pairing.",
  "license": "MIT",
  "homepage": "https://github.com/<you>/remoteapp",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<you>/remoteapp.git",
    "directory": "packages/agent"
  },
  "bugs": "https://github.com/<you>/remoteapp/issues",
  "keywords": ["remote", "terminal", "ssh", "qr", "self-hosted", "cli"],
  "scripts": {
    "build": "tsc -p tsconfig.json && node ../../scripts/copy-web.js",
    "prepublishOnly": "npm --prefix ../web run build && npm run build"
  }
}
```

Tambahan penting:

- **`prepublishOnly`** — jalan otomatis saat `npm publish`. Memastikan build
  web sudah fresh dan disalin ke `public/` sebelum tarball dikemas. Tanpa
  ini, kamu bisa accidentally publish dengan asset web lama.
- **`license`** — wajib MIT (atau lainnya). File `LICENSE` di root repo
  sudah cukup; npm akan referensi dari `package.json`.
- **`repository.directory`** — penting untuk monorepo, supaya npm tahu
  source code-nya di subfolder.

Kalau kamu ingin file LICENSE ikut di tarball, copy ke `packages/agent/LICENSE`
sebelum publish (atau tambahkan ke field `files`).

---

## 3. Pilih nama package

Dua opsi:

### Opsi A — Pakai scope `@lawang`

1. Login ke npmjs.com, klaim scope `@lawang` (gratis untuk user account).
2. `npm publish --access public` (scoped package default-nya private, harus
   eksplisit set public).
3. User install: `npm i -g lawang`.

### Opsi B — Unscoped

Rename di `package.json`:
```json
{ "name": "lawang-cli" }
```
Lalu cek ketersediaan: `npm view lawang-cli`. Kalau 404 → tersedia.

User install: `npm i -g lawang-cli`. Lebih pendek, tidak perlu klaim scope.

**Rekomendasi**: opsi A (scoped). Lebih jelas owner-nya, sulit di-typosquat.

---

## 4. Pre-flight check

Sebelum push ke npm, simulasi tarball lokal:

```bash
cd packages/agent
npm pack
# menghasilkan lawang-agent-0.1.0.tgz
tar -tzf lawang-agent-0.1.0.tgz | head -30
```

Yang harus muncul:
- `package/dist/cli.js`
- `package/dist/server.js`
- `package/dist/lib/*.js`
- `package/public/index.html`
- `package/public/assets/*`
- `package/package.json`

Yang TIDAK boleh muncul: `src/`, `node_modules/`, `*.ts`, audit log, file `.env`.

Test install dari tarball ke folder bersih:
```bash
mkdir -p /tmp/rap-test && cd /tmp/rap-test
npm init -y
npm i ~/lawang/packages/agent/lawang-agent-0.1.0.tgz
npx lawang --version
npx lawang start --no-tunnel --qr-size off
```

Kalau lancar, lanjut ke publish.

---

## 5. Publish ke npm

Pertama kali:
```bash
npm login                                  # interaktif, prompt user/password/2FA
cd packages/agent
npm publish --access public                # untuk scoped lawang
# atau cukup `npm publish` untuk unscoped
```

Versi berikutnya, gunakan `npm version`:
```bash
cd packages/agent
npm version patch          # 0.1.0 → 0.1.1
npm version minor          # 0.1.0 → 0.2.0
npm version major          # 0.1.0 → 1.0.0
npm publish
```

`npm version` otomatis bikin commit dan tag git. Kalau kamu pakai
monorepo dan tidak mau commit otomatis, tambah `--no-git-tag-version`.

---

## 6. Sisi user — Cara install dan menjalankan

### 6.1 Prasyarat di mesin user

Wajib:
- **Node.js ≥ 18.17** (cek dengan `node -v`).
- **npm ≥ 9** (terbawa Node 18+).

Wajib kalau prebuild `node-pty` tidak tersedia untuk versi Node mereka:
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `build-essential` + `python3` (`sudo apt install build-essential python3` di Debian/Ubuntu).
- **Windows**: Visual Studio Build Tools dengan workload "Desktop development with C++".

> node-pty saat ini ship prebuilt binary untuk Node 18/20/22 di
> darwin (x64/arm64), linux (x64/arm64), dan win32 x64. Mayoritas user
> tidak akan pernah compile. Compile cuma terjadi di Node version atau
> arsitektur yang belum punya prebuild.

Optional:
- **`cloudflared`** untuk tunnel publik. macOS: `brew install cloudflared`.
  Linux: download binary dari Cloudflare. Tanpa ini, akses cuma LAN.

### 6.2 Cara install di sisi user

**One-shot tanpa install** (paling cepat):
```bash
npx lawang start
```

**Install global** (kalau mau pakai sering):
```bash
npm i -g lawang
lawang start
```

**pnpm**:
```bash
pnpm dlx lawang start          # one-shot
pnpm add -g lawang             # global
```

**bun**:
```bash
bun x lawang start
bun add -g lawang
```

### 6.3 Workflow user yang umum

```bash
# Mulai sesi
lawang start --keep-awake

# Saat HP mati, generate token baru tanpa restart
lawang rotate

# Lihat sesi yang sudah lewat
lawang history

# Cabut trusted device
lawang devices --revoke <id-prefix>

# Smoke-test keamanan
lawang verify
```

---

## 7. Troubleshooting native dependency

### `npm i` error di node-pty: "node-gyp rebuild failed"

Penyebab: prebuild tidak tersedia untuk kombinasi Node version + OS + arch
mereka, dan toolchain native belum terpasang.

Fix per OS:

**macOS**:
```bash
xcode-select --install
# tunggu sampai selesai, lalu retry npm install
npm i -g lawang
```

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install -y build-essential python3
npm i -g lawang
```

**Fedora/RHEL**:
```bash
sudo dnf install -y gcc-c++ make python3
npm i -g lawang
```

**Alpine**:
```bash
apk add --no-cache build-base python3
npm i -g lawang
```

**Windows (Powershell admin)**:
```powershell
npm i -g windows-build-tools     # legacy, kadang masih dibutuhkan
# atau pasang Visual Studio Build Tools manual dengan workload C++
npm i -g lawang
```

### `cloudflared not found`

```bash
# macOS
brew install cloudflared

# Linux (Debian/Ubuntu)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# atau jalan tanpa tunnel
lawang start --no-tunnel
```

### `EACCES: permission denied` saat `npm i -g`

Pakai nvm untuk hindari sudo:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
npm i -g lawang
```

---

## 8. Versioning + dependency policy

### Versi engine

`package.json` sudah set `"engines": { "node": ">=18.17" }`. Kalau user
pakai Node lebih lama, npm akan warn (atau error kalau pakai `npm config
set engine-strict true`). Tetap pertahankan ini sampai EOL Node 18 (April 2025
lewat tanggal pemeliharaan).

### Dependency yang sensitif

Jaga 3 dependency ini tetap up-to-date karena security/runtime:
- `fastify` — security patches.
- `node-pty` — prebuild untuk Node version baru.
- `ws` — security patches WS frame parsing.

Sisanya bisa update santai. Pastikan run `npm run build` + `lawang verify`
setelah `npm update` untuk catch regresi.

### Lock file

`package-lock.json` di repo root tracks semua workspace. Saat publish, npm
TIDAK ikut lock-file ke tarball. User akan resolve dependency sendiri saat
install. Ini normal.

---

## 9. Distribusi alternatif (opsional)

### Homebrew formula

Setelah package stabil di npm, bikin tap repo:
```ruby
# Formula/lawang.rb
class RemoteApp < Formula
  desc "Local-first remote terminal with QR pairing"
  homepage "https://github.com/<you>/remoteapp"
  url "https://registry.npmjs.org/lawang/-/agent-0.1.0.tgz"
  sha256 "<sha256 dari tarball>"
  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end
end
```

User install: `brew tap <you>/lawang && brew install lawang`.

### Docker image

Untuk hosting di Pi/VPS:
```dockerfile
FROM node:20-alpine
RUN apk add --no-cache build-base python3 git
RUN npm i -g lawang
EXPOSE 3999
CMD ["lawang", "start", "--no-tunnel"]
```

User: `docker run -p 3999:3999 -v $HOME:/work -w /work yourname/lawang`.
Catatan: tunnel cloudflared lebih repot di Docker; biasanya pakai reverse
proxy di host.

### Standalone binary (advanced, tidak disarankan untuk MVP)

`pkg`, `nexe`, atau Bun bisa bundle Node app jadi single binary. Tapi
`node-pty` native module bikin pengemasan rumit. Skip dulu sampai betul-betul
butuh.

---

## 10. CI untuk auto-publish (opsional)

GitHub Actions workflow contoh: `.github/workflows/publish.yml`
```yaml
name: Publish to npm
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm install
      - run: npm run build
      - run: npm --prefix packages/agent publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Setup:
1. Generate npm automation token: `npm token create --type=automation`.
2. GitHub repo → Settings → Secrets → tambah `NPM_TOKEN`.
3. Untuk release: `git tag v0.1.1 && git push --tags`.

---

## 11. Checklist sebelum publish pertama

- [ ] Pilih nama (scoped vs unscoped).
- [ ] Tambah `description`, `license`, `homepage`, `repository`, `bugs`,
      `keywords`, `prepublishOnly` ke `packages/agent/package.json`.
- [ ] Copy `LICENSE` ke `packages/agent/LICENSE` (atau update `files` field).
- [ ] Tulis README package-level di `packages/agent/README.md`. Bisa
      ringkasan dari `docs/DOCUMENTATION.md` + link ke website.
- [ ] `npm pack` lokal, periksa isi tarball.
- [ ] Test install dari tarball di folder bersih.
- [ ] `npm login`.
- [ ] `cd packages/agent && npm publish --access public`.
- [ ] Verify di npmjs.com: halaman terlihat benar, README ter-render.
- [ ] Tag git: `git tag v0.1.0 && git push --tags`.

---

## 12. Catatan jujur untuk MVP

- Saat ini package size sekitar **3.5 MB minified** (mostly Monaco).
  User pertama kali install akan download ~3.5 MB asset web. Ini wajar,
  Monaco editor besar by nature.
- node-pty prebuild ada untuk Node 18/20/22 mainstream. Node 23+ atau
  arch eksotis mungkin compile fallback.
- `--keep-awake`, power actions, dan battery indicator hanya jalan di
  macOS dan Linux. Windows user dapat warning silent.
- Versi pertama better drilling di "early access" — beri tahu user
  bahwa MVP, monitoring audit log direkomendasikan.

Itu saja. Setelah publish, monitoring `npm view lawang` untuk
confirm versi terbaru, dan PRs / issue dari user.
