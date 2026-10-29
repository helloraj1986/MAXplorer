/**
 * Shared Vitest setup. React component tests run in jsdom; the small polyfills
 * below cover browser APIs that jsdom does not implement by default.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof window !== "undefined") {
  (window as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverMock,
    configurable: true,
  });
}

if (typeof globalThis.PointerEvent === "undefined" && typeof MouseEvent !== "undefined") {
  globalThis.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
}

if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null;
}
