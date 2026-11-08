import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8")) as {
  version: string;
};

/** Cloudflare Pages: serve index.html for every path so client-side routes work on reload. */
function spaRedirects(): Plugin {
  return {
    name: "starwatch-spa-redirects",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_redirects", source: "/* /index.html 200\n" });
    },
  };
}

// `vite build --mode demo` builds a static demo with an in-browser fake API (see web/src/demo).
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  // Cloudflare Pages builds the demo from main and sets CF_PAGES_COMMIT_SHA, shown in place of the version.
  const commit = (demo && process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7)) || null;
  return {
    root: "web",
    plugins: [react(), tailwindcss(), demo && spaRedirects()],
    define: {
      __DEMO__: JSON.stringify(demo),
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_COMMIT__: JSON.stringify(commit),
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "web/src"),
        "@shared": path.resolve(import.meta.dirname, "src/shared"),
      },
    },
    build: {
      outDir: demo ? "../dist/demo" : "../dist/web",
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
  };
});
