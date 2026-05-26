/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', '"SF Mono"', "ui-monospace", "monospace"],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        bg: "#0b0d10",
        panel: "#11151b",
        line: "#1e242c",
        ink: "#e6edf3",
        muted: "#8b949e",
        accent: "#7cc4ff",
        warn: "#f4b350",
        danger: "#ff6b6b",
        ok: "#4ade80",
      },
    },
  },
  plugins: [],
};
