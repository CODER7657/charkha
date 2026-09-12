import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ *
 * Nothing projected may be typeset below the legibility floor.
 *
 * This project is watched from the back of a room through a projector, and
 * every view was authored on a monitor at arm's length. Measured against the
 * deployed host, Mesh had 70 text nodes under 11px and Provenance had 29 -
 * including the Real / Partial / Not attempted pills at 9px, the labels whose
 * entire purpose is to be read.
 *
 * Nobody noticed because on a monitor they are fine. That is the class of
 * defect this repository keeps producing: something that looks correct is never
 * asked a question that can return "no".
 *
 * This is a floor, not a design opinion. It cannot prove a thing is readable at
 * four metres - only a room can. It proves nobody has quietly dropped a label
 * back to 9px, which is the regression that would otherwise be found by a judge
 * rather than by us.
 * ------------------------------------------------------------------ */

const FLOOR_PX = 11;

/**
 * Surfaces that are NOT projected, and are therefore not held to the floor.
 *
 * An exemption needs a reason that is about viewing distance or ownership, not
 * about the size being inconvenient to change. Each one is a selector, so
 * exempting a rule does not exempt the rest of its file.
 */
const EXEMPT: Record<string, string> = {
  ".leaflet-control-attribution":
    "OpenStreetMap's required attribution. Third-party chrome, deliberately unobtrusive; enlarging it would be the wrong design, and it is not something anyone is asked to read from a room.",
  ".fc-langlabel":
    "Field view: a phone in a hand at ~30cm, not a projection at 4m. Verified on a real device (motorola edge 60 fusion, Chrome 151) in all four scripts.",
  ".field .fc-pill":
    "Field view, same reason. Held, not projected.",
};

const here = path.dirname(fileURLToPath(import.meta.url));

const stylesheets = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? stylesheets(path.join(dir, e.name))
      : e.name.endsWith(".css")
        ? [path.join(dir, e.name)]
        : [],
  );

const files = [...stylesheets(path.join(here, "views")), path.join(here, "ui.css")];

/** The selector a declaration sits under - the last line before it that opened a block. */
const undersizedIn = (css: string): Array<{ selector: string; decl: string }> => {
  const out: Array<{ selector: string; decl: string }> = [];
  let selector = "";
  for (const raw of css.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("*") || line.startsWith("/*")) continue;
    if (line.endsWith("{")) selector = line.slice(0, -1).trim();
    const m = /font-size:\s*([\d.]+)px/.exec(line);
    if (m && Number(m[1]) < FLOOR_PX) out.push({ selector, decl: line });
  }
  return out;
};

describe("nothing projected is typeset below the floor", () => {
  it("finds the stylesheets it is supposed to be checking", () => {
    // A glob that silently matches nothing is a green test that checks nothing.
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${path.basename(file)} declares no projected font-size under ${FLOOR_PX}px`, () => {
      const offenders = undersizedIn(readFileSync(file, "utf8")).filter(
        (o) => !Object.keys(EXEMPT).some((sel) => o.selector.includes(sel)),
      );
      expect(
        offenders.map((o) => `${o.selector} { ${o.decl} }`),
        `${path.basename(file)} has projected text below ${FLOOR_PX}px`,
      ).toEqual([]);
    });
  }

  /* An exemption list rots silently: a selector gets renamed, the entry stops
     matching anything, and the floor quietly widens. Every exemption must still
     correspond to a real undersized rule somewhere. */
  it("every exemption is still earning its place", () => {
    const all = files.flatMap((f) => undersizedIn(readFileSync(f, "utf8")));
    const dead = Object.keys(EXEMPT).filter((sel) => !all.some((o) => o.selector.includes(sel)));
    expect(dead, "exemptions that no longer match any rule - delete them").toEqual([]);
  });
});
