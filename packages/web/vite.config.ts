import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    // Monaco is lazy-loaded via dynamic import in FilesPanel; the warning
    // about chunks > 500 KB is misleading because that chunk is on-demand,
    // not part of the initial download.
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3999",
      "/health": "http://localhost:3999",
      "/ws": {
        target: "ws://localhost:3999",
        ws: true,
      },
    },
  },
});
