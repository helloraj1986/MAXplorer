import { useEffect } from "react";
import { CommandBar } from "../components/CommandBar";
import { Sidebar } from "../components/Sidebar";
import { StatusBar } from "../components/StatusBar";
import { DualPaneWorkspace } from "../components/DualPaneWorkspace";
import { useTheme } from "../hooks/useTheme";
import { createTab } from "../lib/tabs";
import { useExplorerStore } from "../state/explorerStore";
import type { FileEntry, Location, PaneState, PlatformInfo } from "../lib/types";

/**
 * Development-only portrait of dual-pane mode. It renders the real workspace
 * with sample rows so the divider, themes and pane indicators can be reviewed
 * in a browser without the Tauri runtime. Never part of the production bundle.
 */

const DEMO_ENTRIES: FileEntry[] = [
  ["Projects", true, null],
  ["Design System.fig", false, 2_400_000],
  ["Product Notes.md", false, 18_000],
  ["Brand Assets", true, null],
  ["launch-hero.png", false, 4_100_000],
  ["Research.pdf", false, 1_200_000],
  ["Archive.zip", false, 860_000],
  ["MAXplorer.app", false, 18_000_000],
  ["Screenshots", true, null],
  ["Release Notes.txt", false, 4_200],
].map(([name, isDir, size], index) => {
  const path = `/Users/demo/Projects/${String(name)}`;
  const extension = String(name).includes(".") ? String(name).split(".").pop() ?? null : null;
  return {
    name: String(name),
    path,
    isDir: Boolean(isDir),
    isSymlink: false,
    size: isDir ? null : (size as number),
    modified: Date.now() - index * 3_600_000,
    created: null,
    accessed: null,
    extension,
    isHidden: false,
    isReadOnly: false,
    target: null,
    mode: null,
    owner: null,
    group: null,
    itemCount: isDir ? 12 + index : null,
  } as FileEntry;
});

function demoPane(location: string, idPrefix: string, selected?: string): PaneState {
  const tab = createTab(location, `${idPrefix}-tab`);
  return {
    tabs: [
      {
        ...tab,
        entries: DEMO_ENTRIES,
        listingFor: location,
        selection: selected ? [selected] : [],
      },
    ],
    activeTabId: tab.id,
    viewMode: "details",
    sortKey: "name",
    sortDirection: "asc",
    groupBy: "none",
    showHidden: false,
    showExtensions: true,
    collapsed: false,
    tagFilterId: null,
  };
}

const PLATFORM: PlatformInfo = {
  platform: "macos",
  home: "/Users/demo",
  pathSeparator: "/",
  modifier: "cmd",
  computerLabel: "This Mac",
};

const LOCATIONS: Location[] = [
  { id: "home", name: "Home", path: "/Users/demo", kind: "home", icon: "home", isVolume: false },
  { id: "desktop", name: "Desktop", path: "/Users/demo/Desktop", kind: "desktop", icon: "desktop", isVolume: false },
  { id: "documents", name: "Documents", path: "/Users/demo/Documents", kind: "documents", icon: "documents", isVolume: false },
  { id: "downloads", name: "Downloads", path: "/Users/demo/Downloads", kind: "downloads", icon: "downloads", isVolume: false },
  { id: "pictures", name: "Pictures", path: "/Users/demo/Pictures", kind: "pictures", icon: "pictures", isVolume: false },
];

export function DualPanePreview() {
  useTheme();
  const params = new URLSearchParams(window.location.search);
  const appearance = params.get("appearance") === "light" ? "light" : "dark";
  const interfaceTheme = params.get("ui") === "finder" ? "finder" : "windows";
  const split = Number(params.get("split") ?? "0.5") || 0.5;

  useEffect(() => {
    useExplorerStore.setState({
      platform: PLATFORM,
      locations: LOCATIONS,
      initialized: true,
      dualPane: true,
      theme: appearance,
      interfaceTheme,
      activePane: "left",
      splitRatio: split,
      panes: {
        left: demoPane("/Users/demo/Projects", "left", "/Users/demo/Projects/Design System.fig"),
        right: demoPane("/Users/demo/Downloads", "right"),
      },
    });
  }, [appearance, interfaceTheme, split]);

  return (
    <div className="app-shell">
      <div className="chrome">
        <CommandBar />
      </div>
      <div className="main-area">
        <Sidebar />
        <DualPaneWorkspace />
      </div>
      <StatusBar />
    </div>
  );
}
