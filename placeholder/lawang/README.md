# Lawang

> Local-first remote terminal with QR pairing.

Lawang adalah cara untuk membuka shell mesinmu sendiri dari HP atau browser
manapun, dengan satu syarat: setiap pairing harus kamu setujui sendiri di
mesin host. Tidak ada akun, tidak ada cloud broker, tidak ada data yang
menumpang ke server orang lain.

**Status: placeholder.** Package ini di-reservasi di npm registry. Versi
penuh sedang dipersiapkan dan akan dirilis sebagai `1.0.0` ke depannya.

```bash
npm i -g lawang@latest
lawang
```

Jalankan `lawang` di terminal untuk lihat status terbaru.

## Roadmap menuju 1.0

Lawang akan ship dengan:

- CLI agent berbasis Node.js (Fastify + ws + node-pty).
- Pairing one-time via QR code, host approval mandatory.
- Web terminal mobile-friendly (xterm.js + shortcut bar).
- Tab Chat: ketik command, output dirapikan jadi bubble.
- File explorer, code editor (Monaco), git panel.
- Cloudflared tunnel auto-detect untuk akses publik.
- Audit log lokal di `~/.lawang/audit.log`.
- Trusted devices, session history, environment detection.
- Power controls: sleep / shutdown / reboot / lock host dari UI.
- Battery indicator, keep-awake mode, command rotation tanpa restart.
- `lawang verify` untuk smoke-test hard rules keamanan.

## License

MIT.
