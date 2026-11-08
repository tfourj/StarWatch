import path from "node:path";

/** Folder with the built frontend, also used for static assets such as the app icon. */
export function webDir() {
  return path.resolve(process.env.WEB_DIR ?? "dist/web");
}
