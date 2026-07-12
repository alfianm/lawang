import { execFileSync } from "node:child_process";

export interface AgentPresetDef {
  id: string;
  label: string;
  /** Preferred launch command once a binary is resolved. */
  command: string;
  description: string;
  /** Candidate binaries to probe on PATH (first hit wins). */
  binaries: string[];
}

export interface AgentPreset extends AgentPresetDef {
  installed: boolean;
  /** Resolved binary name when installed, else preferred command. */
  resolvedBinary: string | null;
}

/** Common coding-agent CLIs that run well inside a PTY. */
export const AGENT_PRESET_DEFS: AgentPresetDef[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    description: "Anthropic Claude Code — interactive agent in the project root",
    binaries: ["claude"],
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    description: "OpenAI Codex CLI — interactive coding agent",
    binaries: ["codex"],
  },
  {
    id: "cursor-agent",
    label: "Cursor Agent",
    command: "agent",
    description: "Cursor terminal agent (`agent` / `cursor-agent`)",
    binaries: ["agent", "cursor-agent"],
  },
  {
    id: "aider",
    label: "Aider",
    command: "aider",
    description: "Aider pair-programming agent",
    binaries: ["aider"],
  },
  {
    id: "gemini",
    label: "Gemini",
    command: "gemini",
    description: "Google Gemini CLI",
    binaries: ["gemini"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    description: "OpenCode agent",
    binaries: ["opencode"],
  },
  {
    id: "amp",
    label: "Amp",
    command: "amp",
    description: "Amp coding agent (if installed)",
    binaries: ["amp"],
  },
  {
    id: "goose",
    label: "Goose",
    command: "goose",
    description: "Block Goose agent (if installed)",
    binaries: ["goose"],
  },
  {
    id: "kiro",
    label: "Kiro",
    command: "kiro",
    description: "Kiro agent CLI (if on PATH)",
    binaries: ["kiro", "kiro-cli"],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    command: "antigravity",
    description: "Antigravity agent CLI (if on PATH)",
    binaries: ["antigravity", "agy"],
  },
];

export function findAgentPreset(id: string): AgentPresetDef | null {
  return AGENT_PRESET_DEFS.find((p) => p.id === id) || null;
}

export function resolveAgentPresets(): AgentPreset[] {
  return AGENT_PRESET_DEFS.map((def) => {
    const resolvedBinary = def.binaries.find((bin) => commandExists(bin)) || null;
    return {
      ...def,
      // Prefer the binary that actually exists so Start works out of the box.
      command: resolvedBinary || def.command,
      installed: Boolean(resolvedBinary),
      resolvedBinary,
    };
  }).sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export function resolvePresetCommand(presetId: string): string | null {
  const def = findAgentPreset(presetId);
  if (!def) return null;
  const hit = def.binaries.find((bin) => commandExists(bin));
  return hit || def.command;
}

function commandExists(command: string): boolean {
  try {
    if (process.platform === "win32") {
      execFileSync("where.exe", [command], { stdio: "ignore" });
    } else {
      execFileSync("/usr/bin/env", ["sh", "-c", `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
        stdio: "ignore",
      });
    }
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
