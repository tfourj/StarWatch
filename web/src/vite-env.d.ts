/// <reference types="vite/client" />

/** True in the static demo build (`vite build --mode demo`). */
declare const __DEMO__: boolean;
/** Version from package.json. */
declare const __APP_VERSION__: string;
/** Short commit for demo builds that are not a stable release. */
declare const __APP_COMMIT__: string | null;
/** Commits since the newest stable release for demo builds that are not a stable release. */
declare const __APP_AHEAD__: { release: string; commits: number } | null;
