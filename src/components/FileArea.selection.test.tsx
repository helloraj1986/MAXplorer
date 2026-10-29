// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { FileArea } from "./FileArea";
import { useExplorerStore } from "../state/explorerStore";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { createPane } from "../lib/panes";
import { getFileDragState } from "../state/fileDrag";
import type { FileEntry, InterfaceTheme, PaneId } from "../lib/types";

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame;
}

function entry(name: string, isDir = false): FileEntry {
  return {
    name,
    path: `/tmp/folder/${name}`,
    isDir,
    isSymlink: false,
    size: isDir ? null : 10,
    modified: null,
    created: null,
    accessed: null,
    extension: null,
    isHidden: false,
    isReadOnly: false,
    target: null,
  };
}

const a = entry("alpha.txt");
const b = entry("bravo.txt");
const c = entry("charlie.txt");
const folder = entry("Projects", true);

function setup(interfaceTheme: InterfaceTheme = "windows") {
  const pane = createPane("/tmp/folder");
  const tab = pane.tabs[0];
  const id: PaneId = "left";
  useExplorerStore.setState({
    platform: {
      platform: "macos",
      home: "/Users/test",
      pathSeparator: "/",
      modifier: "cmd",
      computerLabel: "This Mac",
    },
    panes: {
      left: {
        ...pane,
        viewMode: "details",
        tabs: [
          {
            ...tab,
            location: "/tmp/folder",
            listingFor: "/tmp/folder",
            entries: [a, b, c, folder],
            loading: false,
            selection: [],
            anchorPath: null,
          },
        ],
      },
      right: createPane("/tmp/other"),
    },
    activePane: id,
    interfaceTheme,
    contextMenu: null,
    dialog: null,
    clipboard: null,
    dualPane: false,
    detailsPane: false,
    previewPane: false,
  });
  return id;
}

function currentSelection(id: PaneId = "left"): string[] {
  return useExplorerStore.getState().activeTab(id).selection;
}

function row(container: HTMLElement, value: FileEntry): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-path="${value.path}"]`);
  if (!element) throw new Error(`Missing row for ${value.name}`);
  return element;
}

function pressRow(element: HTMLElement, init: Record<string, unknown> = {}) {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, ...init });
  fireEvent.pointerUp(window, { button: 0, pointerId: 1 });
}

function pressRowWithoutRelease(element: HTMLElement, init: Record<string, unknown> = {}) {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, ...init });
}

function scrollPane(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".file-scroll");
  if (!element) throw new Error("Missing file list");
  return element;
}

function mockRect(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function prepareMarquee(container: HTMLElement): HTMLElement {
  const scroll = scrollPane(container);
  Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 600 });
  mockRect(scroll, 0, 0, 800, 600);
  mockRect(row(container, folder), 0, 0, 800, 31);
  mockRect(row(container, a), 0, 31, 800, 31);
  mockRect(row(container, b), 0, 62, 800, 31);
  mockRect(row(container, c), 0, 93, 800, 31);
  return scroll;
}

async function marquee(
  container: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const scroll = prepareMarquee(container);
  fireEvent.pointerDown(scroll, {
    button: 0,
    pointerId: 7,
    clientX: from.x,
    clientY: from.y,
  });
  await act(async () => {
    fireEvent.pointerMove(window, { pointerId: 7, clientX: to.x, clientY: to.y });
    // Let the animation-frame update commit while act() is still active.
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  fireEvent.pointerUp(window, {
    pointerId: 7,
    clientX: to.x,
    clientY: to.y,
  });
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  cleanup();
});

describe("file list selection", () => {
  it("selects a single file when clicked", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    fireEvent.click(row(container, a), { button: 0 });
    expect(currentSelection()).toEqual([a.path]);
  });

  it("Ctrl+click adds and then removes items without clearing the rest", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    pressRow(row(container, b), { ctrlKey: true });
    fireEvent.click(row(container, b), { button: 0, ctrlKey: true });
    expect(currentSelection()).toEqual([a.path, b.path]);

    pressRow(row(container, c), { ctrlKey: true });
    fireEvent.click(row(container, c), { button: 0, ctrlKey: true });
    expect(currentSelection()).toEqual([a.path, b.path, c.path]);

    pressRow(row(container, b), { ctrlKey: true });
    fireEvent.click(row(container, b), { button: 0, ctrlKey: true });
    expect(currentSelection()).toEqual([a.path, c.path]);
  });

  it("Ctrl+click does not open a context menu in Windows mode", () => {
    const { container } = render(<FileArea />);
    pressRowWithoutRelease(row(container, a), { ctrlKey: true });
    fireEvent.contextMenu(row(container, a), { button: 0, ctrlKey: true });
    fireEvent.click(row(container, a), { button: 0, ctrlKey: true });
    fireEvent.pointerUp(window, { button: 0, pointerId: 1 });
    expect(useExplorerStore.getState().contextMenu).toBeNull();
    expect(currentSelection()).toEqual([a.path]);
  });

  it("selects a contiguous Shift+click range in display order", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, folder));
    fireEvent.click(row(container, folder), { button: 0 });
    pressRow(row(container, c), { shiftKey: true });
    // Folders sort first: Projects, alpha.txt, bravo.txt, charlie.txt.
    expect(currentSelection()).toEqual([folder.path, a.path, b.path, c.path]);
  });

  it("selects a Shift+click range in reverse order", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, c));
    fireEvent.click(row(container, c), { button: 0 });
    pressRow(row(container, folder), { shiftKey: true });
    expect(currentSelection()).toEqual([folder.path, a.path, b.path, c.path]);
  });

  it("does not navigate when a marquee starts on empty space", async () => {
    const { container } = render(<FileArea />);
    await marquee(container, { x: 5, y: 4 }, { x: 300, y: 60 });
    expect(useExplorerStore.getState().activeTab("left").location).toBe("/tmp/folder");
    expect(currentSelection()).toEqual([folder.path, a.path]);
  });

  it("keeps a marquee selection after the trailing click", async () => {
    const { container } = render(<FileArea />);
    await marquee(container, { x: 5, y: 4 }, { x: 300, y: 60 });
    const before = currentSelection();
    expect(before).toEqual([folder.path, a.path]);
    fireEvent.click(scrollPane(container), { button: 0 });
    expect(currentSelection()).toEqual(before);
  });

  it("selects in the reverse drag direction", async () => {
    const { container } = render(<FileArea />);
    await marquee(container, { x: 300, y: 130 }, { x: 5, y: 4 });
    expect(currentSelection()).toEqual([folder.path, a.path, b.path, c.path]);
  });

  it("preserves multi-selection when right-clicking a selected item", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    pressRow(row(container, b), { ctrlKey: true });
    fireEvent.contextMenu(row(container, b), { button: 2 });
    expect(currentSelection()).toEqual([a.path, b.path]);
    expect(useExplorerStore.getState().contextMenu?.kind).toBe("item");
  });

  it("selects an unselected item before opening its context menu", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    fireEvent.contextMenu(row(container, b), { button: 2 });
    expect(currentSelection()).toEqual([b.path]);
    const menu = useExplorerStore.getState().contextMenu;
    expect(menu?.kind === "item" ? menu.path : null).toBe(b.path);
  });

  it("passes the full selected set to context-menu bulk actions", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    pressRow(row(container, b), { ctrlKey: true });
    fireEvent.contextMenu(row(container, b), { button: 2 });
    expect(useExplorerStore.getState().contextMenu?.kind).toBe("item");
    expect(
      useExplorerStore.getState().selectedEntries("left").map((item) => item.path),
    ).toEqual([a.path, b.path]);
  });

  it("keeps the selection when switching from details to list view", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    pressRow(row(container, b), { ctrlKey: true });
    act(() => {
      useExplorerStore.getState().setViewMode("list", "left");
    });
    expect(currentSelection()).toEqual([a.path, b.path]);
    const listRows = container.querySelectorAll('[data-path][aria-selected="true"]');
    expect(listRows).toHaveLength(2);
  });

  it("keeps the selection when the listing is scrolled", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    pressRow(row(container, b), { ctrlKey: true });
    const scroll = scrollPane(container);
    scroll.scrollTop = 120;
    fireEvent.scroll(scroll);
    expect(currentSelection()).toEqual([a.path, b.path]);
    expect(row(container, a).getAttribute("aria-selected")).toBe("true");
    expect(row(container, b).getAttribute("aria-selected")).toBe("true");
  });

  it("updates selected styling in light and dark appearances", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    act(() => {
      useExplorerStore.getState().setTheme("light");
    });
    expect(row(container, a).classList.contains("selected")).toBe(true);
    act(() => {
      useExplorerStore.getState().setTheme("dark");
    });
    expect(row(container, a).classList.contains("selected")).toBe(true);
    expect(row(container, a).getAttribute("aria-selected")).toBe("true");
  });

  it("starts a drag with the whole existing selection", () => {
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    pressRow(row(container, b), { ctrlKey: true });
    pressRowWithoutRelease(row(container, a));
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(getFileDragState()?.payload.paths).toEqual([a.path, b.path]);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 20 });
  });

  it("uses Command-click for Finder mode and keeps Ctrl+click as a context menu", () => {
    setup("finder");
    const { container } = render(<FileArea />);
    pressRow(row(container, a));
    pressRow(row(container, b), { ctrlKey: true });
    // Finder keeps the macOS Control-click secondary-click convention.
    fireEvent.contextMenu(row(container, b), { button: 0, ctrlKey: true });
    expect(useExplorerStore.getState().contextMenu?.kind).toBe("item");
    expect(currentSelection()).toEqual([b.path]);

    useExplorerStore.getState().hideContextMenu();
    pressRow(row(container, a));
    pressRow(row(container, c), { metaKey: true });
    fireEvent.click(row(container, c), { button: 0, metaKey: true });
    expect(currentSelection()).toEqual([a.path, c.path]);
  });
});

function ShortcutHarness() {
  useKeyboardShortcuts();
  return null;
}

describe("selection keyboard shortcuts", () => {
  it("selects all with Ctrl+A in Windows mode", () => {
    setup("windows");
    render(<ShortcutHarness />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(currentSelection()).toEqual([folder.path, a.path, b.path, c.path]);
  });

  it("selects all with Command+A in Finder mode", () => {
    setup("finder");
    render(<ShortcutHarness />);
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    expect(currentSelection()).toEqual([folder.path, a.path, b.path, c.path]);
  });

  it("clears selection with Escape", () => {
    setup("windows");
    useExplorerStore.getState().setSelection([a.path], a.path, "left");
    render(<ShortcutHarness />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(currentSelection()).toEqual([]);
  });
});
