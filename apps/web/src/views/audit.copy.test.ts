import { describe, expect, it, vi } from "vitest";
import { copyText } from "./AuditConsole.tsx";

/* ------------------------------------------------------------------ *
 * Copying, and knowing whether it happened.
 *
 * Reported from the deployed host as "nothing is copyable". The old code was
 *
 *   void navigator.clipboard?.writeText(value);
 *   setCopied(true);
 *
 * which claims success unconditionally: `?.` makes a missing clipboard a
 * no-op and `void` discards a rejection. Outside a secure context, or with an
 * unfocused document, the reader got a control that said "copied" and copied
 * nothing. The guarantee below is that we never again report a success we did
 * not have.
 * ------------------------------------------------------------------ */

describe("copyText", () => {
  it("uses the async clipboard when it works", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const legacy = vi.fn().mockReturnValue(true);
    await expect(copyText("match_abc", { write, legacy })).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith("match_abc");
    expect(legacy).not.toHaveBeenCalled();
  });

  /* Outside a secure context there is no clipboard at all - the case that
     produced the report. */
  it("falls back rather than claiming success when there is no clipboard", async () => {
    const legacy = vi.fn().mockReturnValue(true);
    await expect(copyText("match_abc", { legacy })).resolves.toBe(true);
    expect(legacy).toHaveBeenCalledWith("match_abc");
  });

  it("falls back when the clipboard rejects", async () => {
    const write = vi.fn().mockRejectedValue(new Error("document is not focused"));
    const legacy = vi.fn().mockReturnValue(true);
    await expect(copyText("match_abc", { write, legacy })).resolves.toBe(true);
    expect(legacy).toHaveBeenCalled();
  });

  /* THE guarantee. A reader told "copied" who then pastes nothing is worse
     off than one told to select the text by hand. */
  it("reports false when both paths fail", async () => {
    const write = vi.fn().mockRejectedValue(new Error("denied"));
    const legacy = vi.fn().mockReturnValue(false);
    await expect(copyText("match_abc", { write, legacy })).resolves.toBe(false);
  });

  it("reports false when the fallback throws", async () => {
    const legacy = vi.fn().mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(copyText("match_abc", { legacy })).resolves.toBe(false);
  });

  it("reports false when neither path exists at all", async () => {
    await expect(copyText("match_abc", { write: undefined, legacy: undefined })).resolves.toBe(false);
  });

  it("never throws at the caller", async () => {
    const write = vi.fn().mockRejectedValue(new Error("x"));
    const legacy = vi.fn().mockImplementation(() => {
      throw new Error("y");
    });
    await expect(copyText("v", { write, legacy })).resolves.toBe(false);
  });
});
