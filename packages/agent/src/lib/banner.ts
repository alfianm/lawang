import QRCode from "qrcode";
import { log } from "./logger";

// Render the QR using only ANSI background colors with plain spaces. This
// avoids relying on unicode block glyphs (which some terminals strip) or on
// foreground colors (which some terminals override).
//
// `size` controls how many character columns make up one QR module:
//   - "small": 1 column per module, 1 row per module (compact, slightly tall)
//   - "large": 2 columns per module, 1 row per module (square, easy to scan)
async function renderTerminalQr(text: string, size: "small" | "large"): Promise<string> {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const dim = qr.modules.size;
  const data = qr.modules.data;
  const padding = 2;

  const cellWidth = size === "large" ? 2 : 1;
  const cellSpace = " ".repeat(cellWidth);
  const WHITE = `\x1b[47m${cellSpace}\x1b[0m`;
  const BLACK = `\x1b[40m${cellSpace}\x1b[0m`;
  const lineWidth = dim + padding * 2;

  const lines: string[] = [];
  const blank = WHITE.repeat(lineWidth);
  for (let i = 0; i < padding; i++) lines.push(blank);
  for (let y = 0; y < dim; y++) {
    let line = WHITE.repeat(padding);
    for (let x = 0; x < dim; x++) {
      line += data[y * dim + x] ? BLACK : WHITE;
    }
    line += WHITE.repeat(padding);
    lines.push(line);
  }
  for (let i = 0; i < padding; i++) lines.push(blank);
  return lines.join("\n");
}

export async function printStartBanner(opts: {
  localUrl: string;
  lanUrl: string | null;
  tunnelUrl: string | null;
  pairUrl: string;
  qrPageUrl: string;
  pairingExpiresMin: number;
  rootPath: string;
  machineName: string;
  qrSize: "small" | "large" | "off";
}) {
  const lines = [
    "",
    log.paint("bold", "  Lawang started"),
    `  Machine     : ${opts.machineName}`,
    `  Project root: ${opts.rootPath}`,
    `  Local URL   : ${opts.localUrl}`,
    `  LAN URL     : ${opts.lanUrl || log.paint("yellow", "no LAN address detected")}`,
    `  Tunnel URL  : ${opts.tunnelUrl || log.paint("yellow", "not available (cloudflared missing)")}`,
    `  Pair URL    : ${log.paint("cyan", opts.pairUrl)}`,
    `  QR page     : ${log.paint("cyan", opts.qrPageUrl)}  (sharp full-screen QR in your laptop browser)`,
    `  Token TTL   : ${opts.pairingExpiresMin} minutes`,
    "",
  ];
  process.stdout.write(lines.join("\n") + "\n");

  if (opts.qrSize === "off") return;
  try {
    const block = await renderTerminalQr(opts.pairUrl, opts.qrSize);
    process.stdout.write(block + "\n\n");
  } catch (err) {
    process.stdout.write(`  (failed to render terminal QR: ${(err as Error).message})\n\n`);
  }
}
