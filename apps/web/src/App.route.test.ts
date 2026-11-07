import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------------ *
 * The hash router, as pure predicates.
 *
 * The component reads window.location.hash in two places - once at mount and
 * once per hashchange - and both have to agree on what counts as a view, or
 * a deep link opens a screen the Back button then refuses to return to.
 * ------------------------------------------------------------------ */

const VIEW_IDS = ["mesh", "operator", "audit", "field", "saathi", "breakit", "provenance"] as const;

const viewFromHash = (hash: string): string | null => {
  const h = hash.replace("#", "");
  return (VIEW_IDS as readonly string[]).includes(h) ? h : null;
};

describe("hash routing", () => {
  it.each(VIEW_IDS)("resolves #%s", (id) => {
    expect(viewFromHash(`#${id}`)).toBe(id);
  });

  /* The phone opens straight onto the field view - DEPLOY.md documents
     /#field, so if this one ever stops resolving the deploy doc is wrong. */
  it("resolves the documented phone deep link", () => {
    expect(viewFromHash("#field")).toBe("field");
  });

  it.each(["", "#", "#nope", "#Operator", "#field?x=1", "#/field"])(
    "refuses %o rather than rendering a blank shell",
    (hash) => {
      expect(viewFromHash(hash)).toBeNull();
    },
  );

  /* Every id in the list must be a legal fragment, or the URL the app writes
     back is not the URL it can read. */
  it.each(VIEW_IDS)("%s round-trips through encodeURIComponent", (id) => {
    expect(encodeURIComponent(id)).toBe(id);
  });
});
