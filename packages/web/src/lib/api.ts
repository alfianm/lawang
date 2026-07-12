export interface AgentInfo {
  machineName: string;
  version: string;
  tunnelUrl: string | null;
  localUrl?: string | null;
  lanUrl?: string | null;
  pairUrl: string | null;
  pairPinRequired?: boolean;
  pairLanOnly?: boolean;
}

export interface PairSuccess {
  status: "approved";
  sessionToken: string;
  machineName?: string;
  permissions?: string[];
  trusted?: boolean;
  preset?: "full" | "files" | "terminal";
}

export interface PairFailure {
  status: "rejected" | "rate_limited" | "invalid_request";
  reason?: string;
}

export type PairResponse = PairSuccess | PairFailure;

export async function fetchInfo(): Promise<AgentInfo> {
  const r = await fetch("/api/info");
  if (!r.ok) throw new Error("info_failed");
  return (await r.json()) as AgentInfo;
}

export async function requestPairing(input: {
  pairingToken: string;
  deviceName?: string;
  deviceType?: "mobile" | "desktop" | "unknown";
  deviceFingerprint?: string;
  pairingPin?: string;
}): Promise<PairResponse> {
  const r = await fetch("/api/pair/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (r.status === 429) return { status: "rate_limited" };
  const data = (await r.json()) as PairResponse;
  return data;
}

// ---- Authenticated APIs ----

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  modifiedAt: string;
}

export interface ListDirResponse {
  path: string;
  rootName: string;
  entries: DirEntry[];
}

export interface FileReadResponse {
  path: string;
  size: number;
  modifiedAt: string;
  encoding: "utf8" | "base64";
  content: string;
  isBinary: boolean;
  mime: string;
}

export interface SessionInfoResponse {
  sessionId: string;
  machineName: string;
  rootPath: string;
  permissions: string[];
  deviceName: string;
  createdAt: string;
  expiresAt: string | null;
  reachability?: {
    tunnelUrl: string | null;
    localUrl: string;
    lanUrl: string | null;
    preferred: string;
    mode: "tunnel" | "lan" | "local";
  };
  agentMode?: {
    autoApprove: boolean;
    keepAwake: boolean;
    unattended: boolean;
    autoApproveScope: "full" | "files" | "terminal" | null;
    pairLanOnly: boolean;
    pairPinRequired: boolean;
    sessionTtlMinutes: number;
  };
}

function authHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

export class AuthError extends Error {
  constructor(public statusCode: number) {
    super(`auth_${statusCode}`);
  }
}

async function authedJson<T>(token: string, url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders(token) });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 100)}`);
  }
  return (await r.json()) as T;
}

export function fetchSession(token: string) {
  return authedJson<SessionInfoResponse>(token, "/api/session");
}

export interface EnvironmentResponse {
  machine: { hostname: string; platform: string; arch: string; cpus: number; release: string };
  runtime: { node: string; npm_user_agent: string | null };
  shell:   { path: string; name: string };
  project: {
    rootPath: string;
    name: string | null;
    version: string | null;
    packageManager: "npm" | "pnpm" | "yarn" | "bun" | null;
    packageManagerLockfile: string | null;
    isGitRepo: boolean;
    monorepo: boolean;
    workspaces: string[] | null;
  };
}

export interface SessionHistoryRecord {
  sessionId: string;
  deviceName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: "ended" | "revoked" | "expired" | null;
  remoteAddr?: string;
  trusted?: boolean;
}

export interface ActiveSessionRecord {
  sessionId: string;
  deviceName: string;
  deviceType: string;
  remoteAddr: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string | null;
  permissions: string[];
  current: boolean;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  outdated: boolean;
  checkedAt: string | null;
}

export async function rotatePairingViaApi(token: string): Promise<{ pairUrl: string; token: string; expiresAt: number }> {
  const r = await fetch("/api/control/rotate", {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (r.status === 503) throw new Error("rotate_not_supported");
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export async function fetchVersion(): Promise<VersionInfo> {
  // Public endpoint, no auth required.
  const r = await fetch("/api/version", { cache: "no-store" });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return (await r.json()) as VersionInfo;
}

export function fetchEnvironment(token: string) {
  return authedJson<EnvironmentResponse>(token, "/api/env");
}

export interface Snippet {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  description?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  usageCount: number;
}

export function listSnippets(token: string): Promise<{ snippets: Snippet[] }> {
  return authedJson<{ snippets: Snippet[] }>(token, "/api/snippets");
}

export async function createSnippet(token: string, input: {
  label: string; command: string; cwd?: string; description?: string; tags?: string[];
}): Promise<Snippet> {
  const r = await fetch("/api/snippets", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (r.status === 409) throw new Error("duplicate_label");
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export async function updateSnippet(token: string, id: string, patch: {
  label?: string; command?: string; cwd?: string; description?: string; tags?: string[];
}): Promise<Snippet> {
  const r = await fetch(`/api/snippets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (r.status === 409) throw new Error("duplicate_label");
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export async function deleteSnippet(token: string, id: string): Promise<void> {
  const r = await fetch(`/api/snippets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`http_${r.status}`);
}

export async function recordSnippetUsage(token: string, id: string): Promise<void> {
  const r = await fetch(`/api/snippets/${encodeURIComponent(id)}/use`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  // ignore non-fatal failures
}

export async function exportSnippets(token: string): Promise<{ version: 1; snippets: Snippet[] }> {
  return authedJson<{ version: 1; snippets: Snippet[] }>(token, "/api/snippets/export");
}

export async function importSnippets(token: string, file: unknown, mode: "merge" | "replace" = "merge"): Promise<{ status: string; imported: number; skipped: number }> {
  const r = await fetch("/api/snippets/import", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ file, mode }),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export interface ExecResult {
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
}

export type PowerAction = "sleep" | "shutdown" | "reboot" | "lock";
interface PowerCap { supported: boolean; provider: string; needsAuth?: boolean; reason?: string }
export interface PowerCapabilities {
  sleep:    PowerCap;
  shutdown: PowerCap;
  reboot:   PowerCap;
  lock:     PowerCap;
}

export interface BatteryInfo {
  supported: boolean;
  hasBattery: boolean;
  percent: number | null;
  charging: boolean | null;
  acConnected: boolean | null;
  state: "charging" | "discharging" | "charged" | "unknown" | null;
  timeRemainingMin: number | null;
  source: string;
}

export function fetchBattery(token: string): Promise<BatteryInfo> {
  return authedJson<BatteryInfo>(token, "/api/system/battery");
}

export function fetchPowerCapabilities(token: string): Promise<PowerCapabilities> {
  return authedJson<PowerCapabilities>(token, "/api/system/power");
}

export interface DesktopCapability {
  supported: boolean;
  provider: string;
  reason?: string;
}

export interface DesktopCapabilities {
  platform: string;
  view: DesktopCapability;
  control: DesktopCapability;
}

export type DesktopInput =
  | { kind: "mouse_move"; x: number; y: number }
  | { kind: "mouse_click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { kind: "key"; key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }
  | { kind: "text"; text: string };

export function fetchDesktopCapabilities(token: string): Promise<DesktopCapabilities> {
  return authedJson<DesktopCapabilities>(token, "/api/desktop/capabilities");
}

export async function openDesktopSettings(
  token: string,
  target: "screen-recording" | "accessibility",
): Promise<void> {
  const r = await fetch("/api/desktop/settings", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ target }),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 160)}`);
  }
}

export async function fetchDesktopScreenshot(token: string): Promise<{ url: string; capturedAt: string | null }> {
  const r = await fetch(`/api/desktop/screenshot?t=${Date.now()}`, {
    headers: authHeaders(token),
    cache: "no-store",
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 160)}`);
  }
  const blob = await r.blob();
  return {
    url: URL.createObjectURL(blob),
    capturedAt: r.headers.get("x-captured-at"),
  };
}

export async function sendDesktopInput(token: string, input: DesktopInput): Promise<void> {
  const r = await fetch("/api/desktop/input", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 160)}`);
  }
}

export async function performPower(token: string, action: PowerAction, delaySeconds = 5): Promise<{ status: string; action: PowerAction; delaySeconds: number; willHappenAt: string }> {
  const r = await fetch("/api/system/power", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ action, confirm: true, delaySeconds }),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 120)}`);
  }
  return await r.json();
}

export async function execCommand(token: string, command: string, cwd: string, timeoutMs?: number): Promise<ExecResult> {
  const r = await fetch("/api/exec", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ command, cwd, timeoutMs }),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 120)}`);
  }
  return (await r.json()) as ExecResult;
}

export function fetchSessionHistory(token: string, limit = 25) {
  return authedJson<{ records: SessionHistoryRecord[]; limit: number }>(
    token,
    `/api/sessions/history?limit=${encodeURIComponent(String(limit))}`
  );
}

export function fetchActiveSessions(token: string) {
  return authedJson<{ sessions: ActiveSessionRecord[] }>(token, "/api/sessions/active");
}

export async function revokeActiveSession(token: string, sessionId: string): Promise<{ status: string; sessionId: string; current: boolean }> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export function listFiles(token: string, p: string): Promise<ListDirResponse> {
  const u = `/api/files?path=${encodeURIComponent(p)}`;
  return authedJson<ListDirResponse>(token, u);
}

export function readFile(token: string, p: string): Promise<FileReadResponse> {
  const u = `/api/file?path=${encodeURIComponent(p)}`;
  return authedJson<FileReadResponse>(token, u);
}

export function downloadUrl(token: string, p: string): string {
  return `/api/file/download?path=${encodeURIComponent(p)}&token=${encodeURIComponent(token)}`;
}

// ---- Write APIs ----

export async function writeFile(token: string, p: string, content: string, encoding: "utf8" | "base64" = "utf8"): Promise<{ status: string; path: string; size: number; modifiedAt: string }> {
  const r = await fetch("/api/file", {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ path: p, content, encoding }),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export async function uploadFile(token: string, p: string, file: File): Promise<{ status: string; path: string; size: number }> {
  const url = `/api/file/upload?path=${encodeURIComponent(p)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: file,
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export async function makeDir(token: string, p: string): Promise<{ status: string; path: string }> {
  const r = await fetch("/api/dir", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ path: p }),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

export async function renameEntry(token: string, from: string, to: string): Promise<{ status: string; from: string; to: string }> {
  const r = await fetch("/api/file/rename", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ from, to }),
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 120)}`);
  }
  return await r.json();
}

export async function deleteEntry(token: string, p: string): Promise<{ status: string }> {
  const r = await fetch(`/api/file?path=${encodeURIComponent(p)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

// ---- Git APIs ----

export interface GitStatus {
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  clean: boolean;
  files: Array<{
    path: string;
    index: string;
    workingDir: string;
    staged: boolean;
    unstaged: boolean;
    untracked: boolean;
    conflicted: boolean;
    renamedFrom: string | null;
  }>;
}

export interface GitLogEntry { hash: string; date: string; author: string; message: string; }

async function authedJsonOrThrow<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
  if (r.status === 409) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`http_409:${(body as any).status || "conflict"}`);
  }
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`http_${r.status}:${body.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

export function gitStatus(token: string): Promise<GitStatus> {
  return authedJsonOrThrow<GitStatus>(token, "/api/git/status");
}
export function gitDiff(token: string, p: string, staged: boolean): Promise<{ path: string; staged: boolean; diff: string }> {
  const u = `/api/git/diff?path=${encodeURIComponent(p)}&staged=${staged ? "1" : "0"}`;
  return authedJsonOrThrow(token, u);
}
export function gitLog(token: string, max = 30): Promise<{ commits: GitLogEntry[] }> {
  return authedJsonOrThrow(token, `/api/git/log?max=${max}`);
}
export function gitStage(token: string, paths: string[]) {
  return authedJsonOrThrow(token, "/api/git/stage", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
}
export function gitUnstage(token: string, paths: string[]) {
  return authedJsonOrThrow(token, "/api/git/unstage", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
}
export function gitCommit(token: string, message: string): Promise<{ status: string; commit: string }> {
  return authedJsonOrThrow(token, "/api/git/commit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
}
export function gitPull(token: string): Promise<{ status: string; summary: { changes: number; insertions: number; deletions: number } }> {
  return authedJsonOrThrow(token, "/api/git/pull", { method: "POST" });
}

export interface GitPushResult {
  status: "ok";
  branch: string;
  remote: string;
  pushed: { from: string; to: string; alreadyUpdated: boolean }[];
}

export function gitPush(
  token: string,
  opts: { remote?: string; branch?: string; setUpstream?: boolean } = {}
): Promise<GitPushResult> {
  return authedJsonOrThrow(token, "/api/git/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...opts, confirm: true }),
  });
}

// ---- Local sites proxy ----

export interface ProxyTarget {
  port: number;
  host: string;
  label: string | null;
  addedAt: number;
}

export interface ProxyState {
  targets: ProxyTarget[];
  allowList: number[] | null;
  proxyBase: string;
}

export function fetchProxy(token: string): Promise<ProxyState> {
  return authedJsonOrThrow<ProxyState>(token, "/api/proxy");
}

export function discoverProxyPorts(token: string): Promise<{ ports: number[] }> {
  return authedJsonOrThrow<{ ports: number[] }>(token, "/api/proxy/discover");
}

export function addProxyTarget(token: string, opts: { port: number; host?: string; label?: string }) {
  return authedJsonOrThrow<{ status: string; target: ProxyTarget }>(token, "/api/proxy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export function removeProxyTarget(token: string, port: number) {
  return authedJsonOrThrow<{ status: string }>(token, `/api/proxy/${port}`, {
    method: "DELETE",
  });
}

// ---- Ops ----

export type OpsCheckStatus = "ok" | "warn" | "bad";

export interface OpsDoctorCheck {
  id: string;
  label: string;
  status: OpsCheckStatus;
  detail: string;
  fix?: string;
}

export interface OpsDoctor {
  generatedAt: string;
  env: EnvironmentResponse;
  desktop: DesktopCapabilities;
  service: {
    platform: string;
    unitPath: string;
    installed: boolean;
    active: boolean;
    source: string;
  };
  tools: Record<string, unknown>;
  checks: OpsDoctorCheck[];
}

export type ProcessJobStatus = "running" | "exited" | "failed" | "stopped";

export interface ProcessJob {
  id: string;
  command: string;
  cwd: string;
  label: string | null;
  status: ProcessJobStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  log: string;
  truncated: boolean;
}

export interface OpsPort {
  port: number;
  proxied: boolean;
  allowed: boolean;
  url: string;
  label: string;
}

export interface OpsService {
  platform: string;
  unitPath: string;
  serviceName: string;
  rootPath: string;
  binaryPath: string;
  status: { installed: boolean; active: boolean; source: string };
}

export interface OpsShareResult {
  status: "ok";
  url: string;
  token: string;
  sessionId: string;
  scope: "full" | "files" | "terminal";
  permissions: string[];
  expiresAt: string | null;
}

export interface OpsShareRecord {
  sessionId: string;
  label: string;
  scope: "full" | "files" | "terminal" | "custom";
  permissions: string[];
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string | null;
  createdBySessionId: string | null;
  current: boolean;
}

export interface TrustedDeviceRecord {
  deviceId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  preset: "full" | "files" | "terminal" | null;
  active: boolean;
}

export function fetchOpsDoctor(token: string): Promise<OpsDoctor> {
  return authedJsonOrThrow<OpsDoctor>(token, "/api/ops/doctor");
}

export function listProcessJobs(token: string): Promise<{ jobs: ProcessJob[] }> {
  return authedJsonOrThrow<{ jobs: ProcessJob[] }>(token, "/api/ops/processes");
}

export function startProcessJob(token: string, input: { command: string; cwd?: string; label?: string }) {
  return authedJsonOrThrow<{ status: string; job: ProcessJob }>(token, "/api/ops/processes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function stopProcessJob(token: string, jobId: string) {
  return authedJsonOrThrow<{ status: string; job: ProcessJob }>(token, `/api/ops/processes/${encodeURIComponent(jobId)}/stop`, {
    method: "POST",
  });
}

export function listShareSessions(token: string): Promise<{ shares: OpsShareRecord[] }> {
  return authedJsonOrThrow<{ shares: OpsShareRecord[] }>(token, "/api/ops/share");
}

export function createShareSession(token: string, input: { scope: "full" | "files" | "terminal"; label?: string }) {
  return authedJsonOrThrow<OpsShareResult>(token, "/api/ops/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function revokeShareSession(token: string, sessionId: string) {
  return authedJsonOrThrow<{ status: string; sessionId: string; current: boolean }>(
    token,
    `/api/ops/share/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
}

export function listTrustedDevices(token: string): Promise<{ devices: TrustedDeviceRecord[] }> {
  return authedJsonOrThrow<{ devices: TrustedDeviceRecord[] }>(token, "/api/devices");
}

export function revokeTrustedDevice(token: string, deviceId: string) {
  return authedJsonOrThrow<{ status: string; device: TrustedDeviceRecord | null }>(
    token,
    `/api/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
  );
}

export function fetchOpsPorts(token: string): Promise<{ ports: OpsPort[]; allowList: number[] | null }> {
  return authedJsonOrThrow<{ ports: OpsPort[]; allowList: number[] | null }>(token, "/api/ops/ports");
}

export function fetchOpsService(token: string): Promise<OpsService> {
  return authedJsonOrThrow<OpsService>(token, "/api/ops/service");
}

export function performOpsService(token: string, input: { action: "install" | "uninstall"; register?: boolean }) {
  return authedJsonOrThrow<{ status: string; service: OpsService["status"]; results: Array<{ cmd: string; ok: boolean; stdout: string; stderr: string }> }>(
    token,
    "/api/ops/service",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

// ---- Audit log ----

export interface AuditEvent {
  eventId: string;
  type: string;
  timestamp: string;
  deviceName?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryParams {
  limit?: number;
  types?: string[];
  search?: string;
  since?: string;
}

export function fetchAuditLog(token: string, params: AuditQueryParams = {}): Promise<{ events: AuditEvent[]; limit: number }> {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.types && params.types.length) search.set("types", params.types.join(","));
  if (params.search) search.set("search", params.search);
  if (params.since) search.set("since", params.since);
  const qs = search.toString();
  return authedJsonOrThrow<{ events: AuditEvent[]; limit: number }>(token, `/api/audit${qs ? `?${qs}` : ""}`);
}

export function fetchAuditSummary(token: string): Promise<{ counts: Record<string, number> }> {
  return authedJsonOrThrow<{ counts: Record<string, number> }>(token, "/api/audit/summary");
}

// ---- Clipboard bridge ----

export interface ClipboardCapabilities {
  supported: boolean;
  provider: string;
  platform: string;
}

export interface ClipboardReadResult {
  supported: boolean;
  provider: string;
  kind: "text" | "empty" | "unsupported";
  text: string | null;
  truncated: boolean;
}

export function fetchClipboardCapabilities(token: string) {
  return authedJsonOrThrow<ClipboardCapabilities>(token, "/api/clipboard/capabilities");
}

export function readClipboard(token: string) {
  return authedJsonOrThrow<ClipboardReadResult>(token, "/api/clipboard");
}

export function writeClipboard(token: string, text: string) {
  return authedJsonOrThrow<{ supported: boolean; provider: string; status: string; bytes: number }>(token, "/api/clipboard", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

// ---- Attention / agents ----

export interface AttentionItem {
  id: string;
  source: "terminal" | "process" | "agent";
  kind: string;
  label: string;
  snippet: string;
  sessionId?: string;
  jobId?: string;
  agentId?: string;
  command?: string | null;
  agent?: string | null;
  status?: string;
}

export interface AgentCard {
  jobId: string;
  agentId?: string | null;
  source?: "process" | "agent";
  agent: string;
  command: string;
  cwd: string;
  startedAt: string;
  durationMs: number;
  attention: { kind: string; label: string; snippet: string } | null;
}

export interface AttentionResponse {
  generatedAt: string;
  items: AttentionItem[];
  agents: AgentCard[];
  counts: { attention: number; agents: number };
}

export function fetchAttention(token: string) {
  return authedJsonOrThrow<AttentionResponse>(token, "/api/attention");
}

// ---- Agent Hub ----

export interface AgentPreset {
  id: string;
  label: string;
  command: string;
  description: string;
  binaries?: string[];
  installed?: boolean;
  resolvedBinary?: string | null;
}

export interface AgentReply {
  id: string;
  at: string;
  text: string;
  kind: "reply" | "approve" | "reject" | "enter";
}

export interface AgentSession {
  id: string;
  presetId: string | null;
  agent: string;
  label: string;
  command: string;
  cwd: string;
  status: "running" | "exited" | "failed" | "stopped";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  durationMs: number;
  log: string;
  truncated: boolean;
  attention: { kind: string; label: string; snippet: string } | null;
  replies: AgentReply[];
}

export function listAgents(token: string) {
  return authedJsonOrThrow<{ agents: AgentSession[]; presets: AgentPreset[] }>(token, "/api/agents");
}

export function listAgentPresets(token: string) {
  return authedJsonOrThrow<{ presets: AgentPreset[] }>(token, "/api/agents/presets");
}

export function startAgent(
  token: string,
  body: { presetId?: string; command?: string; cwd?: string; label?: string },
) {
  return authedJsonOrThrow<{ agent: AgentSession }>(token, "/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchAgent(token: string, agentId: string) {
  return authedJsonOrThrow<{ agent: AgentSession }>(token, `/api/agents/${encodeURIComponent(agentId)}`);
}

export function replyToAgent(token: string, agentId: string, text: string) {
  return authedJsonOrThrow<{ agent: AgentSession }>(token, `/api/agents/${encodeURIComponent(agentId)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function agentAction(token: string, agentId: string, action: "approve" | "reject" | "enter") {
  return authedJsonOrThrow<{ agent: AgentSession }>(token, `/api/agents/${encodeURIComponent(agentId)}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export function stopAgent(token: string, agentId: string) {
  return authedJsonOrThrow<{ agent: AgentSession }>(token, `/api/agents/${encodeURIComponent(agentId)}/stop`, {
    method: "POST",
  });
}
