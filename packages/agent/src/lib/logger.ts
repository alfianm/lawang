import { stdout } from "node:process";

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function paint(color: keyof typeof colors, text: string) {
  if (!stdout.isTTY) return text;
  return colors[color] + text + colors.reset;
}

export const log = {
  info(msg: string) {
    process.stdout.write(`${paint("dim", ts())} ${paint("cyan", "info")}  ${msg}\n`);
  },
  success(msg: string) {
    process.stdout.write(`${paint("dim", ts())} ${paint("green", "ok")}    ${msg}\n`);
  },
  warn(msg: string) {
    process.stdout.write(`${paint("dim", ts())} ${paint("yellow", "warn")}  ${msg}\n`);
  },
  error(msg: string) {
    process.stderr.write(`${paint("dim", ts())} ${paint("red", "error")} ${msg}\n`);
  },
  raw(msg: string) {
    process.stdout.write(msg);
  },
  paint,
};
