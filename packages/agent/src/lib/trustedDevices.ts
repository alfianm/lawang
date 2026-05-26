import crypto from "node:crypto";
import { AgentConfig, TrustedDevice, saveConfig } from "./config";
import { hash, safeEqual } from "./tokens";
import { recordEvent } from "./audit";

export interface TrustMatch {
  device: TrustedDevice;
}

export class TrustedDeviceStore {
  constructor(private cfg: AgentConfig) {}

  list(): TrustedDevice[] {
    return [...this.cfg.trustedDevices];
  }

  active(): TrustedDevice[] {
    return this.cfg.trustedDevices.filter((d) => !d.revokedAt);
  }

  match(rawFingerprint: string | null | undefined): TrustMatch | null {
    if (!rawFingerprint) return null;
    const h = hash(rawFingerprint);
    for (const d of this.cfg.trustedDevices) {
      if (d.revokedAt) continue;
      if (safeEqual(d.fingerprintHash, h)) return { device: d };
    }
    return null;
  }

  async upsert(opts: { name: string; rawFingerprint: string; preset?: "full" | "files" | "terminal" }): Promise<TrustedDevice> {
    if (!opts.rawFingerprint) {
      throw new Error("fingerprint_required");
    }
    const h = hash(opts.rawFingerprint);
    const now = new Date().toISOString();
    const existing = this.cfg.trustedDevices.find((d) => safeEqual(d.fingerprintHash, h));
    if (existing) {
      existing.name = opts.name || existing.name;
      existing.lastUsedAt = now;
      existing.revokedAt = null;
      if (opts.preset) existing.preset = opts.preset;
      await saveConfig(this.cfg);
      recordEvent("trusted_device_added", {
        deviceName: existing.name,
        metadata: { deviceId: existing.deviceId, reused: true, preset: existing.preset },
      });
      return existing;
    }
    const device: TrustedDevice = {
      deviceId: crypto.randomUUID(),
      name: opts.name || "Unknown device",
      fingerprintHash: h,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
      preset: opts.preset,
    };
    this.cfg.trustedDevices.push(device);
    await saveConfig(this.cfg);
    recordEvent("trusted_device_added", {
      deviceName: device.name,
      metadata: { deviceId: device.deviceId, reused: false, preset: device.preset },
    });
    return device;
  }

  async touch(deviceId: string): Promise<void> {
    const d = this.cfg.trustedDevices.find((x) => x.deviceId === deviceId);
    if (!d) return;
    d.lastUsedAt = new Date().toISOString();
    await saveConfig(this.cfg);
  }

  async revoke(deviceId: string): Promise<TrustedDevice | null> {
    const d = this.cfg.trustedDevices.find((x) => x.deviceId === deviceId);
    if (!d) return null;
    if (d.revokedAt) return d;
    d.revokedAt = new Date().toISOString();
    await saveConfig(this.cfg);
    recordEvent("trusted_device_revoked", {
      deviceName: d.name,
      metadata: { deviceId: d.deviceId },
    });
    return d;
  }

  findById(deviceId: string): TrustedDevice | undefined {
    return this.cfg.trustedDevices.find((d) => d.deviceId === deviceId);
  }
}
