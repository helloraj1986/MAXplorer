// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPane } from "../lib/panes";
import { api } from "../lib/api";
import type { FileEntry, PaneId } from "../lib/types";
import { useExplorerStore } from "./explorerStore";

function entryAt(folder: string, name: string, isDir = false): FileEntry {
  return {
    name,
    path: `${folder}/${name}`,
    isDir,
    isSymlink: false,
    size: isDir ? null : 10,
    modified: null,
    created: null,
    accessed: null,
    extension: isDir ? null : name.split(".").pop() ?? null,
    isHidden: name.startsWith("."),
    isReadOnly: false,
    target: null,
  };
}

function entry(name: string, isDir = false): FileEntry {
  return entryAt("/tmp/folder", name, isDir);
}

function paneAt(folder: string, entries: FileEntry[]) {
  const pane = createPane(folder);
  const tab = pane.tabs[0];
  return {
    ...pane,
    tabs: [
      {
        ...tab,
        location: folder,
        listingFor: folder,
        entries,
        loading: false,
        selection: [],
        anchorPath: null,
      },
    ],
  };
}

function paneWith(entries: FileEntry[]) {
  return paneAt("/tmp/folder", entries);
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("reveal in a MAXplorer pane", () => {
  it("reveals a search result in the requested pane and selects it", async () => {
    const left = paneWith([entry("left.txt")]);
    const right = paneWith([entry("right.txt")]);
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
    });
    await useExplorerStore.getState().revealInPane("/tmp/folder/right.txt", "right");
    expect(useExplorerStore.getState().activePane).toBe("right");
    expect(useExplorerStore.getState().activeTab("right").selection).toEqual(["/tmp/folder/right.txt"]);
  });

  it("restores an explicitly requested collapsed pane before revealing", async () => {
    const left = paneWith([entry("left.txt")]);
    const right = { ...paneWith([entry("right.txt")]), collapsed: true };
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
    });
    await useExplorerStore.getState().revealInPane("/tmp/folder/right.txt", "right");
    expect(useExplorerStore.getState().panes.right.collapsed).toBe(false);
    expect(useExplorerStore.getState().activePane).toBe("right");
    expect(useExplorerStore.getState().activeTab("right").selection).toEqual(["/tmp/folder/right.txt"]);
  });

  it("uses the active pane by default", async () => {
    const left = paneWith([entry("left.txt")]);
    const right = paneWith([entry("right.txt")]);
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
    });
    await useExplorerStore.getState().revealInPane("/tmp/folder/left.txt");
    expect(useExplorerStore.getState().activePane).toBe("left");
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual(["/tmp/folder/left.txt"]);
  });

  it("activates the pane that is already showing the result folder", async () => {
    const left = paneAt("/tmp/left", [entryAt("/tmp/left", "left.txt")]);
    const right = paneWith([entry("right.txt")]);
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
    });

    const revealed = await useExplorerStore.getState().revealInPane("/tmp/folder/right.txt");

    expect(revealed).toBe(true);
    expect(useExplorerStore.getState().activePane).toBe("right");
    expect(useExplorerStore.getState().activeTab("right").selection).toEqual(["/tmp/folder/right.txt"]);
    expect(useExplorerStore.getState().activeTab("left").location).toBe("/tmp/left");
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual([]);
  });

  it("prefers the active pane when both panes show the folder", async () => {
    const left = paneWith([entry("shared.txt")]);
    const right = paneWith([entry("shared.txt")]);
    useExplorerStore.setState({
      dualPane: true,
      activePane: "right",
      panes: { left, right },
    });

    await useExplorerStore.getState().revealInPane("/tmp/folder/shared.txt");

    expect(useExplorerStore.getState().activePane).toBe("right");
    expect(useExplorerStore.getState().activeTab("right").selection).toEqual(["/tmp/folder/shared.txt"]);
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual([]);
  });

  it("reuses an inactive tab showing the result folder instead of navigating", async () => {
    const folderPane = paneWith([entry("target.txt")]);
    const otherTab = createPane("/tmp/other").tabs[0];
    const folderTab = folderPane.tabs[0];
    const left = {
      ...folderPane,
      tabs: [otherTab, ...folderPane.tabs],
      activeTabId: otherTab.id,
    };
    const right = createPane("/tmp/right");
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
    });

    const revealed = await useExplorerStore.getState().revealInPane("/tmp/folder/target.txt");

    expect(revealed).toBe(true);
    expect(useExplorerStore.getState().panes.left.tabs).toHaveLength(2);
    expect(useExplorerStore.getState().activeTab("left").id).toBe(folderTab.id);
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual(["/tmp/folder/target.txt"]);
    expect(useExplorerStore.getState().activeTab("right").location).toBe("/tmp/right");
  });

  it("navigates the active pane without moving a synchronized sibling", async () => {
    const left = paneAt("/tmp/source", [entryAt("/tmp/source", "existing.txt")]);
    const right = paneAt("/tmp/target", [entryAt("/tmp/target", "right.txt")]);
    const result = entryAt("/tmp/source/sub", "result.txt");
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
      syncNavigation: true,
      syncAnchors: { left: "/tmp/source", right: "/tmp/target" },
    });
    vi.spyOn(api, "resolvePath").mockImplementation(async (path) => path);
    vi.spyOn(api, "pathExists").mockResolvedValue(true);
    vi.spyOn(api, "listDirectory").mockImplementation(async (path) => ({
      path,
      entries: path === "/tmp/source/sub" ? [result] : [],
      truncated: false,
      readErrors: 0,
    }));

    const revealed = await useExplorerStore.getState().revealInPane(result.path);

    expect(revealed).toBe(true);
    expect(useExplorerStore.getState().activePane).toBe("left");
    expect(useExplorerStore.getState().activeTab("left").location).toBe("/tmp/source/sub");
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual([result.path]);
    expect(useExplorerStore.getState().activeTab("left").history).toEqual([
      "/tmp/source",
      "/tmp/source/sub",
    ]);
    expect(useExplorerStore.getState().panes.left.tabs).toHaveLength(1);
    expect(useExplorerStore.getState().activeTab("right").location).toBe("/tmp/target");
    expect(api.resolvePath).toHaveBeenCalledWith("/tmp/source/sub");
  });

  it("reports an inaccessible parent folder without selecting", async () => {
    const left = paneAt("/tmp/left", [entryAt("/tmp/left", "existing.txt")]);
    const right = createPane("/tmp/right");
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
      toasts: [],
    });
    vi.spyOn(api, "resolvePath").mockImplementation(async (path) => path);
    vi.spyOn(api, "pathExists").mockResolvedValue(true);
    vi.spyOn(api, "listDirectory").mockRejectedValue({
      code: "permission_denied",
      message: "Permission denied",
      path: "/tmp/private",
    });

    const revealed = await useExplorerStore
      .getState()
      .revealInPane("/tmp/private/secret.txt");

    expect(revealed).toBe(false);
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual([]);
    expect(useExplorerStore.getState().toasts.at(-1)?.title).toBe("Permission denied");
  });

  it("does not leave a stale selection when the result was deleted", async () => {
    const left = paneWith([entry("existing.txt")]);
    const right = createPane("/tmp/right");
    const missing = entry("deleted.txt");
    useExplorerStore.setState({
      dualPane: true,
      activePane: "left",
      panes: { left, right },
      toasts: [],
    });
    vi.spyOn(api, "resolvePath").mockImplementation(async (path) => path);
    vi.spyOn(api, "pathExists").mockResolvedValue(true);
    vi.spyOn(api, "listDirectory").mockImplementation(async (path) => ({
      path,
      entries: [entry("existing.txt")],
      truncated: false,
      readErrors: 0,
    }));

    const revealed = await useExplorerStore.getState().revealInPane(missing.path);

    expect(revealed).toBe(false);
    expect(useExplorerStore.getState().activeTab("left").selection).toEqual([]);
    expect(useExplorerStore.getState().toasts.at(-1)?.title).toContain("can't be found");
    expect(useExplorerStore.getState().contextMenu).toBeNull();
  });
});
