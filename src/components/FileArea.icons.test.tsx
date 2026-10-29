// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { FileArea } from "./FileArea";
import { useExplorerStore } from "../state/explorerStore";
import { createPane } from "../lib/panes";
import type { FileEntry, InterfaceTheme, PaneId, ViewMode } from "../lib/types";

function entry(name: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    path: `/tmp/folder/${name}`,
    isDir: false,
    isSymlink: false,
    size: 10,
    modified: null,
    created: null,
    accessed: null,
    extension: name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? null : null,
    isHidden: false,
    isReadOnly: false,
    target: null,
    ...overrides,
  };
}

const entries = [
  entry("Projects", { isDir: true, extension: null }),
  entry("Report.pdf"),
  entry("photo.png"),
  entry("notes.txt"),
  entry("archive.tar.gz"),
  entry("mystery"),
];

function setup(viewMode: ViewMode, interfaceTheme: InterfaceTheme = "windows") {
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
        viewMode,
        tabs: [
          {
            ...tab,
            location: "/tmp/folder",
            listingFor: "/tmp/folder",
            entries,
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

beforeEach(() => {
  setup("details");
});

afterEach(cleanup);

describe("FileArea icon rendering", () => {
  it("renders registry artwork in details view", () => {
    const { container } = render(<FileArea />);
    expect(container.querySelector('[data-file-kind="pdf"]')).toBeTruthy();
    expect(container.querySelector('[data-file-kind="image"]')).toBeTruthy();
    expect(container.querySelector('[data-file-kind="archive"]')).toBeTruthy();
    expect(container.querySelector('[data-file-kind="unknown"]')).toBeTruthy();
    expect(container.querySelector("[data-folder-theme]")).toBeTruthy();
  });

  it("renders registry artwork in list view", () => {
    setup("list");
    const { container } = render(<FileArea />);
    expect(container.querySelector(".list-row")).toBeTruthy();
    expect(container.querySelector('[data-file-kind="pdf"]')).toBeTruthy();
    expect(container.querySelector("[data-folder-theme]")).toBeTruthy();
  });

  it("renders registry artwork in grid and tile views", () => {
    setup("large");
    const first = render(<FileArea />);
    expect(first.container.querySelector(".grid-item")).toBeTruthy();
    expect(first.container.querySelector("[data-folder-theme], [data-file-kind]")).toBeTruthy();
    cleanup();

    setup("tiles");
    const second = render(<FileArea />);
    expect(second.container.querySelector(".grid-item.tiles")).toBeTruthy();
    expect(second.container.querySelector("[data-folder-theme], [data-file-kind]")).toBeTruthy();
  });

  it("keeps file artwork present in both interface themes", () => {
    const windows = render(<FileArea />);
    expect(windows.container.querySelector('[data-folder-theme="windows"]')).toBeTruthy();
    cleanup();

    setup("details", "finder");
    const finder = render(<FileArea />);
    expect(finder.container.querySelector('[data-folder-theme="finder"]')).toBeTruthy();
    expect(finder.container.querySelector('[data-file-kind="pdf"]')).toBeTruthy();
  });

  it("does not change the listing when the theme changes", () => {
    const { container } = render(<FileArea />);
    const before = container.querySelectorAll("[data-path]").length;
    act(() => {
      useExplorerStore.getState().setInterfaceTheme("finder");
    });
    expect(container.querySelectorAll("[data-path]").length).toBe(before);
    expect(container.querySelector('[data-folder-theme="finder"]')).toBeTruthy();
  });
});
