import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------------ *
 * Every var() a stylesheet uses must resolve to something.
 *
 * A CSS custom property that is not defined fails SILENTLY: the browser drops
 * the declaration and the element renders with no background, or no accent, or
 * no border. Nothing logs. Nothing fails to build. The page just looks broken.
 *
 * That is exactly what happened: the shell palette was renamed, the view
 * stylesheets still referenced --panel, --accent, --bg and --hot, and the
 * Operator and Audit views lost their colours with every check still green.
 *
 * This test is the thing that would have caught it.
 * ------------------------------------------------------------------ */

const ROOT = join(import.meta.dirname);

const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });

const FILES = cssFiles(ROOT);

/** `--name:` at the start of a declaration - where a token is defined. */
const defined = (css: string): string[] =>
  [...css.matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]!);

/** `var(--name)` - where a token is used. */
const used = (css: string): string[] =>
  [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gim)].map((m) => m[1]!);

describe("css custom properties", () => {
  it("finds the stylesheets", () => {
    expect(FILES.length).toBeGreaterThan(3);
  });

  it("every var() used anywhere resolves to a definition somewhere", () => {
    /* Definitions are global across the bundle: the shell defines the palette,
       a view may define its own locals. What must never happen is a reference
       with no definition at all. */
    const allDefined = new Set(FILES.flatMap((f) => defined(readFileSync(f, "utf8"))));

    const dangling: string[] = [];
    for (const file of FILES) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      for (const token of new Set(used(readFileSync(file, "utf8")))) {
        if (!allDefined.has(token)) dangling.push(`${rel} uses ${token}`);
      }
    }

    expect(dangling, `undefined CSS variables:\n  ${dangling.join("\n  ")}`).toEqual([]);
  });

  it("the shell defines the palette the views are written against", () => {
    const shell = new Set(defined(readFileSync(join(ROOT, "ui.css"), "utf8")));
    /* Renaming any of these is a breaking change for at least one view. If you
       rename one, keep an alias and update this list in the same commit. */
    for (const token of [
      "--void",
      "--soot",
      "--crust",
      "--ink",
      "--muted",
      "--faint",
      "--line",
      "--ember",
      "--flame",
      "--seq",
      "--radius",
      "--mono",
      "--sans",
      // aliases the view stylesheets still use
      "--bg",
      "--panel",
      "--accent",
      "--hot",
    ]) {
      expect(shell.has(token), `ui.css must define ${token}`).toBe(true);
    }
  });
});
