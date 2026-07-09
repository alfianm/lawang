/**
 * Lightweight heuristics for "something on the host needs your attention".
 * Used by terminal ring buffers and process job logs.
 */

export type AttentionKind =
  | "confirm"
  | "password"
  | "otp"
  | "agent"
  | "error"
  | "prompt";

export interface AttentionHit {
  kind: AttentionKind;
  label: string;
  snippet: string;
}

const PATTERNS: Array<{ kind: AttentionKind; label: string; re: RegExp }> = [
  { kind: "password", label: "Password prompt", re: /(?:password|passphrase|pin)\s*[:=?]?\s*$/im },
  { kind: "otp", label: "Auth / OTP prompt", re: /(?:one[- ]time|verification|otp|2fa|authenticator).{0,40}(?:code|token)?/im },
  { kind: "confirm", label: "Waiting for confirmation", re: /(?:\(y\/n\)|\[y\/n\]|yes\/no|continue\?|proceed\?|overwrite\?|are you sure)/im },
  { kind: "agent", label: "Agent needs input", re: /(?:waiting for (?:your )?(?:input|approval|confirmation)|press enter to continue|do you want to|approve this|human input required|needs? (?:your )?attention)/im },
  { kind: "error", label: "Error / failure", re: /(?:\berror\b|\bfailed\b|\bfatal\b|EACCES|ENOENT|permission denied)/im },
  { kind: "prompt", label: "Shell prompt idle", re: /(?:^|\n)[^\n]{0,80}[$#%>]\s*$/m },
];

const AGENT_COMMAND_RE = /\b(claude|codex|aider|cursor-agent|gemini|opencode|continue-cli|gpt\s*engineer)\b/i;

export function detectAttention(text: string, opts?: { preferTailChars?: number }): AttentionHit | null {
  if (!text) return null;
  const prefer = opts?.preferTailChars ?? 4000;
  const sample = text.length > prefer ? text.slice(text.length - prefer) : text;
  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const tail = lines.slice(-12).join("\n");

  for (const pattern of PATTERNS) {
    // Skip generic "prompt" unless the last non-empty line looks like a prompt.
    if (pattern.kind === "prompt") {
      const last = lines[lines.length - 1] || "";
      if (!/[$#%>]\s*$/.test(last)) continue;
      // Avoid firing on every idle shell — only if recent activity mentioned agents/errors nearby.
      if (!AGENT_COMMAND_RE.test(tail) && !/\b(error|failed|waiting)\b/i.test(tail)) continue;
    }
    if (pattern.re.test(tail)) {
      return {
        kind: pattern.kind,
        label: pattern.label,
        snippet: clipSnippet(tail),
      };
    }
  }
  return null;
}

export function looksLikeAgentCommand(command: string): boolean {
  return AGENT_COMMAND_RE.test(command);
}

export function agentLabelFromCommand(command: string): string | null {
  const m = command.match(AGENT_COMMAND_RE);
  return m ? m[1].toLowerCase() : null;
}

function clipSnippet(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 160) return compact;
  return compact.slice(compact.length - 160);
}
