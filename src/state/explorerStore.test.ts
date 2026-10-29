import { beforeEach, describe, expect, it } from "vitest";
import { createPane } from "../lib/panes";
import type { FileEntry, PaneId } from "../lib/types";
import { useExplorerStore } from "./explorerStore";

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

function paneWith(entries: FileEntry[]) {
  const pane = createPane("/tmp/folder");
  const tab = pane.tabs[0];
  return {
    ...pane,
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
  };
}

function setup(entries: FileEntry[]) {
  const id: PaneId = "left";
  useExplorerStore.setState({
    platform: {
      platform: "macos",
      home: "/Users/test",
      pathSeparator: "/",
      modifier: "cmd",
      computerLabel: "This Mac",
    },
    panes: { left: paneWith(entries), right: createPane("/tmp/other") },
    activePane: id,
    interfaceTheme: "windows",
    contextMenu: null,
    dialog: null,
    clipboard: null,
    dualPane: false,
    detailsPane: false,
    previewPane: false,
  });
  return id;
}

describe("explorer store selection", () => {
  beforeEach(() => {
    useExplorerStore.setState({ contextMenu: null });
  });

  it("selects a range in the displayed sorted order, not listing order", () => {
    const entries = [entry("b.txt"), entry("Z Folder", true), entry("a.txt")];
    const id = setup(entries);
    const state = useExplorerStore.getState();
    // sortEntries shows folders first, then a.txt, b.txt.
    state.selectRangeTo(entries[2], false, id);
    state.selectRangeTo(entries[1], false, id);
    expect(useExplorerStore.getState().activeTab(id).selection).toEqual([
      entries[1].path,
      entries[2].path,
    ]);
  });

  it("selects all visible items and records a predictable anchor", () => {
    const entries = [entry("b.txt"), entry("a.txt"), entry("Folder", true)];
    const id = setup(entries);
    useExplorerStore.getState().selectAll(id);
    const tab = useExplorerStore.getState().activeTab(id);
    expect(tab.selection).toEqual([
      entries[2].path,
      entries[1].path,
      entries[0].path,
    ]);
    expect(tab.anchorPath).toBe(entries[2].path);
  });

  it("does not store duplicate or empty paths", () => {
    const id = setup([entry("a.txt"), entry("b.txt")]);
    useExplorerStore.getState().setSelection(
      ["/tmp/folder/a.txt", "", "/tmp/folder/a.txt", "/tmp/folder/b.txt"],
      null,
      id,
    );
    const tab = useExplorerStore.getState().activeTab(id);
    expect(tab.selection).toEqual(["/tmp/folder/a.txt", "/tmp/folder/b.txt"]);
    expect(tab.anchorPath).toBe("/tmp/folder/b.txt");
  });

  it("keeps a mixed file and folder selection intact while toggling", () => {
    const entries = [entry("a.txt"), entry("Folder", true), entry("b.txt")];
    const id = setup(entries);
    const state = useExplorerStore.getState();
    state.setSelection([entries[0].path], entries[0].path, id);
    state.toggleAt(entries[1], id);
    state.toggleAt(entries[2], id);
    expect(useExplorerStore.getState().activeTab(id).selection).toEqual([
      entries[0].path,
      entries[1].path,
      entries[2].path,
    ]);
    useExplorerStore.getState().toggleAt(entries[1], id);
    expect(useExplorerStore.getState().activeTab(id).selection).toEqual([
      entries[0].path,
      entries[2].path,
    ]);
  });

  it("clears selection and anchor", () => {
    const id = setup([entry("a.txt")]);
    useExplorerStore.getState().setSelection(["/tmp/folder/a.txt"], "/tmp/folder/a.txt", id);
    useExplorerStore.getState().clearSelection(id);
    const tab = useExplorerStore.getState().activeTab(id);
    expect(tab.selection).toEqual([]);
    expect(tab.anchorPath).toBeNull();
  });
});
