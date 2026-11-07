import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/* ------------------------------------------------------------------ *
 * Load the repo-root .env, whatever directory the process started in.
 *
 * `import "dotenv/config"` resolves .env against process.cwd(), and every
 * agent starts with its own package directory as cwd (`pnpm -F ... dev`),
 * so in local dev nothing was ever loaded - not REGISTRY_DID_SEED, not
 * A2A_JWT_SECRET, not FIRMS_MAP_KEY. Docker hid it by passing env_file.
 *
 * Call this at the top of an entrypoint, before anything reads process.env.
 * ------------------------------------------------------------------ */

/** Walk up from this file to the workspace root, which is where .env lives. */
const workspaceRoot = (): string | null => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

export const loadEnv = (): void => {
  const root = workspaceRoot();
  // A real environment (docker, CI) already has its variables set; dotenv
  // never overwrites those, so this is safe to call unconditionally.
  config(root ? { path: path.join(root, ".env"), quiet: true } : { quiet: true });
};
