import readline from "node:readline";
import { log } from "./logger";
import { PairingRequest, Permission } from "./tokens";

type Decision = "approved" | "rejected";

export type PermissionPreset = "full" | "files" | "terminal";

const PRESET_PERMISSIONS: Record<PermissionPreset, Permission[]> = {
  full: ["terminal", "file:read", "file:write", "git:read", "git:write", "screen:view", "screen:control"],
  files: ["terminal", "file:read", "git:read", "screen:view"],
  terminal: ["terminal"],
};

export function permissionsForPreset(preset: PermissionPreset): Permission[] {
  return [...PRESET_PERMISSIONS[preset]];
}

export interface ApprovalAnswer {
  decision: Decision;
  trust: boolean;
  preset: PermissionPreset;
  permissions: Permission[];
}

let queue: Promise<void> = Promise.resolve();

const REJECTED: ApprovalAnswer = {
  decision: "rejected",
  trust: false,
  preset: "full",
  permissions: permissionsForPreset("full"),
};

export function askApproval(
  req: PairingRequest,
  opts: { canTrust: boolean } = { canTrust: false }
): Promise<ApprovalAnswer> {
  let resolveOuter: (v: ApprovalAnswer) => void = () => undefined;
  const decision = new Promise<ApprovalAnswer>((r) => (resolveOuter = r));

  queue = queue.then(
    () =>
      new Promise<void>((done) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const banner = [
          "",
          log.paint("yellow", "─── Pairing request ───────────────────────────────"),
          `  Device   : ${log.paint("bold", req.deviceName)}`,
          `  Type     : ${req.deviceType}`,
          `  Remote   : ${req.remoteAddr}`,
          `  Agent    : ${(req.userAgent || "").slice(0, 80)}`,
          `  Fingerprint : ${req.fingerprint ? log.paint("bold", "present") : log.paint("yellow", "absent")}`,
          log.paint("yellow", "──────────────────────────────────────────────────"),
          "",
        ].join("\n");
        process.stdout.write(banner + "\n");

        rl.question("Approve this device? [y/N] ", (answer) => {
          const trimmed = (answer || "").trim().toLowerCase();
          const ok = trimmed === "y" || trimmed === "yes";
          if (!ok) {
            rl.close();
            resolveOuter(REJECTED);
            done();
            return;
          }

          process.stdout.write([
            "",
            log.paint("dim", "  Permission scope:"),
            "    1) Full access  — terminal + files (rw) + git (rw) + desktop control  [default]",
            "    2) Read-only    — terminal + file:read + git:read + desktop view",
            "    3) Terminal     — only shell access",
            "",
          ].join("\n"));

          rl.question("Select scope [1/2/3] ", (scopeAnswer) => {
            const choice = (scopeAnswer || "").trim();
            const preset: PermissionPreset =
              choice === "2" ? "files" :
              choice === "3" ? "terminal" :
              "full";

            const finalize = (trust: boolean) => {
              rl.close();
              resolveOuter({
                decision: "approved",
                trust,
                preset,
                permissions: permissionsForPreset(preset),
              });
              done();
            };

            if (!opts.canTrust) {
              finalize(false);
              return;
            }
            rl.question("Trust this device for future sessions (skip approval)? [y/N] ", (trustAnswer) => {
              const t = (trustAnswer || "").trim().toLowerCase();
              finalize(t === "y" || t === "yes");
            });
          });
        });
      })
  );

  return decision;
}
