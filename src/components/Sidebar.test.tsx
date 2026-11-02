// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { createPane } from "../lib/panes";
import { useExplorerStore } from "../state/explorerStore";
import {
  NETWORK_LOCATION,
  type Location,
  type PaneId,
  type TagDefinition,
} from "../lib/types";

const workTag: TagDefinition = {
  id: "tag-work",
  name: "Work",
  color: "#0090ff",
  createdAt: 1,
};

const locations: Location[] = [
  {
    id: "shared",
    name: "Shared",
    path: "/Users/Shared",
    kind: "folder",
    icon: "shared",
    isVolume: false,
  },
  {
    id: "icloud",
    name: "iCloud Drive",
    path: "/Users/test/Library/Mobile Documents/com~apple~CloudDocs",
    kind: "folder",
    icon: "icloud",
    isVolume: false,
  },
  {
    id: "root",
    name: "Macintosh HD",
    path: "/",
    kind: "drive",
    icon: "drive",
    isVolume: true,
  },
  {
    id: "trash",
    name: "Trash",
    path: "/Users/test/.Trash",
    kind: "folder",
    icon: "trash",
    isVolume: false,
  },
];

function setup() {
  const id: PaneId = "left";
  const pane = createPane("/Users/test");
  const tab = pane.tabs[0];
  useExplorerStore.setState({
    platform: {
      platform: "macos",
      home: "/Users/test",
      pathSeparator: "/",
      modifier: "cmd",
      computerLabel: "This Mac",
    },
    locations,
    panes: {
      left: {
        ...pane,
        tabs: [{ ...tab, location: "/Users/test", listingFor: "/Users/test" }],
      },
      right: createPane("/tmp/other"),
    },
    activePane: id,
    pinned: ["/Users/test/Documents"],
    tags: [workTag],
    tagAssignments: [
      {
        path: "/Users/test/report.pdf",
        name: "report.pdf",
        isDir: false,
        modified: null,
        size: null,
        tagIds: [workTag.id],
        updatedAt: 1,
      },
    ],
    contextMenu: null,
    dialog: null,
    sidebarWidth: 204,
  });
  return id;
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  cleanup();
});

describe("Finder-style sidebar", () => {
  it("shows collapsible Favorites, Locations, and Tags sections", () => {
    render(<Sidebar />);
    expect(
      screen.getByRole("button", { name: /^Favorites$/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /^Locations$/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /^Tags$/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Recents")).toBeTruthy();
    expect(screen.getByText("Shared")).toBeTruthy();
    expect(screen.getByText("iCloud Drive")).toBeTruthy();
    expect(screen.getByText("Trash")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Locations$/ }));
    expect(
      screen.getByRole("button", { name: /^Locations$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText("iCloud Drive")).toBeNull();
  });

  it("filters the active pane when a tag row is clicked", () => {
    const id = setup();
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Work"));
    expect(useExplorerStore.getState().panes[id].tagFilterId).toBe(workTag.id);
    expect(useExplorerStore.getState().activePane).toBe(id);
  });

  it("opens the tag editor from the New Tag row", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("New Tag..."));
    expect(useExplorerStore.getState().dialog).toEqual({
      kind: "tagEditor",
      tagId: undefined,
      assignPaths: undefined,
    });
  });

  it("opens the Network workspace from Locations", () => {
    const id = setup();
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Network" }));
    expect(useExplorerStore.getState().activeTab(id).location).toBe(
      NETWORK_LOCATION,
    );
  });

  it("opens the connect-to-server dialog from the Network section", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Connect to Server..."));
    expect(useExplorerStore.getState().dialog).toEqual({
      kind: "networkConnection",
      connectionId: undefined,
    });
  });
});
