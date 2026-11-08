import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { buildCommit } from "./src/server/lib/build-info";

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

/**
 * Writes /sw.js from web/sw.js with the built assets and public files to precache. The cache version is a hash of
 * their contents, so every build that changes the app installs a fresh cache.
 */
function serviceWorker(): Plugin {
  let publicDir = "";
  return {
    name: "starwatch-service-worker",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_, bundle) {
      const hash = createHash("sha256");
      const files: string[] = [];

      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName === "index.html") {
          hash.update(output.type === "asset" ? output.source : "");
          continue;
        }
        if (fileName.endsWith(".map") || fileName.startsWith("_")) continue;
        files.push(`/${fileName}`);
      }
      for (const entry of readdirSync(publicDir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || entry.name.startsWith("_")) continue;
        const file = path.join(entry.parentPath, entry.name);
        files.push(`/${path.relative(publicDir, file).split(path.sep).join("/")}`);
        hash.update(readFileSync(file));
      }

      files.sort();
      hash.update(files.join("\n"));
      const template = readFileSync(path.resolve(import.meta.dirname, "web/sw.js"), "utf8");
      const source = template
        .replace("__VERSION__", hash.digest("hex").slice(0, 12))
        .replace("__PRECACHE__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// `vite build --mode demo` builds a static demo with an in-browser fake API (see web/src/demo).
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  // Cloudflare Pages builds the demo from main and sets CF_PAGES_COMMIT_SHA, shown in place of the version unless
  // that commit is the release tag.
  const pagesCommit = process.env.CF_PAGES_COMMIT_SHA;
  const commit = demo && pagesCommit ? buildCommit({ STARWATCH_COMMIT: pagesCommit }, undefined, pkg.version) : null;
  return {
    root: "web",
    plugins: [react(), tailwindcss(), demo && spaRedirects(), serviceWorker()],
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
