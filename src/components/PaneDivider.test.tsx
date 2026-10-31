// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, RefObject } from "react";
import { PaneDivider } from "./PaneDivider";

const RECT = { left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function containerRef(): RefObject<HTMLDivElement | null> {
  const container = document.createElement("div");
  container.getBoundingClientRect = () => RECT;
  return { current: container };
}

function renderDivider(overrides: Partial<ComponentProps<typeof PaneDivider>> = {}) {
  const onRatioChange = vi.fn();
  const onReset = vi.fn();
  const props = {
    ratio: 0.5,
    minRatio: 0.2,
    maxRatio: 0.8,
    hitAreaWidth: 14,
    containerRef: containerRef(),
    onRatioChange,
    onReset,
    ...overrides,
  };
  const view = render(<PaneDivider {...props} />);
  return { ...view, onRatioChange, onReset, props };
}

afterEach(() => {
  cleanup();
  document.body.classList.remove("resizing-panes");
});

describe("PaneDivider rendering", () => {
  it("exposes separator semantics and a slim visible line inside a wider target", () => {
    renderDivider();
    const divider = screen.getByRole("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    expect(divider.getAttribute("aria-valuemin")).toBe("20");
    expect(divider.getAttribute("aria-valuemax")).toBe("80");
    expect(divider.getAttribute("aria-valuenow")).toBe("50");
    expect(divider.getAttribute("aria-valuetext")).toBe("50% left pane, 50% right pane");
    expect(divider.getAttribute("tabindex")).toBe("0");
    // The visible line is a child; the root is the interactive hit area.
    expect(divider.querySelector(".pane-divider-line")).not.toBeNull();
    expect(divider.querySelectorAll(".pane-divider-grip i")).toHaveLength(3);
    expect(divider.style.getPropertyValue("--pane-divider-hit-area")).toBe("14px");
  });

  it("is not focusable when disabled", () => {
    renderDivider({ disabled: true });
    const divider = screen.getByRole("separator");
    expect(divider.getAttribute("tabindex")).toBe("-1");
    expect(divider.getAttribute("aria-disabled")).toBe("true");
  });

  it("updates the accessible value with the current ratio", () => {
    const { rerender, props } = renderDivider();
    rerender(<PaneDivider {...props} ratio={0.65} />);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("65");
  });
});

describe("PaneDivider pointer interaction", () => {
  it("enters a visible dragging state and cleans up on pointer up", () => {
    const { onRatioChange } = renderDivider();
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 });
    expect(divider.classList.contains("is-dragging")).toBe(true);
    expect(document.body.classList.contains("resizing-panes")).toBe(true);

    fireEvent.pointerMove(window, { clientX: 700, pointerId: 1 });
    expect(onRatioChange).toHaveBeenCalled();
    const ratio = onRatioChange.mock.calls.at(-1)?.[0] as number;
    expect(ratio).toBeCloseTo((700 - 7) / 986, 4);

    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(divider.classList.contains("is-dragging")).toBe(false);
    expect(document.body.classList.contains("resizing-panes")).toBe(false);
    onRatioChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
    expect(onRatioChange).not.toHaveBeenCalled();
  });

  it("keeps dragging when the pointer leaves the divider", () => {
    const { onRatioChange } = renderDivider();
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 900, pointerId: 1 });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.8);
    fireEvent.pointerMove(window, { clientX: 50, pointerId: 1 });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.2);
  });

  it("cleans up on pointer cancellation", () => {
    const { onRatioChange } = renderDivider();
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(divider.classList.contains("is-dragging")).toBe(false);
    expect(document.body.classList.contains("resizing-panes")).toBe(false);
    onRatioChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 700, pointerId: 1 });
    expect(onRatioChange).not.toHaveBeenCalled();
  });

  it("ignores secondary buttons and a disabled divider", () => {
    const { onRatioChange } = renderDivider();
    fireEvent.pointerDown(screen.getByRole("separator"), { button: 2, clientX: 500 });
    expect(document.body.classList.contains("resizing-panes")).toBe(false);
    cleanup();

    const disabled = renderDivider({ disabled: true });
    fireEvent.pointerDown(screen.getByRole("separator"), { button: 0, clientX: 500 });
    expect(document.body.classList.contains("resizing-panes")).toBe(false);
    expect(disabled.onRatioChange).not.toHaveBeenCalled();
  });

  it("removes window listeners when unmounted mid-drag", () => {
    const { unmount, onRatioChange } = renderDivider();
    fireEvent.pointerDown(screen.getByRole("separator"), { button: 0, clientX: 500, pointerId: 1 });
    unmount();
    expect(document.body.classList.contains("resizing-panes")).toBe(false);
    onRatioChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 900, pointerId: 1 });
    expect(onRatioChange).not.toHaveBeenCalled();
  });
});

describe("PaneDivider keyboard interaction", () => {
  it("resizes with arrow keys, a larger step with Shift, and resets", () => {
    const { onRatioChange, onReset } = renderDivider();
    const divider = screen.getByRole("separator");

    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.47);

    fireEvent.keyDown(divider, { key: "ArrowRight", shiftKey: true });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.6);

    fireEvent.keyDown(divider, { key: "Home" });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.2);

    fireEvent.keyDown(divider, { key: "End" });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.8);

    fireEvent.keyDown(divider, { key: "Enter" });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("does not emit changes for unrelated keys", () => {
    const { onRatioChange } = renderDivider();
    fireEvent.keyDown(screen.getByRole("separator"), { key: "a" });
    expect(onRatioChange).not.toHaveBeenCalled();
  });

  it("resets on double click", () => {
    const { onReset } = renderDivider();
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
