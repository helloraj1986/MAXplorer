import { describe, expect, it } from "vitest";
import { cacheSummary, formatSpeed } from "./PlayerOverlay";

/**
 * The buffering indicator can't live over the video stage (the native libmpv
 * surface covers it), so the state is rendered in the player header. These are
 * the formatting rules behind that pill.
 */
describe("formatSpeed", () => {
  it("scales bytes/second into human units", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(800)).toBe("800 B/s");
    expect(formatSpeed(1536)).toBe("1.5 KB/s");
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe("2.5 MB/s");
    expect(formatSpeed(12 * 1024 * 1024)).toBe("12 MB/s");
  });

  it("treats missing or negative values as zero", () => {
    expect(formatSpeed(Number.NaN)).toBe("0 B/s");
    expect(formatSpeed(-4)).toBe("0 B/s");
  });
});

describe("cacheSummary", () => {
  it("combines cache fill and arrival rate", () => {
    expect(cacheSummary(42.4, 1.5 * 1024 * 1024)).toBe("42% · 1.5 MB/s");
  });

  it("clamps the percentage into 0-100", () => {
    expect(cacheSummary(-5, 0)).toBe("0% · 0 B/s");
    expect(cacheSummary(180, 0)).toBe("100% · 0 B/s");
  });
});