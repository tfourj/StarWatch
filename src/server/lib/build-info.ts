import pkg from "../../../package.json";

/** From package.json, bundled into the server at build time. */
export const VERSION: string = pkg.version;
