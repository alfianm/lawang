export function detectDevice(): { name: string; type: "mobile" | "desktop" | "unknown" } {
  const ua = navigator.userAgent || "";
  let type: "mobile" | "desktop" | "unknown" = "unknown";
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) type = "mobile";
  else if (ua) type = "desktop";

  let name = "Browser";
  if (/iPhone/i.test(ua)) name = "iPhone Safari";
  else if (/iPad/i.test(ua)) name = "iPad Safari";
  else if (/Android/i.test(ua)) {
    name = /Chrome\//i.test(ua) ? "Android Chrome" : "Android browser";
  } else if (/Edg\//i.test(ua)) name = "Edge";
  else if (/Chrome\//i.test(ua)) name = "Chrome";
  else if (/Firefox\//i.test(ua)) name = "Firefox";
  else if (/Safari\//i.test(ua)) name = "Safari";

  const platform = (navigator.platform || "").trim();
  if (platform && type === "desktop") name = `${name} • ${platform}`;
  return { name, type };
}

const FINGERPRINT_KEY = "lawang:device-fingerprint";

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignored
  }
  // Fallback for older browsers.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getOrCreateDeviceFingerprint(): string {
  try {
    const existing = localStorage.getItem(FINGERPRINT_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = randomId();
    localStorage.setItem(FINGERPRINT_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (e.g. private mode); fall back to per-tab id.
    return randomId();
  }
}
