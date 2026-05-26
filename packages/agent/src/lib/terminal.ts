import os from "node:os";
import { spawn as ptySpawn, IPty } from "node-pty";

export interface TerminalProcess {
  pty: IPty;
  shell: string;
  cwd: string;
}

export function spawnTerminal(opts: { cwd: string; cols?: number; rows?: number }): TerminalProcess {
  const isWindows = process.platform === "win32";
  const shell = isWindows
    ? process.env.COMSPEC || "powershell.exe"
    : process.env.SHELL || "/bin/bash";
  const args: string[] = isWindows ? [] : ["-l"];
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG || "en_US.UTF-8" };

  const pty = ptySpawn(shell, args, {
    name: "xterm-256color",
    cols: opts.cols ?? 100,
    rows: opts.rows ?? 32,
    cwd: opts.cwd,
    env: env as { [key: string]: string },
  });

  return { pty, shell, cwd: opts.cwd };
}

export function defaultUserCwd(rootPath: string) {
  return rootPath || os.homedir();
}
