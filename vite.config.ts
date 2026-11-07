import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "web/src"),
      "@shared": path.resolve(import.meta.dirname, "src/shared"),
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // The app imports CHANGELOG.md and src/shared from outside the web/ root.
    fs: { allow: [".."] },
    proxy: {
      "/api": { target: "http://localhost:4321", changeOrigin: false },
    },
  },
});
