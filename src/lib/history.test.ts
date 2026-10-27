import { describe, expect, it } from "vitest";
import { backHistory, canGoBack, canGoForward, forwardHistory, pushHistory } from "./history";

describe("history", () => {
  it("preserves back and forward entries", () => {
    const start = pushHistory(["/a"], 0, "/b");
    expect(start.history).toEqual(["/a", "/b"]);
    expect(start.index).toBe(1);
    const back = backHistory(start.history, start.index)!;
    expect(back.index).toBe(0);
    expect(canGoBack(back.history, back.index)).toBe(false);
    expect(canGoForward(back.history, back.index)).toBe(true);
    const forward = forwardHistory(back.history, back.index)!;
    expect(forward.index).toBe(1);
  });

  it("truncates forward history after a new navigation", () => {
    const first = pushHistory(["/a"], 0, "/b");
    const back = backHistory(first.history, first.index)!;
    const next = pushHistory(back.history, back.index, "/c");
    expect(next.history).toEqual(["/a", "/c"]);
    expect(next.index).toBe(1);
  });

  it("does not duplicate the current location", () => {
    const next = pushHistory(["/a", "/b"], 1, "/b");
    expect(next.history).toEqual(["/a", "/b"]);
    expect(next.index).toBe(1);
  });

  it("bounds history length", () => {
    let history = ["/0"];
    for (let index = 1; index < 120; index += 1) {
      history = pushHistory(history, index - 1, `/${index}`, 100).history;
    }
    expect(history).toHaveLength(100);
  });
});
