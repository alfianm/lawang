import path from "node:path";
import { promises as fsp } from "node:fs";
import simpleGit, { SimpleGit } from "simple-git";

export class GitError extends Error {
  constructor(message: string, public code: "not_a_repo" | "git_failed" | "invalid_input") {
    super(message);
  }
}

async function isRepo(root: string): Promise<boolean> {
  try {
    const s = await fsp.stat(path.join(root, ".git"));
    return s.isDirectory() || s.isFile();
  } catch {
    return false;
  }
}

async function ensureRepo(root: string): Promise<SimpleGit> {
  if (!(await isRepo(root))) {
    throw new GitError("Not a git repository", "not_a_repo");
  }
  return simpleGit({ baseDir: root, binary: "git", maxConcurrentProcesses: 4 });
}

export interface GitStatusFile {
  path: string;
  index: string;
  workingDir: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  renamedFrom: string | null;
}

export interface GitStatus {
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  files: GitStatusFile[];
  clean: boolean;
}

export async function status(root: string): Promise<GitStatus> {
  const git = await ensureRepo(root);
  const s = await git.status();
  const files: GitStatusFile[] = s.files.map((f) => {
    const idx = f.index || " ";
    const wd = f.working_dir || " ";
    return {
      path: f.path,
      index: idx,
      workingDir: wd,
      staged: idx !== " " && idx !== "?",
      unstaged: wd !== " " && wd !== "?",
      untracked: idx === "?" && wd === "?",
      conflicted: ["U", "A", "D"].some((c) => idx + wd === c + c) || s.conflicted.includes(f.path),
      renamedFrom: (f as unknown as { from?: string }).from || null,
    };
  });
  return {
    branch: s.current,
    tracking: s.tracking,
    ahead: s.ahead,
    behind: s.behind,
    detached: s.detached,
    files,
    clean: s.isClean(),
  };
}

export async function diffFile(root: string, filePath: string, staged = false): Promise<{ path: string; staged: boolean; diff: string }> {
  const git = await ensureRepo(root);
  if (!filePath) throw new GitError("Path is required", "invalid_input");
  const args = staged ? ["--cached", "--", filePath] : ["--", filePath];
  const diff = await git.diff(args);
  return { path: filePath, staged, diff };
}

export async function stage(root: string, paths: string[]): Promise<{ status: "ok"; staged: string[] }> {
  const git = await ensureRepo(root);
  if (!paths.length) throw new GitError("No paths provided", "invalid_input");
  await git.add(paths);
  return { status: "ok", staged: paths };
}

export async function unstage(root: string, paths: string[]): Promise<{ status: "ok"; unstaged: string[] }> {
  const git = await ensureRepo(root);
  if (!paths.length) throw new GitError("No paths provided", "invalid_input");
  // git reset HEAD <paths> works whether HEAD exists or not, except for empty repo.
  try {
    await git.reset(["HEAD", "--", ...paths]);
  } catch {
    // initial commit case: rm --cached to just unstage tracked entries
    await git.raw(["rm", "--cached", "--ignore-unmatch", ...paths]);
  }
  return { status: "ok", unstaged: paths };
}

export async function commit(root: string, message: string): Promise<{ status: "ok"; commit: string }> {
  const git = await ensureRepo(root);
  if (!message || message.trim().length === 0) throw new GitError("Commit message is required", "invalid_input");
  const r = await git.commit(message.trim());
  return { status: "ok", commit: r.commit || "" };
}

export async function pull(root: string): Promise<{ status: "ok"; summary: { changes: number; insertions: number; deletions: number } }> {
  const git = await ensureRepo(root);
  const r = await git.pull();
  return {
    status: "ok",
    summary: {
      changes: r.summary.changes || 0,
      insertions: r.summary.insertions || 0,
      deletions: r.summary.deletions || 0,
    },
  };
}

export interface PushSummary {
  status: "ok";
  branch: string;
  remote: string;
  pushed: { from: string; to: string; alreadyUpdated: boolean }[];
}

export async function push(
  root: string,
  opts: { remote?: string; branch?: string; setUpstream?: boolean } = {}
): Promise<PushSummary> {
  const git = await ensureRepo(root);
  const s = await git.status();
  if (s.detached || !s.current) {
    throw new GitError("Cannot push from a detached HEAD", "git_failed");
  }
  const branch = opts.branch?.trim() || s.current;
  let remote = opts.remote?.trim();
  if (!remote) {
    if (s.tracking) {
      remote = s.tracking.split("/")[0] || "origin";
    } else {
      const remotes = await git.getRemotes(false);
      if (remotes.length === 0) {
        throw new GitError("No git remote configured", "git_failed");
      }
      remote = remotes.find((r) => r.name === "origin")?.name || remotes[0].name;
    }
  }
  const args: string[] = [];
  if (opts.setUpstream || !s.tracking) args.push("--set-upstream");
  try {
    const result = await git.push(remote, branch, args);
    const pushed = (result.pushed || []).map((p) => ({
      from: p.local || branch,
      to: p.remote || `${remote}/${branch}`,
      alreadyUpdated: !!p.alreadyUpdated,
    }));
    return { status: "ok", branch, remote, pushed };
  } catch (err) {
    const msg = (err as Error).message || "git push failed";
    throw new GitError(msg, "git_failed");
  }
}

export async function log(root: string, max = 30): Promise<{ commits: { hash: string; date: string; author: string; message: string }[] }> {
  const git = await ensureRepo(root);
  const l = await git.log({ maxCount: max });
  return {
    commits: l.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      author: `${c.author_name} <${c.author_email}>`,
      message: c.message,
    })),
  };
}
