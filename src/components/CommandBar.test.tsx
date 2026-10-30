// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CommandBar } from "./CommandBar";
import { useExplorerStore } from "../state/explorerStore";
import { createPane } from "../lib/panes";

function setup(selection: string[] = []) {
  const pane = createPane("/tmp/folder");
  const tab = pane.tabs[0];
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
        tabs: [
          {
            ...tab,
            location: "/tmp/folder",
            listingFor: "/tmp/folder",
            entries: [
              {
                name: "alpha.txt",
                path: "/tmp/folder/alpha.txt",
                isDir: false,
                isSymlink: false,
                size: 10,
                modified: null,
                created: null,
                accessed: null,
                extension: "txt",
                isHidden: false,
                isReadOnly: false,
                target: null,
              },
            ],
            loading: false,
            selection,
            anchorPath: selection[0] ?? null,
          },
        ],
      },
      right: createPane("/tmp/other"),
    },
    activePane: "left",
    interfaceTheme: "windows",
    display: { density: "comfortable", textSize: "default", iconSize: "default" },
    dualPane: false,
    sidebarVisible: true,
    commandBarLabels: true,
    clipboard: null,
    contextMenu: null,
    dialog: null,
  });
}

afterEach(() => {
  cleanup();
});

describe("command bar", () => {
  it("keeps file operations context-aware", () => {
    setup();
    render(<CommandBar />);
    expect((screen.getByRole("button", { name: "Cut" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Paste" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables selection commands for the active pane", () => {
    setup(["/tmp/folder/alpha.txt"]);
    render(<CommandBar />);
    expect((screen.getByRole("button", { name: "Cut" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hosts the dual-pane toggle in the main command area", () => {
    setup();
    render(<CommandBar />);
    const toolbar = screen.getByRole("toolbar", { name: "MAXplorer commands" });
    expect(toolbar.contains(screen.getByRole("button", { name: "Switch to dual pane" }))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dual pane" }));
    expect(useExplorerStore.getState().dualPane).toBe(true);
  });

  it("opens one consolidated settings menu without duplicate section entries", () => {
    setup();
    render(<CommandBar />);
    fireEvent.click(screen.getByRole("button", { name: "Settings and more" }));
    expect(screen.getByRole("menuitem", { name: /^Settings/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Universal Search/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Open in Terminal/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /About MAXplorer/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Appearance and themes/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Display and layout/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Interface theme/ })).toBeNull();
  });
});
