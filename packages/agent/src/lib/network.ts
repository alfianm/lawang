import os from "node:os";

// Pick the most likely LAN IPv4 address. Prefers en0/en1 style interfaces and
// non-virtual networks. Falls back to the first non-internal IPv4.
export function pickLanAddress(): string | null {
  const ifaces = os.networkInterfaces();
  const order = ["en0", "en1", "wlan0", "wlan1", "eth0", "eth1"];
  const seen: string[] = [];

  for (const name of order) {
    const list = ifaces[name];
    if (!list) continue;
    for (const a of list) {
      if (!a.internal && a.family === "IPv4" && !a.address.startsWith("169.254.")) {
        return a.address;
      }
    }
  }
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    if (/^(lo|bridge|utun|awdl|llw|gif|stf|vmnet|vboxnet|docker|tun|tap)/i.test(name)) continue;
    for (const a of list) {
      if (!a.internal && a.family === "IPv4" && !a.address.startsWith("169.254.")) {
        seen.push(a.address);
      }
    }
  }
  return seen[0] ?? null;
}
