# Changelog

All notable changes to Lawang are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.6.0] - 2026-05-26

### Added
- **Multi-host directory** (browser-side bookmark): switcher chip in the Session header lists every Lawang agent paired from this browser. Click to navigate to that origin. New `/#/hosts` page to add, rename, or forget hosts. Sessions remain scoped per origin (no cross-origin token sharing).
- Auto-register the current host the first time you open a session.
- **Session reattach**: PTY processes now survive WebSocket drops. The agent keeps each shell alive for up to 5 minutes after the client disconnects, with a 256 KB output ring buffer per session. When the client reconnects (phone wakes, network blip), the terminal screen replays the buffered output and resumes exactly where it was. Verified end-to-end with `terminal:replay` event + `[reconnected]` ANSI banner.
- Auto-reconnect with exponential backoff (up to 6 attempts) in `TerminalPanel`.

## [0.5.0] - 2026-05-26

### Added
- **Command palette** (`Cmd-K` / `Ctrl-K` from anywhere in the session): fuzzy search across navigation actions, session controls, and saved snippets. Run a snippet directly from the palette without opening the drawer.
- REST `POST /api/control/rotate`: rotate the pairing token from the web UI (used by the palette's "Rotate pairing token" action).
- 30-second client-side cache for snippet list inside the palette so opening it repeatedly does not hammer the server.

## [0.4.0] - 2026-05-26

### Added
- **Snippet library**: save command kustom (`label`, `command`, `cwd`, `tags`, `description`) ke `~/.lawang/snippets.json`. Bookmark di Chat tab membuka drawer untuk list/search/create/edit/delete. Tap snippet → command langsung dijalankan dengan cwd yang disimpan.
- REST endpoints: `GET /api/snippets`, `POST /api/snippets`, `PATCH /api/snippets/:id`, `DELETE /api/snippets/:id`, `POST /api/snippets/:id/use`, `GET /api/snippets/export`, `POST /api/snippets/import`.
- Audit events: `snippet_created`, `snippet_updated`, `snippet_deleted`, `snippet_used`.

## [0.3.0] - 2026-05-26

### Added
- (interim release published in parallel) Terminal session reattach groundwork (`terminalSessions.ts`) and local proxy module (`localProxy.ts`). See repo history for detail.

## [0.2.0] - 2026-05-26

### Added
- **Update notifier** in the CLI banner: warns when a newer version of `lawang` is available on npm. Checks once per 24h, cached locally. Disable with `NO_UPDATE_NOTIFIER=1`.
- **Update banner** in the web Session header: subtle "update available" pill that links to `npm i -g lawang@latest`. Disappears when running latest.
- `GET /api/version` endpoint: returns current vs latest version of the agent.
- `CHANGELOG.md` at the repo root.

### Changed
- README at the npm page now points to the changelog and roadmap.

## [0.1.2] - 2026-05-25

### Fixed
- `lawang verify` stops early with an actionable tip when the agent is not running, instead of spamming probes that already failed.

## [0.1.0] - 2026-05-25

### Added
- First real release. Code reorganized under the `lawang` package name.
- CLI agent (`lawang start`) with Fastify HTTP + WebSocket server.
- One-time QR pairing with explicit host approval.
- Mobile-friendly web terminal using xterm.js.
- File explorer with sandboxed read/write/upload/rename/delete.
- Monaco code editor (lazy-loaded) for inline editing.
- Git panel: status, diff, log, stage, commit, pull, push (push requires `confirm: true`).
- Chat tab: one-shot command exec rendered as bubbles, with formatter for JSON / diff / exit code, plus interactive command detector and history recall.
- Cloudflared tunnel auto-detect.
- Trusted devices: hashed fingerprint, auto-approve, revoke.
- Audit log JSONL at `~/.lawang/audit.log`.
- Session history viewer (CLI + REST + UI modal).
- Environment detection (`/api/env`).
- Power controls: sleep / shutdown / reboot / lock from the UI, with confirmation.
- Battery indicator + `--keep-awake` mode.
- `lawang rotate`: new pairing token without restarting.
- `lawang verify`: smoke-test PRD § 17 / 18.3 hard rules.
- `lawang install-service` / `uninstall-service` / `service-status`: systemd user unit (Linux) or launchd plist (macOS).
- WebSocket Origin allowlist + 64 KB frame cap + 32 KB input cap.
- Auto-migration from legacy `~/.remote-app/` to `~/.lawang/` on first run.

## [0.0.1] - 2026-05-24

### Added
- Placeholder reservation on npm to claim the `lawang` name.
