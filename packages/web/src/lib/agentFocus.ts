/** Shared focus handoff between Attention indicator and Agents tab. */
const FOCUS_AGENT_KEY = "lawang:focusAgent";

export function setFocusAgentId(agentId: string | null | undefined) {
  try {
    if (!agentId) {
      sessionStorage.removeItem(FOCUS_AGENT_KEY);
      return;
    }
    sessionStorage.setItem(FOCUS_AGENT_KEY, agentId);
  } catch {
    /* ignore */
  }
}

export function takeFocusAgentId(): string | null {
  try {
    const id = sessionStorage.getItem(FOCUS_AGENT_KEY);
    if (id) sessionStorage.removeItem(FOCUS_AGENT_KEY);
    return id;
  } catch {
    return null;
  }
}

export function peekFocusAgentId(): string | null {
  try {
    return sessionStorage.getItem(FOCUS_AGENT_KEY);
  } catch {
    return null;
  }
}
